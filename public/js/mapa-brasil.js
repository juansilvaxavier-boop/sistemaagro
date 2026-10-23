// Mapa do Brasil com vendas por estado (cores) e por cidade (bolhas).
// Desenho dos estados: @svg-maps/brazil (CC BY 4.0). Coordenadas das cidades: municipios-brasil (IBGE).
import { get, esc, fmt, qs } from './core.js';

let desenho;
const carregarDesenho = async () => (desenho ||= (await import('/vendor/mapa-brasil/index.js')).default);

// Projeção de Mercator ajustada ao desenho (97,7% das cidades caem dentro do estado certo).
const merc = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
const projetar = (lat, lng) => [15.6122 * lng + 1155.4128, -15.5105 * merc(lat) + 82.1168];

// Escala sequencial (um tom, claro → escuro). No tema escuro, mais venda = mais claro.
const ESCALA = {
  light: ['#e4f2e6', '#bde2c3', '#88c994', '#4ea764', '#1f6f3a'],
  dark: ['#1f3326', '#24553a', '#2f7d48', '#4fb26b', '#93dca8'],
};
const tema = () => (document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'light');

/**
 * Monta o mapa em `el`. params: filtros do painel (de, ate, vendedores...).
 * Retorna { recarregar(params) }.
 */
export function mapaVendas(el, params = {}) {
  let atual = params;
  let modo = 'estados';
  let metrica = 'valor';
  let dados;
  el.innerHTML = `<div class="card mapa-card"><div class="card-header"><i class="bi bi-geo-alt"></i> Vendas pelo Brasil
      <div class="ms-auto d-flex gap-2 flex-wrap">
        <div class="painel-periodos" role="group" aria-label="Mostrar">
          <button type="button" class="ativo" data-modo="estados">Estados</button><button type="button" data-modo="cidades">Cidades</button></div>
        <div class="painel-periodos" role="group" aria-label="Medida">
          <button type="button" class="ativo" data-metrica="valor">Valor</button><button type="button" data-metrica="pedidos">Pedidos</button></div>
      </div></div>
    <div class="card-body"><div class="mapa-grade">
      <div class="mapa-area"><div class="mapa-svg" aria-busy="true"><span class="esqueleto" style="height:320px;max-width:none"></span></div><div class="mapa-dica" role="tooltip" hidden></div>
        <div class="mapa-legenda"></div></div>
      <div class="mapa-lado"><div class="mapa-total"></div><div class="mapa-ranking"></div></div>
    </div></div></div>`;
  const svgBox = el.querySelector('.mapa-svg');
  const dica = el.querySelector('.mapa-dica');

  const valorTxt = (x) => (metrica === 'valor' ? fmt.money(x.valor) : `${x.pedidos.toLocaleString('pt-BR')} pedido${x.pedidos === 1 ? '' : 's'}`);
  const detalhe = (x) => `${fmt.money(x.valor)} · ${x.pedidos.toLocaleString('pt-BR')} pedido(s) · ${x.clientes.toLocaleString('pt-BR')} cliente(s)`;

  async function desenhar() {
    const mapa = await carregarDesenho();
    const cores = ESCALA[tema()];
    const porUf = Object.fromEntries(dados.estados.map((e) => [e.uf, e]));
    const max = Math.max(0, ...dados.estados.map((e) => e[metrica]));
    // Classes por quintis do máximo (5 tons); zero fica neutro.
    const classe = (v) => (!v || !max ? -1 : Math.min(4, Math.floor((v / max) * 5 - 1e-9)));
    const estados = mapa.locations.map((l) => {
      const uf = l.id.toUpperCase();
      const e = porUf[uf];
      const c = classe(e?.[metrica]);
      return `<path d="${l.path}" class="mapa-uf ${modo === 'cidades' ? 'fundo' : ''}" data-uf="${uf}" tabindex="${modo === 'estados' ? 0 : -1}"
        style="fill:${c < 0 || modo === 'cidades' ? 'var(--mapa-vazio)' : cores[c]}" aria-label="${esc(l.name)}: ${e ? esc(detalhe(e)) : 'sem vendas'}"></path>`;
    }).join('');
    let bolhas = '';
    if (modo === 'cidades') {
      const comLocal = dados.cidades.filter((c) => c.lat != null && c[metrica] > 0);
      const maxC = Math.max(1, ...comLocal.map((c) => c[metrica]));
      // Área proporcional ao valor; maiores desenhadas primeiro para as menores ficarem por cima.
      bolhas = comLocal.sort((a, b) => b[metrica] - a[metrica]).map((c, i) => {
        const [x, y] = projetar(c.lat, c.lng);
        const raio = Math.max(3, Math.sqrt(c[metrica] / maxC) * 22);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${raio.toFixed(1)}" class="mapa-cidade" data-i="${i}" tabindex="0"
          aria-label="${esc(c.cidade)}/${c.uf}: ${esc(detalhe(c))}"></circle>`;
      }).join('');
      svgBox.dataset.cidades = JSON.stringify(comLocal.map((c) => [c.cidade, c.uf, c.valor, c.pedidos, c.clientes]));
    }
    svgBox.removeAttribute('aria-busy');
    svgBox.innerHTML = `<svg viewBox="${mapa.viewBox}" role="img" aria-label="Mapa de vendas por ${modo === 'estados' ? 'estado' : 'cidade'}">${estados}<g>${bolhas}</g></svg>`;

    // Legenda e ranking
    const leg = el.querySelector('.mapa-legenda');
    if (modo === 'estados') {
      leg.innerHTML = `<span class="text-muted">${metrica === 'valor' ? 'Valor vendido' : 'Pedidos'}</span>
        <span class="mapa-escala">${cores.map((cor, i) => `<i style="background:${cor}" title="${i * 20}–${(i + 1) * 20}% do maior"></i>`).join('')}</span>
        <span class="text-muted small">menos → mais</span> <span class="mapa-sem"><i></i> sem vendas</span>`;
    } else {
      leg.innerHTML = `<span class="text-muted">Tamanho da bolha = ${metrica === 'valor' ? 'valor vendido' : 'nº de pedidos'} na cidade</span>`;
    }
    const lista = modo === 'estados' ? dados.estados : dados.cidades;
    el.querySelector('.mapa-total').innerHTML = `<div class="rotulo">Total no período</div><div class="valor">${fmt.money(dados.total.valor)}</div>
      <div class="sub">${dados.total.pedidos.toLocaleString('pt-BR')} pedidos · ${dados.estados.length} estado(s) · ${dados.cidades.length} cidade(s)</div>
      ${dados.sem_localizacao.pedidos ? `<div class="sub text-warning-emphasis">${dados.sem_localizacao.pedidos} pedido(s) sem endereço com UF</div>` : ''}`;
    el.querySelector('.mapa-ranking').innerHTML = lista.length ? `<table class="table table-sm mb-0"><thead><tr><th>#</th><th>${modo === 'estados' ? 'Estado' : 'Cidade'}</th><th class="num">${metrica === 'valor' ? 'Valor' : 'Pedidos'}</th><th class="num">%</th></tr></thead>
      <tbody>${lista.slice(0, 12).map((x, i) => `<tr data-uf="${x.uf}"><td class="text-muted">${i + 1}</td><td>${modo === 'estados' ? x.uf : `${esc(x.cidade)}<small class="text-muted">/${x.uf}</small>`}</td>
        <td class="num">${metrica === 'valor' ? fmt.money(x.valor) : x.pedidos.toLocaleString('pt-BR')}</td>
        <td class="num text-muted">${dados.total[metrica] ? fmt.pct((x[metrica] / dados.total[metrica]) * 100) : '-'}</td></tr>`).join('')}</tbody></table>
      ${lista.length > 12 ? `<div class="small text-muted mt-1">+ ${lista.length - 12} ${modo === 'estados' ? 'estados' : 'cidades'}</div>` : ''}`
      : '<div class="vazio py-4"><i class="bi bi-geo"></i>Nenhuma venda no período.</div>';
    ligarDicas();
  }

  function ligarDicas() {
    const svg = svgBox.querySelector('svg');
    const cidades = JSON.parse(svgBox.dataset.cidades || '[]');
    const porUf = Object.fromEntries(dados.estados.map((e) => [e.uf, e]));
    const mostrar = (alvo, ev) => {
      let html = '';
      if (alvo.classList.contains('mapa-cidade')) {
        const [cidade, uf, valor, pedidos, clientes] = cidades[alvo.dataset.i];
        html = `<b>${esc(cidade)}/${uf}</b><div>${fmt.money(valor)}</div><small>${pedidos} pedido(s) · ${clientes} cliente(s)</small>`;
      } else if (alvo.dataset.uf && modo === 'estados') {
        const e = porUf[alvo.dataset.uf];
        html = `<b>${alvo.dataset.uf}</b>${e ? `<div>${fmt.money(e.valor)}</div><small>${e.pedidos} pedido(s) · ${e.clientes} cliente(s)</small>` : '<div class="text-muted">Sem vendas</div>'}`;
      } else return esconder();
      dica.innerHTML = html;
      dica.hidden = false;
      const box = svgBox.getBoundingClientRect();
      const r = alvo.getBoundingClientRect();
      const x = ev?.clientX ?? r.left + r.width / 2;
      const y = ev?.clientY ?? r.top;
      dica.style.left = `${Math.min(box.width - 160, Math.max(0, x - box.left + 12))}px`;
      dica.style.top = `${Math.max(0, y - box.top - 10)}px`;
      svg.querySelectorAll('.destaque').forEach((n) => n.classList.remove('destaque'));
      alvo.classList.add('destaque');
    };
    const esconder = () => { dica.hidden = true; svg.querySelectorAll('.destaque').forEach((n) => n.classList.remove('destaque')); };
    svg.addEventListener('mousemove', (e) => { const a = e.target.closest('.mapa-uf, .mapa-cidade'); a ? mostrar(a, e) : esconder(); });
    svg.addEventListener('mouseleave', esconder);
    svg.addEventListener('focusin', (e) => mostrar(e.target));
    svg.addEventListener('focusout', esconder);
  }

  async function carregar() {
    svgBox.setAttribute('aria-busy', 'true');
    try {
      dados = await get(`/api/dashboard/mapa${qs({ ...atual, metrica })}`);
      await desenhar();
    } catch (e) {
      svgBox.innerHTML = `<div class="vazio text-danger">${esc(e.message)}</div>`;
    }
  }
  el.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    modo = b.dataset.modo;
    el.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('ativo', x === b));
    if (dados) desenhar();
  }));
  el.querySelectorAll('[data-metrica]').forEach((b) => b.addEventListener('click', () => {
    metrica = b.dataset.metrica;
    el.querySelectorAll('[data-metrica]').forEach((x) => x.classList.toggle('ativo', x === b));
    carregar();
  }));
  const aoTema = () => { if (document.body.contains(el)) { if (dados) desenhar(); } else window.removeEventListener('tema', aoTema); };
  window.addEventListener('tema', aoTema);
  carregar();
  return { recarregar: (p) => { atual = p; carregar(); } };
}
