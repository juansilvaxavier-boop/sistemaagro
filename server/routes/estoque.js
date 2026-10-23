// Controle de estoque por produto e embalagem, com lote, validade, custo e inventário.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('estoque'));

const ORIGENS_ENTRADA = ['compra', 'producao', 'devolucao', 'ajuste', 'manual'];
const ORIGENS_SAIDA = ['venda', 'perda', 'consumo', 'amostra', 'ajuste', 'manual'];

/** Saldo de cada embalagem de produto ativo, com mínimo, custo médio e situação. */
const SALDOS_SQL = `
  SELECT e.id AS embalagem_id, p.id AS produto_id, p.codigo, p.nome AS produto, g.nome AS grupo, e.descricao AS embalagem, e.unidade,
    COALESCE(m.saldo, 0) AS saldo, COALESCE(e.estoque_minimo, 0) AS minimo, m.custo_medio,
    ROUND(COALESCE(m.saldo, 0) * COALESCE(m.custo_medio, e.custo, 0), 2) AS valor_estoque,
    CASE WHEN COALESCE(m.saldo, 0) <= 0 THEN 'zerado' WHEN COALESCE(m.saldo, 0) < COALESCE(e.estoque_minimo, 0) THEN 'baixo' ELSE 'ok' END AS situacao,
    m.lotes, m.ultimo_movimento,
    (SELECT COALESCE(SUM(i.quantidade), 0) FROM pedido_itens i JOIN pedidos pe ON pe.id = i.pedido_id
      WHERE i.embalagem_id = e.id AND pe.empresa_id = ? AND pe.etapa IN ('supervisao','analise','diretoria','cobranca','producao','faturamento')) AS reservado
  FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id LEFT JOIN grupos_produto g ON g.id = p.grupo_id
  LEFT JOIN (
    SELECT embalagem_id, SUM(quantidade) AS saldo, MAX(created_at) AS ultimo_movimento,
      COUNT(DISTINCT lote) FILTER (WHERE lote IS NOT NULL) AS lotes,
      SUM(CASE WHEN quantidade > 0 AND custo_unitario IS NOT NULL THEN quantidade * custo_unitario END)
        / NULLIF(SUM(CASE WHEN quantidade > 0 AND custo_unitario IS NOT NULL THEN quantidade END), 0) AS custo_medio
    FROM estoque_movimentos WHERE empresa_id = ? GROUP BY embalagem_id
  ) m ON m.embalagem_id = e.id
  WHERE p.ativo = 1`;

r.get('/saldos', async (req, res) =>
  await responderLista(req, res, { sql: SALDOS_SQL, params: [req.empresaId, req.empresaId], sort: 'produto', dir: 'asc', exact: ['situacao', 'embalagem_id', 'produto_id'] }));

r.get('/resumo', async (req, res) => {
  const t = await db.get(
    `SELECT COUNT(*) AS itens, SUM(CASE WHEN situacao = 'baixo' THEN 1 ELSE 0 END) AS baixos, SUM(CASE WHEN situacao = 'zerado' THEN 1 ELSE 0 END) AS zerados,
       COALESCE(SUM(CASE WHEN saldo > 0 THEN valor_estoque END), 0) AS valor FROM (${SALDOS_SQL}) t`, req.empresaId, req.empresaId,
  );
  const vencendo = (await db.get(
    `SELECT COUNT(*) AS n FROM (SELECT embalagem_id, lote, MIN(validade) AS validade, SUM(quantidade) AS s FROM estoque_movimentos
       WHERE empresa_id = ? AND lote IS NOT NULL AND validade IS NOT NULL GROUP BY embalagem_id, lote) x
      WHERE x.s > 0 AND x.validade <= date('now','localtime','+60 days')`, req.empresaId,
  )).n;
  res.json({ ...t, vencendo });
});

r.get('/lotes/:embalagemId', async (req, res) => {
  res.json(await db.all(
    `SELECT lote, MIN(validade) AS validade, SUM(quantidade) AS saldo, MIN(created_at) AS entrada FROM estoque_movimentos
      WHERE empresa_id = ? AND embalagem_id = ? GROUP BY lote HAVING SUM(quantidade) <> 0 ORDER BY MIN(validade) NULLS LAST, lote`,
    req.empresaId, Number(req.params.embalagemId),
  ));
});

r.get('/movimentos', async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT m.id, m.created_at, p.nome AS produto, e.descricao AS embalagem, m.tipo, m.origem, m.quantidade, m.lote, m.validade,
            m.custo_unitario, f.razao_social AS fornecedor, pe.numero AS pedido, m.documento, m.observacao, u.nome AS usuario, m.embalagem_id
          FROM estoque_movimentos m JOIN produtos p ON p.id = m.produto_id LEFT JOIN produto_embalagens e ON e.id = m.embalagem_id
          LEFT JOIN fornecedores f ON f.id = m.fornecedor_id LEFT JOIN pedidos pe ON pe.id = m.pedido_id LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.empresa_id = ?`,
    params: [req.empresaId], sort: 'id', dir: 'desc', exact: ['tipo', 'origem', 'embalagem_id'],
  }));

async function embalagemValida(embalagemId) {
  const e = await db.get('SELECT e.id, e.produto_id FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id WHERE e.id = ?', Number(embalagemId));
  if (!e) throw new ErroNegocio('Selecione o produto e a embalagem.');
  return e;
}

r.post('/movimentos', A.exige('estoque.movimentar'), async (req, res) => {
  const b = req.body || {};
  const e = await embalagemValida(b.embalagem_id);
  const qtd = Number(b.quantidade);
  if (!(qtd > 0)) throw new ErroNegocio('Informe a quantidade.');
  if (!['entrada', 'saida'].includes(b.tipo)) throw new ErroNegocio('Tipo inválido.');
  const origens = b.tipo === 'entrada' ? ORIGENS_ENTRADA : ORIGENS_SAIDA;
  const origem = origens.includes(b.origem) ? b.origem : 'manual';
  if (b.tipo === 'saida' && b.lote) {
    const saldoLote = await S.saldoEstoque(req.empresaId, e.produto_id, e.id, b.lote);
    if (saldoLote < qtd) throw new ErroNegocio(`O lote ${b.lote} tem só ${saldoLote} em estoque.`);
  }
  const id = await S.movimentarEstoque({
    ...b, empresa_id: req.empresaId, produto_id: e.produto_id, embalagem_id: e.id, origem,
    quantidade: b.tipo === 'entrada' ? qtd : -qtd, usuario_id: req.user.id,
  });
  res.status(201).json({ id, saldo: await S.saldoEstoque(req.empresaId, e.produto_id, e.id) });
});

/** Inventário: informa a quantidade contada e o sistema lança o ajuste da diferença. */
r.post('/inventario', A.exige('estoque.movimentar'), async (req, res) => {
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itens.length) throw new ErroNegocio('Informe as contagens.');
  const ajustes = await db.tx(async () => {
    const out = [];
    for (const it of itens) {
      if (it.contado === null || it.contado === undefined || it.contado === '') continue;
      const e = await embalagemValida(it.embalagem_id);
      const atual = await S.saldoEstoque(req.empresaId, e.produto_id, e.id, it.lote || null);
      const dif = S.r2(Number(it.contado) - atual);
      if (!dif) continue;
      await S.movimentarEstoque({
        empresa_id: req.empresaId, produto_id: e.produto_id, embalagem_id: e.id, tipo: 'ajuste', origem: 'inventario', quantidade: dif,
        lote: it.lote || null, observacao: `Inventário: sistema ${atual}, contado ${it.contado}`, usuario_id: req.user.id,
      });
      out.push({ embalagem_id: e.id, antes: atual, contado: Number(it.contado), diferenca: dif });
    }
    return out;
  });
  res.json({ ajustes });
});

r.put('/minimo/:embalagemId', A.exige('estoque.movimentar'), async (req, res) => {
  const v = Number(req.body?.estoque_minimo);
  if (!(v >= 0)) throw new ErroNegocio('Estoque mínimo inválido.');
  await db.update('produto_embalagens', Number(req.params.embalagemId), { estoque_minimo: v, peso_kg: req.body?.peso_kg });
  res.json({ ok: true });
});

module.exports = r;
