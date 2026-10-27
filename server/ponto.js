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
  abonado: 'Abonado', falta: 'Falta lançada', hoje: 'Em andamento', fora: 'Fora do contrato', feriado: 'Feriado',
};

const minutos = (hora) => { const [h, m, s] = String(hora).split(':').map(Number); return h * 60 + (m || 0) + (s || 0) / 60; };
const diaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();

// ---------- Regras da empresa ----------
const REGRAS_PADRAO = { exigir_foto: false, bloquear_fora_cerca: false, avisos: true, aviso_entrada: 15, aviso_saida: 30, tolerancia_atraso: 5 };
async function regras(empresaId) {
  const r = await db.get('SELECT valor FROM configuracoes WHERE chave = ?', `ponto.regras.${Number(empresaId) || 0}`);
  try { return { ...REGRAS_PADRAO, ...(r ? JSON.parse(r.valor) : {}) }; } catch { return { ...REGRAS_PADRAO }; }
}
async function salvarRegras(empresaId, b, usuarioId) {
  const num = (v, min, max, padrao) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
  const r = {
    exigir_foto: !!b.exigir_foto, bloquear_fora_cerca: !!b.bloquear_fora_cerca, avisos: b.avisos === undefined ? true : !!b.avisos,
    aviso_entrada: num(b.aviso_entrada, 5, 240, 15), aviso_saida: num(b.aviso_saida, 5, 240, 30), tolerancia_atraso: num(b.tolerancia_atraso, 0, 60, 5),
  };
  await db.run(`INSERT INTO configuracoes (chave, valor, updated_by) VALUES (?, ?, ?)
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_by = EXCLUDED.updated_by, updated_at = sq_datetime('now', 'localtime')`,
  `ponto.regras.${Number(empresaId)}`, JSON.stringify(r), usuarioId);
  return r;
}

// ---------- Horário de trabalho do colaborador ----------
// {"1": {"e":"08:00","si":"12:00","vi":"13:00","s":"18:00"}, ...}: 0 = domingo; dia ausente = folga.
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
function lerHorario(c) {
  if (!c?.horario) return null;
  try {
    const h = typeof c.horario === 'string' ? JSON.parse(c.horario) : c.horario;
    return h && typeof h === 'object' && Object.keys(h).length ? h : null;
  } catch { return null; }
}
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Confere e normaliza o horário; null quando nenhum dia foi preenchido (volta à regra da carga horária). */
function validarHorario(h) {
  if (h == null || h === '') return null;
  if (typeof h !== 'object') throw new ErroNegocio('Horário inválido.');
  const out = {};
  for (let d = 0; d < 7; d++) {
    const x = h[d] || h[String(d)];
    if (!x || (!x.e && !x.s)) continue;
    const nome = NOMES_DIA[d];
    if (!HORA.test(x.e || '') || !HORA.test(x.s || '')) throw new ErroNegocio(`Informe entrada e saída de ${nome} (HH:MM).`);
    const dia = { e: x.e, s: x.s };
    if (x.si || x.vi) {
      if (!HORA.test(x.si || '') || !HORA.test(x.vi || '')) throw new ErroNegocio(`Intervalo de ${nome}: informe a saída e a volta (HH:MM).`);
      dia.si = x.si;
      dia.vi = x.vi;
    }
    const seq = [dia.e, dia.si, dia.vi, dia.s].filter(Boolean).map(minutos);
    if (seq.some((v, i) => i && v <= seq[i - 1])) throw new ErroNegocio(`Horário de ${nome} fora de ordem (entrada, intervalo, volta, saída).`);
    out[d] = dia;
  }
  return Object.keys(out).length ? out : null;
}
const minutosDoHorario = (d) => (d ? minutos(d.s) - minutos(d.e) - (d.si && d.vi ? minutos(d.vi) - minutos(d.si) : 0) : 0);

/** Minutos previstos no dia: pelo horário do colaborador; sem horário, pela carga semanal e escala (null = sem dias fixos). */
function previstoDia(c, data) {
  const dow = diaSemana(data);
  const h = lerHorario(c);
  if (h) return minutosDoHorario(h[dow]);
  const carga = (Number(c.carga_horaria) || 44) * 60;
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
async function apurar(c, de, ate, { comAnuladas = false, regras: rg } = {}) {
  const hoje = S.hoje();
  const agoraMin = minutos(S.agora().slice(11));
  const tolAtraso = (rg || await regras(c.empresa_id)).tolerancia_atraso;
  const horario = lerHorario(c);
  const marc = await db.all(`SELECT p.id, p.data, p.hora, p.origem, p.latitude, p.longitude, p.precisao, p.endereco, p.justificativa, p.anulada, p.anulada_motivo,
      p.ip, p.dispositivo, p.distancia, p.fora_cerca, l.nome AS local, CASE WHEN p.foto IS NULL THEN 0 ELSE 1 END AS tem_foto
    FROM rh_ponto p LEFT JOIN rh_ponto_locais l ON l.id = p.local_id WHERE p.colaborador_id = ? AND p.data BETWEEN ? AND ? ORDER BY p.data, p.hora, p.id`, c.id, de, ate);
  const ferias = await db.all(`SELECT inicio, fim FROM rh_ferias WHERE colaborador_id = ? AND status = 'aprovada' AND inicio <= ? AND fim >= ?`, c.id, ate, de);
  const ocs = (await db.all(`SELECT data, tipo, COALESCE(dias, 1) AS dias FROM rh_ocorrencias
      WHERE colaborador_id = ? AND tipo IN ('atestado','falta_justificada','falta') AND data <= ?`, c.id, ate))
    .map((o) => ({ tipo: o.tipo, inicio: o.data, fim: S.addDias(o.data, Math.max(1, Math.ceil(Number(o.dias) || 1)) - 1) }));
  const primeira = (await db.get('SELECT MIN(data) AS d FROM rh_ponto WHERE colaborador_id = ? AND anulada = 0', c.id))?.d;
  // Feriado de folga da empresa do colaborador. Na 12x36 sem horário a escala segue (o feriado é pago à parte, não muda o previsto).
  const feriados = c.escala === '12x36' && !horario ? new Map() : await require('./feriados').folgas(c.empresa_id, de, ate);

  const porDia = {};
  for (const m of marc) (porDia[m.data] ||= []).push(m);
  const dias = [];
  const tot = { trabalhado: 0, previsto: 0, saldo: 0, incompletos: 0, sem_marcacao: 0, sem_localizacao: 0, fora_cerca: 0, marcacoes: 0, atrasos: 0, atraso_min: 0 };
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
    else if (feriados.has(d)) { previsto = 0; situacao = 'feriado'; }
    else if (ocs.some((o) => o.tipo !== 'falta' && o.inicio <= d && o.fim >= d)) {
      // O abono cobre a ausência: não gera débito, mas o que passar da jornada continua sendo crédito.
      const base = previsto ?? previstoDiaTrabalhado(c);
      previsto = Math.min(trabalhado, base);
      situacao = 'abonado';
    }
    else if (ocs.some((o) => o.tipo === 'falta' && o.inicio <= d && o.fim >= d)) { previsto = 0; situacao = 'falta'; }
    else if (foraContrato) { previsto = 0; situacao = 'fora'; }
    else if (previsto == null) previsto = validas.length ? previstoDiaTrabalhado(c) : 0;
    // Trabalhou no feriado: as horas viram crédito, mas marcação ímpar ainda precisa de ajuste.
    if (situacao === 'feriado' && validas.length % 2) situacao = ehHoje ? 'hoje' : 'incompleto';
    if (situacao === 'normal') {
      if (ehHoje) situacao = 'hoje';
      else if (validas.length % 2) situacao = 'incompleto';
      else if (!validas.length) situacao = previsto ? 'sem_marcacao' : 'folga';
    }
    // Hoje ainda não fechou e dia incompleto espera o ajuste do RH: nenhum dos dois entra no saldo.
    let saldo = situacao === 'hoje' || situacao === 'incompleto' ? null : Math.round(trabalhado - previsto);
    if (saldo != null && Math.abs(saldo) <= TOLERANCIA_DIA) saldo = 0;
    // Atraso e saída antecipada contra o horário do dia (além da tolerância).
    const hd = horario?.[diaSemana(d)];
    let atraso = 0;
    let antecipada = 0;
    if (hd && validas.length && ['normal', 'hoje', 'incompleto'].includes(situacao)) {
      const a = Math.round(minutos(validas[0].hora) - minutos(hd.e));
      if (a > tolAtraso) atraso = a;
      if (situacao === 'normal' && validas.length % 2 === 0) {
        const b = Math.round(minutos(hd.s) - minutos(validas.at(-1).hora));
        if (b > tolAtraso) antecipada = b;
      }
    }
    if (atraso || antecipada) { tot.atrasos++; tot.atraso_min += atraso + antecipada; }
    dias.push({
      data: d, dia_semana: diaSemana(d), situacao, situacao_label: situacao === 'feriado' ? `Feriado: ${feriados.get(d)}` : SITUACOES[situacao], trabalhado, previsto: Math.round(previsto), saldo,
      horario: hd || null, atraso, saida_antecipada: antecipada,
      marcacoes: (comAnuladas ? todas : validas).map((m) => ({ ...m, tipo: m.anulada ? 'Anulada' : m.tipo })),
    });
    tot.trabalhado += trabalhado;
    tot.previsto += Math.round(previsto);
    tot.saldo += saldo || 0;
    if (situacao === 'incompleto') tot.incompletos++;
    if (situacao === 'sem_marcacao') tot.sem_marcacao++;
    tot.marcacoes += validas.length;
    tot.sem_localizacao += validas.filter((m) => m.origem === 'web' && m.latitude == null).length;
    tot.fora_cerca += validas.filter((m) => m.fora_cerca).length;
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

/** Distância em metros entre duas coordenadas (haversine). */
function distancia(lat1, lng1, lat2, lng2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const textoDistancia = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);

/** Local da empresa mais próximo e se a marcação ficou fora de todas as cercas. A precisão do GPS (até 100 m) conta a favor. */
async function conferirCerca(c, empresaId, lat, lng, precisao) {
  const locais = await db.all('SELECT id, nome, latitude, longitude, raio FROM rh_ponto_locais WHERE empresa_id IN (?) AND ativo = 1', empresaId);
  if (!locais.length) return { local: null, distancia: null, fora: 0 };
  let perto = null;
  if (lat != null) {
    for (const l of locais) {
      const d = distancia(lat, lng, l.latitude, l.longitude);
      const folga = d - l.raio;
      if (!perto || folga < perto.folga) perto = { ...l, d, folga };
    }
  }
  const dentro = perto && perto.d <= perto.raio + Math.min(precisao || 0, 100);
  return { local: perto, distancia: perto ? Math.round(perto.d) : null, fora: c.ponto_externo || dentro ? 0 : 1 };
}

const MAX_FOTO = 400 * 1024;
function lerFoto(v) {
  if (!v) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v));
  if (!m) throw new ErroNegocio('Foto inválida.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_FOTO) throw new ErroNegocio('Foto grande demais.');
  return { buf, mime: m[1] };
}

/** Registra a marcação do próprio colaborador. */
async function bater(c, b, { empresaId, usuarioId, ip, dispositivo }) {
  if (c.bate_ponto === 0) throw new ErroNegocio('Seu cadastro está como "não registra ponto". Fale com o RH.');
  if (c.data_desligamento && c.data_desligamento < S.hoje()) throw new ErroNegocio('Colaborador desligado.');
  const emp = c.empresa_id || empresaId;
  const rg = await regras(emp);
  const agora = S.agora();
  const data = agora.slice(0, 10);
  const hora = agora.slice(11, 19);
  const ultima = await db.get('SELECT hora FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0 ORDER BY hora DESC LIMIT 1', c.id, data);
  if (ultima && minutos(hora) - minutos(ultima.hora) < INTERVALO_MINIMO_SEG / 60) throw new ErroNegocio('Você acabou de registrar uma marcação. Aguarde um minuto para marcar de novo.');
  const { lat, lng, precisao } = coordenadas(b);
  const cerca = await conferirCerca(c, emp, lat, lng, precisao);
  if (cerca.fora && rg.bloquear_fora_cerca) {
    throw new ErroNegocio(lat == null
      ? 'Permita a localização do aparelho: o ponto só é aceito dentro dos locais da empresa.'
      : `Você está a ${textoDistancia(cerca.distancia)} de ${cerca.local.nome}. O ponto só é aceito até ${cerca.local.raio} m de um local da empresa.`);
  }
  const foto = lerFoto(b.foto);
  if (rg.exigir_foto && !foto) throw new ErroNegocio('Tire a foto para registrar o ponto.');
  const endereco = lat != null ? await enderecoDe(lat, lng) : null;
  const id = await db.insert('rh_ponto', {
    colaborador_id: c.id, empresa_id: emp, data, hora, origem: 'web', latitude: lat, longitude: lng, precisao, endereco,
    local_id: cerca.local?.id || null, distancia: cerca.distancia, fora_cerca: cerca.fora, foto: foto?.buf || null, foto_mime: foto?.mime || null,
    ip: String(ip || '').slice(0, 60) || null, dispositivo: String(dispositivo || '').slice(0, 200) || null, usuario_id: usuarioId,
  }, null, { auditoria: false });
  const n = (await db.get('SELECT COUNT(*) AS n FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0', c.id, data)).n;
  return {
    id, data, hora, tipo: rotulo(Number(n) - 1), endereco, sem_localizacao: lat == null, fora_cerca: !!cerca.fora,
    local: cerca.local?.nome || null, distancia: cerca.distancia,
  };
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

// ---------- Avisos de marcação esquecida ----------
const TEXTOS_AVISO = {
  entrada: (h) => `Você ainda não registrou a entrada de hoje (horário: ${h.e}).`,
  intervalo: (h) => `Você não registrou a saída e a volta do intervalo (${h.si} às ${h.vi}).`,
  saida: (h) => `Sua jornada terminou às ${h.s} e a saída ainda não foi registrada.`,
};

/** Qual marcação está atrasada agora (ou null), pelo horário do dia e pelas marcações feitas. */
function avisoDevido(h, n, agoraMin, rg) {
  if (!h) return null;
  if (n % 2 === 1 && agoraMin >= minutos(h.s) + rg.aviso_saida) return 'saida';
  if (agoraMin >= minutos(h.s)) return null;
  if (n === 0 && agoraMin >= minutos(h.e) + rg.aviso_entrada) return 'entrada';
  if (n === 1 && h.si && h.vi && agoraMin >= minutos(h.vi) + rg.aviso_entrada) return 'intervalo';
  return null;
}

/** Colaboradores ausentes no dia (férias aprovadas, atestado, falta lançada). */
async function ausentesNoDia(data) {
  const ids = new Set((await db.all(`SELECT colaborador_id FROM rh_ferias WHERE status = 'aprovada' AND inicio <= ? AND fim >= ?`, data, data)).map((x) => x.colaborador_id));
  for (const o of await db.all(`SELECT colaborador_id, data, COALESCE(dias, 1) AS dias FROM rh_ocorrencias
      WHERE tipo IN ('atestado','falta_justificada','falta') AND data <= ? AND data >= ?`, data, S.addDias(data, -90))) {
    if (S.addDias(o.data, Math.max(1, Math.ceil(Number(o.dias) || 1)) - 1) >= data) ids.add(o.colaborador_id);
  }
  return ids;
}

/**
 * Confere quem esqueceu de marcar e avisa (notificação no celular/computador e aviso na tela).
 * Cada colaborador recebe no máximo um aviso de cada tipo por dia.
 */
async function verificarAvisos(agora = S.agora()) {
  const data = agora.slice(0, 10);
  const agoraMin = minutos(agora.slice(11));
  const dow = diaSemana(data);
  const colabs = await db.all(`SELECT c.id, c.empresa_id, c.horario,
      (SELECT COUNT(*) FROM rh_ponto p WHERE p.colaborador_id = c.id AND p.data = ? AND p.anulada = 0) AS n
    FROM colaboradores c WHERE c.ativo = 1 AND (c.data_desligamento IS NULL OR c.data_desligamento >= ?) AND COALESCE(c.bate_ponto, 1) = 1
      AND c.horario IS NOT NULL AND c.horario <> ''`, data, data);
  if (!colabs.length) return { enviados: [] };
  const ausentes = await ausentesNoDia(data);
  const cacheRegras = {};
  const cacheFeriado = {};
  const enviados = [];
  for (const c of colabs) {
    if (ausentes.has(c.id)) continue;
    const k = c.empresa_id || 0;
    if (!(k in cacheFeriado)) cacheFeriado[k] = (await require('./feriados').folgas(c.empresa_id, data, data)).has(data);
    if (cacheFeriado[k]) continue;
    const rg = (cacheRegras[c.empresa_id || 0] ||= await regras(c.empresa_id));
    if (!rg.avisos) continue;
    const h = lerHorario(c)?.[dow];
    const tipo = avisoDevido(h, Number(c.n), agoraMin, rg);
    if (!tipo) continue;
    const novo = await db.get(`INSERT INTO rh_ponto_avisos (colaborador_id, data, tipo) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING tipo`, c.id, data, tipo);
    if (!novo) continue;
    const usuarios = (await db.all('SELECT id FROM usuarios WHERE colaborador_id = ? AND ativo = 1', c.id)).map((x) => x.id);
    const texto = TEXTOS_AVISO[tipo](h);
    const n = await require('./push').enviar(usuarios, { titulo: 'Lembrete de ponto', corpo: texto, url: '/#/ponto', tag: `ponto-${data}-${tipo}` }).catch(() => 0);
    if (n) await db.run('UPDATE rh_ponto_avisos SET enviado_push = ? WHERE colaborador_id = ? AND data = ? AND tipo = ?', n, c.id, data, tipo);
    require('./sse').enviar('ponto', { texto }, { usuarios });
    enviados.push({ colaborador_id: c.id, tipo, push: n });
  }
  return { enviados };
}

const agoraSP = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ms));
let ultimaVerificacao = 0;
/**
 * Roda a verificação de avisos no máximo a cada 5 minutos, aproveitando as requisições do sistema
 * (a hospedagem só agenda tarefas uma vez por dia). A trava no banco evita duas instâncias ao mesmo tempo.
 */
async function talvezVerificarAvisos() {
  if (Date.now() - ultimaVerificacao < 5 * 60e3) return null;
  ultimaVerificacao = Date.now();
  const trava = await db.get(`INSERT INTO configuracoes (chave, valor) VALUES ('ponto.avisos_ultima', ?)
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor WHERE configuracoes.valor < ? RETURNING chave`, agoraSP(Date.now()), agoraSP(Date.now() - 270e3));
  return trava ? verificarAvisos() : null;
}

/** Lembrete para mostrar na tela do próprio colaborador agora (independe de já ter sido enviado). */
async function lembreteDe(c) {
  if (!c || c.bate_ponto === 0) return null;
  const agora = S.agora();
  const data = agora.slice(0, 10);
  const h = lerHorario(c)?.[diaSemana(data)];
  if (!h || (await ausentesNoDia(data)).has(c.id) || (await require('./feriados').folgas(c.empresa_id, data, data)).has(data)) return null;
  const rg = await regras(c.empresa_id);
  const n = Number((await db.get('SELECT COUNT(*) AS n FROM rh_ponto WHERE colaborador_id = ? AND data = ? AND anulada = 0', c.id, data)).n);
  const tipo = avisoDevido(h, n, minutos(agora.slice(11)), rg);
  return tipo ? { tipo, texto: TEXTOS_AVISO[tipo](h) } : null;
}

module.exports = {
  ROTULOS, SITUACOES, TOLERANCIA_DIA, REGRAS_PADRAO, NOMES_DIA, rotulo, previstoDia, apurar, saldoPonto, bancoDeHoras, bater, ajustar, anular, minutos,
  regras, salvarRegras, lerHorario, validarHorario, minutosDoHorario, distancia, avisoDevido, verificarAvisos, talvezVerificarAvisos, lembreteDe,
};
