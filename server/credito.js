// Limite de crédito: exposição do cliente (parcelas em aberto + pedidos em andamento), bloqueio por excesso
// ou por atraso, liberação com justificativa e limite sugerido a partir do histórico.
const db = require('./db');
const S = require('./services');
const C = require('./config');

const EM_ANDAMENTO = `('supervisao','analise','diretoria','cobranca','producao','faturamento')`;

/** Linhas de crédito dos clientes (todos ou os ids informados), com os dados para o limite sugerido. */
async function linhas({ ids, where = 'TRUE', params = [] } = {}) {
  const filtro = ids?.length ? `c.id IN (${ids.map(Number).join(',')})` : where;
  return db.all(
    `SELECT c.id, c.nome, c.documento, c.limite_credito, COALESCE(c.limite_automatico, 0) AS limite_automatico, c.limite_atualizado_em, v.nome AS vendedor,
        COALESCE(pa.em_aberto, 0) AS em_aberto, COALESCE(pa.vencido, 0) AS vencido, COALESCE(pa.maior_atraso, 0) AS maior_atraso,
        COALESCE(pe.em_andamento, 0) AS em_andamento, COALESCE(nf.compras_12m, 0) AS compras_12m, COALESCE(ah.atraso_historico, 0) AS atraso_historico,
        (SELECT s.score FROM consultas_serasa s WHERE s.cliente_id = c.id ORDER BY s.id DESC LIMIT 1) AS score,
        EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 AND b.tipo = 'bloqueio') AS bloqueado_blacklist,
        EXISTS (SELECT 1 FROM negativacoes n WHERE n.cliente_id = c.id AND n.status IN ('inclusao_solicitada','inclusao_aceita')) AS negativado
       FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id
       LEFT JOIN (SELECT p.cliente_id, SUM(CASE WHEN ${S.ABERTA_SQL} THEN ${S.SALDO_PARCELA_SQL} END) AS em_aberto,
            SUM(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} END) AS vencido,
            MAX(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER) END) AS maior_atraso
          FROM parcelas p GROUP BY p.cliente_id) pa ON pa.cliente_id = c.id
       LEFT JOIN (SELECT cliente_id, SUM(valor_total) AS em_andamento FROM pedidos WHERE etapa IN ${EM_ANDAMENTO} GROUP BY cliente_id) pe ON pe.cliente_id = c.id
       LEFT JOIN (SELECT cliente_id, SUM(valor) AS compras_12m FROM notas_fiscais WHERE status <> 'cancelada' AND data_emissao >= date('now','localtime','-365 days') GROUP BY cliente_id) nf ON nf.cliente_id = c.id
       LEFT JOIN (SELECT cliente_id, MAX(CAST(julianday(data_pagamento) - julianday(COALESCE(vencimento_original, vencimento)) AS INTEGER)) AS atraso_historico
          FROM parcelas WHERE data_pagamento IS NOT NULL AND data_pagamento >= date('now','localtime','-365 days') GROUP BY cliente_id) ah ON ah.cliente_id = c.id
      WHERE ${filtro}`, ...params,
  );
}

async function regras() {
  return {
    diasAtraso: Number(await C.obter('credito.dias_atraso_bloqueio')) || 0,
    semLimite: await C.obter('credito.sem_limite'),
    meses: Number(await C.obter('credito.meses_cobertura')) || 3,
  };
}

/**
 * Limite sugerido: média mensal comprada nos últimos 12 meses × meses de cobertura,
 * ajustada pelo score Serasa e pelo atraso histórico. Zero com blacklist ou negativação.
 */
function sugerido(l, rg) {
  const motivos = [];
  if (l.bloqueado_blacklist) return { valor: 0, motivos: ['Cliente bloqueado na blacklist'] };
  if (l.negativado) return { valor: 0, motivos: ['Cliente negativado'] };
  if (!l.compras_12m) return { valor: 0, motivos: ['Sem compras faturadas nos últimos 12 meses: venda à vista ou defina manualmente'] };
  let v = (l.compras_12m / 12) * rg.meses;
  motivos.push(`Média mensal ${S.r2(l.compras_12m / 12).toLocaleString('pt-BR')} × ${rg.meses} meses`);
  if (l.score != null) {
    const f = l.score < 400 ? 0.5 : l.score < 550 ? 0.75 : l.score >= 700 ? 1.2 : 1;
    if (f !== 1) { v *= f; motivos.push(`Score ${l.score}: ×${f}`); }
  }
  if (l.atraso_historico > 60) { v = 0; motivos.push(`Pagou com ${l.atraso_historico} dias de atraso no último ano`); }
  else if (l.atraso_historico > 30) { v *= 0.5; motivos.push(`Atraso de até ${l.atraso_historico} dias no último ano: ×0,5`); }
  else if (l.atraso_historico > 5) { v *= 0.8; motivos.push(`Atrasos curtos no último ano: ×0,8`); }
  return { valor: Math.round(v / 100) * 100, motivos };
}

/** Situação de crédito de uma linha; valorNovo = pedido que está sendo avaliado (se ainda não conta como em andamento). */
function situacao(l, rg, valorNovo = 0) {
  const exposicao = S.r2(l.em_aberto + l.em_andamento + valorNovo);
  const limite = Number(l.limite_credito) || 0;
  const bloqueios = [];
  if (rg.diasAtraso > 0 && l.maior_atraso > rg.diasAtraso) bloqueios.push(`Parcela vencida há ${l.maior_atraso} dias (bloqueio a partir de ${rg.diasAtraso})`);
  if (l.bloqueado_blacklist) bloqueios.push('Cliente bloqueado na blacklist');
  if (limite > 0 && exposicao > limite + 0.009) bloqueios.push(`Exposição ${exposicao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} passa do limite em ${(exposicao - limite).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  if (!limite && rg.semLimite === 'bloquear') bloqueios.push('Cliente sem limite de crédito definido');
  const status = bloqueios.length ? (l.maior_atraso > rg.diasAtraso && rg.diasAtraso > 0 ? 'atraso' : 'excedido') : !limite ? 'sem_limite' : 'ok';
  return {
    limite, exposicao, disponivel: limite ? S.r2(limite - exposicao) : null, uso_pct: limite ? S.r2((exposicao / limite) * 100) : null,
    status, bloqueios, sugerido: sugerido(l, rg),
  };
}

async function doCliente(clienteId, valorNovo = 0) {
  const [l] = await linhas({ ids: [clienteId] });
  if (!l) return null;
  return { ...l, ...situacao(l, await regras(), valorNovo) };
}

/**
 * Validação na aprovação da Análise: venda a prazo precisa caber no crédito (ou ter liberação).
 * O pedido em análise já conta como "em andamento", então não soma de novo.
 */
async function validarPedido(p) {
  if (p.credito_liberado_em) return;
  const forma = p.forma_id ? await db.get('SELECT tipo FROM formas_pagamento WHERE id = ?', p.forma_id) : null;
  if (forma?.tipo === 'a_vista') return;
  const andamento = (await db.get(`SELECT 1 AS x FROM pedidos WHERE id = ? AND etapa IN ${EM_ANDAMENTO}`, p.id)) ? 0 : p.valor_total;
  const s = await doCliente(p.cliente_id, andamento);
  if (s?.bloqueios.length) {
    throw new S.ErroNegocio(`Crédito bloqueado: ${s.bloqueios.join('; ')}. A Diretoria pode liberar este pedido com justificativa.`);
  }
}

/** Atualiza os limites dos clientes marcados como automáticos (rotina diária). */
async function atualizarAutomaticos() {
  const rg = await regras();
  const ls = await linhas({ where: 'COALESCE(c.limite_automatico, 0) = 1' });
  let n = 0;
  for (const l of ls) {
    const v = sugerido(l, rg).valor;
    if (v !== Number(l.limite_credito)) {
      await db.run(`UPDATE clientes SET limite_credito = ?, limite_atualizado_em = datetime('now','localtime') WHERE id = ?`, v, l.id);
      n++;
    }
  }
  return { avaliados: ls.length, alterados: n };
}

module.exports = { linhas, regras, sugerido, situacao, doCliente, validarPedido, atualizarAutomaticos, EM_ANDAMENTO };
