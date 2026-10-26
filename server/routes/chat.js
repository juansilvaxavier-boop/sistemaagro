// Chat interno: conversas diretas e grupos, mensagens com anexos e áudio, respostas, reações, menções, fixar, silenciar e busca.
// Guarda e exportação das conversas ficam com quem tem a permissão de LGPD.
const express = require('express');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const C = require('../chat');
const { enviarXlsx } = require('../lista');

const { ErroNegocio } = S;
const r = express.Router();

// Anexos: imagens (prints), PDFs, documentos e áudio. O navegador reduz imagens grandes antes de enviar.
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 4);
const EXTENSOES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.txt', '.odt', '.ods', '.xml', '.zip',
  '.mp4', '.mp3', '.ogg', '.m4a', '.webm', '.wav'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ok = EXTENSOES.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new ErroNegocio(`Tipo de arquivo não permitido no chat. Use: ${EXTENSOES.join(', ')}`), ok);
  },
});

// ---------- Administração: guarda e exportação (antes do exige('chat'): o encarregado de LGPD pode não usar o chat) ----------
const adm = express.Router();
adm.use(A.exige('lgpd.titular'));
adm.get('/config', async (req, res) => res.json({ retencao_dias: await C.retencaoDias() }));
adm.put('/config', async (req, res) => res.json({ retencao_dias: await C.definirRetencao(req.body?.retencao_dias, req.user.id) }));
adm.get('/conversas', async (req, res) => {
  const uid = Number(req.query.usuario_id) || null;
  res.json(await db.all(`SELECT c.id, c.tipo, c.nome, c.created_at, c.atualizada_em,
      (SELECT string_agg(u.nome, ', ' ORDER BY u.nome) FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id WHERE mb.conversa_id = c.id) AS participantes,
      (SELECT COUNT(*) FROM chat_mensagens m WHERE m.conversa_id = c.id) AS mensagens
    FROM chat_conversas c WHERE ${uid ? 'EXISTS (SELECT 1 FROM chat_membros x WHERE x.conversa_id = c.id AND x.usuario_id = ?)' : 'TRUE'}
    ORDER BY c.atualizada_em DESC LIMIT 300`, ...(uid ? [uid] : [])));
});
adm.get('/conversas/:id/exportar', async (req, res) => {
  const c = await db.get('SELECT * FROM chat_conversas WHERE id = ?', Number(req.params.id));
  if (!c) throw new ErroNegocio('Conversa não encontrada.', 404);
  const participantes = (await db.all('SELECT u.nome FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id WHERE mb.conversa_id = ? ORDER BY u.nome', c.id)).map((x) => x.nome);
  await require('../auditoria').registrar('lgpd_exportar', 'chat_conversas', c.id, null, { participantes, nome: c.nome });
  const linhas = (await C.exportarLinhas(c.id)).map((l) => ({ ...l, tipo: { audio: 'Áudio', sistema: 'Aviso do sistema' }[l.tipo] || 'Texto' }));
  await enviarXlsx(res, {
    titulo: c.tipo === 'grupo' ? `Grupo ${c.nome}` : `Conversa ${participantes.join(' e ')}`,
    colunas: [{ k: 'created_at', l: 'Data e hora', t: 'datetime' }, { k: 'autor', l: 'Autor' }, { k: 'tipo', l: 'Tipo' }, { k: 'texto', l: 'Mensagem' },
      { k: 'anexos', l: 'Anexos' }, { k: 'responde_a', l: 'Responde à mensagem nº' }, { k: 'editada_em', l: 'Editada em', t: 'datetime' }, { k: 'apagada_em', l: 'Apagada em', t: 'datetime' }],
    linhas,
  });
});
r.use('/admin', adm);

r.use(A.exige('chat'));

r.get('/config', (req, res) => {
  const rt = C.configRealtime();
  res.json({ realtime: rt, topico: C.topicoUsuario(req.user.id), presenca: C.topicoPresenca(), emojis: C.EMOJIS });
});

/** Pessoas para começar conversa ou montar grupo. */
r.get('/contatos', async (req, res) => {
  const linhas = await db.all(`SELECT u.id, u.nome, u.perfil, u.foto IS NOT NULL AS tem_foto, c.cargo, c.departamento
    FROM usuarios u LEFT JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.ativo = 1 AND u.id <> ? ORDER BY u.nome`, req.user.id);
  res.json(linhas.map((l) => ({ ...l, perfil_label: A.PERFIS[l.perfil] })));
});

r.get('/conversas', async (req, res) => res.json(await C.listarConversas(req.user.id)));
r.get('/nao-lidas', async (req, res) => res.json(await C.naoLidas(req.user.id)));

/** O que mudou desde a última consulta (usado quando não há tempo real e depois de cada sinal). */
r.get('/novidades', async (req, res) => {
  const desde = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(req.query.desde || '')) ? req.query.desde : S.agora();
  const agora = S.agora();
  const conversas = (await db.all(`SELECT c.id FROM chat_conversas c JOIN chat_membros mb ON mb.conversa_id = c.id
    WHERE mb.usuario_id = ? AND c.atualizada_em >= ?`, req.user.id, desde)).map((x) => x.id);
  res.json({ agora, conversas, ...(await C.naoLidas(req.user.id)) });
});

r.get('/busca', async (req, res) => res.json(await C.buscar(req.user.id, req.query)));

r.post('/direta/:usuarioId', async (req, res) => res.json({ id: await C.conversaDireta(req.user.id, req.params.usuarioId) }));

r.post('/grupos', async (req, res) => res.status(201).json({ id: await C.criarGrupo(req.user.id, req.body || {}) }));

r.get('/c/:id', async (req, res) => {
  const { conversa, membro } = await C.membro(req.params.id, req.user.id);
  const q = req.query;
  const msgs = await C.mensagens(conversa.id, membro, { desdeId: Number(q.desde_id) || 0, antes: Number(q.antes) || 0, aoRedor: Number(q.ao_redor) || 0 });
  if (!q.antes) await C.marcarLida(conversa.id, req.user.id);
  const membros = await db.all(`SELECT mb.usuario_id AS id, u.nome, u.perfil, u.ativo, u.foto IS NOT NULL AS tem_foto, mb.papel, mb.ultima_lida_id, mb.saiu_em
    FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id WHERE mb.conversa_id = ? ORDER BY mb.saiu_em IS NOT NULL, u.nome`, conversa.id);
  const fixadas = await db.all(`SELECT m.id, m.texto, m.tipo, u.nome AS de_nome, m.fixada_em FROM chat_mensagens m LEFT JOIN usuarios u ON u.id = m.de_id
    JOIN chat_membros mb ON mb.conversa_id = m.conversa_id AND mb.usuario_id = ?
    WHERE m.conversa_id = ? AND m.fixada_em IS NOT NULL AND m.apagada_em IS NULL AND (mb.saiu_em IS NULL OR m.id <= COALESCE(mb.saiu_ate_id, 0)) ORDER BY m.fixada_em DESC`, req.user.id, conversa.id);
  const outro = conversa.tipo === 'direta' ? membros.find((x) => x.id !== req.user.id) : null;
  res.json({
    conversa: {
      id: conversa.id, tipo: conversa.tipo, nome: conversa.tipo === 'grupo' ? conversa.nome : outro?.nome, descricao: conversa.descricao,
      papel: membro.papel, silenciada: !!membro.silenciada, saiu: !!membro.saiu_em, somente_leitura: !!membro.saiu_em || (outro && !outro.ativo),
      outro: outro ? { id: outro.id, nome: outro.nome, perfil_label: A.PERFIS[outro.perfil], ativo: outro.ativo, tem_foto: outro.tem_foto } : null,
      topico: C.topicoConversa(conversa.id),
    },
    membros: membros.map((x) => ({ ...x, perfil_label: A.PERFIS[x.perfil] })),
    fixadas,
    mensagens: msgs,
    tem_mais: !q.desde_id && !q.ao_redor && msgs.length >= 60,
  });
});

r.post('/c/:id/mensagens', async (req, res) => {
  const { conversa } = await C.membro(req.params.id, req.user.id, { escrever: true });
  const b = req.body || {};
  res.status(201).json(await C.gravar({ conversa, eu: req.user.id, texto: b.texto, respondeA: b.responde_a, mencoes: b.mencoes }));
});

// Mensagem com anexos ou áudio (texto opcional).
r.post('/c/:id/anexos', upload.array('arquivos', 5), async (req, res) => {
  const { conversa } = await C.membro(req.params.id, req.user.id, { escrever: true });
  const arquivos = req.files || [];
  if (!arquivos.length) throw new ErroNegocio('Escolha ao menos um arquivo.');
  const b = req.body || {};
  const audio = b.tipo === 'audio';
  if (audio && (arquivos.length !== 1 || !/^audio\//.test(arquivos[0].mimetype))) throw new ErroNegocio('Áudio inválido.');
  let medidas = [];
  let mencoes = [];
  try { medidas = JSON.parse(b.medidas || '[]'); } catch { medidas = []; }
  try { mencoes = JSON.parse(b.mencoes || '[]'); } catch { mencoes = []; }
  res.status(201).json(await C.gravar({
    conversa, eu: req.user.id, texto: audio ? '' : b.texto, tipo: audio ? 'audio' : 'texto', respondeA: b.responde_a, mencoes, arquivos, medidas,
  }));
});

r.put('/mensagens/:id', async (req, res) => { await C.editar(req.params.id, req.user.id, req.body?.texto); res.json({ ok: true }); });
r.delete('/mensagens/:id', async (req, res) => { await C.apagar(req.params.id, req.user.id); res.json({ ok: true }); });
r.post('/mensagens/:id/reacao', async (req, res) => res.json({ ativa: await C.reagir(req.params.id, req.user.id, req.body?.emoji) }));
r.post('/mensagens/:id/fixar', async (req, res) => res.json({ fixada: await C.fixar(req.params.id, req.user.id) }));

r.post('/c/:id/silenciar', async (req, res) => {
  const { conversa } = await C.membro(req.params.id, req.user.id);
  await db.run('UPDATE chat_membros SET silenciada = ? WHERE conversa_id = ? AND usuario_id = ?', req.body?.silenciada ? 1 : 0, conversa.id, req.user.id);
  res.json({ ok: true });
});

const exigirAdmin = async (req) => {
  const x = await C.membro(req.params.id, req.user.id, { escrever: true });
  if (x.conversa.tipo !== 'grupo') throw new ErroNegocio('Só grupos têm essa opção.');
  if (x.membro.papel !== 'admin') throw new ErroNegocio('Só o administrador do grupo pode fazer isso.', 403);
  return x;
};
r.put('/c/:id', async (req, res) => {
  const { conversa } = await exigirAdmin(req);
  const nome = String(req.body?.nome || '').trim();
  if (nome.length < 2) throw new ErroNegocio('Dê um nome ao grupo.');
  await db.run('UPDATE chat_conversas SET nome = ?, descricao = ? WHERE id = ?', nome.slice(0, 80), String(req.body?.descricao || '').slice(0, 300) || null, conversa.id);
  await C.tocar(conversa.id);
  await C.sinal(await C.membrosAtivos(conversa.id), { tipo: 'conversa', conversa_id: conversa.id });
  res.json({ ok: true });
});
r.post('/c/:id/membros', async (req, res) => {
  const { conversa } = await exigirAdmin(req);
  res.json({ adicionados: await C.adicionarMembros(conversa, req.user.id, req.body?.usuarios) });
});
r.post('/c/:id/membros/:uid/admin', async (req, res) => {
  const { conversa } = await exigirAdmin(req);
  await db.run(`UPDATE chat_membros SET papel = CASE WHEN papel = 'admin' THEN 'membro' ELSE 'admin' END WHERE conversa_id = ? AND usuario_id = ? AND saiu_em IS NULL AND usuario_id <> ?`,
    conversa.id, Number(req.params.uid), req.user.id);
  await C.tocar(conversa.id);
  res.json({ ok: true });
});
r.delete('/c/:id/membros/:uid', async (req, res) => {
  const uid = Number(req.params.uid);
  const { conversa } = uid === req.user.id ? await C.membro(req.params.id, req.user.id, { escrever: true }) : await exigirAdmin(req);
  if (conversa.tipo !== 'grupo') throw new ErroNegocio('Só grupos têm essa opção.');
  await C.removerMembro(conversa, req.user.id, uid);
  res.json({ ok: true });
});

/** Anexo: só quem participa (ou participou até a data da mensagem). */
r.get('/anexos/:id', async (req, res) => {
  const a = await db.get(`SELECT a.*, m.conversa_id, m.created_at FROM chat_anexos a JOIN chat_mensagens m ON m.id = a.mensagem_id
    JOIN chat_membros mb ON mb.conversa_id = m.conversa_id AND mb.usuario_id = ? WHERE a.id = ? AND (mb.saiu_em IS NULL OR m.id <= COALESCE(mb.saiu_ate_id, 0))`,
  req.user.id, Number(req.params.id));
  if (!a) throw new ErroNegocio('Anexo não encontrado.', 404);
  const inline = req.query.baixar !== '1' && /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/mp4|audio\/)/.test(a.mime || '');
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
  res.end(Buffer.from(a.conteudo));
});

/** Cartão de pedido, cliente ou chamado citado na mensagem, respeitando o acesso de quem lê. */
r.get('/cartao/:tipo/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (req.params.tipo === 'pedido') {
      if (!A.can(req.user, 'fila') && !A.can(req.user, 'pedido') && !A.can(req.user, 'financeiro') && !A.can(req.user, 'clientes')) throw new ErroNegocio('', 403);
      // "#1234" no texto é o número do pedido.
      const pid = (await db.get('SELECT id FROM pedidos WHERE numero = ?', id))?.id;
      if (!pid) throw new ErroNegocio('', 404);
      const p = await require('./pedidos').carregar(req, pid);
      const cli = await db.get('SELECT nome FROM clientes WHERE id = ?', p.cliente_id);
      return res.json({ tipo: 'pedido', id: p.id, numero: p.numero || p.id, titulo: cli?.nome, etapa: p.etapa, etapa_label: require('../workflow').ETAPAS[p.etapa]?.label, valor: p.valor_total, data: p.created_at });
    }
    if (req.params.tipo === 'cliente') {
      if (!A.can(req.user, 'clientes') && !A.can(req.user, 'crm') && !A.can(req.user, 'cobranca')) throw new ErroNegocio('', 403);
      await require('./clientes').exigirAcessoCliente(req.user, id);
      const c = await db.get('SELECT id, nome, cidade, uf FROM clientes WHERE id = ?', id);
      if (!c) throw new ErroNegocio('', 404);
      const aberto = await db.get(`SELECT COALESCE(SUM(valor + COALESCE(juros,0) - COALESCE(desconto,0) - COALESCE(valor_pago,0)), 0) AS v FROM parcelas WHERE cliente_id = ? AND status = 'a_pagar'`, id);
      return res.json({ tipo: 'cliente', id: c.id, titulo: c.nome, local: [c.cidade, c.uf].filter(Boolean).join('/'), em_aberto: S.r2(aberto.v) });
    }
    if (req.params.tipo === 'chamado') {
      if (!A.can(req.user, 'chamados')) throw new ErroNegocio('', 403);
      const c = await require('./chamados').carregar({ ...req, params: { id } });
      return res.json({ tipo: 'chamado', id: c.id, numero: c.numero, titulo: c.titulo, status: c.status, prioridade: c.prioridade });
    }
    throw new ErroNegocio('', 404);
  } catch (e) {
    if (e instanceof ErroNegocio) return res.status(e.status === 403 ? 403 : 404).json({ erro: 'Sem acesso ou não encontrado.' });
    throw e;
  }
});

module.exports = r;
