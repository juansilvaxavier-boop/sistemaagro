// Ponto web. Meu ponto: marcação pelo navegador com a localização do aparelho, marcações do dia, espelho do mês e banco de horas.
// RH → Ponto: quem está trabalhando agora, espelho de cada colaborador com o local de cada marcação, ajustes e exportação.
import { get, post, put, del, esc, fmt, titulo, toast, erro, kpi, modal, campo, confirmar, pedirTexto, pode, baixar, tentar, lerForm } from '../core.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SIT_COR = { normal: 'success', incompleto: 'warning', sem_marcacao: 'danger', folga: 'secondary', ferias: 'info', abonado: 'info', falta: 'danger', hoje: 'primary', fora: 'secondary' };
const mesAtual = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 7);

/** Minutos → "7h45" (com sinal quando pedido). */
export function hm(min, { sinal = false } = {}) {
  if (min == null) return '—';
  const n = Math.round(Number(min));
  const s = n < 0 ? '−' : sinal && n > 0 ? '+' : '';
  const a = Math.abs(n);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
const horas = (h, o) => hm(Number(h) * 60, o);
const corSaldo = (v) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : '');

const distTxt = (m) => (m >= 1000 ? `${fmt.num(Math.round(m / 100) / 10)} km` : `${fmt.num(m)} m`);
function cercaHtml(m) {
  if (m.fora_cerca) return `<span class="badge text-bg-danger"><i class="bi bi-geo-alt"></i> Fora da cerca${m.local && m.distancia != null ? ` · ${distTxt(m.distancia)} de ${esc(m.local)}` : ''}</span>`;
  return m.local ? `<span class="badge text-bg-success"><i class="bi bi-building"></i> ${esc(m.local)}</span>` : '';
}
const fotoHtml = (m) => (m.tem_foto ? `<a href="/api/ponto/${m.id}/foto" target="_blank" rel="noopener" title="Foto da marcação"><img src="/api/ponto/${m.id}/foto" alt="Foto da marcação das ${esc(m.hora.slice(0, 5))}" loading="lazy"
  style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--borda)"></a>` : '');
function localHtml(m) {
  if (m.origem === 'ajuste') return `<span class="badge text-bg-info">Ajuste do RH</span> <span class="small text-body-secondary">${esc(m.justificativa || '')}</span>`;
  if (m.latitude == null) return `<span class="badge text-bg-warning"><i class="bi bi-geo-alt"></i> Sem localização</span> ${cercaHtml(m)}`;
  const url = `https://www.google.com/maps?q=${m.latitude},${m.longitude}`;
  const texto = m.endereco || `${Number(m.latitude).toFixed(5)}, ${Number(m.longitude).toFixed(5)}`;
  return `${cercaHtml(m)} <a href="${url}" target="_blank" rel="noopener" class="small"><i class="bi bi-geo-alt"></i> ${esc(texto)}</a>${m.precisao != null ? ` <span class="small text-body-secondary">(±${fmt.num(m.precisao)} m)</span>` : ''}`;
}
/** "08:00–12:00 · 13:00–18:00" */
export const horarioTxt = (h) => (h ? (h.si ? `${h.e}–${h.si} · ${h.vi}–${h.s}` : `${h.e}–${h.s}`) : 'folga');

/** Tabela do espelho do mês. Com rh=true mostra o local de cada marcação e o botão de anular. */
function espelhoHtml(dias, { rh = false } = {}) {
  if (!dias.length) return '<div class="vazio py-4"><i class="bi bi-clock"></i><b>Nenhuma marcação neste mês</b>O espelho aparece a partir da primeira marcação.</div>';
  const anular = rh && pode('rh.gerir');
  const linhas = [...dias].reverse().map((d) => {
    const marc = d.marcacoes.map((m) => {
      const chip = `<span class="badge rounded-pill ${m.anulada ? 'text-bg-light text-decoration-line-through' : m.origem === 'ajuste' ? 'text-bg-info' : 'text-bg-secondary'}"
        title="${esc(m.tipo)}${m.endereco ? ` · ${esc(m.endereco)}` : ''}">${esc(m.hora.slice(0, 5))}${m.origem === 'ajuste' ? '*' : ''}</span>`;
      if (!rh) return chip;
      return `<div class="d-flex flex-wrap align-items-center gap-2 mb-1">${fotoHtml(m)}${chip}<span class="small">${esc(m.tipo)}</span> ${m.anulada ? `<span class="small text-body-secondary">Anulada: ${esc(m.anulada_motivo || '')}</span>` : localHtml(m)}
        ${anular && !m.anulada ? `<button type="button" class="btn btn-link btn-sm p-0 text-danger" data-anular="${m.id}" aria-label="Anular marcação das ${esc(m.hora.slice(0, 5))}">anular</button>` : ''}</div>`;
    }).join(rh ? '' : ' ');
    return `<tr><td class="text-nowrap">${fmt.date(d.data)} <span class="text-body-secondary small">${DIAS[d.dia_semana]}</span></td>
      <td>${marc || '<span class="text-body-secondary small">—</span>'}</td>
      <td class="num">${hm(d.trabalhado)}</td><td class="num">${hm(d.previsto)}</td>
      <td class="num ${corSaldo(d.saldo)}">${d.saldo == null ? '—' : hm(d.saldo, { sinal: true })}</td>
      <td><span class="badge text-bg-${SIT_COR[d.situacao] || 'secondary'}">${esc(d.situacao_label)}</span>
        ${d.atraso ? `<div class="small text-danger">Atraso ${hm(d.atraso)}</div>` : ''}${d.saida_antecipada ? `<div class="small text-danger">Saiu ${hm(d.saida_antecipada)} antes</div>` : ''}
        ${rh && d.horario ? `<div class="small text-body-secondary">${horarioTxt(d.horario)}</div>` : ''}</td></tr>`;
  }).join('');
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Dia</th><th>Marcações</th><th class="num">Trabalhado</th><th class="num">Previsto</th>
    <th class="num">Saldo</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <div class="form-text mt-2">* marcação lançada pelo RH. Diferença de até 10 minutos no dia não conta (CLT, art. 58). Dia incompleto só entra no saldo depois de corrigido.</div>`;
}

/** Pede a localização ao navegador; nunca rejeita (devolve o motivo quando não consegue). */
function localizar() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ erro: 'Este navegador não informa a localização.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: p.coords.accuracy }),
      (e) => resolve({ erro: e.code === 1 ? 'A permissão de localização foi negada neste navegador.' : 'Não foi possível obter a localização agora.' }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

/** Abre a câmera frontal e devolve a foto (JPEG reduzido) ou null se a pessoa cancelar. */
function tirarFoto() {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) return reject(new Error('Este navegador não dá acesso à câmera. Use o navegador do celular atualizado.'));
    let stream;
    let foto = null;
    modal({
      title: '<i class="bi bi-camera"></i> Foto da marcação', size: 'md', static: true,
      body: `<div class="text-center"><video playsinline autoplay muted style="width:100%;max-height:60vh;border-radius:12px;background:#000;transform:scaleX(-1)"></video>
        <div class="form-text">Enquadre o rosto e toque em <b>Tirar foto e registrar</b>. A foto fica só com você e o RH.</div></div>`,
      onShow: async ({ body }) => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
          body.querySelector('video').srcObject = stream;
        } catch {
          body.innerHTML = '<div class="vazio"><i class="bi bi-camera-video-off"></i><b>Câmera bloqueada</b>Permita o acesso à câmera nas configurações do navegador e tente de novo.</div>';
        }
      },
      onClose: () => { stream?.getTracks().forEach((t) => t.stop()); resolve(foto); },
      buttons: [{ label: '<i class="bi bi-camera"></i> Tirar foto e registrar', onClick: ({ body }) => {
        const v = body.querySelector('video');
        if (!v?.videoWidth) { toast('A câmera ainda não abriu.', 'warning'); return false; }
        const larg = Math.min(480, v.videoWidth);
        const c = Object.assign(document.createElement('canvas'), { width: larg, height: Math.round((v.videoHeight / v.videoWidth) * larg) });
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        foto = c.toDataURL('image/jpeg', 0.72);
      } }],
    });
  });
}

const base64Url = (s) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
/** Inscreve este aparelho para receber os lembretes de ponto, mesmo com o sistema fechado. */
async function ativarLembretes(chave) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador não recebe notificações. No iPhone, instale o sistema na tela de início (Compartilhar → Adicionar à Tela de Início) e abra por lá.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('As notificações não foram autorizadas neste navegador.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Url(chave) }));
  await post('/api/ponto/push', { inscricao: sub.toJSON() });
}
async function lembretesAtivos() {
  try {
    if (!('PushManager' in window) || Notification.permission !== 'granted') return false;
    return !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription());
  } catch { return false; }
}

// ======================= Meu ponto =======================
export default async function meuPonto(conteudo, { mes } = {}) {
  const pagina = titulo(conteudo, 'Meu ponto', 'bi-fingerprint');
  const m = mes || mesAtual();
  const d = await get(`/api/ponto/meu?mes=${m}`);
  if (!d.vinculado) {
    pagina.innerHTML = '<div class="vazio"><i class="bi bi-person-x"></i><b>Seu usuário ainda não está ligado a um colaborador</b>Peça ao RH para fazer o vínculo e liberar o ponto.</div>';
    return;
  }
  const t = d.espelho.totais;
  const registra = d.colaborador.bate_ponto !== 0;
  // Relógio na hora do servidor (a marcação vale a hora do servidor, não a do aparelho).
  const desvio = Date.parse(d.agora.replace(' ', 'T')) - Date.now();
  const hHoje = d.colaborador.horario ? (d.colaborador.horario[new Date(Date.now() + desvio).getDay()] || null) : undefined;
  pagina.innerHTML = `${d.lembrete && registra ? `<div class="alert alert-warning d-flex gap-2 align-items-center" role="alert"><i class="bi bi-alarm"></i><div>${esc(d.lembrete.texto)}</div></div>` : ''}
    <div class="row g-3 mb-3">
    <div class="col-lg-5"><div class="card h-100"><div class="card-body text-center d-flex flex-column justify-content-center gap-2 py-4">
      <div class="text-body-secondary" id="pt-data"></div>
      <div class="fw-bold" style="font-size:2.6rem;font-variant-numeric:tabular-nums;line-height:1" id="pt-relogio" aria-live="off">--:--:--</div>
      ${hHoje !== undefined ? `<div class="small">Seu horário hoje: <b>${esc(horarioTxt(hHoje))}</b></div>` : ''}
      ${registra ? `<button class="btn btn-success btn-lg mt-2 mx-auto px-4" id="pt-bater"><i class="bi bi-fingerprint"></i> Registrar ${esc(d.proxima.toLowerCase())}</button>
        <div class="small text-body-secondary"><i class="bi bi-geo-alt"></i> A localização do aparelho${d.regras.exigir_foto ? ' e uma foto são registradas' : ' é registrada'} junto com a marcação.</div>
        ${d.regras.bloquear_fora_cerca && d.locais.length ? `<div class="small text-body-secondary"><i class="bi bi-building"></i> Aceito em: ${d.locais.map((l) => `${esc(l.nome)} (até ${fmt.num(l.raio)} m)`).join(', ')}</div>` : ''}
        <button class="btn btn-link btn-sm d-none" id="pt-push"><i class="bi bi-bell"></i> Receber lembretes neste aparelho</button>`
    : '<div class="aviso-todas mx-auto"><i class="bi bi-info-circle"></i> Seu cadastro está como "não registra ponto".</div>'}
    </div></div></div>
    <div class="col-lg-7"><div class="card h-100"><div class="card-header py-2"><i class="bi bi-list-check"></i> Marcações de hoje</div><div class="card-body">
      ${d.marcacoes_hoje.length ? `<ul class="list-unstyled mb-0">${d.marcacoes_hoje.map((x) => `<li class="d-flex gap-3 align-items-start py-2 border-bottom">
        ${fotoHtml(x)}<b style="font-variant-numeric:tabular-nums">${esc(x.hora.slice(0, 5))}</b><div><div>${esc(x.tipo)}</div>${localHtml(x)}</div></li>`).join('')}</ul>`
    : '<div class="vazio py-3"><i class="bi bi-clock"></i>Nenhuma marcação hoje.</div>'}
    </div></div></div></div>
    <div class="kpis mb-3">
      ${kpi('Banco de horas', `<span class="${corSaldo(d.banco.saldo)}">${horas(d.banco.saldo, { sinal: true })}</span>`, { icone: 'bi-piggy-bank', cor: d.banco.saldo < 0 ? 'danger' : 'info', sub: `${horas(d.banco.ponto, { sinal: true })} do ponto · ${horas(d.banco.manual, { sinal: true })} lançados pelo RH`, dica: 'Saldo de todos os dias fechados (até ontem) mais créditos e débitos lançados pelo RH.' })}
      ${kpi('Trabalhado no mês', hm(t.trabalhado), { icone: 'bi-hourglass-split', sub: `previsto ${hm(t.previsto)}` })}
      ${kpi('Saldo do mês', `<span class="${corSaldo(t.saldo)}">${hm(t.saldo, { sinal: true })}</span>`, { icone: 'bi-plus-slash-minus', cor: t.saldo < 0 ? 'danger' : 'success' })}
      ${kpi('Dias para corrigir', fmt.num(t.incompletos), { icone: 'bi-exclamation-triangle', cor: t.incompletos ? 'warning' : 'secondary', sub: t.incompletos ? 'Marcação ímpar: fale com o RH' : 'Tudo certo' })}
    </div>
    <div class="card"><div class="card-header py-2 d-flex align-items-center gap-2 flex-wrap"><span><i class="bi bi-calendar3"></i> Espelho do mês</span>
      <input type="month" class="form-control form-control-sm ms-auto" style="max-width:11rem" id="pt-mes" value="${esc(d.mes)}" aria-label="Mês do espelho"></div>
      <div class="card-body">${espelhoHtml(d.espelho.dias)}</div></div>`;

  const rel = pagina.querySelector('#pt-relogio');
  const dt = pagina.querySelector('#pt-data');
  const tique = () => {
    if (!document.body.contains(rel)) return clearInterval(timer);
    const agora = new Date(Date.now() + desvio);
    rel.textContent = agora.toLocaleTimeString('pt-BR');
    const txt = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    dt.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
  };
  const timer = setInterval(tique, 1000);
  tique();

  pagina.querySelector('#pt-mes').addEventListener('change', (e) => e.target.value && meuPonto(conteudo, { mes: e.target.value }));
  const bPush = pagina.querySelector('#pt-push');
  if (bPush && 'PushManager' in window) {
    lembretesAtivos().then((ok) => bPush.classList.toggle('d-none', ok));
    bPush.addEventListener('click', () => tentar(async () => { await ativarLembretes(d.push_chave); bPush.classList.add('d-none'); }, 'Lembretes ativados neste aparelho.'));
  }
  const btn = pagina.querySelector('#pt-bater');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.classList.add('carregando');
    try {
      const loc = await localizar();
      if (loc.erro && d.regras.bloquear_fora_cerca) throw new Error(`${loc.erro} O ponto só é aceito com a localização ligada, dentro dos locais da empresa.`);
      if (loc.erro && !(await confirmar(`${esc(loc.erro)}<br><br>Registrar mesmo assim? A marcação vai para o RH sinalizada como <b>sem localização</b>.`, { titulo: 'Localização indisponível', ok: 'Registrar sem localização', cls: 'btn-warning' }))) return;
      const corpo = loc.erro ? {} : loc;
      if (d.regras.exigir_foto) {
        corpo.foto = await tirarFoto();
        if (!corpo.foto) return;
      }
      const r = await post('/api/ponto/bater', corpo);
      toast(`${r.tipo} registrada às ${r.hora.slice(0, 5)}.${r.local && !r.fora_cerca ? ` ${r.local}.` : r.endereco ? ` ${r.endereco}` : ''}`);
      if (r.fora_cerca) toast('Marcação feita fora dos locais da empresa: o RH vai ver a distância.', 'warning');
      meuPonto(conteudo, { mes: m });
    } catch (e) {
      erro(e);
    } finally {
      btn.disabled = false;
      btn.classList.remove('carregando');
    }
  });
}

// ======================= RH → Ponto =======================
export async function rhPonto(conteudo, { mes } = {}) {
  const m = mes || mesAtual();
  const gere = pode('rh.gerir');
  const pagina = titulo(conteudo, 'Ponto', 'bi-fingerprint', `<input type="month" class="form-control form-control-sm" style="max-width:11rem" id="rp-mes" value="${esc(m)}" aria-label="Mês">
    <button class="btn btn-sm btn-outline-success" id="rp-exportar"><i class="bi bi-file-earmark-excel"></i> Exportar espelhos</button>
    <button class="btn btn-sm btn-outline-secondary" id="rp-config"><i class="bi bi-sliders"></i> Locais e regras</button>
    ${gere ? '<button class="btn btn-sm btn-success" id="rp-ajuste"><i class="bi bi-plus-lg"></i> Lançar marcação</button>' : ''}`);
  const d = await get(`/api/ponto?mes=${m}`);
  const t = d.totais;
  const SIT_HOJE = { trabalhando: ['Trabalhando', 'success'], fora: ['Saiu', 'secondary'], sem: ['Sem marcação', 'warning'] };
  pagina.innerHTML = `<div class="kpis mb-3">
      ${kpi('Registram ponto', fmt.num(t.colaboradores), { icone: 'bi-people' })}
      ${kpi('Trabalhando agora', fmt.num(t.trabalhando), { icone: 'bi-person-check', cor: 'success', sub: `${t.sem_marcacao_hoje} sem marcação hoje` })}
      ${kpi('Dias para corrigir', fmt.num(t.incompletos), { icone: 'bi-exclamation-triangle', cor: t.incompletos ? 'warning' : 'secondary', sub: `${t.sem_localizacao} sem localização · ${t.fora_cerca} fora da cerca no mês` })}
      ${kpi('Banco de horas da equipe', `<span class="text-success">${horas(t.banco_positivo, { sinal: true })}</span> / <span class="text-danger">${horas(t.banco_negativo)}</span>`, { icone: 'bi-piggy-bank', cor: 'info', sub: 'a compensar / a pagar pela empresa' })}
    </div>
    <div class="card"><div class="card-body p-0">${d.linhas.length ? `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">
      <thead><tr><th>Colaborador</th><th>Hoje</th><th class="num">Trabalhado</th><th class="num">Previsto</th><th class="num">Saldo do mês</th><th class="num">Banco de horas</th><th>Pendências</th></tr></thead>
      <tbody>${d.linhas.map((x) => {
        const [l, c] = SIT_HOJE[x.hoje_situacao];
        const pend = [x.incompletos && `${x.incompletos} incompleto(s)`, x.sem_marcacao && `${x.sem_marcacao} sem marcação`, x.sem_localizacao && `${x.sem_localizacao} sem local`,
          x.fora_cerca && `${x.fora_cerca} fora da cerca`, x.atrasos && `${x.atrasos} atraso(s)`].filter(Boolean);
        return `<tr role="button" tabindex="0" data-colab="${x.id}"><td><b>${esc(x.nome)}</b>${x.ponto_externo ? ' <span class="badge text-bg-info">Externo</span>' : ''}
          <div class="small text-body-secondary">${esc([x.cargo, x.departamento].filter(Boolean).join(' · '))}${x.horario ? '' : ' · <span class="text-warning-emphasis">sem horário</span>'}</div></td>
          <td><span class="badge text-bg-${c}">${l}</span>${x.hoje_ultima ? ` <span class="small text-body-secondary">${esc(x.hoje_ultima.slice(0, 5))}</span>` : ''}</td>
          <td class="num">${hm(x.trabalhado)}</td><td class="num">${hm(x.previsto)}</td><td class="num ${corSaldo(x.saldo)}">${hm(x.saldo, { sinal: true })}</td>
          <td class="num ${corSaldo(x.banco)}"><b>${horas(x.banco, { sinal: true })}</b></td>
          <td>${pend.length ? pend.map((p) => `<span class="badge text-bg-warning me-1">${p}</span>`).join('') : '<span class="text-body-secondary small">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`
    : '<div class="vazio"><i class="bi bi-fingerprint"></i><b>Ninguém registrando ponto</b>Marque "Registra ponto" na ficha do colaborador e ligue o usuário dele ao cadastro.</div>'}</div></div>`;

  const recarregar = () => rhPonto(conteudo, { mes: m });
  conteudo.querySelector('#rp-mes').addEventListener('change', (e) => e.target.value && rhPonto(conteudo, { mes: e.target.value }));
  conteudo.querySelector('#rp-exportar').addEventListener('click', () => tentar(() => baixar(`/api/ponto/exportar?mes=${m}`, `espelho_ponto_${m}.xlsx`)));
  conteudo.querySelector('#rp-ajuste')?.addEventListener('click', () => lancarMarcacao(d.linhas, null, recarregar));
  conteudo.querySelector('#rp-config').addEventListener('click', () => configurar(recarregar));
  pagina.querySelectorAll('[data-colab]').forEach((tr) => {
    const abrir = () => espelhoColaborador(Number(tr.dataset.colab), m, d.linhas, recarregar);
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
  });
}

async function espelhoColaborador(id, mes, linhas, aoMudar) {
  const d = await get(`/api/ponto/colaborador/${id}?mes=${mes}`);
  const t = d.espelho.totais;
  const corpo = `<div class="kpis mb-3">
      ${kpi('Banco de horas', `<span class="${corSaldo(d.banco.saldo)}">${horas(d.banco.saldo, { sinal: true })}</span>`, { icone: 'bi-piggy-bank', cor: 'info', sub: `${horas(d.banco.ponto, { sinal: true })} do ponto · ${horas(d.banco.manual, { sinal: true })} manuais` })}
      ${kpi('Trabalhado no mês', hm(t.trabalhado), { icone: 'bi-hourglass-split', sub: `previsto ${hm(t.previsto)}` })}
      ${kpi('Saldo do mês', hm(t.saldo, { sinal: true }), { icone: 'bi-plus-slash-minus', cor: t.saldo < 0 ? 'danger' : 'success' })}
    </div>
    <div class="small text-body-secondary mb-2">${d.colaborador.horario
    ? `Horário: ${[1, 2, 3, 4, 5, 6, 0].filter((i) => d.colaborador.horario[i]).map((i) => `${DIAS[i]} ${horarioTxt(d.colaborador.horario[i])}`).join(' · ')}`
    : `Sem horário definido: escala ${esc(d.colaborador.escala || '5x2')} · ${esc(d.colaborador.carga_horaria || 44)} h por semana`}${d.colaborador.ponto_externo ? ' · <b>trabalho externo</b> (marca fora das cercas)' : ''}</div>
    ${espelhoHtml(d.espelho.dias, { rh: true })}`;
  modal({
    title: `<i class="bi bi-fingerprint"></i> Espelho de ponto · ${esc(d.colaborador.nome)} · ${fmt.periodo(mes)}`, size: 'xl', body: corpo,
    onShow: ({ body, close }) => {
      body.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', async () => {
        const motivo = await pedirTexto('Por que esta marcação deve ser anulada? Ela continua no histórico, mas deixa de contar.', { titulo: 'Anular marcação', ok: 'Anular', min: 5 });
        if (!motivo) return;
        await tentar(() => post(`/api/ponto/${b.dataset.anular}/anular`, { motivo }), 'Marcação anulada.');
        close?.();
        aoMudar?.();
      }));
    },
    buttons: [
      { label: '<i class="bi bi-file-earmark-excel"></i> Exportar', cls: 'btn-outline-success', onClick: async () => { await baixar(`/api/ponto/exportar?mes=${mes}&colaborador_id=${id}`, `espelho_${mes}.xlsx`); return false; } },
      ...(pode('rh.gerir') ? [
        { label: '<i class="bi bi-calendar-week"></i> Horário de trabalho', cls: 'btn-outline-secondary', onClick: () => { editarHorario(d.colaborador, linhas, aoMudar); } },
        { label: '<i class="bi bi-plus-lg"></i> Lançar marcação', onClick: () => { lancarMarcacao(linhas, id, aoMudar); } },
      ] : []),
    ],
  });
}

function lancarMarcacao(linhas, colabId, aoSalvar) {
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  modal({
    title: '<i class="bi bi-plus-lg"></i> Lançar marcação', size: 'md',
    body: `<form class="row g-2">
      ${campo('colaborador_id', 'Colaborador', { type: 'select', col: 'col-12', required: true, options: [['', 'Selecione...'], ...linhas.map((x) => [x.id, x.nome])] })}
      ${campo('data', 'Data', { type: 'date', col: 'col-6', required: true, value: hoje, attrs: `max="${hoje}"` })}
      ${campo('hora', 'Hora', { type: 'time', col: 'col-6', required: true })}
      ${campo('justificativa', 'Justificativa', { type: 'textarea', col: 'col-12', required: true, help: 'Ex.: esqueceu de marcar a saída; celular sem bateria.' })}</form>
      <div class="form-text">A marcação entra como ajuste do RH e aparece com * no espelho do colaborador.</div>`,
    onShow: ({ body }) => { if (colabId) body.querySelector('[name=colaborador_id]').value = colabId; },
    buttons: [{ label: 'Lançar', onClick: async ({ body }) => {
      const f = body.querySelector('form');
      await post('/api/ponto/ajuste', { colaborador_id: f.colaborador_id.value, data: f.data.value, hora: f.hora.value, justificativa: f.justificativa.value });
      toast('Marcação lançada.');
      aoSalvar?.();
    } }],
  });
}

// ---------- Horário de trabalho ----------
const PRESETS = {
  comercial: { l: 'Seg a sex 08–18 (almoço 12–13)', h: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [i, { e: '08:00', si: '12:00', vi: '13:00', s: '18:00' }])) },
  comercial_sab: { l: 'Seg a sex 08–17:48 + sáb 08–12', h: { ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [i, { e: '08:00', si: '12:00', vi: '13:00', s: '17:48' }])), 6: { e: '08:00', s: '12:00' } } },
  seis: { l: 'Seg a sáb 07–15:20 (almoço 11–12)', h: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [i, { e: '07:00', si: '11:00', vi: '12:00', s: '15:20' }])) },
};
const minHH = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function editarHorario(c, linhas, aoSalvar) {
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const linha = (i) => `<tr data-dia="${i}"><th class="fw-normal">${DIAS[i]}</th>${['e', 'si', 'vi', 's'].map((k) => `<td><input type="time" class="form-control form-control-sm" data-k="${k}" aria-label="${DIAS[i]} ${{ e: 'entrada', si: 'saída para intervalo', vi: 'volta do intervalo', s: 'saída' }[k]}"></td>`).join('')}
    <td class="num small" data-total></td></tr>`;
  modal({
    title: `<i class="bi bi-calendar-week"></i> Horário de trabalho · ${esc(c.nome)}`, size: 'lg',
    body: `<div class="d-flex flex-wrap gap-2 mb-2"><span class="small text-body-secondary align-self-center">Modelos:</span>
        ${Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-preset="${k}">${esc(p.l)}</button>`).join('')}
        <button type="button" class="btn btn-sm btn-outline-danger" data-preset="">Limpar</button></div>
      <div class="table-responsive"><table class="table table-sm align-middle mb-1"><thead><tr><th>Dia</th><th>Entrada</th><th>Saída intervalo</th><th>Volta intervalo</th><th>Saída</th><th class="num">Horas</th></tr></thead>
        <tbody>${ordem.map(linha).join('')}</tbody><tfoot><tr><th colspan="5" class="text-end">Total na semana</th><th class="num" data-semana></th></tr></tfoot></table></div>
      <div class="form-text mb-3">Dia em branco = folga. O previsto de cada dia, o atraso e os lembretes de marcação esquecida seguem este horário. Sem horário, vale a carga horária e a escala da ficha.</div>
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="h-externo" ${c.ponto_externo ? 'checked' : ''}>
        <label class="form-check-label" for="h-externo"><b>Trabalho externo</b>: pode marcar fora dos locais da empresa (vendedor, motorista, técnico de campo)</label></div>
      <label class="form-label">Aplicar o mesmo horário também a</label>
      <select multiple class="form-select form-select-sm" size="6" id="h-outros">${linhas.filter((x) => x.id !== c.id).map((x) => `<option value="${x.id}">${esc(x.nome)}${x.departamento ? ` · ${esc(x.departamento)}` : ''}</option>`).join('')}</select>
      <div class="form-text">Segure Ctrl (ou Cmd) para escolher vários.</div>`,
    onShow: ({ body }) => {
      const preencher = (h) => body.querySelectorAll('tr[data-dia]').forEach((tr) => {
        const x = h?.[tr.dataset.dia] || {};
        tr.querySelectorAll('input').forEach((inp) => { inp.value = x[inp.dataset.k] || ''; });
      });
      const totais = () => {
        let semana = 0;
        body.querySelectorAll('tr[data-dia]').forEach((tr) => {
          const v = Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.k, i.value]));
          const min = v.e && v.s ? minHH(v.s) - minHH(v.e) - (v.si && v.vi ? minHH(v.vi) - minHH(v.si) : 0) : 0;
          semana += Math.max(0, min);
          tr.querySelector('[data-total]').textContent = min > 0 ? hm(min) : '—';
        });
        body.querySelector('[data-semana]').textContent = hm(semana);
      };
      preencher(c.horario);
      totais();
      body.addEventListener('input', totais);
      body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { preencher(b.dataset.preset ? PRESETS[b.dataset.preset].h : null); totais(); }));
    },
    buttons: [{ label: 'Salvar horário', onClick: async ({ body }) => {
      const horario = {};
      body.querySelectorAll('tr[data-dia]').forEach((tr) => {
        const v = Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.k, i.value]).filter(([, x]) => x));
        if (Object.keys(v).length) horario[tr.dataset.dia] = v;
      });
      const aplicar_a = [...body.querySelector('#h-outros').selectedOptions].map((o) => Number(o.value));
      const r = await put(`/api/ponto/colaborador/${c.id}/horario`, { horario, ponto_externo: body.querySelector('#h-externo').checked, aplicar_a });
      toast(r.atualizados > 1 ? `Horário salvo para ${r.atualizados} colaboradores.` : 'Horário salvo.');
      aoSalvar?.();
    } }],
  });
}

// ---------- Locais (cercas) e regras ----------
async function configurar(aoMudar) {
  const d = await get('/api/ponto/config');
  const gere = pode('rh.gerir');
  const rg = d.regras;
  const locaisHtml = (ls) => (ls.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Local</th><th>Coordenadas</th><th class="num">Raio</th><th></th></tr></thead>
    <tbody>${ls.map((l) => `<tr><td><b>${esc(l.nome)}</b></td><td><a href="https://www.google.com/maps?q=${l.latitude},${l.longitude}" target="_blank" rel="noopener" class="small">${Number(l.latitude).toFixed(5)}, ${Number(l.longitude).toFixed(5)}</a></td>
      <td class="num">${fmt.num(l.raio)} m</td><td class="text-end text-nowrap">${gere ? `<button type="button" class="btn btn-sm btn-outline-secondary py-0" data-editar="${l.id}" aria-label="Editar ${esc(l.nome)}"><i class="bi bi-pencil"></i></button>
      <button type="button" class="btn btn-sm btn-outline-danger py-0" data-remover="${l.id}" aria-label="Remover ${esc(l.nome)}"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="vazio py-3"><i class="bi bi-geo"></i><b>Nenhum local cadastrado</b>Sem locais, o ponto é aceito em qualquer lugar (a localização continua registrada).</div>');
  const dis = gere ? '' : 'disabled';
  modal({
    title: '<i class="bi bi-sliders"></i> Locais e regras do ponto', size: 'lg',
    body: `<h6 class="secao-titulo">Locais da empresa (cercas)</h6>
      <p class="small text-body-secondary">Marcação a mais que o raio do local mais próximo fica marcada como <b>fora da cerca</b>. A imprecisão do GPS (até 100 m) conta a favor do colaborador. Quem tem "trabalho externo" no horário não é afetado.</p>
      <div data-locais>${locaisHtml(d.locais)}</div>
      ${gere ? '<button type="button" class="btn btn-sm btn-outline-success mt-2" data-novo><i class="bi bi-plus-lg"></i> Adicionar local</button>' : ''}
      <h6 class="secao-titulo mt-4">Regras</h6>
      <form class="row g-2" data-regras>
        ${campo('bloquear_fora_cerca', 'Recusar marcação fora da cerca (sem isso, a marcação entra e o RH vê o alerta)', { type: 'checkbox', col: 'col-12', value: rg.bloquear_fora_cerca, attrs: dis })}
        ${campo('exigir_foto', 'Exigir foto (câmera frontal) em cada marcação', { type: 'checkbox', col: 'col-12', value: rg.exigir_foto, attrs: dis })}
        ${campo('avisos', 'Avisar o colaborador quando esquecer de marcar (precisa de horário cadastrado)', { type: 'checkbox', col: 'col-12', value: rg.avisos, attrs: dis })}
        ${campo('aviso_entrada', 'Avisar a entrada/volta depois de (min)', { type: 'number', col: 'col-md-4', value: rg.aviso_entrada, attrs: `min="5" max="240" ${dis}` })}
        ${campo('aviso_saida', 'Avisar a saída depois de (min)', { type: 'number', col: 'col-md-4', value: rg.aviso_saida, attrs: `min="5" max="240" ${dis}` })}
        ${campo('tolerancia_atraso', 'Tolerância de atraso (min)', { type: 'number', col: 'col-md-4', value: rg.tolerancia_atraso, attrs: `min="0" max="60" ${dis}` })}
      </form>
      <div class="form-text">A foto é dado pessoal: só o próprio colaborador e o RH veem. Os lembretes chegam no celular de quem ativou "Receber lembretes" em Meu ponto e aparecem na tela quando ele abre o sistema.</div>`,
    onShow: ({ body }) => {
      const recarregarLocais = async () => {
        d.locais = (await get('/api/ponto/config')).locais;
        body.querySelector('[data-locais]').innerHTML = locaisHtml(d.locais);
        ligar();
      };
      const ligar = () => {
        body.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editarLocal(d.locais.find((l) => l.id === Number(b.dataset.editar)), recarregarLocais)));
        body.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmar('Remover este local? As marcações antigas continuam com ele no histórico.', { titulo: 'Remover local', ok: 'Remover', cls: 'btn-danger' }))) return;
          await tentar(() => del(`/api/ponto/locais/${b.dataset.remover}`), 'Local removido.');
          recarregarLocais();
        }));
      };
      ligar();
      body.querySelector('[data-novo]')?.addEventListener('click', () => editarLocal(null, recarregarLocais));
    },
    onClose: () => aoMudar?.(),
    buttons: gere ? [{ label: 'Salvar regras', onClick: async ({ body }) => {
      await put('/api/ponto/regras', lerForm(body.querySelector('[data-regras]')));
      toast('Regras do ponto salvas.');
    } }] : [],
  });
}

function editarLocal(l, aoSalvar) {
  modal({
    title: `<i class="bi bi-geo-alt"></i> ${l ? 'Editar local' : 'Novo local'}`, size: 'md',
    body: `<form class="row g-2">
      ${campo('nome', 'Nome', { col: 'col-12', required: true, value: l?.nome || '', attrs: 'placeholder="Ex.: Matriz, Fábrica, Depósito"' })}
      ${campo('latitude', 'Latitude', { type: 'number', col: 'col-6', required: true, value: l?.latitude ?? '', attrs: 'step="any"' })}
      ${campo('longitude', 'Longitude', { type: 'number', col: 'col-6', required: true, value: l?.longitude ?? '', attrs: 'step="any"' })}
      ${campo('raio', 'Raio (metros)', { type: 'number', col: 'col-6', required: true, value: l?.raio ?? 150, attrs: 'min="30" max="5000"' })}
      <div class="col-6 d-flex align-items-end"><button type="button" class="btn btn-sm btn-outline-secondary w-100" data-aqui><i class="bi bi-crosshair"></i> Usar minha localização</button></div></form>
      <div class="form-text">Estando no local, toque em <b>Usar minha localização</b>. Ou copie as coordenadas do Google Maps (clique com o botão direito no ponto do mapa).</div>`,
    onShow: ({ body }) => body.querySelector('[data-aqui]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('carregando');
      const loc = await localizar();
      btn.classList.remove('carregando');
      if (loc.erro) return toast(loc.erro, 'warning');
      const f = body.querySelector('form');
      f.latitude.value = loc.latitude.toFixed(6);
      f.longitude.value = loc.longitude.toFixed(6);
      toast(`Localização capturada (precisão de ±${Math.round(loc.precisao)} m).`);
    }),
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const b = lerForm(body.querySelector('form'));
      if (l) await put(`/api/ponto/locais/${l.id}`, b);
      else await post('/api/ponto/locais', b);
      toast('Local salvo.');
      aoSalvar?.();
    } }],
  });
}
