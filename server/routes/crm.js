// CRM integrado ao cadastro de clientes e aos pedidos: histórico de relacionamento, oportunidades e tarefas.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');
const { escopoClientes } = require('./clientes');
const E = require('../escopo');
const AUT = require('../crm-automacoes');

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
  b.updated_at = S.agora();
  await db.update('crm_oportunidades', o.id, b, ['titulo', 'valor_estimado', 'estagio', 'previsao_fechamento', 'safra', 'responsavel_id', 'motivo_perda', 'pedido_id', 'updated_at']);
  if (b.estagio && b.estagio !== o.estagio) {
    await db.insert('crm_interacoes', { cliente_id: o.cliente_id, tipo: 'reuniao', assunto: `Oportunidade "${o.titulo}": ${o.estagio} → ${b.estagio}`, descricao: b.motivo_perda, usuario_id: req.user.id });
  }
  res.json({ ok: true });
});

// ---------- Tarefas ----------
const TAREFA_SQL = `SELECT t.*, c.nome AS cliente, u.nome AS responsavel, a.nome AS automacao, pe.numero AS pedido, o.titulo AS oportunidade, pr.numero AS proposta
  FROM crm_tarefas t LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN usuarios u ON u.id = t.responsavel_id
  LEFT JOIN crm_automacoes a ON a.id = t.automacao_id LEFT JOIN pedidos pe ON pe.id = t.pedido_id
  LEFT JOIN crm_oportunidades o ON o.id = t.oportunidade_id LEFT JOIN propostas pr ON pr.id = t.proposta_id`;

// As automações rodam pelo agendador diário; se ele não rodou hoje, rodam na primeira consulta de tarefas.
const rodarAutomacoes = () => AUT.executarSeNecessario().catch((e) => console.error('automações CRM:', e.message));

r.get('/tarefas', async (req, res) => {
  await rodarAutomacoes();
  // "Todas" mostra as tarefas de quem está na abrangência do usuário (a equipe, para o supervisor).
  const todas = req.query.todas === '1' && E.abrangencia(req.user) !== 'proprio';
  res.json(await db.all(
    `${TAREFA_SQL}
      WHERE ${todas ? E.pessoas(req.user, 't.responsavel_id') : 't.responsavel_id = ?'} AND (t.concluida = 0 OR t.concluida_em >= date('now','localtime','-7 days')
        OR (t.concluida_em IS NULL AND t.vencimento >= date('now','localtime','-7 days')))
      ORDER BY t.concluida, t.vencimento NULLS LAST, CASE t.prioridade WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 300`, ...(todas ? [] : [req.user.id]),
  ));
});
r.get('/contagem', async (req, res) => {
  await rodarAutomacoes();
  res.json(await db.get(
    `SELECT COUNT(*) FILTER (WHERE vencimento <= date('now','localtime') OR vencimento IS NULL) AS para_hoje,
            COUNT(*) FILTER (WHERE vencimento < date('now','localtime')) AS atrasadas, COUNT(*) AS abertas
       FROM crm_tarefas WHERE responsavel_id = ? AND concluida = 0`, req.user.id,
  ));
});
r.post('/tarefas', async (req, res) => {
  const b = req.body || {};
  if (b.cliente_id) await exigirCliente(req, b.cliente_id);
  if (!String(b.titulo || '').trim()) throw new ErroNegocio('Informe a tarefa.');
  if (b.prioridade && !AUT.PRIORIDADES.includes(b.prioridade)) throw new ErroNegocio('Prioridade inválida.');
  res.status(201).json({ id: await db.insert('crm_tarefas', { ...b, responsavel_id: b.responsavel_id || req.user.id }, ['cliente_id', 'titulo', 'descricao', 'vencimento', 'responsavel_id', 'prioridade']) });
});
/** Atualiza a tarefa. Ao concluir, pode registrar a interação com o cliente (fica na linha do tempo do CRM). */
r.put('/tarefas/:id', async (req, res) => {
  const t = await db.get(`SELECT * FROM crm_tarefas t WHERE t.id = ? AND (t.responsavel_id = ? OR ${E.pessoas(req.user, 't.responsavel_id')})`, Number(req.params.id), req.user.id);
  if (!t) throw new ErroNegocio('Tarefa não encontrada', 404);
  const b = { ...(req.body || {}) };
  if (b.prioridade && !AUT.PRIORIDADES.includes(b.prioridade)) throw new ErroNegocio('Prioridade inválida.');
  if (b.concluida !== undefined) b.concluida_em = Number(b.concluida) ? S.agora() : null;
  const int = b.interacao;
  if (int && Number(b.concluida) && t.cliente_id) {
    if (!TIPOS_INTERACAO.includes(int.tipo)) throw new ErroNegocio('Tipo de interação inválido.');
    await exigirCliente(req, t.cliente_id);
  }
  await db.tx(async () => {
    await db.update('crm_tarefas', t.id, b, ['titulo', 'descricao', 'vencimento', 'concluida', 'concluida_em', 'responsavel_id', 'prioridade']);
    if (int && Number(b.concluida) && t.cliente_id) {
      await db.insert('crm_interacoes', {
        cliente_id: t.cliente_id, pedido_id: t.pedido_id, tipo: int.tipo, assunto: t.titulo, descricao: int.descricao || null, usuario_id: req.user.id,
      });
    }
  });
  res.json({ ok: true });
});

// ---------- Automações (regras que geram tarefas) ----------
const gestor = A.exige('crm.automacoes');
r.get('/automacoes', gestor, async (req, res) => {
  await AUT.garantirPadroes();
  const regras = await db.all(
    `SELECT a.*, u.nome AS responsavel_nome, eq.nome AS equipe,
        (SELECT COUNT(*) FROM crm_tarefas t WHERE t.automacao_id = a.id) AS total_geradas,
        (SELECT COUNT(*) FROM crm_tarefas t WHERE t.automacao_id = a.id AND t.concluida = 0) AS abertas,
        (SELECT COUNT(*) FROM crm_tarefas t WHERE t.automacao_id = a.id AND t.concluida = 1) AS concluidas
       FROM crm_automacoes a LEFT JOIN usuarios u ON u.id = a.responsavel_id LEFT JOIN equipes eq ON eq.id = a.equipe_id ORDER BY a.id`,
  );
  res.json({ regras, gatilhos: AUT.catalogo() });
});
r.post('/automacoes', gestor, async (req, res) => {
  const d = AUT.validar(req.body || {});
  res.status(201).json({ id: await db.insert('crm_automacoes', { ...d, created_by: req.user.id }) });
});
async function regra(id) {
  const a = await db.get('SELECT * FROM crm_automacoes WHERE id = ?', Number(id));
  if (!a) throw new ErroNegocio('Automação não encontrada.', 404);
  return a;
}
r.put('/automacoes/:id', gestor, async (req, res) => {
  const a = await regra(req.params.id);
  await db.update('crm_automacoes', a.id, AUT.validar(req.body || {}, a));
  res.json({ ok: true });
});
// Excluir mantém as tarefas já geradas (ficam sem a ligação com a regra).
r.delete('/automacoes/:id', gestor, async (req, res) => {
  const a = await regra(req.params.id);
  await db.remove('crm_automacoes', a.id);
  res.json({ ok: true });
});
r.post('/automacoes/:id/simular', gestor, async (req, res) => {
  const a = await regra(req.params.id);
  res.json((await AUT.executar({ regraId: a.id, simular: true }))[0]);
});
r.post('/automacoes/executar', gestor, async (req, res) => {
  const id = Number(req.body?.id) || undefined;
  if (id) await regra(id);
  res.json(await AUT.executar({ regraId: id }));
});

// ---------- Calendário da safra ----------
r.get('/safra/janelas', async (req, res) => {
  const SF = require('../safra');
  const horizonte = Math.min(Math.max(parseInt(req.query.dias, 10) || 120, 15), 365);
  const e = escopoClientes(req.user);
  // A abrangência do CRM usa parâmetros: incorpora os valores no SQL só como números.
  const filtro = e.params.length ? E.clientes(req.user, 'c') : e.sql;
  const rows = await SF.janelas({ horizonte, filtroSql: filtro });
  await require('../lista').responderMemoria(req, res, rows, { titulo: 'Calendário da safra', exatos: ['situacao'] });
});
r.get('/safra/calendario', async (req, res) => {
  await require('../safra').garantirPadroes();
  res.json(await db.all('SELECT * FROM calendario_safra ORDER BY cultura, mes_inicio, atividade'));
});
function linhaCalendario(b) {
  const mi = Number(b.mes_inicio);
  const mf = Number(b.mes_fim);
  if (!String(b.cultura || '').trim() || !String(b.atividade || '').trim()) throw new ErroNegocio('Informe a cultura e a atividade.');
  if (!(mi >= 1 && mi <= 12 && mf >= 1 && mf <= 12)) throw new ErroNegocio('Meses de início e fim inválidos.');
  const ant = Number(b.antecedencia_dias ?? 45);
  if (!(ant >= 0 && ant <= 180)) throw new ErroNegocio('Antecedência de 0 a 180 dias.');
  const uf = b.uf ? String(b.uf).toUpperCase() : null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroNegocio('UF inválida.');
  return { cultura: String(b.cultura).trim(), atividade: String(b.atividade).trim(), uf, mes_inicio: mi, mes_fim: mf, antecedencia_dias: ant, ativo: b.ativo === undefined ? 1 : b.ativo ? 1 : 0 };
}
r.post('/safra/calendario', A.exige('crm.automacoes'), async (req, res) => {
  const d = linhaCalendario(req.body || {});
  await require('../listas').exigir('cultura', d.cultura, { rotulo: 'Cultura' });
  res.status(201).json({ id: await db.insert('calendario_safra', d) });
});
r.put('/safra/calendario/:id', A.exige('crm.automacoes'), async (req, res) => {
  const c = await db.get('SELECT * FROM calendario_safra WHERE id = ?', Number(req.params.id));
  if (!c) throw new ErroNegocio('Linha não encontrada.', 404);
  await db.update('calendario_safra', c.id, linhaCalendario({ ...c, ...req.body }));
  res.json({ ok: true });
});
r.delete('/safra/calendario/:id', A.exige('crm.automacoes'), async (req, res) => {
  const c = await db.get('SELECT id FROM calendario_safra WHERE id = ?', Number(req.params.id));
  if (!c) throw new ErroNegocio('Linha não encontrada.', 404);
  await db.remove('calendario_safra', c.id);
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
