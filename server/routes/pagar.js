// Contas a pagar: lançamentos avulsos, parcelados ou recorrentes, com baixa, estorno e cancelamento.
const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('financeiro.pagar'));

const STATUS_SQL = `CASE WHEN c.status = 'a_pagar' AND c.vencimento < date('now','localtime') THEN 'vencida'
  WHEN c.status = 'a_pagar' AND c.vencimento = date('now','localtime') THEN 'vence_hoje' ELSE c.status END`;
const SALDO_SQL = `CASE WHEN c.status = 'a_pagar' THEN ROUND((c.valor + COALESCE(c.juros,0) - COALESCE(c.desconto,0) - COALESCE(c.valor_pago,0))::numeric, 2)::float8 ELSE 0 END`;

const LISTA_SQL = `
  SELECT c.id, c.vencimento, c.descricao, f.razao_social AS fornecedor, c.fornecedor_id, c.categoria, c.documento, c.competencia,
    c.parcela || '/' || c.total_parcelas AS parcela, c.valor, c.juros, c.desconto, c.valor_pago, ${SALDO_SQL} AS saldo,
    c.data_pagamento, c.forma_pagamento, b.nome AS banco, ${STATUS_SQL} AS status, c.grupo, c.emissao, u.nome AS lancado_por
  FROM contas_pagar c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id LEFT JOIN bancos b ON b.id = c.banco_id
  LEFT JOIN usuarios u ON u.id = c.usuario_id
  WHERE c.empresa_id = ?`;

r.get('/', async (req, res) =>
  await responderLista(req, res, { sql: LISTA_SQL + (req.query.abertos === '1' ? ` AND c.status = 'a_pagar'` : ''), params: [req.empresaId], sort: 'vencimento', dir: 'asc', exact: ['status', 'fornecedor_id', 'grupo'] }));

r.get('/resumo', async (req, res) => {
  const t = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN c.status = 'a_pagar' AND c.vencimento < date('now','localtime') THEN ${SALDO_SQL} END), 0) AS vencido,
       COUNT(*) FILTER (WHERE c.status = 'a_pagar' AND c.vencimento < date('now','localtime')) AS qtd_vencido,
       COALESCE(SUM(CASE WHEN c.status = 'a_pagar' AND c.vencimento = date('now','localtime') THEN ${SALDO_SQL} END), 0) AS hoje,
       COUNT(*) FILTER (WHERE c.status = 'a_pagar' AND c.vencimento = date('now','localtime')) AS qtd_hoje,
       COALESCE(SUM(CASE WHEN c.status = 'a_pagar' AND c.vencimento > date('now','localtime') AND c.vencimento <= date('now','localtime','+7 days') THEN ${SALDO_SQL} END), 0) AS semana,
       COALESCE(SUM(CASE WHEN c.status = 'a_pagar' THEN ${SALDO_SQL} END), 0) AS aberto,
       COALESCE(SUM(CASE WHEN c.status = 'pago' AND substr(c.data_pagamento, 1, 7) = substr(date('now','localtime'), 1, 7) THEN c.valor_pago END), 0) AS pago_mes
     FROM contas_pagar c WHERE c.empresa_id = ?`, req.empresaId,
  );
  const categorias = await db.all(
    `SELECT COALESCE(c.categoria, 'Sem categoria') AS categoria, ROUND(SUM(${SALDO_SQL})::numeric, 2)::float8 AS valor
       FROM contas_pagar c WHERE c.empresa_id = ? AND c.status = 'a_pagar' GROUP BY 1 ORDER BY 2 DESC`, req.empresaId,
  );
  res.json({ ...t, categorias });
});

r.get('/:id', async (req, res) => {
  const c = await db.get(`SELECT c.*, ${STATUS_SQL} AS status_atual, ${SALDO_SQL} AS saldo FROM contas_pagar c WHERE c.id = ? AND c.empresa_id = ?`,
    Number(req.params.id), req.empresaId);
  if (!c) throw new ErroNegocio('Conta não encontrada', 404);
  c.parcelas = c.grupo ? await db.all('SELECT id, parcela, vencimento, valor, status FROM contas_pagar WHERE grupo = ? ORDER BY parcela', c.grupo) : [];
  res.json(c);
});

const CAMPOS = ['fornecedor_id', 'descricao', 'categoria', 'documento', 'emissao', 'competencia', 'vencimento', 'valor', 'forma_pagamento',
  'banco_id', 'codigo_barras', 'observacao'];

function addMeses(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/**
 * Inclusão. "parcelas" divide o valor em N vencimentos mensais;
 * "recorrente" repete o mesmo valor por N meses (aluguel, energia...).
 */
r.post('/', async (req, res) => {
  const b = req.body || {};
  if (!String(b.descricao || '').trim()) throw new ErroNegocio('Informe a descrição.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.vencimento || '')) throw new ErroNegocio('Informe o vencimento.');
  const valor = S.r2(b.valor);
  if (!(valor > 0)) throw new ErroNegocio('Informe o valor.');
  const n = Math.min(Math.max(parseInt(b.parcelas || b.repeticoes, 10) || 1, 1), 120);
  const recorrente = !!b.recorrente;
  const grupo = n > 1 ? crypto.randomUUID() : null;
  const ids = await db.tx(async () => {
    const out = [];
    let restante = valor;
    for (let i = 0; i < n; i++) {
      // No parcelamento a última parcela absorve o arredondamento.
      const v = recorrente ? valor : i === n - 1 ? S.r2(restante) : S.r2(valor / n);
      restante = S.r2(restante - v);
      const venc = addMeses(b.vencimento, i);
      out.push(await db.insert('contas_pagar', {
        ...Object.fromEntries(CAMPOS.map((k) => [k, b[k]])),
        descricao: n > 1 && !recorrente ? `${b.descricao} (${i + 1}/${n})` : b.descricao,
        competencia: recorrente ? venc.slice(0, 7) : b.competencia || venc.slice(0, 7),
        vencimento: venc, valor: v, parcela: i + 1, total_parcelas: n, grupo,
        empresa_id: req.empresaId, usuario_id: req.user.id, status: 'a_pagar',
      }));
    }
    return out;
  });
  res.status(201).json({ id: ids[0], ids });
});

async function carregar(req) {
  const c = await db.get('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!c) throw new ErroNegocio('Conta não encontrada', 404);
  return c;
}

r.put('/:id', async (req, res) => {
  const c = await carregar(req);
  if (c.status !== 'a_pagar') throw new ErroNegocio('Só é possível alterar contas em aberto.');
  const b = { ...req.body };
  if (b.valor !== undefined && !(S.r2(b.valor) > 0)) throw new ErroNegocio('Valor inválido.');
  await db.update('contas_pagar', c.id, b, CAMPOS);
  res.json({ ok: true });
});

r.post('/:id/pagar', async (req, res) => {
  const c = await carregar(req);
  if (c.status !== 'a_pagar') throw new ErroNegocio('Conta não está em aberto.');
  const b = req.body || {};
  const juros = S.r2(b.juros ?? c.juros);
  const desconto = S.r2(b.desconto ?? c.desconto);
  const devido = S.r2(c.valor + juros - desconto - (c.valor_pago || 0));
  const pago = S.r2(b.valor_pago ?? devido);
  if (!(pago > 0)) throw new ErroNegocio('Informe o valor pago.');
  if (pago > devido + 0.009) throw new ErroNegocio(`Valor maior que o saldo (${devido.toFixed(2)}).`);
  const total = S.r2((c.valor_pago || 0) + pago);
  const quitou = total >= S.r2(c.valor + juros - desconto) - 0.009;
  await db.update('contas_pagar', c.id, {
    juros, desconto, valor_pago: total, data_pagamento: b.data_pagamento || S.hoje(), status: quitou ? 'pago' : 'a_pagar',
    forma_pagamento: b.forma_pagamento || c.forma_pagamento, banco_id: b.banco_id || c.banco_id,
  });
  res.json({ ok: true, quitou });
});

r.post('/:id/estornar', async (req, res) => {
  const c = await carregar(req);
  if (!(c.valor_pago > 0)) throw new ErroNegocio('Conta sem pagamento para estornar.');
  await db.update('contas_pagar', c.id, { valor_pago: 0, data_pagamento: null, juros: 0, desconto: 0, status: 'a_pagar' });
  res.json({ ok: true });
});

r.post('/:id/cancelar', async (req, res) => {
  const c = await carregar(req);
  if (c.status !== 'a_pagar') throw new ErroNegocio('Só é possível cancelar contas em aberto.');
  if (c.valor_pago > 0) throw new ErroNegocio('Estorne o pagamento parcial antes de cancelar.');
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo do cancelamento.');
  const ids = req.body?.todas && c.grupo
    ? (await db.all(`SELECT id FROM contas_pagar WHERE grupo = ? AND status = 'a_pagar' AND COALESCE(valor_pago,0) = 0 AND vencimento >= ?`, c.grupo, c.vencimento)).map((x) => x.id)
    : [c.id];
  await db.tx(async () => {
    for (const id of ids) {
      await db.update('contas_pagar', id, { status: 'cancelado', observacao: `${c.observacao ? c.observacao + ' | ' : ''}Cancelada: ${motivo}` });
    }
  });
  res.json({ ok: true, canceladas: ids.length });
});

module.exports = r;
module.exports.STATUS_SQL = STATUS_SQL;
module.exports.SALDO_SQL = SALDO_SQL;
