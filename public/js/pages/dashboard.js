import { get, esc, fmt, state, titulo, qs } from '../core.js';

const graficos = [];
const CORES = ['#2e7d32', '#1976d2', '#f9a825', '#c62828', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#546e7a', '#9e9d24', '#ad1457'];

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Painel', 'bi-speedometer2', '<select class="form-select form-select-sm d-none" id="sel-perfil" style="width:auto"></select>');
  const sel = conteudo.querySelector('#sel-perfil');
  const carregar = async (perfil) => {
    const d = await get('/api/dashboard' + qs({ perfil }));
    conteudo.querySelector('.page-title h2').innerHTML = `<i class="bi bi-speedometer2 text-agro"></i> ${esc(d.titulo)}`;
    if (d.perfis_disponiveis.length > 1) {
      sel.classList.remove('d-none');
      sel.innerHTML = d.perfis_disponiveis.map((p) => `<option value="${p}" ${p === d.perfil ? 'selected' : ''}>Painel ${esc(state.me.perfis[p])}</option>`).join('');
    }
    desenhar(pagina, d);
  };
  sel.addEventListener('change', () => carregar(sel.value));
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
    const html = `<div class="card kpi cor-${c.cor || 'primary'} h-100"><div class="card-body d-flex align-items-center py-2">
      <div class="flex-grow-1"><div class="text-muted small">${esc(c.label)}</div><div class="valor">${valorCard(c)}</div>${c.sub ? `<div class="small text-muted">${esc(c.sub)}</div>` : ''}</div>
      <i class="bi ${c.icone || 'bi-graph-up'} icone text-${c.cor || 'primary'}"></i></div></div>`;
    return `<div class="col-12 col-sm-6 col-xl">${c.link ? `<a class="kpi-link" href="${c.link}">${html}</a>` : html}</div>`;
  }).join('');
  const charts = d.graficos.map((g, i) => `<div class="col-12 col-xl-${d.graficos.length === 1 ? 12 : 6}"><div class="card h-100"><div class="card-header py-2">${esc(g.titulo)}</div>
    <div class="card-body"><div class="chart-box"><canvas id="g${i}"></canvas></div></div></div></div>`).join('');
  const tabelas = d.tabelas.map((t) => `<div class="col-12 col-xl-6"><div class="card h-100"><div class="card-header py-2">${esc(t.titulo)}</div>
    <div class="card-body p-0">${t.linhas.length ? `<table class="table table-sm mb-0"><thead><tr>${t.colunas.map((c, j) => `<th class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${t.linhas.map((l) => `<tr>${l.map((v, j) => `<td class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${t.tipos[j] === 'moeda' ? fmt.money(v) : t.tipos[j] === 'date' ? fmt.date(v) : t.tipos[j] === 'datetime' ? fmt.datetime(v) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Sem dados.</div>'}</div></div></div>`).join('');
  el.innerHTML = `<div class="row g-3 mb-3">${cards}</div><div class="row g-3 mb-3">${charts}</div><div class="row g-3">${tabelas}</div>`;
  d.graficos.forEach((g, i) => {
    const moeda = g.series.some((s) => /R\$/.test(s.nome));
    graficos.push(new Chart(el.querySelector(`#g${i}`), {
      type: g.tipo,
      data: {
        labels: g.labels,
        datasets: g.series.map((s, k) => ({
          label: s.nome, data: s.dados, tension: 0.3, fill: g.tipo === 'line',
          backgroundColor: g.tipo === 'doughnut' ? CORES : g.tipo === 'line' ? 'rgba(46,125,50,.12)' : CORES[k],
          borderColor: g.tipo === 'doughnut' ? '#fff' : CORES[k],
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: g.tipo === 'doughnut', position: 'right' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${moeda ? fmt.money(c.parsed.y ?? c.parsed) : (c.parsed.y ?? c.parsed).toLocaleString('pt-BR')}` } },
        },
        scales: g.tipo === 'doughnut' ? {} : { y: { beginAtZero: true, ticks: { callback: (v) => (moeda ? 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact' }) : v) } } },
      },
    }));
  });
}
