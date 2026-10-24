// Tesouraria: conciliação bancária (extrato OFX), fluxo de caixa e resultado do mês.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const T = require('../tesouraria');
const CFG = require('../config');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('tesouraria'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Extratos e conciliação ----------
r.post('/extratos', upload.single('arquivo'), async (req, res) => {
  if (!req.file) throw new ErroNegocio('Envie o arquivo OFX do banco.');
  // OFX antigo costuma vir em Latin-1; o novo em UTF-8.
  const bruto = req.file.buffer;
  const texto = /charset[:=]\s*1252|ENCODING:USASCII|CHARSET:1252/i.test(bruto.toString('latin1').slice(0, 400)) ? bruto.toString('latin1') : bruto.toString('utf8');
  const r_ = await T.importarOfx(texto, { empresaId: req.empresaId, bancoId: req.body?.banco_id, arquivo: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), usuarioId: req.user.id });
  const auto = req.body?.conciliar === '0' ? null : await T.conciliarAutomatico(req.empresaId, req.user.id);
  res.status(201).json({ ...r_, automatico: auto });
});

r.get('/extratos', async (req, res) => {
  res.json(await db.all(
    `SELECT e.*, b.nome AS banco, u.nome AS usuario,
        (SELECT COUNT(*) FROM extrato_lancamentos l WHERE l.extrato_id = e.id AND l.status = 'pendente') AS pendentes
       FROM extratos_bancarios e LEFT JOIN bancos b ON b.id = e.banco_id LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.empresa_id = ? ORDER BY e.id DESC LIMIT 50`, req.empresaId,
  ));
});

r.get('/lancamentos', async (req, res) => {
  await responderLista(req, res, {
    sql: `SELECT l.id, l.data, l.descricao, l.documento, l.valor, CASE WHEN l.valor > 0 THEN 'credito' ELSE 'debito' END AS tipo, l.status, b.nome AS banco, l.banco_id,
            COALESCE(cp.nome || ' · parcela ' || p.numero, f.razao_social || ' · ' || cpg.descricao, cpg.descricao) AS vinculo, l.parcela_id, l.conta_pagar_id, l.observacao
          FROM extrato_lancamentos l LEFT JOIN bancos b ON b.id = l.banco_id
          LEFT JOIN parcelas p ON p.id = l.parcela_id LEFT JOIN clientes cp ON cp.id = p.cliente_id
          LEFT JOIN contas_pagar cpg ON cpg.id = l.conta_pagar_id LEFT JOIN fornecedores f ON f.id = cpg.fornecedor_id
          WHERE l.empresa_id = ?`,
    params: [req.empresaId], sort: 'data', dir: 'desc', exact: ['status', 'tipo', 'banco_id'],
  });
});

async function lancamento(req) {
  const l = await db.get('SELECT * FROM extrato_lancamentos WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!l) throw new ErroNegocio('Lançamento não encontrado.', 404);
  return l;
}

r.get('/lancamentos/:id/sugestoes', async (req, res) => res.json(await T.sugestoes(await lancamento(req), { amplo: req.query.amplo === '1' })));

r.post('/lancamentos/:id/conciliar', A.exige('financeiro.parcelas', 'financeiro.pagar'), async (req, res) => {
  const l = await lancamento(req);
  const tipo = req.body?.tipo;
  if (tipo === 'parcela' && !A.can(req.user, 'financeiro.parcelas')) throw new ErroNegocio('Sem permissão para baixar parcelas.', 403);
  if (tipo === 'conta' && !A.can(req.user, 'financeiro.pagar')) throw new ErroNegocio('Sem permissão para baixar contas a pagar.', 403);
  res.json(await T.conciliar(l.id, { tipo, id: req.body?.id }, { empresaId: req.empresaId, usuarioId: req.user.id }));
});

/** Débito sem conta lançada (tarifa, imposto...): cria a conta já paga e concilia. */
r.post('/lancamentos/:id/criar-conta', A.exige('financeiro.pagar'), async (req, res) => {
  const l = await lancamento(req);
  if (l.status !== 'pendente' || l.valor >= 0) throw new ErroNegocio('Só débitos pendentes viram conta a pagar.');
  const b = req.body || {};
  if (!b.categoria) throw new ErroNegocio('Escolha a categoria.');
  await db.tx(async () => {
    const id = await db.insert('contas_pagar', {
      empresa_id: req.empresaId, fornecedor_id: Number(b.fornecedor_id) || null, descricao: String(b.descricao || l.descricao).slice(0, 200), categoria: b.categoria,
      vencimento: l.data, competencia: l.data.slice(0, 7), valor: Math.abs(l.valor), valor_pago: Math.abs(l.valor), data_pagamento: l.data, status: 'pago',
      banco_id: l.banco_id, documento: l.documento, usuario_id: req.user.id, observacao: 'Lançada pela conciliação bancária',
    });
    await db.run(`UPDATE extrato_lancamentos SET status = 'conciliado', conta_pagar_id = ?, conciliado_por = ?, conciliado_em = datetime('now','localtime') WHERE id = ?`, id, req.user.id, l.id);
  });
  res.json({ ok: true });
});

r.post('/lancamentos/:id/ignorar', async (req, res) => {
  const l = await lancamento(req);
  if (l.status === 'conciliado') throw new ErroNegocio('Desfaça a conciliação antes.');
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo (ex.: transferência entre contas, aplicação).');
  await db.run(`UPDATE extrato_lancamentos SET status = 'ignorado', observacao = ?, conciliado_por = ?, conciliado_em = datetime('now','localtime') WHERE id = ?`, motivo, req.user.id, l.id);
  res.json({ ok: true });
});

/** Desfaz a ligação (a baixa feita na parcela/conta continua; estorne por lá se for o caso). */
r.post('/lancamentos/:id/desfazer', async (req, res) => {
  const l = await lancamento(req);
  await db.run(`UPDATE extrato_lancamentos SET status = 'pendente', parcela_id = NULL, conta_pagar_id = NULL, observacao = NULL, conciliado_por = NULL, conciliado_em = NULL WHERE id = ?`, l.id);
  res.json({ ok: true });
});

r.post('/conciliar-automatico', A.exige('financeiro.parcelas', 'financeiro.pagar'), async (req, res) => res.json(await T.conciliarAutomatico(req.empresaId, req.user.id)));

// ---------- Fluxo de caixa ----------
r.get('/fluxo', async (req, res) => {
  const hoje = S.hoje();
  const de = DATA.test(req.query.de || '') ? req.query.de : S.addDias(hoje, -30);
  const ate = DATA.test(req.query.ate || '') ? req.query.ate : S.addDias(hoje, 90);
  if (ate < de) throw new ErroNegocio('Período inválido.');
  const agrupar = ['dia', 'semana', 'mes'].includes(req.query.agrupar) ? req.query.agrupar : 'semana';
  res.json({ de, ate, agrupar, hoje, ...(await T.fluxo(req.empresaId, { de, ate, agrupar, incluirAtrasados: req.query.atrasados === '1' })) });
});

r.put('/saldo', async (req, res) => {
  await T.informarSaldo(req.empresaId, req.body?.valor, req.body?.data, req.user.id);
  res.json(await T.saldoInicial(req.empresaId));
});

// ---------- Resultado do mês ----------
r.get('/resultado', async (req, res) => {
  const ano = Number(req.query.ano) || Number(S.hoje().slice(0, 4));
  if (ano < 2000 || ano > 2100) throw new ErroNegocio('Ano inválido.');
  res.json({ ...(await T.dre(req.empresaId, ano)), impostos_pct: await CFG.obter('dre.impostos_pct') });
});
r.put('/resultado/impostos', async (req, res) => {
  await CFG.definir('dre.impostos_pct', req.body?.pct ?? 0, req.user.id);
  res.json({ ok: true });
});

module.exports = r;
