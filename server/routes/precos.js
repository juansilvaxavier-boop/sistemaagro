// Tabelas de preço por região (UF) e safra: cabeçalho com vigência e ajuste %, preço próprio por embalagem,
// reajuste em lote e cópia para a safra seguinte.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const P = require('../precos');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('cadastros.produto'));
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;

r.get('/tabelas', async (req, res) => {
  const hoje = S.hoje();
  const rows = await db.all(
    `SELECT t.*, (SELECT COUNT(*) FROM tabela_preco_itens i WHERE i.tabela_id = t.id) AS itens FROM tabelas_preco t ORDER BY t.ativa DESC, t.vigencia_inicio DESC, t.nome`,
  );
  res.json({ ufs: UFS, tabelas: rows.map((t) => ({ ...t, vigente: !!t.ativa && t.vigencia_inicio <= hoje && (!t.vigencia_fim || t.vigencia_fim >= hoje) })) });
});

/** Tabela com a grade de todas as embalagens ativas: preço base, preço próprio da tabela e preço final. */
r.get('/tabelas/:id', async (req, res) => {
  // id 0 = grade em branco para uma tabela nova.
  const t = Number(req.params.id) === 0 ? { id: 0, ajuste_pct: 0 } : await db.get('SELECT * FROM tabelas_preco WHERE id = ?', Number(req.params.id));
  if (!t) throw new ErroNegocio('Tabela não encontrada.', 404);
  const embs = await db.all(
    `SELECT e.id AS embalagem_id, e.produto_id, p.nome AS produto, p.codigo, g.nome AS grupo, e.descricao AS embalagem, e.unidade, e.custo
       FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id LEFT JOIN grupos_produto g ON g.id = p.grupo_id WHERE p.ativo = 1 ORDER BY g.nome, p.nome, e.quantidade`,
  );
  const proprios = Object.fromEntries((await db.all('SELECT embalagem_id, valor FROM tabela_preco_itens WHERE tabela_id = ? AND forma_id IS NULL', t.id)).map((x) => [x.embalagem_id, x.valor]));
  const grade = [];
  for (const e of embs) {
    const base = await P.base(e.produto_id, e.embalagem_id, null);
    const proprio = proprios[e.embalagem_id] ?? null;
    const final = proprio ?? S.r2(base * (1 + (t.ajuste_pct || 0) / 100));
    grade.push({ ...e, base, proprio, final, margem_pct: final > 0 && e.custo ? S.r2(((final - e.custo) / final) * 100) : null });
  }
  res.json({ ...t, grade });
});

function cabecalho(b, atual = {}) {
  const x = { ...atual, ...b };
  if (!String(x.nome || '').trim()) throw new ErroNegocio('Informe o nome da tabela.');
  if (!DATA.test(x.vigencia_inicio || '')) throw new ErroNegocio('Informe o início da vigência.');
  if (x.vigencia_fim && !DATA.test(x.vigencia_fim)) throw new ErroNegocio('Fim da vigência inválido.');
  if (x.vigencia_fim && x.vigencia_fim < x.vigencia_inicio) throw new ErroNegocio('O fim da vigência deve ser depois do início.');
  const ufs = (Array.isArray(x.ufs) ? x.ufs : String(x.ufs || '').split(',')).map((u) => String(u).trim().toUpperCase()).filter(Boolean);
  const invalidas = ufs.filter((u) => !UFS.includes(u));
  if (invalidas.length) throw new ErroNegocio(`UF inválida: ${invalidas.join(', ')}.`);
  const ajuste = Number(String(x.ajuste_pct ?? 0).replace(',', '.'));
  if (!(ajuste > -90 && ajuste < 500)) throw new ErroNegocio('Ajuste % inválido.');
  if (x.safra && !/^\d{2}\/\d{2}$/.test(x.safra)) throw new ErroNegocio('Safra no formato 26/27.');
  return {
    nome: String(x.nome).trim(), safra: x.safra || null, ufs: [...new Set(ufs)].join(',') || null, vigencia_inicio: x.vigencia_inicio, vigencia_fim: x.vigencia_fim || null,
    ajuste_pct: ajuste, prioridade: Number(x.prioridade) || 0, ativa: x.ativa === undefined ? 1 : x.ativa ? 1 : 0, observacao: x.observacao || null,
  };
}

async function gravarItens(tabelaId, itens) {
  for (const it of itens || []) {
    const emb = Number(it.embalagem_id);
    if (!emb) continue;
    await db.run('DELETE FROM tabela_preco_itens WHERE tabela_id = ? AND embalagem_id = ? AND COALESCE(forma_id, 0) = ?', tabelaId, emb, Number(it.forma_id) || 0);
    const v = it.valor === '' || it.valor == null ? null : Number(it.valor);
    if (v === null) continue;
    if (!(v > 0)) throw new ErroNegocio('Preço deve ser maior que zero.');
    await db.run('INSERT INTO tabela_preco_itens (tabela_id, embalagem_id, forma_id, valor) VALUES (?, ?, ?, ?)', tabelaId, emb, Number(it.forma_id) || null, S.r2(v));
  }
}

r.post('/tabelas', async (req, res) => {
  const id = await db.tx(async () => {
    const tid = await db.insert('tabelas_preco', cabecalho(req.body || {}));
    await gravarItens(tid, req.body?.itens);
    return tid;
  });
  res.status(201).json({ id });
});

r.put('/tabelas/:id', async (req, res) => {
  const t = await db.get('SELECT * FROM tabelas_preco WHERE id = ?', Number(req.params.id));
  if (!t) throw new ErroNegocio('Tabela não encontrada.', 404);
  await db.tx(async () => {
    await db.update('tabelas_preco', t.id, cabecalho(req.body || {}, t));
    await gravarItens(t.id, req.body?.itens);
  });
  await require('../auditoria').registrar('tabela_preco', 'tabelas_preco', t.id, null, { itens_alterados: (req.body?.itens || []).length });
  res.json({ ok: true });
});

/** Reajuste em lote: muda os preços próprios da tabela (ou o ajuste geral) em X%. */
r.post('/tabelas/:id/reajustar', async (req, res) => {
  const t = await db.get('SELECT * FROM tabelas_preco WHERE id = ?', Number(req.params.id));
  if (!t) throw new ErroNegocio('Tabela não encontrada.', 404);
  const pct = Number(String(req.body?.pct ?? '').replace(',', '.'));
  if (!(pct > -50 && pct < 200) || !pct) throw new ErroNegocio('Informe o reajuste em % (ex.: 5 ou -3).');
  const fator = 1 + pct / 100;
  await db.tx(async () => {
    await db.run('UPDATE tabela_preco_itens SET valor = ROUND((valor * ?)::numeric, 2)::float8 WHERE tabela_id = ?', fator, t.id);
    // Itens sem preço próprio seguem o ajuste geral: compõe o reajuste sobre ele.
    await db.run('UPDATE tabelas_preco SET ajuste_pct = ROUND((((1 + ajuste_pct / 100) * ? - 1) * 100)::numeric, 4)::float8 WHERE id = ?', fator, t.id);
  });
  await require('../auditoria').registrar('reajuste_tabela', 'tabelas_preco', t.id, { ajuste_pct: t.ajuste_pct }, { reajuste_pct: pct });
  res.json({ ok: true });
});

/** Copia a tabela (para a próxima safra, por exemplo), com reajuste opcional. */
r.post('/tabelas/:id/copiar', async (req, res) => {
  const t = await db.get('SELECT * FROM tabelas_preco WHERE id = ?', Number(req.params.id));
  if (!t) throw new ErroNegocio('Tabela não encontrada.', 404);
  const b = req.body || {};
  const fator = 1 + (Number(b.reajuste_pct) || 0) / 100;
  const id = await db.tx(async () => {
    const novo = await db.insert('tabelas_preco', cabecalho({
      nome: b.nome || `${t.nome} (cópia)`, safra: b.safra ?? t.safra, ufs: t.ufs, vigencia_inicio: b.vigencia_inicio || t.vigencia_inicio,
      vigencia_fim: b.vigencia_fim ?? null, ajuste_pct: S.r2(((1 + t.ajuste_pct / 100) * fator - 1) * 100), prioridade: t.prioridade, ativa: 1, observacao: t.observacao,
    }));
    await db.run(`INSERT INTO tabela_preco_itens (tabela_id, embalagem_id, forma_id, valor)
      SELECT ?, embalagem_id, forma_id, ROUND((valor * ?)::numeric, 2)::float8 FROM tabela_preco_itens WHERE tabela_id = ?`, novo, fator, t.id);
    return novo;
  });
  res.status(201).json({ id });
});

r.delete('/tabelas/:id', async (req, res) => {
  const t = await db.get('SELECT id FROM tabelas_preco WHERE id = ?', Number(req.params.id));
  if (!t) throw new ErroNegocio('Tabela não encontrada.', 404);
  if (await db.get('SELECT 1 AS x FROM pedido_itens WHERE tabela_preco_id = ? LIMIT 1', t.id)) {
    await db.update('tabelas_preco', t.id, { ativa: 0 });
    return res.json({ ok: true, desativada: true });
  }
  await db.remove('tabelas_preco', t.id);
  res.json({ ok: true });
});

/** Qual tabela vale para uma UF numa data (conferência). */
r.get('/vigente', async (req, res) => {
  const t = await P.tabelaVigente(req.query.uf ? String(req.query.uf).toUpperCase() : null, req.query.data || S.hoje());
  res.json(t);
});

module.exports = r;
