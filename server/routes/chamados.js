// Chamados internos (help desk entre setores): abertura, atendimento, prazo por prioridade e avaliação.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const sse = require('../sse');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('chamados'));

const PRIORIDADES = { urgente: 1, alta: 2, media: 5, baixa: 10 };
const STATUS = ['aberto', 'em_andamento', 'aguardando', 'resolvido', 'fechado'];
const STATUS_LABEL = { aberto: 'Aberto', em_andamento: 'Em andamento', aguardando: 'Aguardando solicitante', resolvido: 'Resolvido', fechado: 'Fechado' };

const gestor = (u) => A.can(u, 'chamados.gerir');

/** Quem vê o chamado: quem abriu, o responsável, o setor de destino ou quem gere chamados. */
function visibilidade(req, alias = 'c') {
  if (gestor(req.user)) return { sql: '1=1', params: [] };
  return {
    sql: `(${alias}.solicitante_id = ? OR ${alias}.responsavel_id = ? OR ${alias}.setor_destino = ?)`,
    params: [req.user.id, req.user.id, req.user.perfil],
  };
}

const LISTA_SQL = `
  SELECT c.id, c.numero, c.created_at AS aberto_em, c.titulo, c.categoria, c.setor_destino, c.prioridade, c.status,
    s.nome AS solicitante, c.solicitante_id, rp.nome AS responsavel, c.responsavel_id, c.prazo,
    CASE WHEN c.status IN ('resolvido','fechado') THEN 0 WHEN c.prazo < date('now','localtime') THEN 1 ELSE 0 END AS atrasado,
    p.numero AS pedido, c.updated_at, c.avaliacao,
    (SELECT COUNT(*) FROM chamado_interacoes i WHERE i.chamado_id = c.id AND i.tipo = 'comentario') AS comentarios
  FROM chamados c JOIN usuarios s ON s.id = c.solicitante_id LEFT JOIN usuarios rp ON rp.id = c.responsavel_id
  LEFT JOIN pedidos p ON p.id = c.pedido_id`;

r.get('/', async (req, res) => {
  const v = visibilidade(req);
  const cond = [v.sql];
  const params = [...v.params];
  const escopo = req.query.escopo;
  if (escopo === 'meus') cond.push('c.solicitante_id = ?'), params.push(req.user.id);
  else if (escopo === 'atribuidos') cond.push('c.responsavel_id = ?'), params.push(req.user.id);
  else if (escopo === 'setor') cond.push('c.setor_destino = ?'), params.push(req.user.perfil);
  if (req.query.abertos === '1') cond.push(`c.status NOT IN ('resolvido','fechado')`);
  await responderLista(req, res, {
    sql: `${LISTA_SQL} WHERE (c.empresa_id IS NULL OR c.empresa_id = ?) AND ${cond.join(' AND ')}`,
    params: [req.empresaId, ...params], sort: 'id', dir: 'desc', exact: ['status', 'prioridade', 'setor_destino', 'atrasado'],
  });
});

/** Contadores para o menu e o painel. */
r.get('/contagem', async (req, res) => {
  const v = visibilidade(req);
  const t = await db.get(
    `SELECT COUNT(*) FILTER (WHERE c.status NOT IN ('resolvido','fechado') AND (c.setor_destino = ? OR c.responsavel_id = ?)) AS para_mim,
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolvido','fechado') AND c.solicitante_id = ?) AS meus_abertos,
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolvido','fechado') AND c.prazo < date('now','localtime')) AS atrasados,
            COUNT(*) FILTER (WHERE c.status NOT IN ('resolvido','fechado')) AS abertos,
            COUNT(*) FILTER (WHERE c.status = 'resolvido' AND c.solicitante_id = ? AND c.avaliacao IS NULL) AS avaliar
       FROM chamados c WHERE (c.empresa_id IS NULL OR c.empresa_id = ?) AND ${v.sql}`,
    req.user.perfil, req.user.id, req.user.id, req.user.id, req.empresaId, ...v.params,
  );
  res.json(t);
});

async function carregar(req) {
  const v = visibilidade(req);
  const c = await db.get(`SELECT c.* FROM chamados c WHERE c.id = ? AND ${v.sql}`, Number(req.params.id), ...v.params);
  if (!c) throw new ErroNegocio('Chamado não encontrado', 404);
  return c;
}

const podeAtender = (req, c) => gestor(req.user) || c.setor_destino === req.user.perfil || c.responsavel_id === req.user.id;

r.get('/:id', async (req, res) => {
  const c = await carregar(req);
  const det = await db.get(`${LISTA_SQL} WHERE c.id = ?`, c.id);
  res.json({
    ...c, ...det,
    interacoes: await db.all(
      'SELECT i.*, u.nome AS usuario, u.id AS usuario_id FROM chamado_interacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE chamado_id = ? ORDER BY i.id', c.id,
    ),
    pode_atender: podeAtender(req, c),
    e_solicitante: c.solicitante_id === req.user.id,
    atendentes: await db.all(
      `SELECT id, nome, perfil FROM usuarios WHERE ativo = 1 AND (perfil = ? OR perfil IN ('admin','diretoria')) ORDER BY nome`, c.setor_destino || '',
    ),
  });
});

async function interacao(chamadoId, usuarioId, tipo, texto) {
  await db.insert('chamado_interacoes', { chamado_id: chamadoId, usuario_id: usuarioId, tipo, texto }, null, { auditoria: false });
  await db.run(`UPDATE chamados SET updated_at = datetime('now','localtime') WHERE id = ?`, chamadoId);
}

function avisar(c, texto, autorId) {
  const usuarios = [c.solicitante_id, c.responsavel_id].filter(Boolean);
  const dados = { id: c.id, numero: c.numero, titulo: c.titulo, texto };
  sse.enviar('chamado', dados, { usuarios, exceto: autorId });
  if (!c.responsavel_id && c.setor_destino) sse.enviar('chamado', dados, { perfis: [c.setor_destino], exceto: autorId });
}

r.post('/', async (req, res) => {
  const b = req.body || {};
  const titulo = String(b.titulo || '').trim();
  const descricao = String(b.descricao || '').trim();
  if (!titulo) throw new ErroNegocio('Informe o título.');
  if (!descricao) throw new ErroNegocio('Descreva o chamado.');
  if (!A.PERFIS[b.setor_destino]) throw new ErroNegocio('Escolha o setor que vai atender.');
  const prioridade = PRIORIDADES[b.prioridade] ? b.prioridade : 'media';
  let pedidoId = null;
  if (b.pedido_numero) {
    const p = await db.get('SELECT id FROM pedidos WHERE numero = ? AND empresa_id = ?', Number(b.pedido_numero), req.empresaId);
    if (!p) throw new ErroNegocio('Pedido não encontrado.');
    pedidoId = p.id;
  }
  const c = await db.tx(async () => {
    const numero = await db.nextSeq('chamado', 1001);
    const id = await db.insert('chamados', {
      numero, empresa_id: req.empresaId, titulo, descricao, categoria: b.categoria || null, setor_destino: b.setor_destino, prioridade,
      status: 'aberto', solicitante_id: req.user.id, pedido_id: pedidoId, prazo: S.addDias(S.hoje(), PRIORIDADES[prioridade]),
    });
    await interacao(id, req.user.id, 'abertura', 'Chamado aberto');
    return db.get('SELECT * FROM chamados WHERE id = ?', id);
  });
  avisar(c, `Novo chamado #${c.numero}: ${c.titulo}`, req.user.id);
  res.status(201).json({ id: c.id, numero: c.numero });
});

r.post('/:id/comentar', async (req, res) => {
  const c = await carregar(req);
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva o comentário.');
  if (c.status === 'fechado') throw new ErroNegocio('Chamado fechado. Reabra para comentar.');
  await interacao(c.id, req.user.id, 'comentario', texto);
  // Resposta do solicitante a um chamado aguardando volta para atendimento.
  if (c.status === 'aguardando' && c.solicitante_id === req.user.id) {
    await db.run(`UPDATE chamados SET status = 'em_andamento' WHERE id = ?`, c.id);
  }
  avisar(c, `Chamado #${c.numero}: novo comentário de ${req.user.nome}`, req.user.id);
  res.status(201).json({ ok: true });
});

r.post('/:id/status', async (req, res) => {
  const c = await carregar(req);
  const novo = req.body?.status;
  if (!STATUS.includes(novo)) throw new ErroNegocio('Status inválido.');
  const solicitante = c.solicitante_id === req.user.id;
  // O solicitante pode fechar o próprio chamado ou reabri-lo; os demais status são do atendimento.
  const doSolicitante = solicitante && (novo === 'fechado' || (novo === 'aberto' && ['resolvido', 'fechado'].includes(c.status)));
  if (!doSolicitante && !podeAtender(req, c)) throw new ErroNegocio('Só quem atende o chamado pode mudar o status.', 403);
  const obs = String(req.body?.observacao || '').trim();
  if (novo === 'resolvido' && !obs) throw new ErroNegocio('Descreva a solução.');
  const campos = { status: novo };
  if (novo === 'resolvido') campos.resolvido_em = S.hoje();
  if (novo === 'aberto') Object.assign(campos, { resolvido_em: null, avaliacao: null });
  if (novo === 'em_andamento' && !c.responsavel_id && podeAtender(req, c)) campos.responsavel_id = req.user.id;
  await db.update('chamados', c.id, campos);
  await interacao(c.id, req.user.id, 'status', `${STATUS_LABEL[c.status]} → ${STATUS_LABEL[novo]}${obs ? ': ' + obs : ''}`);
  avisar({ ...c, ...campos }, `Chamado #${c.numero}: ${STATUS_LABEL[novo]}`, req.user.id);
  res.json({ ok: true });
});

r.post('/:id/atribuir', async (req, res) => {
  const c = await carregar(req);
  if (!podeAtender(req, c)) throw new ErroNegocio('Sem permissão para atribuir.', 403);
  const u = req.body?.responsavel_id ? await db.get('SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1', Number(req.body.responsavel_id)) : null;
  if (req.body?.responsavel_id && !u) throw new ErroNegocio('Usuário inválido.');
  const campos = { responsavel_id: u?.id || null };
  if (u && c.status === 'aberto') campos.status = 'em_andamento';
  await db.update('chamados', c.id, campos);
  await interacao(c.id, req.user.id, 'atribuicao', u ? `Atribuído a ${u.nome}` : 'Responsável removido');
  avisar({ ...c, ...campos }, `Chamado #${c.numero} atribuído a ${u?.nome || 'ninguém'}`, req.user.id);
  res.json({ ok: true });
});

r.put('/:id', async (req, res) => {
  const c = await carregar(req);
  if (!podeAtender(req, c) && c.solicitante_id !== req.user.id) throw new ErroNegocio('Sem permissão.', 403);
  const b = req.body || {};
  const campos = {};
  if (b.prioridade && PRIORIDADES[b.prioridade]) campos.prioridade = b.prioridade;
  if (b.categoria !== undefined) campos.categoria = b.categoria;
  if (b.prazo && podeAtender(req, c)) campos.prazo = b.prazo;
  if (b.setor_destino && A.PERFIS[b.setor_destino] && podeAtender(req, c)) Object.assign(campos, { setor_destino: b.setor_destino, responsavel_id: null });
  await db.update('chamados', c.id, campos);
  if (campos.setor_destino && campos.setor_destino !== c.setor_destino) {
    await interacao(c.id, req.user.id, 'atribuicao', `Transferido para ${A.PERFIS[campos.setor_destino]}`);
  }
  res.json({ ok: true });
});

r.post('/:id/avaliar', async (req, res) => {
  const c = await carregar(req);
  if (c.solicitante_id !== req.user.id) throw new ErroNegocio('Só quem abriu o chamado avalia o atendimento.', 403);
  if (!['resolvido', 'fechado'].includes(c.status)) throw new ErroNegocio('Avalie depois que o chamado for resolvido.');
  const nota = parseInt(req.body?.avaliacao, 10);
  if (!(nota >= 1 && nota <= 5)) throw new ErroNegocio('A avaliação vai de 1 a 5.');
  await db.update('chamados', c.id, { avaliacao: nota, status: 'fechado' });
  await interacao(c.id, req.user.id, 'status', `Atendimento avaliado com ${nota} de 5${req.body?.comentario ? ': ' + req.body.comentario : ''}`);
  res.json({ ok: true });
});

module.exports = r;
module.exports.PRIORIDADES = PRIORIDADES;
module.exports.carregar = carregar;
