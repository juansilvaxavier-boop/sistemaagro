// CRM integrado ao cadastro de clientes e aos pedidos: histórico de relacionamento, oportunidades e tarefas.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');
const { escopoClientes } = require('./clientes');
const E = require('../escopo');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('crm'));

async function exigirCliente(req, clienteId) {
  const e = escopoClientes(req.user);
  const c = await db.get(`SELECT c.* FROM clientes c WHERE c.id = ? AND ${e.sql}`, clienteId, ...e.params);
  if (!c) throw new ErroNegocio('Cliente não encontrado ou fora da sua carteira.', 404);
  return c;
}

/** Visão 360º do cliente: dados, indicadores e linha do tempo de tudo que aconteceu com ele. */
r.get('/cliente/:id', async (req, res) => {
  const c = await exigirCliente(req, Number(req.params.id));
  const id = c.id;
  const kpi = await db.get(
    `SELECT COUNT(*) AS pedidos, IFNULL(SUM(valor_total),0) AS total, MAX(created_at) AS ultima_compra, MIN(created_at) AS primeira_compra
       FROM pedidos p WHERE cliente_id = ? AND etapa NOT IN ('cancelado') AND ${E.vendas(req.user, 'p')}`, id,
  );
  const fin = await db.get(
    `SELECT IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} THEN ${S.SALDO_PARCELA_SQL} END),0) AS em_aberto,
            IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} END),0) AS vencido
       FROM parcelas p WHERE p.cliente_id = ? AND ${E.financeiro(req.user, 'p')}`, id,
  );
  res.json({
    cliente: c,
    telefones: await db.all('SELECT * FROM cliente_telefones WHERE cliente_id = ?', id),
    enderecos: await db.all('SELECT * FROM cliente_enderecos WHERE cliente_id = ?', id),
    areas: await db.all('SELECT * FROM cliente_areas WHERE cliente_id = ?', id),
    kpi: { ...kpi, ...fin, ticket_medio: kpi.pedidos ? S.r2(kpi.total / kpi.pedidos) : 0 },
    produtos: await db.all(
      `SELECT pr.nome, SUM(i.quantidade) AS quantidade, i.unidade, ROUND(SUM(i.valor_total),2) AS valor, MAX(p.created_at) AS ultima
         FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id
        WHERE p.cliente_id = ? AND p.etapa <> 'cancelado' AND ${E.vendas(req.user, 'p')} GROUP BY pr.id, i.unidade ORDER BY valor DESC LIMIT 10`, id,
    ),
    timeline: await db.all(timelineSql(req.user), { c: id }),
    oportunidades: await db.all(
      'SELECT o.*, u.nome AS responsavel FROM crm_oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id WHERE cliente_id = ? ORDER BY id DESC', id,
    ),
    tarefas: await db.all(
      'SELECT t.*, u.nome AS responsavel FROM crm_tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id WHERE cliente_id = ? ORDER BY concluida, vencimento', id,
    ),
    blacklist: await S.situacaoBlacklist(id),
  });
});

// Na linha do tempo, pedidos, notas e pagamentos de vendas de fora da abrangência do usuário não aparecem.
const timelineSql = (user) => `SELECT * FROM (
  SELECT 'interacao' AS origem, i.id, i.data AS quando, i.tipo, i.assunto AS titulo, i.descricao, u.nome AS usuario, i.pedido_id
    FROM crm_interacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE i.cliente_id = :c
  UNION ALL
  SELECT 'pedido', h.id, h.created_at, h.etapa_destino, 'Pedido ' || p.numero || ': ' || h.acao, h.observacao, u.nome, p.id
    FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE p.cliente_id = :c AND ${E.vendas(user, 'p')}
  UNION ALL
  SELECT 'nota', n.id, n.data_emissao, n.status, 'NF ' || n.numero || ' - R$ ' || replace(round(n.valor::numeric, 2)::text, '.', ','), NULL, NULL, n.pedido_id
    FROM notas_fiscais n WHERE n.cliente_id = :c AND ${E.financeiro(user, 'n')}
  UNION ALL
  SELECT 'pagamento', p.id, p.data_pagamento, p.tipo_baixa, 'Pagamento da parcela ' || p.numero || ' - R$ ' || replace(round(p.valor_pago::numeric, 2)::text, '.', ','), NULL, NULL, p.pedido_id
    FROM parcelas p WHERE p.cliente_id = :c AND p.data_pagamento IS NOT NULL AND ${E.financeiro(user, 'p')}
  UNION ALL
  SELECT 'cobranca', a.id, a.created_at, a.tipo, 'Cobrança: ' || a.tipo || IFNULL(' - ' || a.resultado, ''), a.descricao, u.nome, NULL
    FROM cobranca_acoes a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.cliente_id = :c
  UNION ALL
  SELECT 'serasa', s.id, s.created_at, s.tipo, 'Consulta ' || s.tipo || ': score ' || s.score || ' (' || s.resultado || ')', s.justificativa, u.nome, s.pedido_id
    FROM consultas_serasa s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE s.cliente_id = :c
  UNION ALL
  SELECT 'blacklist', b.id, b.data_inclusao, b.tipo, 'Blacklist (' || b.tipo || ')', b.motivo, u.nome, NULL
    FROM blacklist b LEFT JOIN usuarios u ON u.id = b.usuario_id WHERE b.cliente_id = :c
  UNION ALL
  SELECT 'arquivo', a.id, a.created_at, a.categoria, 'Arquivo: ' || a.nome_original, a.descricao, u.nome, a.pedido_id
    FROM arquivos a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.cliente_id = :c
) WHERE quando IS NOT NULL ORDER BY quando DESC LIMIT 300`;

// ---------- Interações ----------
const TIPOS_INTERACAO = ['ligacao', 'visita', 'whatsapp', 'email', 'reuniao', 'pos_venda', 'reclamacao', 'sms', 'carta'];
r.get('/interacoes', async (req, res) => {
  const e = escopoClientes(req.user);
  await responderLista(req, res, {
    sql: `SELECT i.id, i.cliente_id, c.nome AS cliente, i.tipo, i.assunto, i.descricao, pe.numero AS pedido, u.nome AS usuario, i.data
          FROM crm_interacoes i JOIN clientes c ON c.id = i.cliente_id LEFT JOIN usuarios u ON u.id = i.usuario_id
          LEFT JOIN pedidos pe ON pe.id = i.pedido_id WHERE ${e.sql}`,
    params: e.params, sort: 'data', exact: ['tipo', 'cliente_id'],
  });
});
r.post('/interacoes', async (req, res) => {
  const b = req.body || {};
  await exigirCliente(req, b.cliente_id);
  if (!TIPOS_INTERACAO.includes(b.tipo)) throw new ErroNegocio('Tipo de interação inválido.');
  if (!String(b.assunto || '').trim()) throw new ErroNegocio('Informe o assunto.');
  let pedidoId = null;
  if (b.pedido_numero) {
    pedidoId = (await db.get('SELECT id FROM pedidos WHERE numero = ? AND cliente_id = ?', b.pedido_numero, b.cliente_id))?.id;
    if (!pedidoId) throw new ErroNegocio('Pedido não pertence ao cliente.');
  }
  const id = await db.insert('crm_interacoes', {
    cliente_id: b.cliente_id, pedido_id: pedidoId, tipo: b.tipo, assunto: b.assunto, descricao: b.descricao,
    data: b.data ? b.data.replace('T', ' ') : undefined, usuario_id: req.user.id,
  });
  if (b.proxima_tarefa && b.proxima_data) {
    await db.insert('crm_tarefas', { cliente_id: b.cliente_id, titulo: b.proxima_tarefa, vencimento: b.proxima_data, responsavel_id: req.user.id });
  }
  res.status(201).json({ id });
});

// ---------- Oportunidades (funil) ----------
const ESTAGIOS = ['prospeccao', 'qualificacao', 'proposta', 'negociacao', 'ganha', 'perdida'];
r.get('/oportunidades', async (req, res) => {
  const e = escopoClientes(req.user);
  await responderLista(req, res, {
    sql: `SELECT o.id, o.cliente_id, c.nome AS cliente, o.titulo, o.valor_estimado, o.estagio, o.previsao_fechamento, o.safra,
            u.nome AS responsavel, pe.numero AS pedido, o.motivo_perda, o.created_at
          FROM crm_oportunidades o JOIN clientes c ON c.id = o.cliente_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
          LEFT JOIN pedidos pe ON pe.id = o.pedido_id WHERE ${e.sql}`,
    params: e.params, sort: 'previsao_fechamento', dir: 'asc', exact: ['estagio'],
  });
});
r.post('/oportunidades', async (req, res) => {
  const b = req.body || {};
  await exigirCliente(req, b.cliente_id);
  if (!String(b.titulo || '').trim()) throw new ErroNegocio('Informe o título.');
  if (b.estagio && !ESTAGIOS.includes(b.estagio)) throw new ErroNegocio('Estágio inválido.');
  res.status(201).json({
    id: await db.insert('crm_oportunidades', { ...b, responsavel_id: b.responsavel_id || req.user.id },
      ['cliente_id', 'titulo', 'valor_estimado', 'estagio', 'previsao_fechamento', 'safra', 'responsavel_id']),
  });
});
r.put('/oportunidades/:id', async (req, res) => {
  const o = await db.get('SELECT * FROM crm_oportunidades WHERE id = ?', req.params.id);
  if (!o) throw new ErroNegocio('Oportunidade não encontrada', 404);
  await exigirCliente(req, o.cliente_id);
  const b = { ...req.body };
  if (b.estagio && !ESTAGIOS.includes(b.estagio)) throw new ErroNegocio('Estágio inválido.');
  if (b.estagio === 'perdida' && !b.motivo_perda && !o.motivo_perda) throw new ErroNegocio('Informe o motivo da perda.');
  if (b.pedido_numero) b.pedido_id = (await db.get('SELECT id FROM pedidos WHERE numero = ? AND cliente_id = ?', b.pedido_numero, o.cliente_id))?.id;
  await db.update('crm_oportunidades', o.id, b, ['titulo', 'valor_estimado', 'estagio', 'previsao_fechamento', 'safra', 'responsavel_id', 'motivo_perda', 'pedido_id']);
  if (b.estagio && b.estagio !== o.estagio) {
    await db.insert('crm_interacoes', { cliente_id: o.cliente_id, tipo: 'reuniao', assunto: `Oportunidade "${o.titulo}": ${o.estagio} → ${b.estagio}`, descricao: b.motivo_perda, usuario_id: req.user.id });
  }
  res.json({ ok: true });
});

// ---------- Tarefas ----------
r.get('/tarefas', async (req, res) => {
  // "Todas" mostra as tarefas de quem está na abrangência do usuário (a equipe, para o supervisor).
  const todas = req.query.todas === '1' && E.abrangencia(req.user) !== 'proprio';
  res.json(await db.all(
    `SELECT t.*, c.nome AS cliente, u.nome AS responsavel FROM crm_tarefas t LEFT JOIN clientes c ON c.id = t.cliente_id
       LEFT JOIN usuarios u ON u.id = t.responsavel_id
      WHERE ${todas ? E.pessoas(req.user, 't.responsavel_id') : 't.responsavel_id = ?'} AND (t.concluida = 0 OR t.vencimento >= date('now','localtime','-7 days'))
      ORDER BY t.concluida, t.vencimento LIMIT 200`, ...(todas ? [] : [req.user.id]),
  ));
});
r.post('/tarefas', async (req, res) => {
  const b = req.body || {};
  if (b.cliente_id) await exigirCliente(req, b.cliente_id);
  if (!String(b.titulo || '').trim()) throw new ErroNegocio('Informe a tarefa.');
  res.status(201).json({ id: await db.insert('crm_tarefas', { ...b, responsavel_id: b.responsavel_id || req.user.id }, ['cliente_id', 'titulo', 'vencimento', 'responsavel_id']) });
});
r.put('/tarefas/:id', async (req, res) => {
  const t = await db.get(`SELECT id FROM crm_tarefas t WHERE t.id = ? AND (t.responsavel_id = ? OR ${E.pessoas(req.user, 't.responsavel_id')})`, Number(req.params.id), req.user.id);
  if (!t) throw new ErroNegocio('Tarefa não encontrada', 404);
  await db.update('crm_tarefas', req.params.id, req.body || {}, ['titulo', 'vencimento', 'concluida', 'responsavel_id']);
  res.json({ ok: true });
});

// ---------- Clientes sem compra (reativação) ----------
r.get('/inativos', async (req, res) => {
  const dias = Math.max(parseInt(req.query.dias, 10) || 180, 1);
  const e = escopoClientes(req.user);
  await responderLista(req, res, {
    sql: `SELECT c.id, c.nome AS cliente, c.documento, v.nome AS vendedor, MAX(p.created_at) AS ultima_compra,
            CAST(julianday('now','localtime') - julianday(MAX(p.created_at)) AS INTEGER) AS dias_sem_compra,
            COUNT(p.id) AS pedidos, ROUND(SUM(p.valor_total),2) AS total_historico
          FROM clientes c JOIN pedidos p ON p.cliente_id = c.id AND p.etapa <> 'cancelado' AND ${E.vendas(req.user, 'p')} LEFT JOIN usuarios v ON v.id = c.vendedor_id
          WHERE ${e.sql} GROUP BY c.id, v.nome HAVING julianday('now','localtime') - julianday(MAX(p.created_at)) >= ?`,
    params: [...e.params, dias], sort: 'total_historico',
  });
});

module.exports = r;
