// Metas mensais (empresa, equipe e vendedor) e campanhas de vendas: o realizado vem dos pedidos enviados
// (fora "em digitação" e cancelados), na mesma regra dos painéis.
const db = require('./db');
const S = require('./services');

const INDICADORES = {
  valor: { nome: 'Valor vendido', tipo: 'moeda' },
  volume: { nome: 'Volume (kg/L)', tipo: 'numero' },
  pedidos: { nome: 'Pedidos', tipo: 'numero' },
  clientes_novos: { nome: 'Clientes novos', tipo: 'numero' },
};

const fimDoMes = (periodo) => {
  const [a, m] = periodo.split('-').map(Number);
  return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
};

/**
 * Realizado por vendedor no intervalo [de, ate): { vendedor_id: { valor, volume, pedidos, clientes_novos } }.
 * filtro: { produto_id, grupo_id } restringe valor e volume aos itens do produto/grupo (campanhas).
 */
async function realizado(empresaId, de, ate, filtro = {}) {
  const itemFiltro = filtro.produto_id ? 'AND i.produto_id = :produto' : filtro.grupo_id ? 'AND pr.grupo_id = :grupo' : '';
  const params = { e: empresaId, de, ate, produto: filtro.produto_id || null, grupo: filtro.grupo_id || null };
  const base = `p.empresa_id = :e AND p.etapa NOT IN ('venda','cancelado') AND p.created_at >= :de AND p.created_at < :ate`;
  const itens = await db.all(
    `SELECT p.vendedor_id, ROUND(SUM(i.valor_total)::numeric, 2)::float8 AS valor, SUM(i.quantidade * COALESCE(e.quantidade, 1)) AS volume,
        COUNT(DISTINCT p.id) AS pedidos
       FROM pedidos p JOIN pedido_itens i ON i.pedido_id = p.id AND i.brinde = 0 JOIN produtos pr ON pr.id = i.produto_id
       LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id
      WHERE ${base} ${itemFiltro} GROUP BY p.vendedor_id`, params,
  );
  // Sem filtro de produto, o valor é o total do pedido (com o desconto da condição), igual aos painéis.
  const totais = itemFiltro ? [] : await db.all(`SELECT p.vendedor_id, ROUND(SUM(p.valor_total)::numeric, 2)::float8 AS valor FROM pedidos p WHERE ${base} GROUP BY p.vendedor_id`, params);
  const novos = await db.all(
    `SELECT p.vendedor_id, COUNT(DISTINCT p.cliente_id) AS n FROM pedidos p
      WHERE ${base} AND NOT EXISTS (SELECT 1 FROM pedidos x WHERE x.cliente_id = p.cliente_id AND x.etapa NOT IN ('venda','cancelado') AND x.created_at < :de)
      GROUP BY p.vendedor_id`, params,
  );
  const out = {};
  const de_ = (id) => (out[id] ||= { valor: 0, volume: 0, pedidos: 0, clientes_novos: 0 });
  for (const x of itens) Object.assign(de_(x.vendedor_id), { valor: x.valor || 0, volume: S.r2(x.volume || 0), pedidos: x.pedidos });
  for (const x of totais) de_(x.vendedor_id).valor = x.valor || 0;
  for (const x of novos) de_(x.vendedor_id).clientes_novos = x.n;
  return out;
}

const soma = (lista) => lista.reduce((a, r) => {
  for (const k of Object.keys(INDICADORES)) a[k] = S.r2((a[k] || 0) + (r?.[k] || 0));
  return a;
}, {});

/** Fração do mês já decorrida (para a projeção de fechamento). */
function fracaoDoMes(periodo) {
  const hoje = S.hoje();
  if (hoje.slice(0, 7) > periodo) return 1;
  if (hoje.slice(0, 7) < periodo) return 0;
  const [a, m] = periodo.split('-').map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Number(hoje.slice(8, 10)) / dias;
}

module.exports = { INDICADORES, realizado, soma, fimDoMes, fracaoDoMes };
