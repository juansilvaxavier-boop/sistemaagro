// Feriados (RH): nacionais calculados + estaduais, municipais e da empresa; a empresa decide folga ou trabalho em cada um.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const F = require('../feriados');

const r = express.Router();
const { ErroNegocio } = S;

r.get('/', A.exige('rh'), async (req, res) => {
  const ano = /^\d{4}$/.test(String(req.query.ano || '')) ? Number(req.query.ano) : Number(S.hoje().slice(0, 4));
  res.json({ ano, feriados: await F.doAno(req.empresaId, ano), tipos: F.TIPOS });
});

async function cadastro(req) {
  const f = await db.get('SELECT * FROM rh_feriados WHERE id = ? AND (empresa_id IS NULL OR empresa_id = ?)', Number(req.params.id), req.empresaId);
  if (!f) throw new ErroNegocio('Feriado não encontrado.', 404);
  return f;
}

r.post('/', A.exige('rh.gerir'), async (req, res) => {
  const d = F.dados(req.body || {});
  await F.exigirAberta(req.empresaId, d.data, d.anual);
  const id = await db.insert('rh_feriados', { ...d, empresa_id: req.body?.todas_empresas ? null : req.empresaId, usuario_id: req.user.id });
  res.status(201).json({ id });
});

r.put('/:id', A.exige('rh.gerir'), async (req, res) => {
  const f = await cadastro(req);
  const d = F.dados({ ...f, ...req.body });
  await F.exigirAberta(req.empresaId, f.data, f.anual);
  await F.exigirAberta(req.empresaId, d.data, d.anual);
  await db.update('rh_feriados', f.id, d);
  res.json({ ok: true });
});

r.delete('/:id', A.exige('rh.gerir'), async (req, res) => {
  const f = await cadastro(req);
  await F.exigirAberta(req.empresaId, f.data, f.anual);
  await db.remove('rh_feriados', f.id);
  res.json({ ok: true });
});

/** Decisão da empresa sobre um feriado nacional ou facultativo: folga ou trabalha (vale só para o ano daquela data). */
r.post('/decisao', A.exige('rh.gerir'), async (req, res) => {
  const data = String(req.body?.data || '');
  const ano = Number(data.slice(0, 4));
  const n = ano ? (await F.nacionais(ano)).find((x) => x.data === data) : null;
  if (!n) throw new ErroNegocio('Não há feriado nacional nesta data.');
  await F.exigirAberta(req.empresaId, data, false);
  const folga = req.body.folga ? 1 : 0;
  const atual = await db.get('SELECT id FROM rh_feriados WHERE empresa_id = ? AND data = ? AND anual = 0', req.empresaId, data);
  if (atual) await db.update('rh_feriados', atual.id, { folga, usuario_id: req.user.id });
  else await db.insert('rh_feriados', { empresa_id: req.empresaId, data, nome: n.nome, tipo: n.tipo, anual: 0, folga, usuario_id: req.user.id });
  res.json({ ok: true });
});

module.exports = r;
