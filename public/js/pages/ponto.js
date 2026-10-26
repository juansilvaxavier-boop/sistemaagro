// Ponto web. Meu ponto: marcação pelo navegador com a localização do aparelho, marcações do dia, espelho do mês e banco de horas.
// RH → Ponto: quem está trabalhando agora, espelho de cada colaborador com o local de cada marcação, ajustes e exportação.
import { get, post, esc, fmt, titulo, toast, erro, kpi, modal, campo, confirmar, pedirTexto, pode, baixar, tentar } from '../core.js';

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

function localHtml(m) {
  if (m.origem === 'ajuste') return `<span class="badge text-bg-info">Ajuste do RH</span> <span class="small text-body-secondary">${esc(m.justificativa || '')}</span>`;
  if (m.latitude == null) return '<span class="badge text-bg-warning"><i class="bi bi-geo-alt"></i> Sem localização</span>';
  const url = `https://www.google.com/maps?q=${m.latitude},${m.longitude}`;
  const texto = m.endereco || `${Number(m.latitude).toFixed(5)}, ${Number(m.longitude).toFixed(5)}`;
  return `<a href="${url}" target="_blank" rel="noopener" class="small"><i class="bi bi-geo-alt"></i> ${esc(texto)}</a>${m.precisao != null ? ` <span class="small text-body-secondary">(±${fmt.num(m.precisao)} m)</span>` : ''}`;
}

/** Tabela do espelho do mês. Com rh=true mostra o local de cada marcação e o botão de anular. */
function espelhoHtml(dias, { rh = false } = {}) {
  if (!dias.length) return '<div class="vazio py-4"><i class="bi bi-clock"></i><b>Nenhuma marcação neste mês</b>O espelho aparece a partir da primeira marcação.</div>';
  const anular = rh && pode('rh.gerir');
  const linhas = [...dias].reverse().map((d) => {
    const marc = d.marcacoes.map((m) => {
      const chip = `<span class="badge rounded-pill ${m.anulada ? 'text-bg-light text-decoration-line-through' : m.origem === 'ajuste' ? 'text-bg-info' : 'text-bg-secondary'}"
        title="${esc(m.tipo)}${m.endereco ? ` · ${esc(m.endereco)}` : ''}">${esc(m.hora.slice(0, 5))}${m.origem === 'ajuste' ? '*' : ''}</span>`;
      if (!rh) return chip;
      return `<div class="d-flex flex-wrap align-items-center gap-2 mb-1">${chip}<span class="small">${esc(m.tipo)}</span> ${m.anulada ? `<span class="small text-body-secondary">Anulada: ${esc(m.anulada_motivo || '')}</span>` : localHtml(m)}
        ${anular && !m.anulada ? `<button type="button" class="btn btn-link btn-sm p-0 text-danger" data-anular="${m.id}" aria-label="Anular marcação das ${esc(m.hora.slice(0, 5))}">anular</button>` : ''}</div>`;
    }).join(rh ? '' : ' ');
    return `<tr><td class="text-nowrap">${fmt.date(d.data)} <span class="text-body-secondary small">${DIAS[d.dia_semana]}</span></td>
      <td>${marc || '<span class="text-body-secondary small">—</span>'}</td>
      <td class="num">${hm(d.trabalhado)}</td><td class="num">${hm(d.previsto)}</td>
      <td class="num ${corSaldo(d.saldo)}">${d.saldo == null ? '—' : hm(d.saldo, { sinal: true })}</td>
      <td><span class="badge text-bg-${SIT_COR[d.situacao] || 'secondary'}">${esc(d.situacao_label)}</span></td></tr>`;
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
  pagina.innerHTML = `<div class="row g-3 mb-3">
    <div class="col-lg-5"><div class="card h-100"><div class="card-body text-center d-flex flex-column justify-content-center gap-2 py-4">
      <div class="text-body-secondary" id="pt-data"></div>
      <div class="fw-bold" style="font-size:2.6rem;font-variant-numeric:tabular-nums;line-height:1" id="pt-relogio" aria-live="off">--:--:--</div>
      ${registra ? `<button class="btn btn-success btn-lg mt-2 mx-auto px-4" id="pt-bater"><i class="bi bi-fingerprint"></i> Registrar ${esc(d.proxima.toLowerCase())}</button>
        <div class="small text-body-secondary"><i class="bi bi-geo-alt"></i> A localização do aparelho é registrada junto com a marcação.</div>`
    : '<div class="aviso-todas mx-auto"><i class="bi bi-info-circle"></i> Seu cadastro está como "não registra ponto".</div>'}
    </div></div></div>
    <div class="col-lg-7"><div class="card h-100"><div class="card-header py-2"><i class="bi bi-list-check"></i> Marcações de hoje</div><div class="card-body">
      ${d.marcacoes_hoje.length ? `<ul class="list-unstyled mb-0">${d.marcacoes_hoje.map((x) => `<li class="d-flex gap-3 align-items-start py-2 border-bottom">
        <b style="font-variant-numeric:tabular-nums">${esc(x.hora.slice(0, 5))}</b><div><div>${esc(x.tipo)}</div>${localHtml(x)}</div></li>`).join('')}</ul>`
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
  const btn = pagina.querySelector('#pt-bater');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.classList.add('carregando');
    try {
      const loc = await localizar();
      if (loc.erro && !(await confirmar(`${esc(loc.erro)}<br><br>Registrar mesmo assim? A marcação vai para o RH sinalizada como <b>sem localização</b>.`, { titulo: 'Localização indisponível', ok: 'Registrar sem localização', cls: 'btn-warning' }))) return;
      const r = await post('/api/ponto/bater', loc.erro ? {} : loc);
      toast(`${r.tipo} registrada às ${r.hora.slice(0, 5)}.${r.endereco ? ` ${r.endereco}` : ''}`);
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
    ${gere ? '<button class="btn btn-sm btn-success" id="rp-ajuste"><i class="bi bi-plus-lg"></i> Lançar marcação</button>' : ''}`);
  const d = await get(`/api/ponto?mes=${m}`);
  const t = d.totais;
  const SIT_HOJE = { trabalhando: ['Trabalhando', 'success'], fora: ['Saiu', 'secondary'], sem: ['Sem marcação', 'warning'] };
  pagina.innerHTML = `<div class="kpis mb-3">
      ${kpi('Registram ponto', fmt.num(t.colaboradores), { icone: 'bi-people' })}
      ${kpi('Trabalhando agora', fmt.num(t.trabalhando), { icone: 'bi-person-check', cor: 'success', sub: `${t.sem_marcacao_hoje} sem marcação hoje` })}
      ${kpi('Dias para corrigir', fmt.num(t.incompletos), { icone: 'bi-exclamation-triangle', cor: t.incompletos ? 'warning' : 'secondary', sub: `${t.sem_localizacao} marcações sem localização no mês` })}
      ${kpi('Banco de horas da equipe', `<span class="text-success">${horas(t.banco_positivo, { sinal: true })}</span> / <span class="text-danger">${horas(t.banco_negativo)}</span>`, { icone: 'bi-piggy-bank', cor: 'info', sub: 'a compensar / a pagar pela empresa' })}
    </div>
    <div class="card"><div class="card-body p-0">${d.linhas.length ? `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">
      <thead><tr><th>Colaborador</th><th>Hoje</th><th class="num">Trabalhado</th><th class="num">Previsto</th><th class="num">Saldo do mês</th><th class="num">Banco de horas</th><th>Pendências</th></tr></thead>
      <tbody>${d.linhas.map((x) => {
        const [l, c] = SIT_HOJE[x.hoje_situacao];
        const pend = [x.incompletos && `${x.incompletos} incompleto(s)`, x.sem_marcacao && `${x.sem_marcacao} sem marcação`, x.sem_localizacao && `${x.sem_localizacao} sem local`].filter(Boolean);
        return `<tr role="button" tabindex="0" data-colab="${x.id}"><td><b>${esc(x.nome)}</b><div class="small text-body-secondary">${esc([x.cargo, x.departamento].filter(Boolean).join(' · '))}</div></td>
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
    <div class="small text-body-secondary mb-2">Escala ${esc(d.colaborador.escala || '5x2')} · ${esc(d.colaborador.carga_horaria || 44)} h por semana</div>
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
      ...(pode('rh.gerir') ? [{ label: '<i class="bi bi-plus-lg"></i> Lançar marcação', onClick: () => { lancarMarcacao(linhas, id, aoMudar); } }] : []),
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
