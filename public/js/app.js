import { state, get, post, esc, toast, pode, erro } from './core.js';

const MENU = [
  { grupo: 'Início', itens: [{ href: '#/dashboard', l: 'Painel', i: 'bi-speedometer2', p: 'dashboard' }] },
  {
    grupo: 'Vendas', itens: [
      { href: '#/fila/venda', l: 'Vendedor', i: 'bi-cart', p: 'fila.venda', etapa: 'venda' },
      { href: '#/fila/supervisao', l: 'Supervisor', i: 'bi-person-check', p: 'fila.supervisao', etapa: 'supervisao' },
      { href: '#/fila/analise', l: 'Análise', i: 'bi-search', p: 'fila.analise', etapa: 'analise' },
      { href: '#/fila/diretoria', l: 'Diretoria', i: 'bi-award', p: 'fila.diretoria', etapa: 'diretoria' },
      { href: '#/fila/cobranca', l: 'Cobrança (à vista)', i: 'bi-cash-coin', p: 'fila.cobranca', etapa: 'cobranca' },
      { href: '#/fila/producao', l: 'Produção', i: 'bi-gear', p: 'fila.producao', etapa: 'producao' },
      { href: '#/fila/expedicao', l: 'Expedição', i: 'bi-box-seam', p: 'fila.expedicao', etapa: 'expedicao' },
      { href: '#/fila/transito', l: 'Expedição – Trânsito', i: 'bi-truck', p: 'fila.transito', etapa: 'transito' },
      { href: '#/fila/devolucao', l: 'Devolução', i: 'bi-arrow-return-left', p: 'fila.devolucao', etapa: 'devolucao' },
      { href: '#/clientes', l: 'Clientes', i: 'bi-people', p: 'clientes' },
      { href: '#/historico-compra', l: 'Histórico de Compra de Cliente', i: 'bi-clock-history', p: 'clientes.historico' },
      { href: '#/blacklist', l: 'Cliente (Blacklist)', i: 'bi-shield-x', p: 'blacklist' },
    ],
  },
  {
    grupo: 'Faturamento', itens: [
      { href: '#/fila/faturamento', l: 'Faturamento', i: 'bi-receipt', p: 'fila.faturamento', etapa: 'faturamento' },
      { href: '#/financeiro/notas', l: 'Nota Fiscal de Saída', i: 'bi-file-earmark-text', p: 'financeiro.notas' },
    ],
  },
  {
    grupo: 'Relacionamento', itens: [
      { href: '#/crm', l: 'CRM', i: 'bi-diagram-3', p: 'crm' },
      { href: '#/cobranca', l: 'Cobrança', i: 'bi-telephone-outbound', p: 'cobranca' },
      { href: '#/arquivos', l: 'Arquivos e Documentos', i: 'bi-folder2-open', p: 'arquivos' },
      { href: '#/mensagens', l: 'Mensagens', i: 'bi-chat-dots', p: 'dashboard' },
    ],
  },
  {
    grupo: 'Financeiro', itens: [
      { href: '#/financeiro/parcelas', l: 'Gestão de Parcelas', i: 'bi-list-check', p: 'financeiro.parcelas' },
      { href: '#/financeiro/lancamentos', l: 'Lançar Descontos/Créditos', i: 'bi-plus-slash-minus', p: 'financeiro.lancamentos' },
      { href: '#/financeiro/comissoes', l: 'Revisar Comissões', i: 'bi-percent', p: 'financeiro.comissoes' },
      { href: '#/financeiro/devolucoes', l: 'Lançar Desconto Devolução', i: 'bi-arrow-counterclockwise', p: 'financeiro.devolucoes' },
      { href: '#/financeiro/negativados', l: 'Clientes Negativados', i: 'bi-person-x', p: 'financeiro.negativados' },
    ],
  },
  {
    grupo: 'Registro', itens: [
      { href: '#/cadastros/produtos', l: 'Produto', i: 'bi-box', p: 'cadastros.produto' },
      { href: '#/cadastros/formas', l: 'Forma de Pagamento', i: 'bi-credit-card', p: 'cadastros.forma' },
      { href: '#/cadastros/transportadoras', l: 'Transportadoras', i: 'bi-truck-front', p: 'cadastros.transportadora' },
      { href: '#/cadastros/usuarios', l: 'Usuários', i: 'bi-person-gear', p: 'cadastros.usuario' },
      { href: '#/cadastros/equipes', l: 'Equipes', i: 'bi-people-fill', p: 'cadastros.usuario' },
      { href: '#/cadastros/empresas', l: 'Empresas', i: 'bi-building', p: 'cadastros.empresa' },
      { href: '#/senha', l: 'Alterar Minha Senha', i: 'bi-key' },
    ],
  },
  { grupo: 'Relatórios', itens: [{ href: '#/relatorios', l: 'Relatórios', i: 'bi-bar-chart-line', p: 'relatorios' }] },
];

const ROTAS = [
  [/^#\/dashboard$/, () => import('./pages/dashboard.js')],
  [/^#\/fila\/(\w+)$/, () => import('./pages/filas.js')],
  [/^#\/pedido\/novo$/, () => import('./pages/pedido-form.js')],
  [/^#\/pedido\/(\d+)\/editar$/, () => import('./pages/pedido-form.js')],
  [/^#\/clientes$/, () => import('./pages/clientes.js'), 'lista'],
  [/^#\/historico-compra$/, () => import('./pages/clientes.js'), 'historico'],
  [/^#\/blacklist$/, () => import('./pages/clientes.js'), 'blacklist'],
  [/^#\/crm$/, () => import('./pages/crm.js')],
  [/^#\/crm\/cliente\/(\d+)$/, () => import('./pages/crm.js'), 'cliente'],
  [/^#\/cobranca$/, () => import('./pages/cobranca.js')],
  [/^#\/cobranca\/cliente\/(\d+)$/, () => import('./pages/cobranca.js'), 'cliente'],
  [/^#\/arquivos$/, () => import('./pages/arquivos.js')],
  [/^#\/mensagens$/, () => import('./pages/mensagens.js')],
  [/^#\/financeiro\/(\w+)$/, () => import('./pages/financeiro.js')],
  [/^#\/cadastros\/(\w+)$/, () => import('./pages/cadastros.js')],
  [/^#\/senha$/, () => import('./pages/cadastros.js'), 'senha'],
  [/^#\/relatorios$/, () => import('./pages/relatorios.js')],
  [/^#\/relatorios\/([\w-]+)$/, () => import('./pages/relatorios.js')],
];

const $ = (s) => document.querySelector(s);

// ---------- Login ----------
async function iniciar() {
  try {
    state.me = await get('/api/auth/me');
  } catch {
    return mostrarLogin();
  }
  if (!state.me.empresa) return escolherEmpresa(state.me.empresas);
  await abrirApp();
}

function mostrarLogin() {
  $('#app').classList.add('d-none');
  $('#tela-login').classList.remove('d-none');
  $('#form-login').classList.remove('d-none');
  $('#form-empresa').classList.add('d-none');
}

function escolherEmpresa(empresas) {
  $('#tela-login').classList.remove('d-none');
  $('#app').classList.add('d-none');
  $('#form-login').classList.add('d-none');
  $('#form-empresa').classList.remove('d-none');
  $('#lista-empresas').innerHTML = empresas.map((e) => `<button type="button" class="list-group-item list-group-item-action" data-id="${e.id}"><i class="bi bi-building"></i> ${esc(e.nome)}</button>`).join('');
  $('#lista-empresas').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    try {
      await post('/api/auth/empresa', { empresa_id: Number(b.dataset.id) });
      state.me = await get('/api/auth/me');
      await abrirApp();
    } catch (e) { erro(e); }
  }));
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const box = $('#login-erro');
  box.classList.add('d-none');
  try {
    const r = await post('/api/auth/login', { login: f.get('login'), senha: f.get('senha') });
    if (!r.empresaEscolhida) return escolherEmpresa(r.empresas);
    state.me = await get('/api/auth/me');
    await abrirApp();
  } catch (e) {
    box.textContent = e.message;
    box.classList.remove('d-none');
  }
});

$('#btn-sair').addEventListener('click', async (e) => {
  e.preventDefault();
  await post('/api/auth/logout').catch(() => {});
  location.hash = '';
  location.reload();
});
$('#btn-empresa').addEventListener('click', () => {
  if (state.me.empresas.length > 1) escolherEmpresa(state.me.empresas);
  else toast('Seu usuário tem acesso a apenas uma empresa.', 'info');
});
$('#btn-mensagens').addEventListener('click', () => { location.hash = '#/mensagens'; });
$('#btn-menu').addEventListener('click', () => $('#sidebar').classList.toggle('aberto'));
window.addEventListener('sessao-expirada', () => { if (state.me) { state.me = null; toast('Sessão expirada. Entre novamente.', 'warning'); mostrarLogin(); } });

// ---------- App ----------
async function abrirApp() {
  $('#tela-login').classList.add('d-none');
  $('#app').classList.remove('d-none');
  const u = state.me.usuario;
  $('#user-nome').textContent = u.nome;
  $('#user-perfil').textContent = u.perfil_label;
  $('#user-avatar').textContent = u.nome.split(' ').map((p) => p[0]).slice(0, 2).join('');
  $('#empresa-nome').textContent = state.me.empresa.nome;
  state.opcoes = await get('/api/cadastros/opcoes');
  montarMenu();
  conectarEventos();
  atualizarContadores();
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  else rotear();
}

function montarMenu() {
  $('#menu').innerHTML = MENU.map((g) => {
    const itens = g.itens.filter((i) => !i.p || pode(i.p));
    if (!itens.length) return '';
    return `<div class="grupo">${g.grupo}</div>` + itens.map((i) =>
      `<a href="${i.href}"><i class="bi ${i.i}"></i> <span>${i.l}</span>${i.etapa ? `<span class="badge rounded-pill text-bg-secondary d-none" data-cont="${i.etapa}"></span>` : ''}</a>`).join('');
  }).join('');
}

export async function atualizarContadores() {
  try {
    const c = await get('/api/pedidos/contagem');
    document.querySelectorAll('[data-cont]').forEach((b) => {
      const n = c[b.dataset.cont] || 0;
      b.textContent = n.toLocaleString('pt-BR');
      b.classList.toggle('d-none', !n);
    });
    const m = await get('/api/mensagens/nao-lidas');
    $('#badge-msg').textContent = m.n;
    $('#badge-msg').classList.toggle('d-none', !m.n);
  } catch { /* silencioso */ }
}
window.atualizarContadores = atualizarContadores;

let fonte;
function conectarEventos() {
  fonte?.close();
  fonte = new EventSource('/api/auth/eventos');
  fonte.addEventListener('pedido', (e) => {
    const d = JSON.parse(e.data);
    toast(`Pedido ${d.numero} → ${d.etapa_label} (${d.acao} por ${d.por})`, 'info', 'Fila atualizada');
    atualizarContadores();
    window.dispatchEvent(new CustomEvent('pedido-atualizado', { detail: d }));
  });
  fonte.addEventListener('mensagem', (e) => {
    const d = JSON.parse(e.data);
    toast(`${d.remetente}${d.pedido_numero ? ' · Pedido ' + d.pedido_numero : ''}: ${d.texto.slice(0, 120)}`, 'primary', 'Nova mensagem');
    atualizarContadores();
    window.dispatchEvent(new CustomEvent('nova-mensagem', { detail: d }));
  });
}

async function rotear() {
  if (!state.me?.empresa) return;
  const hash = (location.hash || '#/dashboard').split('?')[0];
  $('#sidebar').classList.remove('aberto');
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', hash === a.getAttribute('href') || (hash.startsWith(a.getAttribute('href') + '/') && a.getAttribute('href') !== '#/')));
  const ativo = document.querySelector('#menu a.ativo span');
  $('#breadcrumb').textContent = ativo?.textContent || '';
  const conteudo = $('#conteudo');
  for (const [re, carregar, modo] of ROTAS) {
    const m = hash.match(re);
    if (!m) continue;
    conteudo.innerHTML = '<div class="vazio"><div class="spinner-border text-success"></div></div>';
    try {
      const mod = await carregar();
      await mod.default(conteudo, { params: m.slice(1), modo, hash });
    } catch (e) {
      console.error(e);
      conteudo.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    }
    return;
  }
  conteudo.innerHTML = '<div class="vazio">Página não encontrada.</div>';
}
window.addEventListener('hashchange', rotear);

iniciar();
