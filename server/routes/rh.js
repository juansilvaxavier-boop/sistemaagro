// RH e DP: ficha do colaborador, férias, ponto e ocorrências, benefícios, exames, documentos,
// eventos da folha para a contabilidade, solicitações (Meu RH) e painel.
const express = require('express');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const RH = require('../rh');
const sse = require('../sse');
const { responderLista, enviarXlsx } = require('../lista');
const { registrar } = require('../auditoria');
const { mascararObjeto } = require('../lgpd');

const r = express.Router();
const { ErroNegocio, r2 } = S;

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 4);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ok = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.odt'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new ErroNegocio('Envie PDF, imagem ou documento do Office.'), ok);
  },
});

const gere = (u) => A.can(u, 'rh.gerir');
const CB = require('../colaborador');
const CAMPOS = CB.CAMPOS;
// Campos que só quem gere o RH vê (remuneração e dados bancários).
const RESTRITOS = CB.RESTRITOS;
const ocultar = (u, obj) => { if (obj && !gere(u) && !A.can(u, 'rh.folha')) for (const k of RESTRITOS) delete obj[k]; return obj; };

async function colaborador(id) {
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', Number(id));
  if (!c) throw new ErroNegocio('Colaborador não encontrado', 404);
  return c;
}
const usuariosDoRH = async () => (await db.all(`SELECT id FROM usuarios WHERE ativo = 1 AND (perfil IN ('rh','admin') OR permissoes LIKE '%"rh.gerir"%')`)).map((x) => x.id);

// ======================= Meu RH (o próprio colaborador) =======================
async function meuColaborador(req) {
  if (!req.user.colaborador_id) throw new ErroNegocio('Seu usuário não está ligado a um colaborador. Fale com o RH.', 404);
  return colaborador(req.user.colaborador_id);
}

r.get('/meu', async (req, res) => {
  if (!req.user.colaborador_id) return res.json({ vinculado: false });
  const c = await meuColaborador(req);
  res.json({
    vinculado: true,
    colaborador: {
      nome: c.nome, cargo: c.cargo, departamento: c.departamento || c.setor, data_admissao: c.data_admissao, tipo_contrato: RH.TIPOS_CONTRATO[c.tipo_contrato] || c.tipo_contrato,
      jornada: c.jornada, bate_ponto: c.bate_ponto, salario: c.salario, gestor: c.gestor_id ? (await db.get('SELECT nome FROM colaboradores WHERE id = ?', c.gestor_id))?.nome : null,
      email: c.email, telefone: c.telefone, cidade: c.cidade, uf: c.uf,
    },
    periodos: await RH.periodosFerias(c),
    ferias: await db.all(`SELECT id, inicio, fim, dias, abono_dias, status, resposta FROM rh_ferias WHERE colaborador_id = ? ORDER BY inicio DESC LIMIT 20`, c.id),
    banco_horas: await RH.saldoBancoHoras(c.id),
    ocorrencias: await db.all(`SELECT data, tipo, horas, dias, descricao FROM rh_ocorrencias WHERE colaborador_id = ? AND tipo NOT IN ('advertencia','suspensao') ORDER BY data DESC LIMIT 30`, c.id),
    beneficios: await db.all(`SELECT tipo, descricao, valor_desconto FROM rh_beneficios WHERE colaborador_id = ? AND ativo = 1`, c.id),
    exames: await db.all(`SELECT tipo, data, validade, resultado FROM rh_exames WHERE colaborador_id = ? ORDER BY data DESC LIMIT 5`, c.id),
    solicitacoes: await db.all(`SELECT s.id, s.tipo, s.descricao, s.data_inicio, s.data_fim, s.status, s.resposta, s.respondido_em, s.created_at, a.nome_original AS arquivo
      FROM rh_solicitacoes s LEFT JOIN arquivos a ON a.id = s.arquivo_id WHERE s.colaborador_id = ? ORDER BY s.id DESC LIMIT 30`, c.id),
    tipos: RH.TIPOS_SOLICITACAO,
  });
});

/** O colaborador pede algo ao RH; férias já entram como programação "solicitada" para aprovação. */
r.post('/meu/solicitacoes', upload.single('arquivo'), async (req, res) => {
  const c = await meuColaborador(req);
  const b = req.body || {};
  if (!RH.TIPOS_SOLICITACAO[b.tipo]) throw new ErroNegocio('Escolha o tipo de solicitação.');
  const descricao = String(b.descricao || '').trim() || RH.TIPOS_SOLICITACAO[b.tipo];
  if (b.tipo === 'atestado' && !req.file) throw new ErroNegocio('Anexe o atestado.');
  const id = await db.tx(async () => {
    let feriasId = null;
    if (b.tipo === 'ferias') {
      const dias = Number(b.dias) || (b.data_inicio && b.data_fim ? S.diasEntre(b.data_inicio, b.data_fim) + 1 : 0);
      const f = await RH.validarFerias(c, { inicio: b.data_inicio, dias, abono_dias: Number(b.abono_dias) || 0 });
      feriasId = await db.insert('rh_ferias', { ...f, colaborador_id: c.id, status: 'solicitada', observacao: descricao, solicitado_por: req.user.id });
      b.data_fim = f.fim;
    }
    let arquivoId = null;
    if (req.file) {
      arquivoId = await db.insert('arquivos', {
        colaborador_id: c.id, categoria: b.tipo === 'atestado' ? 'Atestado' : 'Documento do colaborador', descricao, nome_original: req.file.originalname,
        conteudo: req.file.buffer, mime: req.file.mimetype, tamanho: req.file.size, usuario_id: req.user.id,
      }, null, { auditoria: false });
    }
    return db.insert('rh_solicitacoes', { colaborador_id: c.id, tipo: b.tipo, descricao, data_inicio: b.data_inicio || null, data_fim: b.data_fim || null, arquivo_id: arquivoId, ferias_id: feriasId });
  });
  sse.enviar('rh', { texto: `Nova solicitação de ${c.nome}: ${RH.TIPOS_SOLICITACAO[b.tipo]}`, id }, { usuarios: await usuariosDoRH(), exceto: req.user.id });
  res.status(201).json({ id });
});

// ======================= Painel do RH =======================
r.get('/painel', A.exige('rh'), async (req, res) => {
  const hoje = S.hoje();
  const mes = hoje.slice(0, 7);
  const emp = req.empresaId;
  const ativos = `COALESCE(c.empresa_id, ${Number(emp)}) = ${Number(emp)} AND c.ativo = 1 AND c.data_desligamento IS NULL`;
  const t = await db.get(`SELECT
      (SELECT COUNT(*) FROM colaboradores c WHERE ${ativos}) AS ativos,
      (SELECT COUNT(*) FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND substr(c.data_admissao,1,7) = ?) AS admissoes_mes,
      (SELECT COUNT(*) FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND substr(c.data_desligamento,1,7) = ?) AS desligamentos_mes,
      (SELECT COUNT(*) FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND c.data_desligamento >= ?) AS desligamentos_12m,
      (SELECT COALESCE(SUM(c.salario),0) FROM colaboradores c WHERE ${ativos}) AS folha_base,
      (SELECT COALESCE(SUM(b.valor_empresa),0) FROM rh_beneficios b JOIN colaboradores c ON c.id = b.colaborador_id WHERE b.ativo = 1 AND ${ativos}) AS beneficios,
      (SELECT COUNT(*) FROM rh_solicitacoes s JOIN colaboradores c ON c.id = s.colaborador_id WHERE s.status = 'aberta' AND COALESCE(c.empresa_id, ?) = ?) AS solicitacoes,
      (SELECT COUNT(*) FROM rh_ferias f JOIN colaboradores c ON c.id = f.colaborador_id WHERE f.status = 'aprovada' AND ? BETWEEN f.inicio AND f.fim AND ${ativos}) AS em_ferias,
      (SELECT COUNT(*) FROM rh_ferias f JOIN colaboradores c ON c.id = f.colaborador_id WHERE f.status = 'solicitada' AND ${ativos}) AS ferias_pendentes`,
    emp, emp, mes, emp, emp, mes, emp, emp, S.addDias(hoje, -365), emp, emp, hoje);
  const colabs = await db.all(`SELECT c.* FROM colaboradores c WHERE ${ativos} ORDER BY c.nome`);
  const alertas = [];
  let feriasVencidas = 0;
  for (const c of colabs) {
    const p = await RH.periodosFerias(c, hoje);
    for (const x of p.filter((y) => ['vencida', 'vence_logo'].includes(y.situacao))) {
      if (x.situacao === 'vencida') feriasVencidas++;
      alertas.push({ tipo: x.situacao === 'vencida' ? 'erro' : 'atencao', colaborador_id: c.id, nome: c.nome,
        texto: x.situacao === 'vencida' ? `Férias vencidas (${x.saldo} dias do período ${x.inicio.split('-').reverse().join('/')}): pagamento em dobro` : `Férias precisam ser concedidas até ${x.limite_concessivo.split('-').reverse().join('/')} (${x.saldo} dias)`, data: x.limite_concessivo });
    }
    if (c.data_admissao && c.tipo_contrato === 'clt') {
      for (const d of [45, Number(c.experiencia_dias) || 90]) {
        const fimExp = S.addDias(c.data_admissao, d - 1);
        if (fimExp >= hoje && S.diasEntre(hoje, fimExp) <= 15) alertas.push({ tipo: 'atencao', colaborador_id: c.id, nome: c.nome, texto: `Contrato de experiência (${d} dias) termina em ${fimExp.split('-').reverse().join('/')}`, data: fimExp });
      }
    }
  }
  for (const e of await db.all(`SELECT e.*, c.nome FROM rh_exames e JOIN colaboradores c ON c.id = e.colaborador_id WHERE ${ativos}
      AND e.validade IS NOT NULL AND e.validade <= ? AND e.id = (SELECT MAX(id) FROM rh_exames x WHERE x.colaborador_id = e.colaborador_id)`, S.addDias(hoje, 30))) {
    alertas.push({ tipo: e.validade < hoje ? 'erro' : 'atencao', colaborador_id: e.colaborador_id, nome: e.nome, texto: `Exame ocupacional ${e.validade < hoje ? 'vencido' : 'vence'} em ${e.validade.split('-').reverse().join('/')}`, data: e.validade });
  }
  alertas.sort((a, b) => (a.tipo === b.tipo ? a.data.localeCompare(b.data) : a.tipo === 'erro' ? -1 : 1));
  const aniversariantes = colabs.filter((c) => c.data_nascimento && c.data_nascimento.slice(5, 7) === hoje.slice(5, 7))
    .map((c) => ({ id: c.id, nome: c.nome, dia: c.data_nascimento.slice(8, 10), cargo: c.cargo })).sort((a, b) => a.dia.localeCompare(b.dia));
  const porDepto = await db.all(`SELECT COALESCE(c.departamento, c.setor, 'Sem departamento') AS nome, COUNT(*) AS n FROM colaboradores c WHERE ${ativos} GROUP BY 1 ORDER BY 2 DESC`);
  const mostrarCusto = gere(req.user) || A.can(req.user, 'rh.folha');
  res.json({
    ...t, ferias_vencidas: feriasVencidas, turnover_12m: t.ativos ? r2((t.desligamentos_12m / t.ativos) * 100) : 0,
    folha_base: mostrarCusto ? t.folha_base : null, beneficios: mostrarCusto ? t.beneficios : null,
    alertas: alertas.slice(0, 40), aniversariantes, por_departamento: porDepto,
  });
});

// ======================= Colaboradores (ficha) =======================
r.get('/colaboradores', A.exige('rh'), async (req, res) => {
  const ver = gere(req.user) || A.can(req.user, 'rh.folha');
  await responderLista(req, res, {
    sql: `SELECT c.id, c.nome, c.cpf, c.cargo, COALESCE(c.departamento, c.setor) AS departamento, c.tipo_contrato, c.data_admissao,
            CAST((julianday(COALESCE(c.data_desligamento, date('now','localtime'))) - julianday(c.data_admissao)) / 365.25 AS INTEGER) AS anos_casa,
            g.nome AS gestor, c.telefone, c.email, ${ver ? 'c.salario' : 'NULL::float8 AS salario'},
            CASE WHEN c.data_desligamento IS NOT NULL OR c.ativo = 0 THEN 'desligado' ELSE 'ativo' END AS situacao, c.data_desligamento,
            u.login, u.id AS usuario_id, (SELECT COUNT(*) FROM rh_solicitacoes s WHERE s.colaborador_id = c.id AND s.status = 'aberta') AS solicitacoes
          FROM colaboradores c LEFT JOIN colaboradores g ON g.id = c.gestor_id LEFT JOIN usuarios u ON u.colaborador_id = c.id
          WHERE COALESCE(c.empresa_id, ?) = ?`,
    params: [req.empresaId, req.empresaId], sort: 'nome', dir: 'asc', exact: ['situacao', 'tipo_contrato'],
  });
});

r.get('/colaboradores/:id', A.exige('rh'), async (req, res) => {
  const c = await colaborador(req.params.id);
  await registrar('visualizar', 'colaboradores', c.id, null, null);
  const g = gere(req.user);
  res.json({
    colaborador: ocultar(req.user, mascararObjeto(req.user, { ...c })),
    usuario: await db.get('SELECT id, login, perfil, ativo FROM usuarios WHERE colaborador_id = ?', c.id),
    dependentes: await db.all('SELECT * FROM rh_dependentes WHERE colaborador_id = ? ORDER BY nome', c.id),
    historico: (await db.all('SELECT h.*, u.nome AS usuario FROM rh_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.colaborador_id = ? ORDER BY h.data DESC, h.id DESC', c.id))
      .map((h) => (g || A.can(req.user, 'rh.folha') ? h : { ...h, salario: null })),
    periodos: await RH.periodosFerias(c),
    ferias: await db.all('SELECT * FROM rh_ferias WHERE colaborador_id = ? ORDER BY inicio DESC', c.id),
    ocorrencias: await db.all('SELECT o.*, u.nome AS usuario FROM rh_ocorrencias o LEFT JOIN usuarios u ON u.id = o.usuario_id WHERE o.colaborador_id = ? ORDER BY o.data DESC, o.id DESC LIMIT 200', c.id),
    banco_horas: await RH.saldoBancoHoras(c.id),
    beneficios: await db.all('SELECT * FROM rh_beneficios WHERE colaborador_id = ? ORDER BY ativo DESC, tipo', c.id),
    exames: await db.all('SELECT * FROM rh_exames WHERE colaborador_id = ? ORDER BY data DESC', c.id),
    documentos: await db.all(`SELECT a.id, a.categoria, a.descricao, a.nome_original, a.tamanho, a.created_at, u.nome AS usuario FROM arquivos a
      LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.colaborador_id = ? ORDER BY a.id DESC`, c.id),
    pode_gerir: g,
  });
});

r.post('/colaboradores', A.exige('rh.gerir'), async (req, res) => {
  const d = await CB.dados(req.body || {}, req.user);
  d.empresa_id ||= req.empresaId;
  const id = await db.tx(async () => {
    const novo = await db.insert('colaboradores', { ativo: 1, ...d }, CAMPOS);
    if (d.data_admissao) await db.insert('rh_historico', { colaborador_id: novo, data: d.data_admissao, tipo: 'admissao', cargo: d.cargo, departamento: d.departamento, salario: d.salario, descricao: 'Admissão', usuario_id: req.user.id });
    return novo;
  });
  res.status(201).json({ id });
});

r.put('/colaboradores/:id', A.exige('rh.gerir'), async (req, res) => {
  const c = await colaborador(req.params.id);
  const d = await CB.dados(req.body || {}, req.user, c);
  await db.tx(async () => {
    await db.update('colaboradores', c.id, d, CAMPOS);
    await CB.sincronizarUsuario(c.id);
    // Mudança de salário, cargo ou departamento entra sozinha no histórico do contrato.
    const mudou = (k) => d[k] !== undefined && String(d[k] ?? '') !== String(c[k] ?? '');
    if (mudou('salario') || mudou('cargo') || mudou('departamento')) {
      const tipo = mudou('cargo') ? 'mudanca_cargo' : mudou('salario') ? 'reajuste' : 'transferencia';
      const partes = [];
      if (mudou('cargo')) partes.push(`Cargo: ${c.cargo || '—'} → ${d.cargo || '—'}`);
      if (mudou('departamento')) partes.push(`Departamento: ${c.departamento || '—'} → ${d.departamento || '—'}`);
      if (mudou('salario')) partes.push(`Salário: ${c.salario ?? '—'} → ${d.salario ?? '—'}`);
      await db.insert('rh_historico', { colaborador_id: c.id, data: req.body?.data_alteracao || S.hoje(), tipo: req.body?.tipo_alteracao && RH.TIPOS_HISTORICO[req.body.tipo_alteracao] ? req.body.tipo_alteracao : tipo,
        cargo: d.cargo ?? c.cargo, departamento: d.departamento ?? c.departamento, salario: d.salario ?? c.salario, descricao: partes.join(' · '), usuario_id: req.user.id });
    }
  });
  res.json({ ok: true });
});

r.post('/colaboradores/:id/desligar', A.exige('rh.gerir'), async (req, res) => {
  const c = await colaborador(req.params.id);
  const b = req.body || {};
  if (c.data_desligamento) throw new ErroNegocio('Colaborador já desligado.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw new ErroNegocio('Informe a data do desligamento.');
  if (!RH.TIPOS_DESLIGAMENTO[b.tipo]) throw new ErroNegocio('Informe o tipo de desligamento.');
  await db.tx(async () => {
    await db.update('colaboradores', c.id, { data_desligamento: b.data, tipo_desligamento: b.tipo, motivo_desligamento: b.motivo || null, ativo: 0 });
    await db.insert('rh_historico', { colaborador_id: c.id, data: b.data, tipo: 'desligamento', cargo: c.cargo, departamento: c.departamento, salario: c.salario,
      descricao: `${RH.TIPOS_DESLIGAMENTO[b.tipo]}${b.motivo ? ': ' + b.motivo : ''}`, usuario_id: req.user.id });
    // O acesso ao sistema é encerrado junto.
    const u = await db.get('SELECT id FROM usuarios WHERE colaborador_id = ?', c.id);
    if (u) {
      await db.update('usuarios', u.id, { ativo: 0 });
      await db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.id);
    }
  });
  res.json({ ok: true });
});

r.post('/colaboradores/:id/reativar', A.exige('rh.gerir'), async (req, res) => {
  const c = await colaborador(req.params.id);
  await db.update('colaboradores', c.id, { data_desligamento: null, tipo_desligamento: null, motivo_desligamento: null, ativo: 1 });
  await db.insert('rh_historico', { colaborador_id: c.id, data: S.hoje(), tipo: 'outro', descricao: 'Desligamento desfeito (readmissão)', usuario_id: req.user.id });
  res.json({ ok: true });
});

// ---------- Listas da ficha (dependentes, histórico, benefícios, exames) ----------
const SUBS = {
  dependentes: ['rh_dependentes', ['nome', 'parentesco', 'data_nascimento', 'cpf', 'irrf', 'salario_familia']],
  historico: ['rh_historico', ['data', 'tipo', 'cargo', 'departamento', 'salario', 'descricao']],
  beneficios: ['rh_beneficios', ['tipo', 'descricao', 'valor_empresa', 'valor_desconto', 'inicio', 'fim', 'ativo']],
  exames: ['rh_exames', ['tipo', 'data', 'validade', 'resultado', 'clinica', 'observacao']],
};
r.post('/colaboradores/:id/:sub', A.exige('rh.gerir'), async (req, res, next) => {
  const def = SUBS[req.params.sub];
  if (!def) return next();
  const c = await colaborador(req.params.id);
  const b = { ...req.body, colaborador_id: c.id };
  if (req.params.sub === 'dependentes' && !String(b.nome || '').trim()) throw new ErroNegocio('Informe o nome do dependente.');
  if (req.params.sub === 'historico' && (!b.data || !RH.TIPOS_HISTORICO[b.tipo])) throw new ErroNegocio('Informe data e tipo.');
  if (req.params.sub === 'beneficios' && !RH.TIPOS_BENEFICIO[b.tipo]) throw new ErroNegocio('Tipo de benefício inválido.');
  if (req.params.sub === 'exames') {
    if (!RH.TIPOS_EXAME[b.tipo] || !b.data) throw new ErroNegocio('Informe tipo e data do exame.');
    b.validade ||= b.tipo === 'demissional' ? null : S.addDias(b.data, 365);
  }
  if (req.params.sub === 'historico') b.usuario_id = req.user.id;
  res.status(201).json({ id: await db.insert(def[0], b, ['colaborador_id', 'usuario_id', ...def[1]]) });
});
r.put('/colaboradores/:id/:sub/:itemId', A.exige('rh.gerir'), async (req, res, next) => {
  const def = SUBS[req.params.sub];
  if (!def) return next();
  const item = await db.get(`SELECT id FROM ${def[0]} WHERE id = ? AND colaborador_id = ?`, Number(req.params.itemId), Number(req.params.id));
  if (!item) throw new ErroNegocio('Registro não encontrado', 404);
  await db.update(def[0], item.id, req.body || {}, def[1]);
  res.json({ ok: true });
});
r.delete('/colaboradores/:id/:sub/:itemId', A.exige('rh.gerir'), async (req, res, next) => {
  const def = SUBS[req.params.sub];
  if (!def) return next();
  const item = await db.get(`SELECT id FROM ${def[0]} WHERE id = ? AND colaborador_id = ?`, Number(req.params.itemId), Number(req.params.id));
  if (!item) throw new ErroNegocio('Registro não encontrado', 404);
  await db.remove(def[0], item.id);
  res.json({ ok: true });
});

// ---------- Documentos do colaborador ----------
r.post('/colaboradores/:id/documentos', A.exige('rh.gerir', 'cadastros.colaborador'), upload.single('arquivo'), async (req, res) => {
  const c = await colaborador(req.params.id);
  if (!req.file) throw new ErroNegocio('Escolha o arquivo.');
  const id = await db.insert('arquivos', {
    colaborador_id: c.id, categoria: req.body?.categoria || 'Documento do colaborador', descricao: req.body?.descricao || null,
    nome_original: req.file.originalname, conteudo: req.file.buffer, mime: req.file.mimetype, tamanho: req.file.size, usuario_id: req.user.id,
  }, null, { auditoria: false });
  await registrar('criar', 'arquivos', id, null, { colaborador_id: c.id, nome: req.file.originalname });
  res.status(201).json({ id });
});
/** Documento do colaborador: o RH vê todos; o colaborador, os próprios. */
r.get('/documentos/:id', async (req, res) => {
  const a = await db.get('SELECT * FROM arquivos WHERE id = ? AND colaborador_id IS NOT NULL', Number(req.params.id));
  if (!a) throw new ErroNegocio('Documento não encontrado', 404);
  if (!A.can(req.user, 'rh') && !A.can(req.user, 'cadastros.colaborador') && a.colaborador_id !== req.user.colaborador_id) throw new ErroNegocio('Sem acesso a este documento.', 403);
  await registrar('baixar_arquivo', 'arquivos', a.id, null, { nome: a.nome_original });
  const inline = req.query.inline === '1' && /^(image\/|application\/pdf)/.test(a.mime || '');
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  res.end(Buffer.from(a.conteudo));
});
r.delete('/documentos/:id', A.exige('rh.gerir'), async (req, res) => {
  const a = await db.get('SELECT id FROM arquivos WHERE id = ? AND colaborador_id IS NOT NULL', Number(req.params.id));
  if (!a) throw new ErroNegocio('Documento não encontrado', 404);
  await db.remove('arquivos', a.id);
  res.json({ ok: true });
});

// ======================= Ponto e ocorrências =======================
r.get('/ocorrencias', A.exige('rh'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT o.id, o.data, o.colaborador_id, c.nome AS colaborador, COALESCE(c.departamento, c.setor) AS departamento, o.tipo, o.horas, o.dias, o.descricao,
            o.arquivo_id, u.nome AS lancado_por, o.created_at
          FROM rh_ocorrencias o JOIN colaboradores c ON c.id = o.colaborador_id LEFT JOIN usuarios u ON u.id = o.usuario_id
          WHERE COALESCE(c.empresa_id, ?) = ?`,
    params: [req.empresaId, req.empresaId], sort: 'data', dir: 'desc', exact: ['tipo', 'colaborador_id'],
  }));
r.post('/ocorrencias', A.exige('rh.gerir'), upload.single('arquivo'), async (req, res) => {
  const b = req.body || {};
  const c = await colaborador(b.colaborador_id);
  if (!RH.TIPOS_OCORRENCIA[b.tipo]) throw new ErroNegocio('Tipo de ocorrência inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.data || '')) throw new ErroNegocio('Informe a data.');
  const horas = b.horas === '' || b.horas == null ? null : Number(b.horas);
  const dias = b.dias === '' || b.dias == null ? null : Number(b.dias);
  if (['hora_extra_50', 'hora_extra_100', 'banco_credito', 'banco_debito', 'atraso'].includes(b.tipo) && !(horas > 0)) throw new ErroNegocio('Informe as horas.');
  if (['falta', 'falta_justificada', 'atestado', 'suspensao'].includes(b.tipo) && dias != null && !(dias > 0)) throw new ErroNegocio('Dias inválidos.');
  if (await RH.competenciaFechada(req.empresaId, b.data.slice(0, 7))) throw new ErroNegocio('A folha desse mês já foi fechada. Reabra a competência para lançar.');
  const id = await db.tx(async () => {
    let arquivoId = null;
    if (req.file) {
      arquivoId = await db.insert('arquivos', { colaborador_id: c.id, categoria: b.tipo === 'atestado' ? 'Atestado' : 'Ocorrência', descricao: b.descricao || null,
        nome_original: req.file.originalname, conteudo: req.file.buffer, mime: req.file.mimetype, tamanho: req.file.size, usuario_id: req.user.id }, null, { auditoria: false });
    }
    return db.insert('rh_ocorrencias', { colaborador_id: c.id, data: b.data, tipo: b.tipo, horas, dias: dias ?? (['falta', 'falta_justificada', 'atestado', 'suspensao'].includes(b.tipo) ? 1 : null),
      descricao: b.descricao || null, arquivo_id: arquivoId, usuario_id: req.user.id });
  });
  res.status(201).json({ id });
});
r.delete('/ocorrencias/:id', A.exige('rh.gerir'), async (req, res) => {
  const o = await db.get('SELECT * FROM rh_ocorrencias WHERE id = ?', Number(req.params.id));
  if (!o) throw new ErroNegocio('Ocorrência não encontrada', 404);
  if (await RH.competenciaFechada(req.empresaId, o.data.slice(0, 7))) throw new ErroNegocio('A folha desse mês já foi fechada.');
  await db.remove('rh_ocorrencias', o.id);
  res.json({ ok: true });
});

// ======================= Férias =======================
r.get('/ferias', A.exige('rh'), async (req, res) => {
  const programadas = await db.all(
    `SELECT f.*, c.nome AS colaborador, COALESCE(c.departamento, c.setor) AS departamento, u.nome AS solicitado_por_nome, a.nome AS aprovado_por_nome
       FROM rh_ferias f JOIN colaboradores c ON c.id = f.colaborador_id LEFT JOIN usuarios u ON u.id = f.solicitado_por LEFT JOIN usuarios a ON a.id = f.aprovado_por
      WHERE COALESCE(c.empresa_id, ?) = ? AND f.fim >= ? ORDER BY f.inicio`, req.empresaId, req.empresaId, S.addDias(S.hoje(), -180),
  );
  const saldos = [];
  for (const c of await db.all(`SELECT * FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND c.ativo = 1 AND c.data_desligamento IS NULL ORDER BY nome`, req.empresaId, req.empresaId)) {
    const p = await RH.periodosFerias(c);
    const abertos = p.filter((x) => x.completo && x.saldo > 0);
    const atual = p.find((x) => !x.completo);
    saldos.push({
      colaborador_id: c.id, colaborador: c.nome, departamento: c.departamento || c.setor, admissao: c.data_admissao,
      saldo: abertos.reduce((a, x) => a + x.saldo, 0), periodos_abertos: abertos.length,
      limite: abertos[abertos.length - 1]?.limite_concessivo || null,
      situacao: abertos.some((x) => x.situacao === 'vencida') ? 'vencida' : abertos.some((x) => x.situacao === 'vence_logo') ? 'vence_logo' : abertos.length ? 'a_gozar' : 'em_dia',
      proporcional: atual?.direito || 0,
    });
  }
  res.json({ programadas, saldos });
});
r.post('/ferias', A.exige('rh.gerir'), async (req, res) => {
  const b = req.body || {};
  const c = await colaborador(b.colaborador_id);
  const f = await RH.validarFerias(c, b);
  const id = await db.insert('rh_ferias', { ...f, colaborador_id: c.id, adiantar_13: b.adiantar_13 ? 1 : 0, observacao: b.observacao || null,
    status: 'aprovada', solicitado_por: req.user.id, aprovado_por: req.user.id });
  res.status(201).json({ id, fim: f.fim });
});
r.post('/ferias/:id/status', A.exige('rh.gerir'), async (req, res) => {
  const f = await db.get('SELECT * FROM rh_ferias WHERE id = ?', Number(req.params.id));
  if (!f) throw new ErroNegocio('Férias não encontradas', 404);
  const novo = req.body?.status;
  const permitido = { solicitada: ['aprovada', 'recusada', 'cancelada'], aprovada: ['cancelada'] };
  if (!(permitido[f.status] || []).includes(novo)) throw new ErroNegocio('Mudança de status não permitida.');
  if (novo === 'recusada' && !String(req.body?.resposta || '').trim()) throw new ErroNegocio('Informe o motivo da recusa.');
  if (novo === 'aprovada') await RH.validarFerias(await colaborador(f.colaborador_id), f, f.id);
  await db.tx(async () => {
    await db.update('rh_ferias', f.id, { status: novo, resposta: req.body?.resposta || null, aprovado_por: req.user.id });
    await db.run(`UPDATE rh_solicitacoes SET status = ?, resposta = ?, respondido_por = ?, respondido_em = datetime('now','localtime') WHERE ferias_id = ? AND status = 'aberta'`,
      novo === 'aprovada' ? 'aprovada' : 'recusada', req.body?.resposta || (novo === 'aprovada' ? 'Férias aprovadas.' : null), req.user.id, f.id);
  });
  const u = await db.get('SELECT id FROM usuarios WHERE colaborador_id = ?', f.colaborador_id);
  if (u) sse.enviar('rh', { texto: `Suas férias de ${f.inicio.split('-').reverse().join('/')} foram ${novo === 'aprovada' ? 'aprovadas' : novo === 'recusada' ? 'recusadas' : 'canceladas'}.` }, { usuarios: [u.id] });
  res.json({ ok: true });
});

// ======================= Solicitações =======================
r.get('/solicitacoes', A.exige('rh'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT s.id, s.created_at, s.colaborador_id, c.nome AS colaborador, COALESCE(c.departamento, c.setor) AS departamento, s.tipo, s.descricao,
            s.data_inicio, s.data_fim, s.status, s.resposta, s.respondido_em, u.nome AS respondido_por, s.arquivo_id, s.ferias_id
          FROM rh_solicitacoes s JOIN colaboradores c ON c.id = s.colaborador_id LEFT JOIN usuarios u ON u.id = s.respondido_por
          WHERE COALESCE(c.empresa_id, ?) = ?`,
    params: [req.empresaId, req.empresaId], sort: 'id', dir: 'desc', exact: ['status', 'tipo'],
  }));
r.post('/solicitacoes/:id/responder', A.exige('rh.gerir'), async (req, res) => {
  const s = await db.get('SELECT * FROM rh_solicitacoes WHERE id = ?', Number(req.params.id));
  if (!s) throw new ErroNegocio('Solicitação não encontrada', 404);
  if (s.status !== 'aberta') throw new ErroNegocio('Solicitação já respondida.');
  const status = req.body?.status;
  if (!['aprovada', 'recusada', 'concluida'].includes(status)) throw new ErroNegocio('Status inválido.');
  const resposta = String(req.body?.resposta || '').trim();
  if (status === 'recusada' && !resposta) throw new ErroNegocio('Explique o motivo da recusa.');
  await db.tx(async () => {
    await db.update('rh_solicitacoes', s.id, { status, resposta: resposta || null, respondido_por: req.user.id, respondido_em: S.hoje() });
    if (s.ferias_id) await db.run(`UPDATE rh_ferias SET status = ?, resposta = ?, aprovado_por = ? WHERE id = ? AND status = 'solicitada'`,
      status === 'recusada' ? 'recusada' : 'aprovada', resposta || null, req.user.id, s.ferias_id);
    // Atestado aprovado vira ocorrência abonada no ponto.
    if (s.tipo === 'atestado' && status !== 'recusada' && s.data_inicio) {
      const dias = s.data_fim ? S.diasEntre(s.data_inicio, s.data_fim) + 1 : 1;
      await db.insert('rh_ocorrencias', { colaborador_id: s.colaborador_id, data: s.data_inicio, tipo: 'atestado', dias, descricao: s.descricao, arquivo_id: s.arquivo_id, usuario_id: req.user.id });
    }
  });
  const u = await db.get('SELECT id FROM usuarios WHERE colaborador_id = ?', s.colaborador_id);
  if (u) sse.enviar('rh', { texto: `Sua solicitação "${RH.TIPOS_SOLICITACAO[s.tipo]}" foi ${status === 'recusada' ? 'recusada' : 'respondida'}.` }, { usuarios: [u.id] });
  res.json({ ok: true });
});

// ======================= Folha: eventos do mês para a contabilidade =======================
const exigeFolha = A.exige('rh.folha');
r.get('/folha', exigeFolha, async (req, res) => {
  const comp = /^\d{4}-\d{2}$/.test(req.query.competencia || '') ? req.query.competencia : S.hoje().slice(0, 7);
  const ini = `${comp}-01`;
  const fim = RH.fimDoMes(comp);
  const colabs = await db.all(
    `SELECT c.id, c.nome, c.cargo, COALESCE(c.departamento, c.setor) AS departamento, c.tipo_contrato, c.salario, c.data_admissao, c.data_desligamento
       FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND (c.data_admissao IS NULL OR c.data_admissao <= ?) AND (c.data_desligamento IS NULL OR c.data_desligamento >= ?)
      ORDER BY c.nome`, req.empresaId, req.empresaId, fim, ini,
  );
  const eventos = await db.all(`SELECT e.*, u.nome AS usuario FROM rh_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.empresa_id = ? AND e.competencia = ? ORDER BY e.colaborador_id, e.tipo DESC, e.id`, req.empresaId, comp);
  const fech = await db.get('SELECT f.*, u.nome AS usuario FROM rh_fechamentos f LEFT JOIN usuarios u ON u.id = f.fechado_por WHERE empresa_id = ? AND competencia = ?', req.empresaId, comp);
  const linhas = colabs.map((c) => {
    const ev = eventos.filter((e) => e.colaborador_id === c.id);
    const prov = r2(ev.filter((e) => e.tipo === 'provento').reduce((a, e) => a + e.valor, 0));
    const desc = r2(ev.filter((e) => e.tipo === 'desconto').reduce((a, e) => a + e.valor, 0));
    return { ...c, tipo_contrato: RH.TIPOS_CONTRATO[c.tipo_contrato] || c.tipo_contrato, proventos: prov, descontos: desc, eventos: ev,
      admitido_no_mes: c.data_admissao?.slice(0, 7) === comp, desligado_no_mes: c.data_desligamento?.slice(0, 7) === comp };
  });
  res.json({ competencia: comp, fechada: !!fech, fechamento: fech, linhas, totais: {
    salarios: r2(colabs.reduce((a, c) => a + (c.salario || 0), 0)), proventos: r2(linhas.reduce((a, l) => a + l.proventos, 0)), descontos: r2(linhas.reduce((a, l) => a + l.descontos, 0)),
  } });
});
/** Comissões que esta folha paga: por vendedor, com o destino (folha ou contas a pagar) e as que ainda esperam revisão. */
r.get('/folha/comissoes', exigeFolha, async (req, res) => {
  const comp = req.query.competencia;
  if (!/^\d{4}-\d{2}$/.test(comp || '')) throw new ErroNegocio('Competência inválida.');
  const fechada = await RH.competenciaFechada(req.empresaId, comp);
  res.json({ ...(await require('../comissao-folha').apurar(req.empresaId, comp, { incluirPagasNa: fechada ? comp : null })), fechada });
});
r.post('/folha/gerar', exigeFolha, async (req, res) => res.json(await RH.gerarEventos(req.empresaId, req.body?.competencia, req.user.id)));
r.post('/folha/eventos', exigeFolha, async (req, res) => {
  const b = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(b.competencia || '')) throw new ErroNegocio('Competência inválida.');
  if (await RH.competenciaFechada(req.empresaId, b.competencia)) throw new ErroNegocio('Competência fechada.');
  await colaborador(b.colaborador_id);
  if (!['provento', 'desconto'].includes(b.tipo)) throw new ErroNegocio('Escolha provento ou desconto.');
  if (!String(b.evento || '').trim()) throw new ErroNegocio('Informe o evento.');
  if (!(Number(b.valor) >= 0)) throw new ErroNegocio('Valor inválido.');
  res.status(201).json({ id: await db.insert('rh_eventos', { ...b, empresa_id: req.empresaId, valor: r2(b.valor), origem: 'manual', usuario_id: req.user.id },
    ['empresa_id', 'colaborador_id', 'competencia', 'tipo', 'evento', 'referencia', 'valor', 'origem', 'observacao', 'usuario_id']) });
});
r.put('/folha/eventos/:id', exigeFolha, async (req, res) => {
  const e = await db.get('SELECT * FROM rh_eventos WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!e) throw new ErroNegocio('Evento não encontrado', 404);
  if (await RH.competenciaFechada(req.empresaId, e.competencia)) throw new ErroNegocio('Competência fechada.');
  // Evento automático ajustado à mão passa a ser manual (não é apagado ao gerar de novo).
  await db.update('rh_eventos', e.id, { ...req.body, origem: 'manual', valor: req.body?.valor != null ? r2(req.body.valor) : undefined }, ['referencia', 'valor', 'observacao', 'origem']);
  res.json({ ok: true });
});
r.delete('/folha/eventos/:id', exigeFolha, async (req, res) => {
  const e = await db.get('SELECT * FROM rh_eventos WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!e) throw new ErroNegocio('Evento não encontrado', 404);
  if (await RH.competenciaFechada(req.empresaId, e.competencia)) throw new ErroNegocio('Competência fechada.');
  await db.remove('rh_eventos', e.id);
  res.json({ ok: true });
});
r.post('/folha/fechar', exigeFolha, async (req, res) => {
  const comp = req.body?.competencia;
  if (!/^\d{4}-\d{2}$/.test(comp || '')) throw new ErroNegocio('Competência inválida.');
  if (await RH.competenciaFechada(req.empresaId, comp)) throw new ErroNegocio('Competência já fechada.');
  const com = await db.tx(async () => {
    await db.run('INSERT INTO rh_fechamentos (empresa_id, competencia, fechado_por, observacao) VALUES (?, ?, ?, ?)', req.empresaId, comp, req.user.id, req.body?.observacao || null);
    // Comissões entram como pagas na folha (CLT) ou viram contas a pagar (PJ / sem cadastro).
    return require('../comissao-folha').aoFechar(req.empresaId, comp, req.user.id);
  });
  await registrar('fechar_folha', 'rh_fechamentos', comp, null, { competencia: comp, comissoes: com });
  res.json({ ok: true, comissoes: com });
});
r.post('/folha/reabrir', A.exige('rh.gerir'), async (req, res) => {
  const comp = req.body?.competencia;
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo da reabertura.');
  await db.tx(async () => {
    await require('../comissao-folha').aoReabrir(req.empresaId, comp);
    await db.run('DELETE FROM rh_fechamentos WHERE empresa_id = ? AND competencia = ?', req.empresaId, comp);
  });
  await registrar('reabrir_folha', 'rh_fechamentos', comp, null, { competencia: comp, motivo });
  res.json({ ok: true });
});
r.get('/folha/exportar', exigeFolha, async (req, res) => {
  const comp = req.query.competencia;
  if (!/^\d{4}-\d{2}$/.test(comp || '')) throw new ErroNegocio('Competência inválida.');
  const linhas = await db.all(
    `SELECT c.nome AS colaborador, c.cpf, c.pis, c.cargo, COALESCE(c.departamento, c.setor) AS departamento, c.salario, e.tipo, e.evento, e.referencia, e.valor, e.observacao
       FROM rh_eventos e JOIN colaboradores c ON c.id = e.colaborador_id WHERE e.empresa_id = ? AND e.competencia = ? ORDER BY c.nome, e.tipo DESC, e.evento`,
    req.empresaId, comp,
  );
  await registrar('exportar', 'rh_eventos', comp, null, { competencia: comp, linhas: linhas.length });
  return enviarXlsx(res, {
    titulo: `Eventos folha ${comp}`,
    colunas: [{ k: 'colaborador', l: 'Colaborador' }, { k: 'cpf', l: 'CPF' }, { k: 'pis', l: 'PIS' }, { k: 'cargo', l: 'Cargo' }, { k: 'departamento', l: 'Departamento' },
      { k: 'salario', l: 'Salário base', t: 'money' }, { k: 'tipo', l: 'Tipo' }, { k: 'evento', l: 'Evento' }, { k: 'referencia', l: 'Referência' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'observacao', l: 'Observação' }],
    linhas: linhas.map((l) => ({ ...l, tipo: l.tipo === 'provento' ? 'Provento' : 'Desconto' })),
  });
});

r.get('/opcoes', A.exige('rh'), async (req, res) => {
  res.json({
    contratos: CB.VINCULOS, ...CB.opcoes(), listas: await require('../listas').todas(), ocorrencias: RH.TIPOS_OCORRENCIA, historico: RH.TIPOS_HISTORICO, beneficios: RH.TIPOS_BENEFICIO, exames: RH.TIPOS_EXAME,
    solicitacoes: RH.TIPOS_SOLICITACAO, desligamentos: RH.TIPOS_DESLIGAMENTO,
    colaboradores: await db.all(`SELECT id, nome, cargo FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND c.ativo = 1 ORDER BY nome`, req.empresaId, req.empresaId),
    departamentos: (await db.all(`SELECT DISTINCT COALESCE(departamento, setor) AS d FROM colaboradores WHERE COALESCE(departamento, setor) IS NOT NULL ORDER BY 1`)).map((x) => x.d),
  });
});

module.exports = r;
