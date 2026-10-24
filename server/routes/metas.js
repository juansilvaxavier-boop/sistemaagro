// Metas mensais e campanhas de vendas, com realizado, projeção e ranking.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const E = require('../escopo');
const M = require('../metas');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('metas'));
const gerir = A.exige('metas.gerir');
const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

function periodoDe(req) {
  const p = String(req.query.periodo || req.body?.periodo || S.hoje().slice(0, 7));
  if (!PERIODO.test(p)) throw new ErroNegocio('Período inválido (use AAAA-MM).');
  return p;
}

/** Vendedores (e supervisores que vendem) visíveis para quem consulta. */
async function vendedoresVisiveis(user) {
  return db.all(
    `SELECT u.id, u.nome, u.perfil, u.equipe_id, eq.nome AS equipe FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id
      WHERE u.ativo = 1 AND u.perfil IN ('vendedor','supervisor') AND ${E.pessoas(user, 'u.id')} ORDER BY u.nome`,
  );
}

r.get('/', async (req, res) => {
  const periodo = periodoDe(req);
  const vend = await vendedoresVisiveis(req.user);
  const real = await M.realizado(req.empresaId, `${periodo}-01`, M.fimDoMes(periodo));
  const metas = await db.all('SELECT escopo, alvo_id, indicador, meta FROM metas WHERE empresa_id = ? AND periodo = ?', req.empresaId, periodo);
  const metaDe = (escopo, alvo) => Object.fromEntries(metas.filter((m) => m.escopo === escopo && m.alvo_id === alvo).map((m) => [m.indicador, m.meta]));
  const fr = M.fracaoDoMes(periodo);
  const linha = (escopo, alvo_id, nome, realizado, extra = {}) => {
    const meta = metaDe(escopo, alvo_id);
    const pct = Object.fromEntries(Object.keys(M.INDICADORES).map((k) => [k, meta[k] ? S.r2((realizado[k] / meta[k]) * 100) : null]));
    const projecao = Object.fromEntries(Object.keys(M.INDICADORES).map((k) => [k, fr > 0 && fr < 1 ? S.r2(realizado[k] / fr) : realizado[k]]));
    return { escopo, alvo_id, nome, meta, realizado, pct, projecao, ...extra };
  };
  const linhas = [];
  const todos = E.veTudo(req.user);
  if (todos) linhas.push(linha('empresa', 0, 'Empresa', M.soma(Object.values(real))));
  const equipes = await db.all(`SELECT e.id, e.nome FROM equipes e ORDER BY e.nome`);
  for (const eq of equipes) {
    const membros = vend.filter((v) => v.equipe_id === eq.id);
    if (!todos && !membros.length) continue;
    const todosMembros = todos ? (await db.all('SELECT id FROM usuarios WHERE equipe_id = ?', eq.id)).map((x) => x.id) : membros.map((v) => v.id);
    linhas.push(linha('equipe', eq.id, eq.nome, M.soma(todosMembros.map((id) => real[id]))));
  }
  for (const v of vend) linhas.push(linha('vendedor', v.id, v.nome, real[v.id] || M.soma([]), { equipe: v.equipe, equipe_id: v.equipe_id }));
  res.json({ periodo, fracao_mes: S.r2(fr), indicadores: M.INDICADORES, linhas, pode_gerir: A.can(req.user, 'metas.gerir') });
});

r.put('/', gerir, async (req, res) => {
  const periodo = periodoDe(req);
  const lista = Array.isArray(req.body?.metas) ? req.body.metas : [];
  await db.tx(async () => {
    for (const m of lista) {
      if (!['empresa', 'equipe', 'vendedor'].includes(m.escopo) || !M.INDICADORES[m.indicador]) throw new ErroNegocio('Meta inválida.');
      const alvo = m.escopo === 'empresa' ? 0 : Number(m.alvo_id);
      if (m.escopo !== 'empresa' && !alvo) throw new ErroNegocio('Meta sem vendedor ou equipe.');
      const v = m.meta === '' || m.meta == null ? null : Number(m.meta);
      if (v !== null && !(v >= 0)) throw new ErroNegocio('Valor de meta inválido.');
      const chave = [req.empresaId, periodo, m.escopo, alvo, m.indicador];
      if (v === null || v === 0) {
        await db.run('DELETE FROM metas WHERE empresa_id = ? AND periodo = ? AND escopo = ? AND alvo_id = ? AND indicador = ?', ...chave);
      } else {
        await db.run(
          `INSERT INTO metas (empresa_id, periodo, escopo, alvo_id, indicador, meta, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (empresa_id, periodo, escopo, alvo_id, indicador) DO UPDATE SET meta = EXCLUDED.meta, updated_by = EXCLUDED.updated_by, updated_at = datetime('now','localtime')`,
          ...chave, v, req.user.id,
        );
      }
    }
  });
  await require('../auditoria').registrar('definir_metas', 'metas', null, null, { periodo, alteradas: lista.length });
  res.json({ ok: true });
});

r.post('/copiar', gerir, async (req, res) => {
  const { de, para } = req.body || {};
  if (!PERIODO.test(de || '') || !PERIODO.test(para || '')) throw new ErroNegocio('Informe os meses de origem e destino.');
  const fator = 1 + (Number(req.body?.reajuste_pct) || 0) / 100;
  const r_ = await db.run(
    `INSERT INTO metas (empresa_id, periodo, escopo, alvo_id, indicador, meta, updated_by)
       SELECT empresa_id, ?, escopo, alvo_id, indicador, ROUND((meta * ?)::numeric, 2)::float8, ? FROM metas WHERE empresa_id = ? AND periodo = ?
       ON CONFLICT (empresa_id, periodo, escopo, alvo_id, indicador) DO NOTHING`, para, fator, req.user.id, req.empresaId, de,
  );
  res.json({ copiadas: r_.changes || 0 });
});

r.get('/ranking', async (req, res) => {
  const periodo = periodoDe(req);
  const real = await M.realizado(req.empresaId, `${periodo}-01`, M.fimDoMes(periodo));
  const vend = await db.all(`SELECT u.id, u.nome, eq.nome AS equipe FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id WHERE u.ativo = 1 AND u.perfil IN ('vendedor','supervisor')`);
  const metas = Object.fromEntries((await db.all(`SELECT alvo_id, meta FROM metas WHERE empresa_id = ? AND periodo = ? AND escopo = 'vendedor' AND indicador = 'valor'`, req.empresaId, periodo)).map((m) => [m.alvo_id, m.meta]));
  const visiveis = new Set((await vendedoresVisiveis(req.user)).map((v) => v.id));
  const lista = vend.map((v) => {
    const valor = real[v.id]?.valor || 0;
    const meta = metas[v.id] || null;
    return { id: v.id, nome: v.nome, equipe: v.equipe, pct: meta ? S.r2((valor / meta) * 100) : null, valor, meta, pedidos: real[v.id]?.pedidos || 0 };
  }).filter((v) => v.valor > 0 || v.meta)
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.valor - a.valor);
  // De quem está fora da abrangência mostra só a posição e o % da meta.
  res.json(lista.map((v, i) => ({ posicao: i + 1, ...v, ...(visiveis.has(v.id) ? {} : { valor: null, meta: null, pedidos: null }), eu: v.id === req.user.id })));
});

// ---------- Campanhas ----------
async function placar(c, user) {
  const real = await M.realizado(c.empresa_id, c.inicio, require('../services').addDias(c.fim, 1), { produto_id: c.produto_id, grupo_id: c.grupo_id });
  const part = await db.all(
    `SELECT u.id, u.nome, eq.nome AS equipe FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id
      WHERE u.ativo = 1 AND u.perfil IN ('vendedor','supervisor') ${c.equipe_id ? 'AND u.equipe_id = ?' : ''}`, ...(c.equipe_id ? [c.equipe_id] : []),
  );
  const visiveis = new Set((await vendedoresVisiveis(user)).map((v) => v.id));
  const lista = part.map((v) => {
    const feito = real[v.id]?.[c.indicador] || 0;
    return { id: v.id, nome: v.nome, equipe: v.equipe, realizado: feito, pct: c.meta_individual ? S.r2((feito / c.meta_individual) * 100) : null, atingiu: c.meta_individual > 0 && feito >= c.meta_individual };
  }).sort((a, b) => b.realizado - a.realizado);
  return lista.map((v, i) => ({ posicao: i + 1, ...v, ...(visiveis.has(v.id) ? {} : { realizado: null }), eu: v.id === user.id }));
}

r.get('/campanhas', async (req, res) => {
  const rows = await db.all(
    `SELECT c.*, p.nome AS produto, g.nome AS grupo, e.nome AS equipe FROM campanhas c LEFT JOIN produtos p ON p.id = c.produto_id
       LEFT JOIN grupos_produto g ON g.id = c.grupo_id LEFT JOIN equipes e ON e.id = c.equipe_id
      WHERE c.empresa_id = ? ${req.query.todas === '1' ? '' : `AND c.ativa = 1 AND c.fim >= date('now','localtime','-60 days')`} ORDER BY c.fim DESC`, req.empresaId,
  );
  for (const c of rows) {
    c.placar = await placar(c, req.user);
    c.situacao = c.inicio > S.hoje() ? 'futura' : c.fim < S.hoje() ? 'encerrada' : 'andamento';
  }
  res.json(rows);
});

function dadosCampanha(b) {
  if (!String(b.nome || '').trim()) throw new ErroNegocio('Informe o nome da campanha.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(b.fim || '')) throw new ErroNegocio('Informe início e fim da campanha.');
  if (b.fim < b.inicio) throw new ErroNegocio('O fim deve ser depois do início.');
  if (!M.INDICADORES[b.indicador || 'valor']) throw new ErroNegocio('Indicador inválido.');
  const meta = Number(b.meta_individual) || 0;
  if (meta < 0) throw new ErroNegocio('Meta inválida.');
  return {
    nome: String(b.nome).trim(), descricao: b.descricao || null, inicio: b.inicio, fim: b.fim, indicador: b.indicador || 'valor',
    produto_id: Number(b.produto_id) || null, grupo_id: Number(b.produto_id) ? null : Number(b.grupo_id) || null, equipe_id: Number(b.equipe_id) || null,
    meta_individual: meta, premio: b.premio || null, ativa: b.ativa === undefined ? 1 : b.ativa ? 1 : 0,
  };
}
r.post('/campanhas', gerir, async (req, res) => {
  res.status(201).json({ id: await db.insert('campanhas', { ...dadosCampanha(req.body || {}), empresa_id: req.empresaId, created_by: req.user.id }) });
});
r.put('/campanhas/:id', gerir, async (req, res) => {
  const c = await db.get('SELECT * FROM campanhas WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!c) throw new ErroNegocio('Campanha não encontrada.', 404);
  await db.update('campanhas', c.id, dadosCampanha({ ...c, ...req.body }));
  res.json({ ok: true });
});
r.delete('/campanhas/:id', gerir, async (req, res) => {
  const c = await db.get('SELECT id FROM campanhas WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!c) throw new ErroNegocio('Campanha não encontrada.', 404);
  await db.remove('campanhas', c.id);
  res.json({ ok: true });
});

module.exports = r;
