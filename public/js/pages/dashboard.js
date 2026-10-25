import { get, esc, fmt, state, titulo, qs, periodoAtalho, pode, kpi, estiloGraficos, coresGrafico } from '../core.js';
import { mapaVendas } from '../mapa-brasil.js';

const graficos = [];
let ultimo;
const alfa = (cor, a) => {
  if (!cor.startsWith('#')) return cor;
  const n = parseInt(cor.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

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

/** Rosca com a legenda em tabela ao lado: nome, valor e % de cada fatia (leitura direta, sem depender só da cor). */
function roscaHtml(g, i) {
  const dados = g.series[0].dados.map(Number);
  const total = dados.reduce((a, x) => a + (x || 0), 0);
  const moeda = g.series.some((s) => /R\$/.test(s.nome));
  const cores = coresGrafico();
  return `<div class="rosca"><div class="rosca-grafico"><canvas id="g${i}" role="img" aria-label="${esc(g.titulo)}"></canvas>
      <div class="rosca-total"><small>Total</small><b>${moeda ? fmt.money(total) : total.toLocaleString('pt-BR')}</b></div></div>
    <table class="table table-sm rosca-legenda mb-0"><tbody>${g.labels.map((l, k) => `<tr><td><span class="ponto" style="background:${cores[k % cores.length]}"></span>${esc(l)}</td>
      <td class="num">${moeda ? fmt.money(dados[k]) : (dados[k] || 0).toLocaleString('pt-BR')}</td><td class="num text-body-secondary">${total ? ((dados[k] / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}%</td></tr>`).join('')}</tbody></table></div>`;
}

function desenhar(el, d) {
  graficos.splice(0).forEach((g) => g.destroy());
  const cards = d.cards.map((c) => kpi(c.label, valorCard(c), { icone: c.icone || 'bi-graph-up', cor: c.cor || 'primary', sub: c.sub ? esc(c.sub) : '', link: c.link, comparacao: c.comparacao, moeda: c.tipo === 'moeda' })).join('');
  // Com número ímpar de gráficos, o último ocupa a linha inteira (sem buraco na grade).
  const vazioG = (g) => !g.series.some((s) => s.dados.some((x) => Number(x)));
  const charts = d.graficos.map((g, i) => `<div class="col-12 col-xl-${d.graficos.length === 1 || (d.graficos.length % 2 && i === d.graficos.length - 1) ? 12 : 6}"><div class="card h-100"><div class="card-header">${esc(g.titulo)}</div>
    <div class="card-body">${vazioG(g) ? '<div class="chart-box"><div class="grafico-vazio vazio"><i class="bi bi-bar-chart"></i><b>Sem movimento no período</b>Mude o período ou os filtros para comparar.</div></div>'
      : g.tipo === 'doughnut' ? roscaHtml(g, i) : `<div class="chart-box"><canvas id="g${i}" role="img" aria-label="${esc(g.titulo)}"></canvas></div>`}</div></div></div>`).join('');
  const tabelas = d.tabelas.map((t) => `<div class="col-12 col-xl-6"><div class="card h-100"><div class="card-header py-2">${esc(t.titulo)}</div>
    <div class="card-body p-0">${t.linhas.length ? `<table class="table table-sm mb-0"><thead><tr>${t.colunas.map((c, j) => `<th class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${t.linhas.map((l) => `<tr>${l.map((v, j) => `<td class="${t.tipos[j] === 'moeda' ? 'num' : ''}">${t.tipos[j] === 'moeda' ? fmt.money(v) : t.tipos[j] === 'date' ? fmt.date(v) : t.tipos[j] === 'datetime' ? fmt.datetime(v) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<div class="vazio"><i class="bi bi-inbox"></i><b>Sem dados no período</b></div>'}</div></div></div>`).join('');
  // Mesma regra do servidor: o mapa de vendas é para quem acompanha vendas ou recebimentos.
  const comMapa = d.filtro?.recortes && !['producao', 'expedicao', 'rh'].includes(d.perfil)
    && ['fila.venda', 'relatorios.vendas', 'dashboard.todos', 'financeiro.parcelas'].some((p) => pode(p));
  el.innerHTML = `<div class="kpis mb-3">${cards}</div><div class="row g-3 mb-3">${charts}</div>${comMapa ? '<div class="mb-3" id="mapa-vendas"></div>' : ''}<div class="row g-3">${tabelas}</div>`;
  if (comMapa) mapaVendas(el.querySelector('#mapa-vendas'), paraQuery(lerFiltro()));
  const est = estiloGraficos();
  const CORES = est.cores;
  d.graficos.forEach((g, i) => {
    const canvas = el.querySelector(`#g${i}`);
    if (!canvas) return;
    const moeda = g.series.some((s) => /R\$/.test(s.nome));
    const rosca = g.tipo === 'doughnut';
    // Categorias com nome (etapas, vendedores) ficam na horizontal: rótulos legíveis, sem texto inclinado.
    const deitado = g.tipo === 'bar' && g.labels.length > 5 && !g.labels.every((l) => /^\d{2}\/\d{2,4}/.test(l));
    const valorFmt = (v) => (moeda ? fmt.money(v) : Number(v).toLocaleString('pt-BR'));
    const total = rosca ? g.series[0].dados.reduce((a, x) => a + Number(x || 0), 0) : 0;
    graficos.push(new Chart(canvas, {
      type: g.tipo,
      data: {
        labels: g.labels,
        datasets: g.series.map((s, k) => ({
          label: s.nome.replace(/\s*\(R\$\)\s*$/, '').replace(/^R\$$/, 'Valor'), data: s.dados, fill: g.tipo === 'line' ? 'origin' : false,
          backgroundColor: rosca ? CORES : g.tipo === 'line' ? alfa(CORES[k], 0.1) : CORES[k],
          borderColor: rosca ? est.superficie : CORES[k], pointBackgroundColor: CORES[k],
        })),
      },
      options: {
        maintainAspectRatio: false,
        indexAxis: deitado ? 'y' : 'x',
        cutout: rosca ? '68%' : undefined,
        plugins: {
          legend: { display: !rosca && g.series.length > 1, position: 'top', align: 'end' },
          tooltip: { callbacks: { label: (c) => {
            const v = rosca ? c.parsed : (deitado ? c.parsed.x : c.parsed.y);
            return ` ${rosca ? c.label : c.dataset.label}: ${valorFmt(v)}${rosca && total ? ` (${((v / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}`;
          } } },
        },
        scales: rosca ? {} : {
          [deitado ? 'y' : 'x']: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: !deitado, maxRotation: 0 } },
          [deitado ? 'x' : 'y']: { beginAtZero: true, grid: { color: est.grade }, border: { display: false }, ticks: { maxTicksLimit: 6, callback: (v) => (moeda ? 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact' }) : Number(v).toLocaleString('pt-BR')) } },
        },
      },
    }));
  });
}
