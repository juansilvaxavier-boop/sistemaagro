import { state, get, post, esc, toast, pode, erro, avatar, fmt, debounce, qs } from './core.js';
import { TEXTO_TERMO } from './privacidade.js';
import * as chat from './chat.js';
import * as assistente from './assistente.js';

const MENU = [
  {
    grupo: 'Início', itens: [
      { href: '#/dashboard', l: 'Painel', i: 'bi-grid-1x2', p: 'dashboard' },
      { href: '#/chamados', l: 'Chamados Internos', i: 'bi-headset', p: 'chamados', etapa: 'chamados' },
      { href: '#/meu-rh', l: 'Meu RH', i: 'bi-person-badge' },
    ],
  },
  {
    grupo: 'Vendas', itens: [
      { href: '#/propostas', l: 'Propostas Comerciais', i: 'bi-file-earmark-text', p: 'propostas' },
      { href: '#/fila/venda', l: 'Vendedor', i: 'bi-cart3', p: 'fila.venda', etapa: 'venda' },
      { href: '#/fila/supervisao', l: 'Supervisor', i: 'bi-person-check', p: 'fila.supervisao', etapa: 'supervisao' },
      { href: '#/fila/analise', l: 'Análise', i: 'bi-search', p: 'fila.analise', etapa: 'analise' },
      { href: '#/fila/diretoria', l: 'Diretoria', i: 'bi-award', p: 'fila.diretoria', etapa: 'diretoria' },
      { href: '#/fila/cobranca', l: 'Cobrança (à vista)', i: 'bi-cash-coin', p: 'fila.cobranca', etapa: 'cobranca' },
      { href: '#/fila/producao', l: 'Produção', i: 'bi-gear', p: 'fila.producao', etapa: 'producao' },
      { href: '#/fila/expedicao', l: 'Expedição', i: 'bi-box-seam', p: 'fila.expedicao', etapa: 'expedicao' },
      { href: '#/fila/transito', l: 'Expedição – Trânsito', i: 'bi-truck', p: 'fila.transito', etapa: 'transito' },
      { href: '#/fila/devolucao', l: 'Devolução', i: 'bi-arrow-return-left', p: 'fila.devolucao', etapa: 'devolucao' },
      { href: '#/clientes', l: 'Clientes', i: 'bi-people', p: 'clientes' },
      { href: '#/historico-compra', l: 'Histórico de Compra', i: 'bi-clock-history', p: 'clientes.historico' },
      { href: '#/blacklist', l: 'Cliente (Blacklist)', i: 'bi-shield-x', p: 'blacklist' },
    ],
  },
  {
    grupo: 'Faturamento', itens: [
      { href: '#/fila/faturamento', l: 'Faturamento', i: 'bi-receipt', p: 'fila.faturamento', etapa: 'faturamento' },
      { href: '#/financeiro/notas', l: 'Nota Fiscal de Saída', i: 'bi-file-earmark-text', p: 'financeiro.notas' },
    ],
  },
  { grupo: 'Estoque', itens: [{ href: '#/estoque', l: 'Controle de Estoque', i: 'bi-boxes', p: 'estoque' }] },
  {
    grupo: 'Relacionamento', itens: [
      { href: '#/crm', l: 'CRM', i: 'bi-diagram-3', p: 'crm' },
      { href: '#/cobranca', l: 'Cobrança', i: 'bi-telephone-outbound', p: 'cobranca' },
      { href: '#/arquivos', l: 'Arquivos e Documentos', i: 'bi-folder2-open', p: 'arquivos' },
      { href: '#/mensagens', l: 'Mensagens dos setores', i: 'bi-bell' },
    ],
  },
  {
    grupo: 'Financeiro', itens: [
      { href: '#/pagar', l: 'Contas a Pagar', i: 'bi-credit-card-2-back', p: 'financeiro.pagar' },
      { href: '#/financeiro/parcelas', l: 'Gestão de Parcelas', i: 'bi-list-check', p: 'financeiro.parcelas' },
      { href: '#/financeiro/lancamentos', l: 'Descontos/Créditos', i: 'bi-plus-slash-minus', p: 'financeiro.lancamentos' },
      { href: '#/financeiro/comissoes', l: 'Revisar Comissões', i: 'bi-percent', p: 'financeiro.comissoes' },
      { href: '#/financeiro/devolucoes', l: 'Desconto Devolução', i: 'bi-arrow-counterclockwise', p: 'financeiro.devolucoes' },
      { href: '#/financeiro/negativados', l: 'Clientes Negativados', i: 'bi-person-x', p: 'financeiro.negativados' },
    ],
  },
  {
    grupo: 'Cadastros', itens: [
      { href: '#/cadastros/produtos', l: 'Produtos', i: 'bi-box', p: 'cadastros.produto' },
      { href: '#/cadastros/formas', l: 'Formas de Pagamento', i: 'bi-credit-card', p: 'cadastros.forma' },
      { href: '#/cadastros/transportadoras', l: 'Transportadoras', i: 'bi-truck-front', p: 'cadastros.transportadora' },
      { href: '#/cadastros/fornecedores', l: 'Fornecedores', i: 'bi-shop', p: 'cadastros.fornecedor' },
      { href: '#/cadastros/colaboradores', l: 'Colaboradores', i: 'bi-person-vcard', p: 'cadastros.colaborador' },
      { href: '#/cadastros/usuarios', l: 'Usuários e Permissões', i: 'bi-person-lock', p: 'cadastros.usuario' },
      { href: '#/cadastros/equipes', l: 'Equipes', i: 'bi-people-fill', p: 'cadastros.usuario' },
      { href: '#/cadastros/empresas', l: 'Empresas', i: 'bi-building', p: 'cadastros.empresa' },
      { href: '#/cadastros/listas', l: 'Listas de opções', i: 'bi-list-ul', p: 'cadastros.listas' },
      { href: '#/cadastros/comissao', l: 'Regras de comissão', i: 'bi-percent', p: 'config.comissao' },
    ],
  },
  {
    grupo: 'RH e DP', itens: [
      { href: '#/rh', l: 'Painel do RH', i: 'bi-person-workspace', p: 'rh' },
      { href: '#/rh/colaboradores', l: 'Colaboradores', i: 'bi-person-vcard', p: 'rh' },
      { href: '#/rh/ferias', l: 'Férias', i: 'bi-sun', p: 'rh' },
      { href: '#/rh/ocorrencias', l: 'Ponto e Ocorrências', i: 'bi-clock-history', p: 'rh' },
      { href: '#/rh/solicitacoes', l: 'Solicitações', i: 'bi-inbox', p: 'rh', etapa: 'rh_solicitacoes' },
      { href: '#/rh/folha', l: 'Folha (eventos do mês)', i: 'bi-cash-stack', p: 'rh.folha' },
    ],
  },
  { grupo: 'Relatórios', itens: [{ href: '#/relatorios', l: 'Relatórios', i: 'bi-bar-chart-line', p: 'relatorios' }] },
  {
    grupo: 'Segurança', itens: [
      { href: '#/auditoria', l: 'Auditoria', i: 'bi-journal-text', p: 'auditoria' },
      { href: '#/backups', l: 'Backups', i: 'bi-database-check', p: 'backup' },
      { href: '#/importacao', l: 'Importar dados', i: 'bi-cloud-upload', p: 'importacao' },
      { href: '#/privacidade', l: 'Privacidade (LGPD)', i: 'bi-shield-lock' },
    ],
  },
];

// Descrição curta de cada tela, mostrada abaixo do título.
const SUBTITULOS = {
  '#/meu-rh': 'Seus dados de contrato, férias, ponto, benefícios e pedidos ao RH.',
  '#/chamados': 'Abra e acompanhe chamados entre os setores, com prioridade e prazo.',
  '#/propostas': 'Monte orçamentos para o cliente e transforme as propostas aceitas em pedidos.',
  '#/fila/venda': 'Pedidos em digitação e devolvidos para correção antes do envio.',
  '#/fila/supervisao': 'Pedidos da equipe aguardando a aprovação do supervisor.',
  '#/fila/analise': 'Análise de crédito com Serasa, blacklist e histórico do cliente.',
  '#/fila/diretoria': 'Aprovação final dos pedidos antes da produção.',
  '#/fila/cobranca': 'Pedidos à vista aguardando a confirmação do pagamento.',
  '#/fila/producao': 'Pedidos aprovados em produção, com lotes e prazos.',
  '#/fila/faturamento': 'Emissão das notas fiscais dos pedidos produzidos.',
  '#/fila/expedicao': 'Embarque, transportadora, volumes e etiquetas de envio.',
  '#/fila/transito': 'Pedidos a caminho do cliente e confirmação de entrega.',
  '#/fila/devolucao': 'Devoluções de mercadoria e seus ajustes financeiros.',
  '#/clientes': 'Cadastro de clientes com documentos, endereços, contatos e referências.',
  '#/historico-compra': 'Pedidos, notas e parcelas de cada cliente.',
  '#/blacklist': 'Clientes com alerta ou bloqueio para novas vendas.',
  '#/financeiro/notas': 'Notas fiscais de saída emitidas, canceladas e cartas de correção.',
  '#/estoque': 'Saldos por produto e embalagem, lotes, movimentações e inventário.',
  '#/crm': 'Oportunidades, tarefas e interações com os clientes.',
  '#/cobranca': 'Carteira em atraso, agenda de contatos, ações e acordos.',
  '#/arquivos': 'Documentos anexados a clientes e pedidos.',
  '#/mensagens': 'Avisos trocados entre os setores sobre os pedidos.',
  '#/pagar': 'Contas dos fornecedores com vencimento, baixa e anexos.',
  '#/financeiro/parcelas': 'Parcelas a receber: baixa, prorrogação, status e negativação.',
  '#/financeiro/lancamentos': 'Descontos e créditos lançados para os vendedores.',
  '#/financeiro/comissoes': 'Revisão e liberação das comissões de venda.',
  '#/financeiro/devolucoes': 'Descontos aplicados por devolução de mercadoria.',
  '#/financeiro/negativados': 'Clientes negativados e pedidos de inclusão ou baixa.',
  '#/cadastros/produtos': 'Produtos, embalagens, preços e estoque mínimo.',
  '#/cadastros/formas': 'Formas e condições de pagamento usadas nos pedidos.',
  '#/cadastros/transportadoras': 'Transportadoras usadas na expedição.',
  '#/cadastros/fornecedores': 'Fornecedores com dados bancários e prazo padrão de pagamento.',
  '#/cadastros/colaboradores': 'Pessoas da empresa e seus vínculos com os usuários.',
  '#/cadastros/usuarios': 'Acesso ao sistema: perfil, permissões e dados que cada pessoa pode ver.',
  '#/cadastros/equipes': 'Equipes de venda e seus supervisores.',
  '#/cadastros/empresas': 'Empresas do grupo, CNPJ e endereço do remetente.',
  '#/cadastros/listas': 'Opções dos campos de escolha: cargos, departamentos, culturas e origens da venda.',
  '#/cadastros/comissao': 'Percentuais de gerente, supervisor e vendedor e a política comercial do pedido.',
  '#/rh': 'Visão geral do quadro: alertas, aniversariantes e custos.',
  '#/rh/colaboradores': 'Admissão, ficha completa e desligamento dos colaboradores.',
  '#/rh/ferias': 'Programação de férias dentro das regras da CLT.',
  '#/rh/ocorrencias': 'Faltas, atestados, atrasos, horas extras e banco de horas.',
  '#/rh/solicitacoes': 'Pedidos dos colaboradores para o RH aprovar ou recusar.',
  '#/rh/folha': 'Eventos variáveis do mês para enviar à contabilidade.',
  '#/relatorios': 'Relatórios de vendas, financeiro e estoque, com exportação.',
  '#/auditoria': 'Quem fez o quê e quando, com antes e depois de cada alteração.',
  '#/backups': 'Cópias de segurança do banco de dados.',
  '#/importacao': 'Carga dos dados do sistema anterior, com conferência e opção de desfazer.',
  '#/privacidade': 'Termo de uso, política de privacidade e direitos do titular (LGPD).',
  '#/perfil': 'Sua foto, dados de contato e preferências.',
};

const ROTAS = [
  [/^#\/dashboard$/, () => import('./pages/dashboard.js')],
  [/^#\/fila\/(\w+)$/, () => import('./pages/filas.js')],
  [/^#\/pedido\/novo$/, () => import('./pages/pedido-form.js')],
  [/^#\/pedido\/(\d+)\/editar$/, () => import('./pages/pedido-form.js')],
  [/^#\/clientes$/, () => import('./pages/clientes.js'), 'lista'],
  [/^#\/historico-compra$/, () => import('./pages/clientes.js'), 'historico'],
  [/^#\/blacklist$/, () => import('./pages/clientes.js'), 'blacklist'],
  [/^#\/propostas$/, () => import('./pages/propostas.js')],
  [/^#\/propostas\/nova$/, () => import('./pages/propostas.js'), 'form'],
  [/^#\/propostas\/(\d+)\/editar$/, () => import('./pages/propostas.js'), 'form'],
  [/^#\/estoque$/, () => import('./pages/estoque.js')],
  [/^#\/pagar$/, () => import('./pages/pagar.js')],
  [/^#\/chamados$/, () => import('./pages/chamados.js')],
  [/^#\/rh$/, () => import('./pages/rh.js')],
  [/^#\/rh\/(\w+)$/, () => import('./pages/rh.js')],
  [/^#\/meu-rh$/, () => import('./pages/meu-rh.js')],
  [/^#\/crm$/, () => import('./pages/crm.js')],
  [/^#\/crm\/cliente\/(\d+)$/, () => import('./pages/crm.js'), 'cliente'],
  [/^#\/cobranca$/, () => import('./pages/cobranca.js')],
  [/^#\/cobranca\/cliente\/(\d+)$/, () => import('./pages/cobranca.js'), 'cliente'],
  [/^#\/arquivos$/, () => import('./pages/arquivos.js')],
  [/^#\/mensagens$/, () => import('./pages/mensagens.js')],
  [/^#\/financeiro\/(\w+)$/, () => import('./pages/financeiro.js')],
  [/^#\/cadastros\/(usuarios|colaboradores)$/, () => import('./pages/usuarios.js')],
  [/^#\/cadastros\/(\w+)$/, () => import('./pages/cadastros.js')],
  [/^#\/senha$/, () => import('./pages/cadastros.js'), 'senha'],
  [/^#\/relatorios$/, () => import('./pages/relatorios.js')],
  [/^#\/relatorios\/([\w-]+)$/, () => import('./pages/relatorios.js')],
  [/^#\/perfil$/, () => import('./pages/perfil.js')],
  [/^#\/(auditoria|backups|privacidade|importacao)$/, () => import('./pages/seguranca.js')],
];

const $ = (s) => document.querySelector(s);
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------- Tema ----------
function aplicarTema(t) {
  document.documentElement.dataset.bsTheme = t;
  $('#btn-tema i').className = `bi ${t === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`;
  window.dispatchEvent(new CustomEvent('tema'));
}
$('#btn-tema').addEventListener('click', () => {
  const t = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
  guardar('agt-tema', t);
  aplicarTema(t);
});
aplicarTema(document.documentElement.dataset.bsTheme);

// ---------- Acesso ----------
const passos = ['passo-login', 'passo-empresa', 'passo-senha', 'passo-termo'];
function mostrarPasso(id) {
  $('#app').classList.add('d-none');
  $('#dock').classList.add('d-none');
  chat.alternar(false);
  assistente.alternar(false);
  $('#tela-login').classList.remove('d-none');
  for (const p of passos) $('#' + p).classList.toggle('d-none', p !== id);
  setTimeout(() => $('#' + id).querySelector('input:not([type=checkbox]),button.list-group-item')?.focus(), 50);
}

async function iniciar() {
  try {
    state.me = await get('/api/auth/me');
  } catch {
    return mostrarPasso('passo-login');
  }
  await seguir();
}

/** Decide o próximo passo do acesso: senha provisória, termo, empresa ou o sistema. */
async function seguir() {
  const pend = state.me.pendencias || {};
  if (pend.trocarSenha) return mostrarPasso('passo-senha');
  if (pend.aceitarTermo) {
    $('#texto-termo').innerHTML = TEXTO_TERMO;
    return mostrarPasso('passo-termo');
  }
  if (!state.me.empresa) return escolherEmpresa(state.me.empresas);
  await abrirApp();
}

function escolherEmpresa(empresas) {
  mostrarPasso('passo-empresa');
  $('#lista-empresas').innerHTML = empresas.map((e) => `<button type="button" class="list-group-item list-group-item-action" data-id="${e.id}">
    <i class="bi bi-building fs-5 text-agro"></i><span><strong class="d-block">${esc(e.nome)}</strong><small class="text-body-secondary">${fmt.doc(e.cnpj)}</small></span></button>`).join('');
  $('#lista-empresas').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    try {
      await post('/api/auth/empresa', { empresa_id: Number(b.dataset.id) });
      state.me = await get('/api/auth/me');
      await abrirApp();
    } catch (e) { erro(e); }
  }));
}

document.querySelectorAll('[data-ver-senha]').forEach((b) => b.addEventListener('click', () => {
  const i = document.getElementById(b.dataset.verSenha);
  i.type = i.type === 'password' ? 'text' : 'password';
  b.querySelector('i').className = `bi ${i.type === 'password' ? 'bi-eye' : 'bi-eye-slash'}`;
}));

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const box = $('#login-erro');
  const spin = ev.target.querySelector('.spinner-border');
  box.classList.add('d-none');
  spin.classList.remove('d-none');
  try {
    await post('/api/auth/login', { login: f.get('login'), senha: f.get('senha') });
    state.me = await get('/api/auth/me');
    ev.target.reset();
    await seguir();
  } catch (e) {
    box.textContent = e.message;
    box.classList.remove('d-none');
  } finally {
    spin.classList.add('d-none');
  }
});

function forcaSenha(s) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^\w]/.test(s)) p++;
  return p;
}
$('#ps-nova').addEventListener('input', (e) => {
  const p = forcaSenha(e.target.value);
  const barra = $('.forca-barra span');
  barra.style.width = `${(p / 5) * 100}%`;
  barra.style.background = p <= 2 ? '#e5484d' : p === 3 ? '#f5a623' : '#30a46c';
  $('#forca-texto').textContent = !e.target.value ? 'Digite a nova senha' : p <= 2 ? 'Fraca' : p === 3 ? 'Razoável' : 'Forte';
});
$('#form-primeira-senha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const box = ev.target.querySelector('.alert');
  box.classList.add('d-none');
  try {
    await post('/api/auth/senha', Object.fromEntries(new FormData(ev.target)));
    ev.target.reset();
    toast('Senha criada.');
    state.me = await get('/api/auth/me');
    await seguir();
  } catch (e) {
    box.textContent = e.message;
    box.classList.remove('d-none');
  }
});
$('#aceito').addEventListener('change', (e) => { $('#btn-aceitar').disabled = !e.target.checked; });
$('#btn-aceitar').addEventListener('click', async () => {
  try {
    await post('/api/auth/termo');
    state.me = await get('/api/auth/me');
    await seguir();
  } catch (e) { erro(e); }
});
document.querySelector('[data-abrir-privacidade]').addEventListener('click', (e) => {
  e.preventDefault();
  import('./core.js').then(({ modal }) => modal({ title: 'Política de privacidade', body: `<div class="termo" style="max-height:none">${TEXTO_TERMO}</div>` }));
});

$('#btn-sair').addEventListener('click', async () => {
  await post('/api/auth/logout').catch(() => {});
  location.hash = '';
  location.reload();
});
$('#btn-empresa').addEventListener('click', () => {
  if (state.me.empresas.length > 1) escolherEmpresa(state.me.empresas);
  else toast('Seu usuário tem acesso a apenas uma empresa.', 'info');
});
$('#btn-mensagens').addEventListener('click', () => { location.hash = '#/mensagens'; });
$('#btn-chat').addEventListener('click', () => { assistente.alternar(false); chat.alternar(); });
$('#btn-assistente').addEventListener('click', () => { chat.alternar(false); assistente.alternar(); });
$('#btn-ia').addEventListener('click', () => { chat.alternar(false); assistente.alternar(true); });
assistente.configurar({
  telas: () => MENU.flatMap((g) => g.itens.filter((i) => !i.p || pode(i.p)).map((i) => `${g.grupo} › ${i.l} (${i.href})`)),
});
const fecharMenu = () => { $('#sidebar').classList.remove('aberto'); $('#backdrop-menu').classList.remove('ativo'); };
$('#btn-menu').addEventListener('click', () => { $('#sidebar').classList.add('aberto'); $('#backdrop-menu').classList.add('ativo'); });
$('#backdrop-menu').addEventListener('click', fecharMenu);
$('#btn-compactar').addEventListener('click', () => {
  const c = document.documentElement.classList.toggle('menu-compacto');
  guardar('agt-menu', c ? 'compacto' : 'normal');
});
window.addEventListener('sessao-expirada', () => { if (state.me) { state.me = null; toast('Sessão expirada. Entre novamente.', 'warning'); mostrarPasso('passo-login'); } });
window.addEventListener('pendencia-acesso', async () => { state.me = await get('/api/auth/me').catch(() => state.me); if (state.me) seguir(); });

// ---------- Aplicação ----------
function pintarUsuario() {
  const u = state.me.usuario;
  $('#user-nome').textContent = u.nome;
  $('#user-perfil').textContent = u.perfil_label;
  $('#menu-conta-nome').textContent = `${u.nome} · ${u.perfil_label}`;
  $('#user-avatar').outerHTML = avatar(u).replace('class="avatar', 'id="user-avatar" class="avatar');
  $('#top-avatar').outerHTML = avatar(u, 'avatar-sm').replace('class="avatar', 'id="top-avatar" class="avatar');
}
window.addEventListener('foto-atualizada', async () => {
  state.fotoVersao = Date.now();
  state.me = await get('/api/auth/me');
  pintarUsuario();
});

async function abrirApp() {
  $('#tela-login').classList.add('d-none');
  $('#app').classList.remove('d-none');
  pintarUsuario();
  $('#empresa-nome').textContent = state.me.empresa.nome;
  $('#dock').classList.remove('d-none');
  $('#btn-chat').classList.toggle('d-none', !pode('chat'));
  state.opcoes = await get('/api/cadastros/opcoes');
  montarMenu();
  conectarEventos();
  atualizarContadores();
  clearInterval(state.timerContadores);
  state.timerContadores = setInterval(atualizarContadores, 60000);
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  else rotear();
}

function montarMenu() {
  const fechados = new Set(JSON.parse(ler('agt-grupos') || '[]'));
  $('#menu').innerHTML = MENU.map((g) => {
    const itens = g.itens.filter((i) => !i.p || pode(i.p));
    if (!itens.length) return '';
    const f = fechados.has(g.grupo) ? 'fechado' : '';
    return `<button type="button" class="grupo ${f}" data-grupo="${g.grupo}">${g.grupo}<i class="bi bi-chevron-down"></i></button>
      <div class="itens ${f}">${itens.map((i) => `<a href="${i.href}" title="${esc(i.l)}"><i class="bi ${i.i}"></i> <span>${i.l}</span>${i.etapa ? `<span class="contador d-none" data-cont="${i.etapa}"></span>` : ''}</a>`).join('')}</div>`;
  }).join('');
  $('#menu').querySelectorAll('[data-grupo]').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('fechado');
    b.nextElementSibling.classList.toggle('fechado');
    guardar('agt-grupos', JSON.stringify([...$('#menu').querySelectorAll('.grupo.fechado')].map((x) => x.dataset.grupo)));
  }));
}

export async function atualizarContadores() {
  if (!state.me?.empresa) return;
  try {
    const c = await get('/api/pedidos/contagem');
    if (pode('chamados')) c.chamados = (await get('/api/chamados/contagem')).para_mim;
    if (pode('rh')) c.rh_solicitacoes = (await get('/api/rh/solicitacoes?f_status=aberta&pageSize=1')).total;
    document.querySelectorAll('[data-cont]').forEach((b) => {
      const n = c[b.dataset.cont] || 0;
      b.textContent = n > 999 ? '999+' : n.toLocaleString('pt-BR');
      b.classList.toggle('d-none', !n);
    });
    const m = await get('/api/mensagens/nao-lidas');
    $('#badge-msg').classList.toggle('d-none', !m.n);
    if (pode('chat')) chat.atualizarBadge();
  } catch { /* silencioso */ }
}
window.atualizarContadores = atualizarContadores;

// ---------- Tempo real e avisos do navegador ----------
let fonte;
function conectarEventos() {
  fonte?.close();
  fonte = new EventSource('/api/auth/eventos');
  fonte.addEventListener('pedido', (e) => {
    const d = JSON.parse(e.data);
    toast(`Pedido ${d.numero} → ${d.etapa_label} (${d.acao} por ${d.por})`, 'info', 'Fila atualizada');
    avisar(`Pedido ${d.numero}: ${d.etapa_label}`, `${d.acao} por ${d.por}`, `/#/fila/${d.etapa}?abrir=${d.pedido_id}`);
    atualizarContadores();
    window.dispatchEvent(new CustomEvent('pedido-atualizado', { detail: d }));
  });
  fonte.addEventListener('mensagem', (e) => {
    const d = JSON.parse(e.data);
    toast(`${d.remetente}${d.pedido_numero ? ' · Pedido ' + d.pedido_numero : ''}: ${d.texto.slice(0, 120)}`, 'primary', 'Nova mensagem');
    avisar(`Mensagem de ${d.remetente}`, d.texto.slice(0, 140), '/#/mensagens');
    atualizarContadores();
    window.dispatchEvent(new CustomEvent('nova-mensagem', { detail: d }));
  });
  fonte.addEventListener('chat', (e) => {
    const d = JSON.parse(e.data);
    chat.receber(d);
    avisar(d.de_nome, d.texto.slice(0, 140), '/#/dashboard');
  });
  fonte.addEventListener('chamado', (e) => {
    const d = JSON.parse(e.data);
    toast(d.texto, 'warning', 'Chamado interno');
    avisar(`Chamado #${d.numero}`, d.texto, `/#/chamados?id=${d.id}`);
    atualizarContadores();
  });
  fonte.addEventListener('rh', (e) => {
    const d = JSON.parse(e.data);
    toast(d.texto, 'info', 'RH');
    avisar('RH', d.texto, pode('rh') ? '/#/rh/solicitacoes' : '/#/meu-rh');
    atualizarContadores();
  });
  fonte.addEventListener('chat_lida', (e) => chat.lidas(JSON.parse(e.data)));
}

/** Notificação do sistema operacional quando a aba não está em foco. */
function avisar(titulo, corpo, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(titulo, { body: corpo, icon: '/img/icone-192.png', badge: '/img/icone-192.png', data: { url }, tag: url }))
    .catch(() => new Notification(titulo, { body: corpo, icon: '/img/icone-192.png' }));
}
$('#btn-notificacoes').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Este navegador não suporta avisos.', 'warning');
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Avisos ativados. Você será avisado de mensagens e pedidos mesmo com a aba em segundo plano.' : 'Avisos não autorizados no navegador.', r === 'granted' ? 'success' : 'warning');
});

// ---------- Aplicativo instalável (PWA) ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
let pedidoInstalar;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoInstalar = e;
  $('#btn-instalar').classList.remove('d-none');
});
$('#btn-instalar').addEventListener('click', async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice;
  pedidoInstalar = null;
  $('#btn-instalar').classList.add('d-none');
});

// ---------- Busca global (Ctrl+K) ----------
const paleta = new bootstrap.Modal('#paleta');
function abrirBusca() {
  $('#paleta-input').value = '';
  buscar('');
  paleta.show();
}
$('#paleta').addEventListener('shown.bs.modal', () => $('#paleta-input').focus());
['#btn-busca', '#btn-busca-mob', '#btn-busca-menu'].forEach((s) => $(s).addEventListener('click', () => { fecharMenu(); abrirBusca(); }));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.me?.empresa) { e.preventDefault(); abrirBusca(); }
});
const telas = () => MENU.flatMap((g) => g.itens.filter((i) => !i.p || pode(i.p)).map((i) => ({ ...i, grupo: g.grupo })))
  .concat([{ href: '#/perfil', l: 'Meu perfil', i: 'bi-person-badge', grupo: 'Conta' }, { href: '#/pedido/novo', l: 'Novo pedido', i: 'bi-cart-plus', grupo: 'Ações', p: 'pedido.criar' }, { href: '#/propostas/nova', l: 'Nova proposta comercial', i: 'bi-file-earmark-plus', grupo: 'Ações', p: 'propostas' }])
  .filter((i) => !i.p || pode(i.p));
const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const buscar = debounce(async (q) => {
  const res = $('#paleta-res');
  const termo = semAcento(q.trim());
  const blocos = [];
  const t = telas().filter((i) => !termo || semAcento(i.l + ' ' + i.grupo).includes(termo)).slice(0, termo ? 8 : 10);
  if (t.length) blocos.push(['Telas', t.map((i) => ({ href: i.href, icone: i.i, texto: i.l, extra: i.grupo }))]);
  if (/^\d{4,}$/.test(termo) && pode('fila')) {
    // Até 6 dígitos é o número do pedido; mais que isso, o código do pedido no sistema anterior.
    const filtro = termo.length > 6 ? { f_codigo_origem: termo } : { f_numero: termo };
    const p = await get('/api/pedidos/progressao' + qs({ ...filtro, pageSize: 5 })).catch(() => ({ rows: [] }));
    if (p.rows.length) blocos.unshift(['Pedidos', p.rows.map((r) => ({ href: `#/fila/${r.etapa}?abrir=${r.id}`, icone: 'bi-cart3', texto: `Pedido ${r.numero} · ${r.cliente}`, extra: r.etapa_label }))]);
  }
  if (termo.length >= 3 && (pode('clientes') || pode('crm'))) {
    const c = await get('/api/clientes/busca' + qs({ q: q.trim() })).catch(() => []);
    if (c.length) blocos.push(['Clientes', c.slice(0, 6).map((x) => ({ href: pode('crm') ? `#/crm/cliente/${x.id}` : `#/historico-compra?doc=${x.documento}`, icone: 'bi-person', texto: x.nome, extra: fmt.doc(x.documento) }))]);
  }
  res.innerHTML = blocos.length ? blocos.map(([g, itens]) => `<div class="grupo-res">${g}</div>${itens.map((i) =>
    `<a href="${i.href}"><i class="bi ${i.icone}"></i><span>${esc(i.texto)}</span><small>${esc(i.extra || '')}</small></a>`).join('')}`).join('')
    : `<div class="vazio">Nada encontrado para “${esc(q)}”.</div>`;
  res.querySelector('a')?.classList.add('sel');
  res.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => paleta.hide()));
}, 200);
$('#paleta-input').addEventListener('input', (e) => buscar(e.target.value));
$('#paleta-input').addEventListener('keydown', (e) => {
  const itens = [...$('#paleta-res').querySelectorAll('a')];
  const i = itens.findIndex((a) => a.classList.contains('sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = e.key === 'ArrowDown' ? Math.min(i + 1, itens.length - 1) : Math.max(i - 1, 0);
    itens.forEach((a) => a.classList.remove('sel'));
    itens[n]?.classList.add('sel');
    itens[n]?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter' && itens[i]) { location.hash = itens[i].getAttribute('href'); paleta.hide(); }
});

// ---------- Rotas ----------
async function rotear() {
  if (!state.me?.empresa) return;
  const hash = (location.hash || '#/dashboard').split('?')[0];
  fecharMenu();
  // Marca só o item mais específico (#/rh/ferias não acende também #/rh).
  let ativo = null;
  document.querySelectorAll('#menu a').forEach((a) => {
    const h = a.getAttribute('href');
    if ((hash === h || hash.startsWith(h + '/')) && h.length > (ativo?.getAttribute('href').length || 0)) ativo = a;
  });
  document.querySelectorAll('#menu a').forEach((a) => {
    a.classList.toggle('ativo', a === ativo);
    if (a === ativo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const grupo = ativo?.closest('.itens')?.previousElementSibling?.dataset.grupo;
  $('#breadcrumb').innerHTML = ativo ? `${grupo ? `<small>${esc(grupo)} /</small> ` : ''}${esc(ativo.querySelector('span').textContent)}` : '';
  const conteudo = $('#conteudo');
  for (const [re, carregar, modo] of ROTAS) {
    const m = hash.match(re);
    if (!m) continue;
    conteudo.innerHTML = '<div class="page-title"><span class="esqueleto" style="height:28px;max-width:280px"></span></div><div class="row g-3">'
      + '<div class="col-md-4"><div class="card"><div class="card-body"><span class="esqueleto"></span><br><br><span class="esqueleto" style="max-width:100px"></span></div></div></div>'.repeat(3) + '</div>';
    try {
      const mod = await carregar();
      await mod.default(conteudo, { params: m.slice(1), modo, hash });
      const sub = SUBTITULOS[hash];
      const h2 = conteudo.querySelector(':scope > .page-title > h2');
      if (sub && h2 && !h2.parentElement.querySelector('.page-sub')) {
        const bloco = document.createElement('div');
        bloco.className = 'min-w-0';
        h2.replaceWith(bloco);
        bloco.append(h2);
        bloco.insertAdjacentHTML('beforeend', `<p class="page-sub">${esc(sub)}</p>`);
      }
      document.title = `${ativo?.querySelector('span').textContent || 'Agroterra'} · Agroterra Sistema`;
    } catch (e) {
      console.error(e);
      conteudo.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`;
    }
    return;
  }
  conteudo.innerHTML = '<div class="vazio"><i class="bi bi-signpost-split"></i>Página não encontrada.</div>';
}
window.addEventListener('hashchange', rotear);

iniciar();
