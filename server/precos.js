// Preço de tabela: base do produto (por embalagem e forma de pagamento) ajustada pela tabela regional
// vigente para a UF de entrega. A tabela regional pode ter preço próprio por item ou um ajuste % geral.
// Usado no pedido, na proposta, na política comercial e na tela de preços.
const db = require('./db');
const S = require('./services');

const r2 = S.r2;

/** UF de entrega: endereço escolhido ou, sem ele, o principal do cliente. */
async function ufDe(clienteId, enderecoId) {
  if (enderecoId) {
    const e = await db.get('SELECT uf FROM cliente_enderecos WHERE id = ?', Number(enderecoId));
    if (e?.uf) return e.uf.toUpperCase();
  }
  if (!clienteId) return null;
  const e = await db.get('SELECT uf FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id LIMIT 1', Number(clienteId));
  return e?.uf ? e.uf.toUpperCase() : null;
}

/** Tabela regional vigente na data para a UF (maior prioridade; empate: a mais recente). */
async function tabelaVigente(uf, data = S.hoje()) {
  const rows = await db.all(
    `SELECT * FROM tabelas_preco WHERE ativa = 1 AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
      ORDER BY prioridade DESC, vigencia_inicio DESC, id DESC`, data, data,
  );
  return rows.find((t) => !t.ufs || (uf && t.ufs.split(',').map((x) => x.trim().toUpperCase()).includes(uf))) || null;
}

async function base(produtoId, embalagemId, formaId) {
  return (await db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND COALESCE(embalagem_id,0) = ? AND forma_id = ?', produtoId, embalagemId || 0, formaId || 0))?.valor
    ?? (await db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND COALESCE(embalagem_id,0) = ? AND forma_id IS NULL', produtoId, embalagemId || 0))?.valor ?? 0;
}

/**
 * Preço de tabela de um item: { valor, base, tabela_id, tabela }.
 * Ordem: preço próprio da tabela regional (embalagem + forma, depois só embalagem) → base × (1 + ajuste%).
 */
async function preco({ produtoId, embalagemId, formaId, uf, data, tabela }) {
  const b = await base(produtoId, embalagemId, formaId);
  const t = tabela === undefined ? await tabelaVigente(uf, data) : tabela;
  if (!t) return { valor: b, base: b, tabela_id: null, tabela: null };
  const proprio = embalagemId ? (
    await db.get('SELECT valor FROM tabela_preco_itens WHERE tabela_id = ? AND embalagem_id = ? AND forma_id = ?', t.id, embalagemId, formaId || 0)
    ?? await db.get('SELECT valor FROM tabela_preco_itens WHERE tabela_id = ? AND embalagem_id = ? AND forma_id IS NULL', t.id, embalagemId)
  ) : null;
  const valor = proprio ? proprio.valor : r2(b * (1 + (t.ajuste_pct || 0) / 100));
  return { valor, base: b, tabela_id: t.id, tabela: `${t.nome}${t.safra ? ` (safra ${t.safra})` : ''}` };
}

/** Todos os preços de um produto (cada embalagem × forma cadastrada) já com a tabela da UF. */
async function precosDoProduto(produtoId, uf, data) {
  const t = await tabelaVigente(uf, data);
  const linhas = await db.all('SELECT * FROM produto_precos WHERE produto_id = ?', produtoId);
  const out = [];
  for (const l of linhas) {
    const p = await preco({ produtoId, embalagemId: l.embalagem_id, formaId: l.forma_id, tabela: t });
    out.push({ ...l, valor: p.valor, valor_base: p.base, tabela_id: p.tabela_id });
  }
  return { precos: out, tabela: t ? { id: t.id, nome: t.nome, safra: t.safra, ufs: t.ufs } : null };
}

module.exports = { ufDe, tabelaVigente, preco, precosDoProduto, base };
