// Ponto web: marcações com localização, apuração diária (trabalhado x previsto) e banco de horas.
// A hora vale a do servidor (fuso de São Paulo). Tolerância da CLT (art. 58 §1º): até 10 minutos no dia não contam.
const db = require('./db');
const S = require('./services');

const { ErroNegocio, r2 } = S;

const TOLERANCIA_DIA = 10;
const INTERVALO_MINIMO_SEG = 60;
const ROTULOS = ['Entrada', 'Saída para intervalo', 'Volta do intervalo', 'Saída'];
const rotulo = (i) => ROTULOS[i] || (i % 2 === 0 ? 'Entrada (extra)' : 'Saída (extra)');
const SITUACOES = {
  normal: 'Normal', incompleto: 'Marcação incompleta', sem_marcacao: 'Sem marcação', folga: 'Folga', ferias: 'Férias',
  abonado: 'Abonado', falta: 'Falta lançada', hoje: 'Em andamento', fora: 'Fora do contrato',
};

const minutos = (hora) => { const [h, m, s] = String(hora).split(':').map(Number); return h * 60 + (m || 0) + (s || 0) / 60; };
const diaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();

/** Minutos previstos no dia pela carga semanal e escala; null = escala sem dias fixos (só conta o dia trabalhado). */
function previstoDia(c, data) {
  const carga = (Number(c.carga_horaria) || 44) * 60;
  const dow = diaSemana(data);
  if (c.escala === '6x1') return dow === 0 ? 0 : carga / 6;
  if (['12x36', '4x3', 'flexivel'].includes(c.escala)) return null;
  return dow === 0 || dow === 6 ? 0 : carga / 5;
}
function previstoDiaTrabalhado(c) {
  const carga = (Number(c.carga_horaria) || 44) * 60;
  if (c.escala === '12x36') return 12 * 60;
  if (c.escala === '4x3') return carga / 4;
  return carga / 5;
}

/** Soma os pares entrada/saída; uma entrada sem saída hoje conta até agora. */
function trabalhadoDia(batidas, agoraMin) {
  let total = 0;
  for (let i = 0; i < batidas.length; i += 2) {
    const ini = minutos(batidas[i].hora);
    const fim = batidas[i + 1] ? minutos(batidas[i + 1].hora) : agoraMin;
    if (fim != null && fim > ini) total += fim - ini;
  }
  return Math.round(total);
}

const cobre = (lista, data) => lista.some((x) => x.inicio <= data && x.fim >= data);

/**
 * Espelho do período: um registro por dia com marcações, trabalhado, previsto e saldo (em minutos).
 * Dias anteriores à primeira marcação do colaborador não geram débito (o controle começa quando ele passa a usar o ponto).
 */
async function apurar(c, de, ate, { comAnuladas = false } = {}) {
  const hoje = S.hoje();
  const agoraMin = minutos(S.agora().slice(11));
  const marc = await db.all(`SELECT id, data, hora, origem, latitude, longitude, precisao, endereco, justificativa, anulada, anulada_motivo, ip, dispositivo
    FROM rh_ponto WHERE colaborador_id = ? AND data BETWEEN ? AND ? ORDER BY data, hora, id`, c.id, de, ate);
  const ferias = await db.all(`SELECT inicio, fim FROM rh_ferias WHERE colaborador_id = ? AND status = 'aprovada' AND inicio <= ? AND fim >= ?`, c.id, ate, de);
  const ocs = (await db.all(`SELECT data, tipo, COALESCE(dias, 1) AS dias FROM rh_ocorrencias
      WHERE colaborador_id = ? AND tipo IN ('atestado','falta_justificada','falta') AND data <= ?`, c.id, ate))
    .map((o) => ({ tipo: o.tipo, inicio: o.data, fim: S.addDias(o.data, Math.max(1, Math.ceil(Number(o.dias) || 1)) - 1) }));
  const primeira = (await db.get('SELECT MIN(data) AS d FROM rh_ponto WHERE colaborador_id = ? AND anulada = 0', c.id))?.d;

  const porDia = {};
  for (const m of marc) (porDia[m.data] ||= []).push(m);
  const dias = [];
  const tot = { trabalhado: 0, previsto: 0, saldo: 0, incompletos: 0, sem_marcacao: 0, sem_localizacao: 0, marcacoes: 0 };
  const fimLaco = ate < hoje ? ate : hoje;
  for (let d = de; d <= fimLaco; d = S.addDias(d, 1)) {
    const todas = porDia[d] || [];
    const validas = todas.filter((m) => !m.anulada);
    const foraContrato = (c.data_admissao && d < c.data_admissao) || (c.data_desligamento && d > c.data_desligamento);
    if (!validas.length && (foraContrato || !primeira || d < primeira)) continue;
    const ehHoje = d === hoje;
    validas.forEach((m, i) => { m.tipo = rotulo(i); });
    const trabalhado = trabalhadoDia(validas, ehHoje ? agoraMin : null);
    let previsto = previstoDia(c, d);
    let situacao = 'normal';
    if (cobre(ferias, d)) { previsto = 0; situacao = 'ferias'; }
    else if (ocs.some((o) => o.tipo !== 'falta' && o.inicio <= d && o.fim >= d)) {
      // O abono cobre a ausência: não gera débito, mas o que passar da jornada continua sendo crédito.
      const base = previsto ?? previstoDiaTrabalhado(c);
      previsto = Math.min(trabalhado, base);
      situacao = 'abonado';
    }
    else if (ocs.some((o) => o.tipo === 'falta' && o.inicio <= d && o.fim >= d)) { previsto = 0; situacao = 'falta'; }
    else if (foraContrato) { previsto = 0; situacao = 'fora'; }
    else if (previsto == null) previsto = validas.length ? previstoDiaTrabalhado(c) : 0;
    if (situacao === 'normal') {
      if (ehHoje) situacao = 'hoje';
      else if (validas.length % 2) situacao = 'incompleto';
      else if (!validas.length) situacao = previsto ? 'sem_marcacao' : 'folga';
    }
    // Hoje ainda não fechou e dia incompleto espera o ajuste do RH: nenhum dos dois entra no saldo.
    let saldo = situacao === 'hoje' || situacao === 'incompleto' ? null : Math.round(trabalhado - previsto);
    if (saldo != null && Math.abs(saldo) <= TOLERANCIA_DIA) saldo = 0;
    dias.push({
      data: d, dia_semana: diaSemana(d), situacao, situacao_label: SITUACOES[situacao], trabalhado, previsto: Math.round(previsto), saldo,
      marcacoes: (comAnuladas ? todas : validas).map((m) => ({ ...m, tipo: m.anulada ? 'Anulada' : m.tipo })),
    });
    tot.trabalhado += trabalhado;
    tot.previsto += Math.round(previsto);
    tot.saldo += saldo || 0;
    if (situacao === 'incompleto') tot.incompletos++;
    if (situacao === 'sem_marcacao') tot.sem_marcacao++;
    tot.marcacoes += validas.length;
    tot.sem_localizacao += validas.filter((m) => m.origem === 'web' && m.latitude == null).length;
  }
  return { dias, totais: tot };
}

/** Saldo do ponto (minutos) desde a primeira marcação até ontem. */
async function saldoPonto(c) {
  const primeira = (await db.get('SELECT MIN(data) AS d FROM rh_ponto WHERE colaborador_id = ? AND anulada = 0', c.id))?.d;
  if (!primeira) return 0;
  const ontem = S.addDias(S.hoje(), -1);
  if (primeira > ontem) return 0;
  return (await apurar(c, primeira, ontem)).totais.saldo;
}

/** Lançamentos manuais do RH (crédito/débito), em horas. */
async function saldoManual(colaboradorId) {
  return r2((await db.get(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'banco_credito' THEN horas WHEN tipo = 'banco_debito' THEN -horas ELSE 0 END), 0) AS s FROM rh_ocorrencias WHERE colaborador_id = ?`,
    colaboradorId,
  )).s);
}

/** Banco de horas em horas: saldo apurado do ponto + créditos e débitos lançados pelo RH. */
async function bancoDeHoras(c) {
  const manual = await saldoManual(c.id);
  const ponto = r2((await saldoPonto(c)) / 60);
  return { ponto, manual, saldo: r2(ponto + manual) };
}

const cacheEndereco = new Map();
/** Endereço aproximado pela coordenada (OpenStreetMap). Falha ou demora não impedem a marcação. */
async function enderecoDe(lat, lng) {
  if (process.env.PONTO_ENDERECO === '0' || process.env.NODE_TEST_CONTEXT) return null;
  const chave = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cacheEndereco.has(chave)) return cacheEndereco.get(chave);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'AceleraFertilizantes-ERP/1.0 (ponto web)' }, signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address || {};
    const cidade = a.city || a.town || a.village || a.municipality || a.county;
    const uf = (a['ISO3166-2-lvl4'] || '').replace(/^BR-/, '') || a.state;
    const rua = [a.road, a.house_number].filter(Boolean).join(', ');
    const texto = [[rua, a.suburb || a.neighbourhood].filter(Boolean).join(' - '), [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(', ')
      || String(j.display_name || '').slice(0, 200) || null;
    if (cacheEndereco.size > 2000) cacheEndereco.clear();
    cacheEndereco.set(chave, texto);
    return texto;
  } catch {
    return null;
  }
}

function coordenadas(b) {
  const lat = b.latitude == null || b.latitude === '' ? null : Number(b.latitude);
  const lng = b.longitude == null || b.longitude === '' ? null : Number(b.longitude);
  if (lat == null || lng == null) return { lat: null, lng: null, precisao: null };
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ErroNegocio('Localização inválida.');
  const precisao = Number(b.precisao);
  return { lat, lng, precisao: Number.isFinite(precisao) && precisao >= 0 ? Math.round(precisao) : null };
}

/** Registra a marcação do próprio colaborador. */
async function bater(c, b, { empresaId, usuarioId, ip, dispositivo }) {
  if (c.bate_ponto === 0) throw new ErroNegocio('Seu cadastro está como "não registra ponto". Fale com o RH.');
  if (c.data_desligamento && c.data_desligamento < S.hoje()) throw new ErroNegocio('Colaborador desligado.');
  const agora = S.agora();
  const data = agora.slice(0, 10);
  const hora = agora.slice(11, 19);
  const ultima = await db.get('SELECT hora FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0 ORDER BY hora DESC LIMIT 1', c.id, data);
  if (ultima && minutos(hora) - minutos(ultima.hora) < INTERVALO_MINIMO_SEG / 60) throw new ErroNegocio('Você acabou de registrar uma marcação. Aguarde um minuto para marcar de novo.');
  const { lat, lng, precisao } = coordenadas(b);
  const endereco = lat != null ? await enderecoDe(lat, lng) : null;
  const id = await db.insert('rh_ponto', {
    colaborador_id: c.id, empresa_id: c.empresa_id || empresaId, data, hora, origem: 'web', latitude: lat, longitude: lng, precisao, endereco,
    ip: String(ip || '').slice(0, 60) || null, dispositivo: String(dispositivo || '').slice(0, 200) || null, usuario_id: usuarioId,
  }, null, { auditoria: false });
  const n = (await db.get('SELECT COUNT(*) AS n FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0', c.id, data)).n;
  return { id, data, hora, tipo: rotulo(Number(n) - 1), endereco, sem_localizacao: lat == null };
}

/** Marcação lançada pelo RH (esquecimento, falha do aparelho...), sempre com justificativa. */
async function ajustar(c, b, { empresaId, usuarioId }) {
  const data = String(b.data || '');
  const hora = String(b.hora || '').length === 5 ? `${b.hora}:00` : String(b.hora || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(hora)) throw new ErroNegocio('Informe a data e a hora da marcação.');
  if (data > S.hoje()) throw new ErroNegocio('Não dá para lançar marcação no futuro.');
  const justificativa = String(b.justificativa || '').trim();
  if (justificativa.length < 5) throw new ErroNegocio('Escreva a justificativa do ajuste.');
  await exigirAberta(c.empresa_id || empresaId, data);
  return db.insert('rh_ponto', { colaborador_id: c.id, empresa_id: c.empresa_id || empresaId, data, hora, origem: 'ajuste', justificativa, usuario_id: usuarioId });
}

async function anular(id, motivo, { empresaId, usuarioId }) {
  const m = await db.get('SELECT p.*, c.empresa_id AS emp_colab FROM rh_ponto p JOIN colaboradores c ON c.id = p.colaborador_id WHERE p.id = ?', Number(id));
  if (!m) throw new ErroNegocio('Marcação não encontrada.', 404);
  if (m.anulada) throw new ErroNegocio('Essa marcação já foi anulada.');
  if (String(motivo || '').trim().length < 5) throw new ErroNegocio('Escreva o motivo.');
  await exigirAberta(m.emp_colab || empresaId, m.data);
  await db.update('rh_ponto', m.id, { anulada: 1, anulada_motivo: String(motivo).trim(), anulada_por: usuarioId });
  return m;
}

async function exigirAberta(empresaId, data) {
  if (await require('./rh').competenciaFechada(empresaId, data.slice(0, 7))) throw new ErroNegocio('A competência dessa data já foi fechada. Reabra a folha para ajustar o ponto.');
}

module.exports = { ROTULOS, SITUACOES, TOLERANCIA_DIA, rotulo, previstoDia, apurar, saldoPonto, bancoDeHoras, bater, ajustar, anular, minutos };
