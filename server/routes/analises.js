// Análises: curva ABC de clientes e produtos, clientes atrasando a recompra e previsão de demanda por produto.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const E = require('../escopo');
const { responderMemoria } = require('../lista');
const { SALDOS_SQL } = require('./estoque');

const r = express.Router();
r.use(A.exige('analises'));
const VENDIDO = `p.etapa NOT IN ('venda','cancelado')`;
const meses = (req, padrao = 12) => Math.min(Math.max(parseInt(req.query.meses, 10) || padrao, 1), 36);

/** Classifica em A (até 80% acumulado), B (até 95%) e C. */
function classificar(rows, campo) {
  const total = rows.reduce((a, x) => a + Math.max(0, x[campo] || 0), 0);
  let acum = 0;
  return rows.sort((a, b) => (b[campo] || 0) - (a[campo] || 0)).map((x, i) => {
    const antes = acum;
    acum += Math.max(0, x[campo] || 0);
    const pct = total ? (x[campo] / total) * 100 : 0;
    return { posicao: i + 1, ...x, pct: S.r2(pct), acumulado: S.r2(total ? (acum / total) * 100 : 0), classe: antes / (total || 1) < 0.8 ? 'A' : antes / (total || 1) < 0.95 ? 'B' : 'C' };
  });
}

r.get('/abc', async (req, res) => {
  const m = meses(req);
  const de = S.addDias(S.hoje(), -Math.round(m * 30.44));
  const metrica = req.query.metrica === 'margem' ? 'margem' : 'valor';
  let rows;
  if (req.query.tipo === 'produtos') {
    rows = await db.all(
      `SELECT pr.id, pr.codigo, pr.nome AS produto, g.nome AS grupo, ROUND(SUM(i.valor_total)::numeric, 2)::float8 AS valor,
          ROUND(SUM(i.valor_total - i.quantidade * COALESCE(i.custo_embalagem, 0))::numeric, 2)::float8 AS margem,
          SUM(i.quantidade) AS quantidade, COUNT(DISTINCT p.cliente_id) AS clientes, COUNT(DISTINCT p.id) AS pedidos
         FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN grupos_produto g ON g.id = pr.grupo_id
        WHERE p.empresa_id = ? AND ${VENDIDO} AND i.brinde = 0 AND p.created_at >= ? AND ${E.vendas(req.user, 'p')}
        GROUP BY pr.id, g.nome`, req.empresaId, de,
    );
    rows.forEach((x) => { x.margem_pct = x.valor ? S.r2((x.margem / x.valor) * 100) : null; });
  } else {
    rows = await db.all(
      `SELECT c.id, c.nome AS cliente, c.documento, v.nome AS vendedor, ROUND(SUM(p.valor_total)::numeric, 2)::float8 AS valor, COUNT(*) AS pedidos,
          MAX(p.created_at) AS ultima_compra,
          ROUND(SUM((SELECT SUM(i.valor_total - i.quantidade * COALESCE(i.custo_embalagem, 0)) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.brinde = 0))::numeric, 2)::float8 AS margem
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios v ON v.id = c.vendedor_id
        WHERE p.empresa_id = ? AND ${VENDIDO} AND p.created_at >= ? AND ${E.vendas(req.user, 'p')}
        GROUP BY c.id, v.nome`, req.empresaId, de,
    );
    rows.forEach((x) => { x.ticket_medio = x.pedidos ? S.r2(x.valor / x.pedidos) : 0; });
  }
  const lista = classificar(rows, metrica);
  if (req.query.resumo === '1') {
    const r_ = { A: { itens: 0, valor: 0 }, B: { itens: 0, valor: 0 }, C: { itens: 0, valor: 0 } };
    for (const x of lista) { r_[x.classe].itens++; r_[x.classe].valor = S.r2(r_[x.classe].valor + (x[metrica] || 0)); }
    return res.json({ meses: m, metrica, resumo: r_, total: lista.length });
  }
  await responderMemoria(req, res, lista, { titulo: `Curva ABC de ${req.query.tipo === 'produtos' ? 'produtos' : 'clientes'}`, exatos: ['classe'] });
});

/** Clientes que passaram do intervalo habitual entre compras (média dos intervalos × 1,2). */
r.get('/recompra', async (req, res) => {
  const compras = await db.all(
    `SELECT p.cliente_id, substr(p.created_at, 1, 10) AS dia, SUM(p.valor_total) AS valor FROM pedidos p
      WHERE p.empresa_id = ? AND ${VENDIDO} AND p.created_at >= date('now','localtime','-1095 days') AND ${E.vendas(req.user, 'p')}
      GROUP BY p.cliente_id, substr(p.created_at, 1, 10) ORDER BY p.cliente_id, dia`, req.empresaId,
  );
  const porCliente = new Map();
  for (const c of compras) (porCliente.get(c.cliente_id) || porCliente.set(c.cliente_id, []).get(c.cliente_id)).push(c);
  const hoje = S.hoje();
  const candidatos = [];
  for (const [id, lista] of porCliente) {
    // Compras a menos de 15 dias uma da outra contam como a mesma (complemento de pedido).
    const datas = [];
    for (const x of lista) if (!datas.length || S.diasEntre(datas.at(-1), x.dia) >= 15) datas.push(x.dia);
    if (datas.length < 2) continue;
    const intervalos = datas.slice(1).map((d, i) => S.diasEntre(datas[i], d));
    const media = Math.round(intervalos.reduce((a, x) => a + x, 0) / intervalos.length);
    const desde = S.diasEntre(datas.at(-1), hoje);
    if (desde <= media * 1.2 || desde > 730) continue;
    const valor = lista.reduce((a, x) => a + x.valor, 0);
    candidatos.push({ cliente_id: id, compras: datas.length, intervalo_medio: media, dias_sem_comprar: desde, atraso_dias: desde - media, ultima_compra: datas.at(-1), previsto_em: S.addDias(datas.at(-1), media), valor_total: S.r2(valor), ticket_medio: S.r2(valor / datas.length) });
  }
  const info = candidatos.length ? Object.fromEntries((await db.all(
    `SELECT c.id, c.nome, c.documento, v.nome AS vendedor, (SELECT t.numero FROM cliente_telefones t WHERE t.cliente_id = c.id ORDER BY t.whatsapp DESC, t.id LIMIT 1) AS telefone
       FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id WHERE c.id IN (${candidatos.map((x) => Number(x.cliente_id)).join(',')})`,
  )).map((x) => [x.id, x])) : {};
  const rows = candidatos.map((x) => ({ ...x, cliente: info[x.cliente_id]?.nome, documento: info[x.cliente_id]?.documento, vendedor: info[x.cliente_id]?.vendedor, telefone: info[x.cliente_id]?.telefone }))
    .sort((a, b) => b.ticket_medio - a.ticket_medio);
  await responderMemoria(req, res, rows, { titulo: 'Clientes atrasando a recompra' });
});

/**
 * Previsão de demanda por embalagem: média de 50% do mesmo mês do ano anterior (corrigido pela tendência dos
 * últimos 12 meses) e 50% da média dos últimos 3 meses. Compara com o disponível e o que já está em compra.
 */
r.get('/demanda', async (req, res) => {
  const horizonte = Math.min(Math.max(parseInt(req.query.horizonte, 10) || 3, 1), 6);
  const hoje = S.hoje();
  const mesAtual = hoje.slice(0, 7);
  const mesesHist = [];
  for (let i = 24; i >= 1; i--) {
    const d = new Date(`${mesAtual}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    mesesHist.push(d.toISOString().slice(0, 7));
  }
  const futuros = [];
  for (let i = 0; i < horizonte; i++) {
    const d = new Date(`${mesAtual}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    futuros.push(d.toISOString().slice(0, 7));
  }
  const vendas = await db.all(
    `SELECT i.embalagem_id, substr(p.created_at, 1, 7) AS mes, SUM(i.quantidade) AS q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
      WHERE p.empresa_id = ? AND ${VENDIDO} AND i.embalagem_id IS NOT NULL AND p.created_at >= ? GROUP BY i.embalagem_id, mes`, req.empresaId, `${mesesHist[0]}-01`,
  );
  const saldos = Object.fromEntries((await db.all(`SELECT * FROM (${SALDOS_SQL}) t`, req.empresaId, req.empresaId)).map((x) => [x.embalagem_id, x]));
  const emCompra = Object.fromEntries((await db.all(
    `SELECT i.embalagem_id, SUM(i.quantidade - i.quantidade_recebida) AS q FROM compra_itens i JOIN compras c ON c.id = i.compra_id
      WHERE c.empresa_id = ? AND c.status IN ('rascunho','aprovacao','aprovada','enviada','parcial') AND i.embalagem_id IS NOT NULL GROUP BY i.embalagem_id`, req.empresaId,
  )).map((x) => [x.embalagem_id, x.q]));
  const porEmb = new Map();
  for (const v of vendas) (porEmb.get(v.embalagem_id) || porEmb.set(v.embalagem_id, {}).get(v.embalagem_id))[v.mes] = v.q;
  const rows = [];
  for (const [emb, hist] of porEmb) {
    const s = saldos[emb];
    if (!s) continue;
    const q = (m) => hist[m] || 0;
    const ult12 = mesesHist.slice(12).reduce((a, m) => a + q(m), 0);
    const ant12 = mesesHist.slice(0, 12).reduce((a, m) => a + q(m), 0);
    const tendencia = ant12 > 0 ? Math.min(2, Math.max(0.5, ult12 / ant12)) : 1;
    const media3 = (q(mesesHist[23]) + q(mesesHist[22]) + q(mesesHist[21])) / 3;
    const previsao = futuros.map((m) => {
      const [a, mm] = m.split('-');
      const anoPassado = q(`${Number(a) - 1}-${mm}`);
      return Math.round(ant12 || anoPassado ? 0.5 * anoPassado * tendencia + 0.5 * media3 : media3);
    });
    const total = previsao.reduce((a, x) => a + x, 0);
    const disponivel = S.r2(s.saldo - s.reservado);
    const compra = emCompra[emb] || 0;
    const mensal = total / horizonte;
    rows.push({
      embalagem_id: emb, produto: s.produto, embalagem: s.embalagem, grupo: s.grupo, unidade: s.unidade,
      vendido_12m: S.r2(ult12), vendido_12m_anterior: S.r2(ant12), tendencia_pct: S.r2((tendencia - 1) * 100), media_3m: S.r2(media3),
      previsao, previsao_total: total, disponivel, em_compra: S.r2(compra), cobertura_meses: mensal > 0 ? Math.max(0, S.r2((disponivel + compra) / mensal)) : null,
      comprar: Math.max(0, Math.ceil(total - disponivel - compra)), historico: mesesHist.slice(12).map(q),
    });
  }
  if (req.query.export === 'xlsx' || req.query.page || req.query.all) {
    return responderMemoria(req, res, rows.sort((a, b) => b.comprar - a.comprar || b.previsao_total - a.previsao_total), { titulo: 'Previsão de demanda' });
  }
  res.json({ horizonte, meses: futuros, historico_meses: mesesHist.slice(12), linhas: rows.sort((a, b) => b.comprar - a.comprar || b.previsao_total - a.previsao_total) });
});

module.exports = r;
