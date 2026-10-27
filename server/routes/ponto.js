// Ponto web: o colaborador marca pelo navegador (com localização) e o RH acompanha espelho, ajustes e banco de horas.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const P = require('../ponto');
const { enviarXlsx } = require('../lista');

const r = express.Router();
const { ErroNegocio, r2 } = S;

/** Mês pedido (AAAA-MM) ou o atual; devolve o intervalo de datas. */
function periodo(q) {
  const mes = /^\d{4}-\d{2}$/.test(String(q.mes || '')) ? q.mes : S.hoje().slice(0, 7);
  const [y, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { mes, de: `${mes}-01`, ate: fim };
}

async function colaborador(id) {
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', Number(id));
  if (!c) throw new ErroNegocio('Colaborador não encontrado', 404);
  return c;
}
async function meu(req) {
  if (!req.user.colaborador_id) throw new ErroNegocio('Seu usuário não está ligado a um colaborador. Peça ao RH para fazer o vínculo.', 404);
  return colaborador(req.user.colaborador_id);
}
const resumoColab = (c) => ({
  id: c.id, nome: c.nome, cargo: c.cargo, departamento: c.departamento || c.setor, escala: c.escala, carga_horaria: c.carga_horaria, bate_ponto: c.bate_ponto,
  horario: P.lerHorario(c), ponto_externo: c.ponto_externo ? 1 : 0,
});

// ---------- O próprio colaborador ----------
r.get('/meu', async (req, res) => {
  if (!req.user.colaborador_id) return res.json({ vinculado: false });
  const c = await meu(req);
  const { mes, de, ate } = periodo(req.query);
  const hoje = S.hoje();
  const marcHoje = await db.all(`SELECT p.id, p.hora, p.origem, p.endereco, p.latitude, p.longitude, p.precisao, p.fora_cerca, p.distancia, l.nome AS local,
      CASE WHEN p.foto IS NULL THEN 0 ELSE 1 END AS tem_foto
    FROM rh_ponto p LEFT JOIN rh_ponto_locais l ON l.id = p.local_id WHERE p.colaborador_id = ? AND p.data = ? AND p.anulada = 0 ORDER BY p.hora, p.id`, c.id, hoje);
  marcHoje.forEach((m, i) => { m.tipo = P.rotulo(i); });
  const rg = await P.regras(c.empresa_id || req.empresaId);
  const locais = await db.all('SELECT nome, raio FROM rh_ponto_locais WHERE empresa_id IN (?) AND ativo = 1 ORDER BY nome', c.empresa_id || req.empresaId);
  res.json({
    vinculado: true, colaborador: resumoColab(c), mes, hoje, agora: S.agora(),
    regras: { exigir_foto: rg.exigir_foto, bloquear_fora_cerca: rg.bloquear_fora_cerca && !c.ponto_externo }, locais,
    lembrete: await P.lembreteDe(c), push_chave: await require('../push').chavePublica(),
    feriados: [...(await require('../feriados').folgas(c.empresa_id || req.empresaId, hoje, S.addDias(hoje, 120)))].slice(0, 3).map(([data, nome]) => ({ data, nome })),
    marcacoes_hoje: marcHoje, proxima: P.rotulo(marcHoje.length),
    espelho: await P.apurar(c, de, ate), banco: await P.bancoDeHoras(c),
  });
});

r.post('/bater', async (req, res) => {
  const c = await meu(req);
  const m = await P.bater(c, req.body || {}, { empresaId: req.empresaId, usuarioId: req.user.id, ip: A.ipDe(req), dispositivo: req.headers['user-agent'] });
  res.status(201).json(m);
});

/** Lembrete de marcação esquecida para a tela do colaborador. */
r.get('/lembrete', async (req, res) => {
  if (!req.user.colaborador_id) return res.json({ lembrete: null });
  res.json({ lembrete: await P.lembreteDe(await colaborador(req.user.colaborador_id)) });
});

// ---------- Notificações no aparelho (Web Push) ----------
r.get('/push/chave', async (req, res) => res.json({ chave: await require('../push').chavePublica() }));
r.post('/push', async (req, res) => {
  await require('../push').inscrever(req.user.id, req.body?.inscricao, req.headers['user-agent']);
  res.status(201).json({ ok: true });
});
r.post('/push/remover', async (req, res) => {
  await require('../push').remover(req.user.id, req.body?.endpoint);
  res.json({ ok: true });
});

/** Foto da marcação: só o RH e o próprio colaborador. */
r.get('/:id/foto', async (req, res) => {
  const m = await db.get('SELECT colaborador_id, foto, foto_mime FROM rh_ponto WHERE id = ?', Number(req.params.id));
  if (!m?.foto) throw new ErroNegocio('Foto não encontrada.', 404);
  if (!A.can(req.user, 'rh') && m.colaborador_id !== req.user.colaborador_id) throw new ErroNegocio('Sem permissão.', 403);
  res.setHeader('Content-Type', m.foto_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(m.foto);
});

// ---------- RH ----------
r.get('/', A.exige('rh'), async (req, res) => {
  const { mes, de, ate } = periodo(req.query);
  const hoje = S.hoje();
  const colabs = await db.all(`SELECT * FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND COALESCE(c.bate_ponto, 1) = 1
      AND (c.data_admissao IS NULL OR c.data_admissao <= ?) AND (c.data_desligamento IS NULL OR c.data_desligamento >= ?) ORDER BY c.nome`,
  req.empresaId, req.empresaId, ate, de);
  const marcHoje = await db.all(`SELECT colaborador_id, COUNT(*) AS n, MAX(hora) AS ultima FROM rh_ponto WHERE data = ? AND anulada = 0 GROUP BY colaborador_id`, hoje);
  const porColab = Object.fromEntries(marcHoje.map((x) => [x.colaborador_id, x]));
  const linhas = [];
  for (const c of colabs) {
    const { totais } = await P.apurar(c, de, ate);
    const banco = await P.bancoDeHoras(c);
    const h = porColab[c.id];
    linhas.push({
      ...resumoColab(c), ...totais, banco: banco.saldo,
      hoje_marcacoes: Number(h?.n || 0), hoje_ultima: h?.ultima || null,
      hoje_situacao: !h ? 'sem' : Number(h.n) % 2 ? 'trabalhando' : 'fora',
    });
  }
  const t = (k) => linhas.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  res.json({
    mes, hoje, linhas,
    totais: {
      colaboradores: linhas.length, trabalhando: linhas.filter((x) => x.hoje_situacao === 'trabalhando').length,
      sem_marcacao_hoje: linhas.filter((x) => x.hoje_situacao === 'sem').length,
      trabalhado: t('trabalhado'), saldo: t('saldo'), incompletos: t('incompletos'), sem_localizacao: t('sem_localizacao'),
      banco_positivo: r2(linhas.filter((x) => x.banco > 0).reduce((a, x) => a + x.banco, 0)),
      banco_negativo: r2(linhas.filter((x) => x.banco < 0).reduce((a, x) => a + x.banco, 0)),
    },
  });
});

// Regras da empresa e locais (cercas).
r.get('/config', A.exige('rh'), async (req, res) => {
  res.json({
    regras: await P.regras(req.empresaId),
    locais: await db.all('SELECT * FROM rh_ponto_locais WHERE empresa_id = ? AND ativo = 1 ORDER BY nome', req.empresaId),
  });
});
r.put('/regras', A.exige('rh.gerir'), async (req, res) => res.json(await P.salvarRegras(req.empresaId, req.body || {}, req.user.id)));

function dadosLocal(b) {
  const nome = String(b.nome || '').trim();
  const lat = Number(b.latitude);
  const lng = Number(b.longitude);
  const raio = Math.round(Number(b.raio) || 150);
  if (!nome) throw new ErroNegocio('Dê um nome ao local.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) throw new ErroNegocio('Informe a latitude e a longitude do local.');
  if (raio < 30 || raio > 5000) throw new ErroNegocio('O raio precisa ficar entre 30 m e 5 km.');
  return { nome, latitude: lat, longitude: lng, raio };
}
r.post('/locais', A.exige('rh.gerir'), async (req, res) => {
  res.status(201).json({ id: await db.insert('rh_ponto_locais', { ...dadosLocal(req.body || {}), empresa_id: req.empresaId }) });
});
r.put('/locais/:id', A.exige('rh.gerir'), async (req, res) => {
  const l = await db.get('SELECT id FROM rh_ponto_locais WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!l) throw new ErroNegocio('Local não encontrado.', 404);
  await db.update('rh_ponto_locais', l.id, dadosLocal(req.body || {}));
  res.json({ ok: true });
});
// As marcações guardam o local; por isso ele é desativado, não apagado.
r.delete('/locais/:id', A.exige('rh.gerir'), async (req, res) => {
  const l = await db.get('SELECT id FROM rh_ponto_locais WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresaId);
  if (!l) throw new ErroNegocio('Local não encontrado.', 404);
  await db.update('rh_ponto_locais', l.id, { ativo: 0 });
  res.json({ ok: true });
});

/** Horário de trabalho e trabalho externo; pode copiar o mesmo horário para outros colaboradores. */
r.put('/colaborador/:id/horario', A.exige('rh.gerir'), async (req, res) => {
  const c = await colaborador(req.params.id);
  const b = req.body || {};
  const horario = P.validarHorario(b.horario);
  const valor = horario ? JSON.stringify(horario) : null;
  const ids = [c.id, ...(Array.isArray(b.aplicar_a) ? b.aplicar_a.map(Number).filter((x) => x && x !== c.id) : [])];
  await db.tx(async () => {
    for (const id of ids) await db.update('colaboradores', id, { horario: valor });
    await db.update('colaboradores', c.id, { ponto_externo: b.ponto_externo ? 1 : 0 });
  });
  res.json({ ok: true, atualizados: ids.length });
});

r.get('/colaborador/:id', A.exige('rh'), async (req, res) => {
  const c = await colaborador(req.params.id);
  const { mes, de, ate } = periodo(req.query);
  res.json({ colaborador: resumoColab(c), mes, espelho: await P.apurar(c, de, ate, { comAnuladas: true }), banco: await P.bancoDeHoras(c) });
});

r.post('/ajuste', A.exige('rh.gerir'), async (req, res) => {
  const c = await colaborador(req.body?.colaborador_id);
  const id = await P.ajustar(c, req.body || {}, { empresaId: req.empresaId, usuarioId: req.user.id });
  res.status(201).json({ id });
});

r.post('/:id/anular', A.exige('rh.gerir'), async (req, res) => {
  await P.anular(req.params.id, req.body?.motivo, { empresaId: req.empresaId, usuarioId: req.user.id });
  res.json({ ok: true });
});

const hm = (min) => (min == null ? '' : `${min < 0 ? '-' : ''}${Math.floor(Math.abs(min) / 60)}:${String(Math.round(Math.abs(min) % 60)).padStart(2, '0')}`);

/** Espelho do mês de todos (ou de um) colaborador(es), para conferência e arquivo. */
r.get('/exportar', A.exige('rh'), async (req, res) => {
  const { mes, de, ate } = periodo(req.query);
  const colabs = req.query.colaborador_id ? [await colaborador(req.query.colaborador_id)]
    : await db.all(`SELECT * FROM colaboradores c WHERE COALESCE(c.empresa_id, ?) = ? AND COALESCE(c.bate_ponto, 1) = 1 AND c.ativo = 1 ORDER BY c.nome`, req.empresaId, req.empresaId);
  const linhas = [];
  for (const c of colabs) {
    for (const d of (await P.apurar(c, de, ate)).dias) {
      linhas.push({
        colaborador: c.nome, data: d.data, situacao: d.situacao_label,
        marcacoes: d.marcacoes.map((m) => `${m.hora.slice(0, 5)}${m.origem === 'ajuste' ? '*' : ''}`).join(' · '),
        trabalhado: hm(d.trabalhado), previsto: hm(d.previsto), saldo: hm(d.saldo),
        locais: [...new Set(d.marcacoes.map((m) => m.endereco || (m.latitude != null ? `${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}` : 'sem localização')))].join(' | '),
      });
    }
  }
  await enviarXlsx(res, {
    titulo: `Espelho de ponto ${mes}`,
    colunas: [{ k: 'colaborador', l: 'Colaborador' }, { k: 'data', l: 'Data', t: 'date' }, { k: 'situacao', l: 'Situação' }, { k: 'marcacoes', l: 'Marcações (* = ajuste do RH)' },
      { k: 'trabalhado', l: 'Trabalhado' }, { k: 'previsto', l: 'Previsto' }, { k: 'saldo', l: 'Saldo do dia' }, { k: 'locais', l: 'Local' }],
    linhas,
  });
});

module.exports = r;
