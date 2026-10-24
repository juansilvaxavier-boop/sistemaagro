// Limites de crédito dos clientes: situação, limite sugerido, limite automático, regras e liberação de pedido.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const E = require('../escopo');
const CR = require('../credito');
const CFG = require('../config');
const { responderMemoria } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;
const ROTULO = { ok: 'Dentro do limite', sem_limite: 'Sem limite definido', excedido: 'Acima do limite', atraso: 'Bloqueado por atraso' };

r.get('/clientes', A.exige('credito.gerir', 'financeiro.parcelas', 'fila.analise'), async (req, res) => {
  const rg = await CR.regras();
  const ls = await CR.linhas({ where: E.clientes(req.user, 'c') });
  const rows = ls.map((l) => {
    const s = CR.situacao(l, rg);
    return {
      id: l.id, nome: l.nome, documento: l.documento, vendedor: l.vendedor, limite: s.limite, exposicao: s.exposicao, disponivel: s.disponivel, uso_pct: s.uso_pct,
      em_aberto: l.em_aberto, em_andamento: l.em_andamento, vencido: l.vencido, maior_atraso: l.maior_atraso, compras_12m: l.compras_12m, score: l.score,
      sugerido: s.sugerido.valor, sugerido_motivos: s.sugerido.motivos.join(' · '), automatico: l.limite_automatico ? 1 : 0, status: s.status, situacao: ROTULO[s.status],
      bloqueios: s.bloqueios.join(' · '), atualizado_em: l.limite_atualizado_em,
    };
  }).filter((x) => req.query.ativos !== '1' || x.exposicao > 0 || x.compras_12m > 0 || x.limite > 0);
  await responderMemoria(req, res, rows, { titulo: 'Limites de crédito', exatos: ['status', 'automatico'] });
});

r.get('/clientes/:id', async (req, res) => {
  const s = await CR.doCliente(Number(req.params.id));
  if (!s) throw new ErroNegocio('Cliente não encontrado.', 404);
  res.json(s);
});

/** Define o limite (manual ou automático). automatico=1 passa a seguir o sugerido todo dia. */
r.put('/clientes/:id', A.exige('credito.gerir'), async (req, res) => {
  const c = await db.get('SELECT id, limite_credito FROM clientes WHERE id = ?', Number(req.params.id));
  if (!c) throw new ErroNegocio('Cliente não encontrado.', 404);
  const b = req.body || {};
  const auto = b.automatico ? 1 : 0;
  let limite = b.limite === '' || b.limite == null ? null : Number(b.limite);
  if (auto) limite = (await CR.doCliente(c.id)).sugerido.valor;
  if (limite === null || !(limite >= 0)) throw new ErroNegocio('Informe o limite (R$).');
  await db.update('clientes', c.id, { limite_credito: S.r2(limite), limite_automatico: auto, limite_atualizado_em: S.agora() });
  res.json({ ok: true, limite });
});

/** Aplica o limite sugerido em lote (ids informados, ou todos os sem limite). */
r.post('/aplicar-sugerido', A.exige('credito.gerir'), async (req, res) => {
  const rg = await CR.regras();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  const ls = await CR.linhas(ids?.length ? { ids } : { where: `COALESCE(c.limite_credito, 0) = 0 AND ${E.clientes(req.user, 'c')}` });
  let n = 0;
  await db.tx(async () => {
    for (const l of ls) {
      const v = CR.sugerido(l, rg).valor;
      if (!v) continue;
      await db.run(`UPDATE clientes SET limite_credito = ?, limite_automatico = ?, limite_atualizado_em = datetime('now','localtime') WHERE id = ?`, v, req.body?.automatico ? 1 : 0, l.id);
      n++;
    }
  });
  await require('../auditoria').registrar('aplicar_limite_sugerido', 'clientes', null, null, { clientes: n, automatico: !!req.body?.automatico });
  res.json({ atualizados: n });
});

r.get('/regras', A.exige('credito.gerir', 'credito.liberar'), async (req, res) => res.json(await CFG.todas('credito.')));
r.put('/regras', A.exige('credito.gerir'), async (req, res) => {
  const b = req.body || {};
  if (Object.keys(b).some((k) => !k.startsWith('credito.'))) throw new ErroNegocio('Regra desconhecida.');
  await db.tx(async () => { for (const [k, v] of Object.entries(b)) await CFG.definir(k, v, req.user.id); });
  res.json(await CFG.todas('credito.'));
});

/** Liberação do crédito de um pedido bloqueado (Diretoria), com justificativa no histórico. */
r.post('/pedidos/:id/liberar', A.exige('credito.liberar'), async (req, res) => {
  const p = await db.get('SELECT * FROM pedidos WHERE id = ?', Number(req.params.id));
  if (!p) throw new ErroNegocio('Pedido não encontrado.', 404);
  if (!['analise', 'supervisao', 'venda'].includes(p.etapa)) throw new ErroNegocio('A liberação de crédito vale até a Análise.');
  const just = String(req.body?.justificativa || '').trim();
  if (just.length < 10) throw new ErroNegocio('Escreva a justificativa da liberação (mínimo 10 caracteres).');
  await db.tx(async () => {
    await db.update('pedidos', p.id, { credito_liberado_por: req.user.id, credito_liberado_em: S.agora(), credito_justificativa: just });
    await S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: 'Crédito liberado', observacao: just, usuarioId: req.user.id });
  });
  res.json({ ok: true });
});

module.exports = r;
