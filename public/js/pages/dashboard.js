import { get, esc, fmt, state, titulo, qs } from '../core.js';

const graficos = [];
let ultimo;
const alfa = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const CORES = ['#2e7d32', '#1976d2', '#f9a825', '#c62828', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#546e7a', '#9e9d24', '#ad1457'];

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Painel', 'bi-speedometer2', '<select class="form-select form-select-sm d-none" id="sel-perfil" style="width:auto"></select>');
  const sel = conteudo.querySelector('#sel-perfil');
  let cabecalho = conteudo.querySelector('.page-title h2');
  const carregar = async (perfil) => {
    const d = await get('/api/dashboard' + qs({ perfil }));
    if (!pagina.isConnected) return; // a pessoa já foi para outra tela
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const novo = document.createElement('div');
    novo.innerHTML = `<p class="saudacao">${saud}, ${esc(state.me.usuario.nome.split(' ')[0])}</p>
      <div class="text-body-secondary">${esc(d.titulo)} · ${esc(data)}</div>`;
    cabecalho.replaceWith(novo);
    cabecalho = novo;
    ultimo = d;
    if (d.perfis_disponiveis.length > 1) {
      sel.classList.remove('d-none');
      sel.innerHTML = d.perfis_disponiveis.map((p) => `<option value="${p}" ${p === d.perfil ? 'selected' : ''}>Painel ${esc(state.me.perfis[p])}</option>`).join('');
    }
    desenhar(pagina, d);
  };
  sel.addEventListener('change', () => carregar(sel.value));
  const redesenhar = () => { if (document.body.contains(pagina) && ultimo) desenhar(pagina, ultimo); else window.removeEventListener('tema', redesenhar); };
  window.addEventListener('tema', redesenhar);
  await carregar();
}

function valorCard(c) {
  if (c.tipo === 'moeda') return fmt.money(c.valor);
  if (c.tipo === 'texto') return esc(c.valor);
  return Number(c.valor || 0).toLocaleString('pt-BR');
}

function desenhar(el, d) {
  graficos.splice(0).forEach((g) => g.destroy());
  const cards = d.cards.map((c) => {
    const html = `<div class="card kpi cor-${c.cor || 'primary'} h-100"><div class="card-body d-flex gap-3 align-items-start">
      <span class="icone"><i class="bi ${c.icone || 'bi-graph-up'}"></i></span>
      <div class="flex-grow-1 min-w-0"><div class="rotulo">${esc(c.label)}</div><div class="valor">${valorCard(c)}</div>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ''}</div>
      ${c.link ? '<i class="bi bi-arrow-up-right text-body-secondary"></i>' : ''}</div></div>`;
    return `<div>${c.link ? `<a class="kpi-link" href="${c.link}">${html}</a>` : html}</div>`;
  }).join('');
  const charts = d.graficos.map((g, i) => `<div class="col-12 col-xl-${d.graficos.length === 1 ? 12 : 6}"><div class="card h-100"><div class="card-header py-2">${esc(g.titulo)}</div>
    <div class="card-body"><div class="chart-box"><canvas id="g${i}"></canvas></div></div></div></div>`).join('');
  const tabelas = d.tabelas.map((t) => `<div class="col-12 col-xl-6"><div class="card h-100"><div class="card-header py-2">${esc(t.titulo)}</div>
    <div class="card-body p-0">${t.linhas.length ? `<table class="table table-sm mb-0"><thead><tr>${t.colunas.map((c, j) => `<th class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${t.linhas.map((l) => `<tr>${l.map((v, j) => `<td class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${t.tipos[j] === 'moeda' ? fmt.money(v) : t.tipos[j] === 'date' ? fmt.date(v) : t.tipos[j] === 'datetime' ? fmt.datetime(v) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Sem dados.</div>'}</div></div></div>`).join('');
  el.innerHTML = `<div class="kpis mb-3">${cards}</div><div class="row g-3 mb-3">${charts}</div><div class="row g-3">${tabelas}</div>`;
  const css = getComputedStyle(document.documentElement);
  const corTexto = css.getPropertyValue('--texto-2').trim();
  const corGrade = css.getPropertyValue('--borda').trim();
  const corAgro = css.getPropertyValue('--agro').trim();
  Chart.defaults.color = corTexto;
  Chart.defaults.font.family = css.getPropertyValue('--bs-body-font-family');
  CORES[0] = corAgro;
  d.graficos.forEach((g, i) => {
    const moeda = g.series.some((s) => /R\$/.test(s.nome));
    graficos.push(new Chart(el.querySelector(`#g${i}`), {
      type: g.tipo,
      data: {
        labels: g.labels,
        datasets: g.series.map((s, k) => ({
          label: s.nome, data: s.dados, tension: 0.3, fill: g.tipo === 'line',
          backgroundColor: g.tipo === 'doughnut' ? CORES : g.tipo === 'line' ? alfa(corAgro, 0.14) : CORES[k],
          borderColor: g.tipo === 'doughnut' ? css.getPropertyValue('--superficie').trim() : CORES[k], borderRadius: g.tipo === 'bar' ? 6 : 0, pointRadius: 3,
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: g.tipo === 'doughnut', position: 'right' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${moeda ? fmt.money(c.parsed.y ?? c.parsed) : (c.parsed.y ?? c.parsed).toLocaleString('pt-BR')}` } },
        },
        scales: g.tipo === 'doughnut' ? {} : { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: corGrade }, border: { display: false }, ticks: { callback: (v) => (moeda ? 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact' }) : v) } } },
      },
    }));
  });
}
