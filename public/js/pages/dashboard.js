import { get, esc, fmt, state, titulo, qs, periodoAtalho } from '../core.js';

const graficos = [];
let ultimo;
const alfa = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const CORES = ['#2e7d32', '#1976d2', '#f9a825', '#c62828', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#546e7a', '#9e9d24', '#ad1457'];

export default async function (conteudo) {
  const corpo = titulo(conteudo, 'Painel', 'bi-speedometer2', '<select class="form-select form-select-sm d-none" id="sel-perfil" style="width:auto"></select>');
  corpo.innerHTML = '<div class="painel-filtro card mb-3" id="painel-filtro"></div><div id="painel-dados"></div>';
  const pagina = corpo.querySelector('#painel-dados');
  const caixaFiltro = corpo.querySelector('#painel-filtro');
  const sel = conteudo.querySelector('#sel-perfil');
  let cabecalho = conteudo.querySelector('.page-title h2');
  let filtro = lerFiltro();
  let perfilAtual;
  const carregar = async (perfil = perfilAtual) => {
    perfilAtual = perfil;
    pagina.classList.add('carregando');
    const d = await get('/api/dashboard' + qs({ perfil, ...paraQuery(filtro) })).finally(() => pagina.classList.remove('carregando'));
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
    desenharFiltro(caixaFiltro, filtro, d.filtro, (novo) => { filtro = novo; guardarFiltro(filtro); carregar(); });
    desenhar(pagina, d);
  };
  sel.addEventListener('change', () => carregar(sel.value));
  const redesenhar = () => { if (document.body.contains(pagina) && ultimo) desenhar(pagina, ultimo); else window.removeEventListener('tema', redesenhar); };
  window.addEventListener('tema', redesenhar);
  await carregar();
}

// ---------- Filtro do painel ----------
const PERIODOS = [['mes', 'Este mês'], ['mes_ant', 'Mês passado'], ['30d', '30 dias'], ['90d', '90 dias'], ['ano', 'Este ano']];
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const CHAVE = 'agt-painel-filtro';

function lerFiltro() {
  try { return { atalho: 'mes', vendedores: [], equipes: [], formas: [], ufs: [], ...JSON.parse(sessionStorage.getItem(CHAVE) || '{}') }; } catch { return { atalho: 'mes', vendedores: [], equipes: [], formas: [], ufs: [] }; }
}
function guardarFiltro(f) { try { sessionStorage.setItem(CHAVE, JSON.stringify(f)); } catch { /* sem armazenamento */ } }
function paraQuery(f) {
  const [de, ate] = f.atalho && f.atalho !== 'personalizado' ? periodoAtalho(f.atalho) : [f.de, f.ate];
  return { de, ate, vendedores: f.vendedores.join(','), equipes: f.equipes.join(','), formas: f.formas.join(','), ufs: f.ufs.join(',') };
}

function desenharFiltro(el, f, servidor, aplicar) {
  const op = state.opcoes;
  const grupos = [
    ...(op.vendedores.length > 1 ? [['vendedores', 'Vendedor', op.vendedores.map((v) => [v.id, v.nome])]] : []),
    ...(op.vendedores.length > 1 && op.equipes.length > 1 ? [['equipes', 'Equipe', op.equipes.map((e) => [e.id, e.nome])]] : []),
    ['formas', 'Forma de pagamento', op.formas.map((x) => [x.id, x.nome])],
    ['ufs', 'UF de entrega', UFS.map((u) => [u, u])],
  ];
  const recortes = servidor.recortes;
  const qtd = recortes ? grupos.reduce((a, [k]) => a + (f[k].length ? 1 : 0), 0) : 0;
  const nomes = (k, l) => f[k].map((v) => l.find(([ov]) => String(ov) === String(v))?.[1] || v);
  el.innerHTML = `<div class="card-body">
    <div class="painel-filtro-linha">
      <span class="painel-filtro-rot"><i class="bi bi-calendar3"></i> Período</span>
      <div class="painel-periodos" role="group" aria-label="Período">${PERIODOS.map(([id, l]) => `<button type="button" class="${f.atalho === id ? 'ativo' : ''}" data-periodo="${id}">${l}</button>`).join('')}
        <button type="button" class="${f.atalho === 'personalizado' ? 'ativo' : ''}" data-periodo="personalizado">Personalizado</button></div>
      <div class="painel-datas ${f.atalho === 'personalizado' ? '' : 'd-none'}">
        <input type="date" class="form-control form-control-sm" data-de value="${esc(servidor.de)}" aria-label="De">
        <span class="text-muted small">até</span>
        <input type="date" class="form-control form-control-sm" data-ate value="${esc(servidor.ate)}" aria-label="Até">
        <button type="button" class="btn btn-sm btn-success" data-aplicar-datas>Aplicar</button>
      </div>
      <span class="painel-intervalo text-muted small">${fmt.date(servidor.de)} a ${fmt.date(servidor.ate)}</span>
      ${recortes ? `<button type="button" class="btn btn-sm btn-outline-secondary ms-auto" data-mais aria-expanded="false"><i class="bi bi-sliders"></i> Mais filtros${qtd ? ` <span class="dt-qtd">${qtd}</span>` : ''}</button>` : ''}
    </div>
    ${recortes ? `<div class="painel-recortes d-none">
      ${grupos.map(([k, l, lista]) => `<div class="dt-campo"><label class="form-label">${l}</label>
        <div class="dropdown dt-multi"><button type="button" class="form-select form-select-sm text-start text-truncate" data-bs-toggle="dropdown" data-bs-auto-close="outside">${f[k].length ? esc(nomes(k, lista).join(', ')) : 'Todos'}</button>
        <div class="dropdown-menu dt-multi-menu">${lista.map(([v, n]) => `<label class="dropdown-item"><input type="checkbox" class="form-check-input m-0" data-g="${k}" value="${esc(v)}" ${f[k].map(String).includes(String(v)) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div></div></div>`).join('')}
      <div class="d-flex gap-2 align-items-end"><button type="button" class="btn btn-sm btn-outline-secondary" data-limpar><i class="bi bi-x-lg"></i> Limpar</button><button type="button" class="btn btn-sm btn-success" data-aplicar><i class="bi bi-check2"></i> Aplicar</button></div>
    </div>
    ${qtd ? `<div class="dt-chips mt-2">${grupos.filter(([k]) => f[k].length).map(([k, l, lista]) => `<span class="dt-chip">${l}: <b>${esc(nomes(k, lista).length > 2 ? `${f[k].length} selecionados` : nomes(k, lista).join(', '))}</b><button type="button" data-tirar="${k}" aria-label="Remover filtro ${l}"><i class="bi bi-x"></i></button></span>`).join('')}</div>` : ''}` : ''}
    <div class="painel-nota">O período vale para vendas, faturamento, recebimentos e decisões. Filas e saldos mostram a situação de hoje${recortes ? ', com os recortes escolhidos' : ''}.</div>
  </div>`;
  el.querySelectorAll('[data-periodo]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.periodo === 'personalizado') {
      el.querySelectorAll('[data-periodo]').forEach((x) => x.classList.toggle('ativo', x === b));
      el.querySelector('.painel-datas').classList.remove('d-none');
      el.querySelector('[data-de]').focus();
      return;
    }
    aplicar({ ...f, atalho: b.dataset.periodo });
  }));
  el.querySelector('[data-aplicar-datas]').addEventListener('click', () => {
    const de = el.querySelector('[data-de]').value;
    const ate = el.querySelector('[data-ate]').value;
    if (de && ate) aplicar({ ...f, atalho: 'personalizado', de, ate });
  });
  if (!recortes) return;
  const caixa = el.querySelector('.painel-recortes');
  el.querySelector('[data-mais]').addEventListener('click', (e) => {
    caixa.classList.toggle('d-none');
    e.currentTarget.setAttribute('aria-expanded', !caixa.classList.contains('d-none'));
  });
  el.querySelectorAll('[data-g]').forEach((cb) => cb.addEventListener('change', () => {
    const menu = cb.closest('.dt-multi');
    const marcados = [...menu.querySelectorAll('[data-g]:checked')].map((x) => x.parentElement.textContent.trim());
    menu.querySelector('[data-bs-toggle]').textContent = marcados.length ? marcados.join(', ') : 'Todos';
  }));
  const ler = () => Object.fromEntries(grupos.map(([k]) => [k, [...el.querySelectorAll(`[data-g="${k}"]:checked`)].map((x) => (k === 'ufs' ? x.value : Number(x.value)))]));
  el.querySelector('[data-aplicar]').addEventListener('click', () => aplicar({ ...f, ...ler() }));
  el.querySelector('[data-limpar]').addEventListener('click', () => aplicar({ ...f, vendedores: [], equipes: [], formas: [], ufs: [] }));
  el.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () => aplicar({ ...f, [b.dataset.tirar]: [] })));
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
