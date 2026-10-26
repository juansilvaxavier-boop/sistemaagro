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
const resumoColab = (c) => ({ id: c.id, nome: c.nome, cargo: c.cargo, departamento: c.departamento || c.setor, escala: c.escala, carga_horaria: c.carga_horaria, bate_ponto: c.bate_ponto });

// ---------- O próprio colaborador ----------
r.get('/meu', async (req, res) => {
  if (!req.user.colaborador_id) return res.json({ vinculado: false });
  const c = await meu(req);
  const { mes, de, ate } = periodo(req.query);
  const hoje = S.hoje();
  const marcHoje = await db.all('SELECT id, hora, origem, endereco, latitude, longitude, precisao FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0 ORDER BY hora, id', c.id, hoje);
  marcHoje.forEach((m, i) => { m.tipo = P.rotulo(i); });
  res.json({
    vinculado: true, colaborador: resumoColab(c), mes, hoje, agora: S.agora(),
    marcacoes_hoje: marcHoje, proxima: P.rotulo(marcHoje.length),
    espelho: await P.apurar(c, de, ate), banco: await P.bancoDeHoras(c),
  });
});

r.post('/bater', async (req, res) => {
  const c = await meu(req);
  const m = await P.bater(c, req.body || {}, { empresaId: req.empresaId, usuarioId: req.user.id, ip: A.ipDe(req), dispositivo: req.headers['user-agent'] });
  res.status(201).json(m);
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
