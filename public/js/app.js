import { state, get, post, esc, toast, pode, erro, avatar, fmt, debounce, qs, botaoAjuda } from './core.js';
import { TEXTO_TERMO } from './privacidade.js';
import * as chat from './chat.js';
import * as assistente from './assistente.js';

// Menu em áreas: cada item é uma área; as abas dela aparecem no topo da tela (só as que o usuário pode ver).
// Itens com uma única aba liberada vão direto para ela, sem barra de abas.
const MENU = [
  {
    grupo: 'Início', itens: [
      { href: '#/dashboard', l: 'Painel', i: 'bi-grid-1x2', p: 'dashboard' },
      { href: '#/chamados', l: 'Chamados internos', i: 'bi-headset', p: 'chamados', etapa: 'chamados' },
      { href: '#/ponto', l: 'Meu ponto', i: 'bi-fingerprint', se: () => !!state.me?.usuario?.colaborador_id },
      { href: '#/meu-rh', l: 'Meu RH', i: 'bi-person-badge' },
      { href: '#/produtividade', l: 'Produtividade', i: 'bi-speedometer2' },
    ],
  },
  {
    grupo: 'Comercial', itens: [
      {
        l: 'Pedidos', i: 'bi-cart3', abas: [
          { href: '#/fila/venda', l: 'Vendedor', i: 'bi-cart3', p: 'fila.venda', etapa: 'venda' },
          { href: '#/fila/supervisao', l: 'Supervisor', i: 'bi-person-check', p: 'fila.supervisao', etapa: 'supervisao' },
          { href: '#/fila/analise', l: 'Análise', i: 'bi-search', p: 'fila.analise', etapa: 'analise' },
          { href: '#/fila/diretoria', l: 'Diretoria', i: 'bi-award', p: 'fila.diretoria', etapa: 'diretoria' },
          { href: '#/fila/cobranca', l: 'Pagamento à vista', i: 'bi-cash-coin', p: 'fila.cobranca', etapa: 'cobranca' },
          { href: '#/fila/producao', l: 'Produção', i: 'bi-gear', p: 'fila.producao', etapa: 'producao' },
          { href: '#/fila/faturamento', l: 'Faturamento', i: 'bi-receipt', p: 'fila.faturamento', etapa: 'faturamento' },
          { href: '#/fila/expedicao', l: 'Expedição', i: 'bi-box-seam', p: 'fila.expedicao', etapa: 'expedicao' },
          { href: '#/fila/transito', l: 'Em trânsito', i: 'bi-truck', p: 'fila.transito', etapa: 'transito' },
          { href: '#/fila/devolucao', l: 'Devolução', i: 'bi-arrow-return-left', p: 'fila.devolucao', etapa: 'devolucao' },
          { href: '#/mensagens', l: 'Mensagens', i: 'bi-bell', se: () => pode('fila') || pode('pedido') },
        ],
      },
      { href: '#/propostas', l: 'Propostas', i: 'bi-file-earmark-text', p: 'propostas' },
      {
        l: 'Metas e campanhas', i: 'bi-bullseye', abas: [
          { href: '#/metas', l: 'Metas', i: 'bi-bullseye', p: 'metas' },
          { href: '#/metas/ranking', l: 'Ranking', i: 'bi-trophy', p: 'metas' },
          { href: '#/metas/campanhas', l: 'Campanhas', i: 'bi-megaphone', p: 'metas' },
        ],
      },
      {
        l: 'Clientes', i: 'bi-people', abas: [
          { href: '#/clientes', l: 'Cadastro', i: 'bi-people', p: 'clientes' },
          { href: '#/historico-compra', l: 'Histórico de compra', i: 'bi-clock-history', p: 'clientes.historico' },
          { href: '#/blacklist', l: 'Blacklist', i: 'bi-shield-x', p: 'blacklist' },
          { href: '#/arquivos', l: 'Arquivos', i: 'bi-folder2-open', p: 'arquivos' },
        ],
      },
      { href: '#/crm', l: 'CRM', i: 'bi-diagram-3', p: 'crm', etapa: 'crm_tarefas' },
    ],
  },
  {
    grupo: 'Financeiro', itens: [
      {
        l: 'Contas a receber', i: 'bi-wallet2', abas: [
          { href: '#/financeiro/parcelas', l: 'Parcelas', i: 'bi-list-check', p: 'financeiro.parcelas' },
          { href: '#/cobranca', l: 'Cobrança', i: 'bi-telephone-outbound', p: 'cobranca' },
          { href: '#/financeiro/negativados', l: 'Negativados', i: 'bi-person-x', p: 'financeiro.negativados' },
          { href: '#/credito', l: 'Limites de crédito', i: 'bi-shield-check', p: 'credito' },
        ],
      },
      { href: '#/pagar', l: 'Contas a pagar', i: 'bi-credit-card-2-back', p: 'financeiro.pagar' },
      {
        l: 'Tesouraria', i: 'bi-bank', abas: [
          { href: '#/tesouraria', l: 'Fluxo de caixa', i: 'bi-graph-up', p: 'tesouraria' },
          { href: '#/tesouraria/resultado', l: 'Resultado do mês', i: 'bi-clipboard-data', p: 'tesouraria' },
          { href: '#/tesouraria/conciliacao', l: 'Conciliação bancária', i: 'bi-bank2', p: 'tesouraria' },
        ],
      },
      {
        l: 'Notas fiscais', i: 'bi-receipt', abas: [
          { href: '#/financeiro/notas', l: 'Notas de saída', i: 'bi-file-earmark-text', p: 'financeiro.notas' },
          { href: '#/financeiro/devolucoes', l: 'Descontos de devolução', i: 'bi-arrow-counterclockwise', p: 'financeiro.devolucoes' },
        ],
      },
      {
        l: 'Comissões', i: 'bi-percent', abas: [
          { href: '#/financeiro/comissoes', l: 'Revisar comissões', i: 'bi-percent', p: 'financeiro.comissoes' },
          { href: '#/financeiro/lancamentos', l: 'Descontos e créditos', i: 'bi-plus-slash-minus', p: 'financeiro.lancamentos' },
          { href: '#/cadastros/comissao', l: 'Regras de comissão', i: 'bi-sliders', p: 'config.comissao' },
        ],
      },
    ],
  },
  {
    grupo: 'Operação', itens: [
      { href: '#/estoque', l: 'Estoque', i: 'bi-boxes', p: 'estoque' },
      {
        l: 'Compras', i: 'bi-bag', abas: [
          { href: '#/compras', l: 'Solicitações', i: 'bi-inbox', p: 'compras', etapa: 'compras_solicitacoes' },
          { href: '#/compras/pedidos', l: 'Pedidos de compra', i: 'bi-bag-check', p: 'compras', se: () => pode('compras.comprar') || pode('compras.aprovar'), etapa: 'compras_aprovacao' },
          { href: '#/compras/receber', l: 'Receber mercadoria', i: 'bi-truck', p: 'compras.receber', etapa: 'compras_receber' },
          { href: '#/compras/reposicao', l: 'Reposição de estoque', i: 'bi-arrow-repeat', p: 'compras', se: () => pode('estoque') },
        ],
      },
    ],
  },
  {
    grupo: 'Gestão', itens: [
      {
        l: 'RH e DP', i: 'bi-person-workspace', abas: [
          { href: '#/rh', l: 'Painel', i: 'bi-person-workspace', p: 'rh' },
          { href: '#/rh/colaboradores', l: 'Colaboradores', i: 'bi-person-vcard', p: 'rh' },
          { href: '#/rh/ferias', l: 'Férias', i: 'bi-sun', p: 'rh' },
          { href: '#/rh/ponto', l: 'Ponto', i: 'bi-fingerprint', p: 'rh' },
          { href: '#/rh/ocorrencias', l: 'Ocorrências', i: 'bi-clock-history', p: 'rh' },
          { href: '#/rh/feriados', l: 'Feriados', i: 'bi-calendar-event', p: 'rh' },
          { href: '#/rh/solicitacoes', l: 'Solicitações', i: 'bi-inbox', p: 'rh', etapa: 'rh_solicitacoes' },
          { href: '#/rh/folha', l: 'Folha do mês', i: 'bi-cash-stack', p: 'rh.folha' },
        ],
      },
      { href: '#/relatorios', l: 'Relatórios', i: 'bi-bar-chart-line', p: 'relatorios' },
      {
        l: 'Análises', i: 'bi-bar-chart-steps', abas: [
          { href: '#/analises', l: 'Curva ABC', i: 'bi-bar-chart-steps', p: 'analises' },
          { href: '#/analises/demanda', l: 'Previsão de demanda', i: 'bi-graph-up-arrow', p: 'analises' },
          { href: '#/analises/recompra', l: 'Recompra atrasada', i: 'bi-arrow-repeat', p: 'analises' },
        ],
      },
      {
        l: 'Pessoas e acesso', i: 'bi-person-lock', abas: [
          // Quem tem RH cadastra colaboradores pelo RH; a aba aqui fica para quem só cuida de cadastros.
          { href: '#/cadastros/colaboradores', l: 'Colaboradores', i: 'bi-person-vcard', p: 'cadastros.colaborador', se: () => !pode('rh') },
          { href: '#/cadastros/usuarios', l: 'Usuários e permissões', i: 'bi-person-lock', p: 'cadastros.usuario' },
          { href: '#/cadastros/equipes', l: 'Equipes', i: 'bi-people-fill', p: 'cadastros.usuario' },
        ],
      },
      {
        l: 'Cadastros', i: 'bi-collection', abas: [
          { href: '#/cadastros/produtos', l: 'Produtos', i: 'bi-box', p: 'cadastros.produto' },
          { href: '#/tabelas-preco', l: 'Tabelas de preço', i: 'bi-tags', p: 'cadastros.produto' },
          { href: '#/cadastros/formas', l: 'Formas de pagamento', i: 'bi-credit-card', p: 'cadastros.forma' },
          { href: '#/cadastros/transportadoras', l: 'Transportadoras', i: 'bi-truck-front', p: 'cadastros.transportadora' },
          { href: '#/cadastros/fornecedores', l: 'Fornecedores', i: 'bi-shop', p: 'cadastros.fornecedor' },
          { href: '#/cadastros/empresas', l: 'Empresas', i: 'bi-building', p: 'cadastros.empresa' },
          { href: '#/cadastros/listas', l: 'Listas de opções', i: 'bi-list-ul', p: 'cadastros.listas' },
        ],
      },
      {
        l: 'Administração', i: 'bi-shield-check', abas: [
          { href: '#/auditoria', l: 'Auditoria', i: 'bi-journal-text', p: 'auditoria' },
          { href: '#/backups', l: 'Backups', i: 'bi-database-check', p: 'backup' },
          { href: '#/importacao', l: 'Importar dados', i: 'bi-cloud-upload', p: 'importacao' },
          { href: '#/chat-lgpd', l: 'Chat: guarda e exportação', i: 'bi-chat-square-text', p: 'lgpd.titular' },
          { href: '#/integracoes', l: 'Integrações', i: 'bi-plug', p: 'integracoes' },
        ],
      },
    ],
  },
];
const liberado = (x) => (!x.p || pode(x.p)) && (!x.se || x.se());
/** Abas da área que o usuário pode ver. */
const abasDe = (item) => (item.abas || [item]).filter(liberado);
/** Todas as telas liberadas (uma por aba), para a busca e o assistente. */
const telasLiberadas = () => MENU.flatMap((g) => g.itens.flatMap((it) => abasDe(it).map((a) => ({ ...a, grupo: it.abas ? it.l : g.grupo, area: it }))));
// Telas fora do menu, mas de uma área (o título e a barra de abas da área aparecem nelas).
const ROTAS_DA_AREA = [[/^#\/pedido\//, 'Pedidos'], [/^#\/crm\//, 'CRM'], [/^#\/cobranca\/cliente\//, 'Contas a receber'], [/^#\/relatorios\//, 'Relatórios'], [/^#\/propostas\//, 'Propostas']];

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
  '#/crm/tarefas': 'Suas tarefas do CRM, inclusive as criadas pelas automações.',
  '#/crm/safra': 'Quando cada cliente vai plantar ou adubar, pelo calendário da safra e pelas áreas cadastradas.',
  '#/metas': 'Metas do mês por empresa, equipe e vendedor, com realizado e projeção de fechamento.',
  '#/metas/ranking': 'Posição de cada vendedor no mês pelo % da meta de valor.',
  '#/metas/campanhas': 'Campanhas de vendas com período, produto, meta individual e prêmio.',
  '#/credito': 'Limite, exposição e situação de crédito de cada cliente, com limite sugerido e automático.',
  '#/tesouraria': 'Saldo realizado e previsto pelas parcelas a receber e contas a pagar.',
  '#/tesouraria/resultado': 'Resultado gerencial: receita, custos, comissões, fretes e despesas por mês.',
  '#/tesouraria/conciliacao': 'Extrato do banco (OFX) casado com as parcelas e as contas a pagar.',
  '#/tabelas-preco': 'Preços por estado e safra, com vigência, ajuste geral e preço por embalagem.',
  '#/analises': 'Quais clientes e produtos fazem 80% do faturamento ou da margem.',
  '#/analises/demanda': 'Quanto deve vender nos próximos meses e quanto comprar para não faltar.',
  '#/analises/recompra': 'Clientes que já passaram do tempo normal entre uma compra e outra.',
  '#/compras': 'Pedidos de compra dos setores, cotação com fornecedores e acompanhamento.',
  '#/compras/pedidos': 'Pedidos de compra: aprovação, envio ao fornecedor e situação da entrega.',
  '#/compras/receber': 'Conferência da mercadoria com a nota do fornecedor: entra no estoque e gera a conta a pagar.',
  '#/compras/reposicao': 'Itens abaixo do estoque mínimo com a quantidade sugerida para comprar.',
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
  '#/rh/ponto': 'Quem está trabalhando agora, espelho de ponto com o local de cada marcação, ajustes e banco de horas.',
  '#/rh/feriados': 'Feriados nacionais, estaduais, municipais e da empresa, e quais são folga para o ponto.',
  '#/rh/ocorrencias': 'Faltas, atestados, atrasos, horas extras e créditos ou débitos manuais no banco de horas.',
  '#/ponto': 'Registre entrada, intervalo e saída; a localização do aparelho vai junto. Veja seu espelho e banco de horas.',
  '#/produtividade': 'Cobranças, pedidos analisados, notas emitidas, vendas e o resultado de cada colaborador no período.',
  '#/rh/solicitacoes': 'Pedidos dos colaboradores para o RH aprovar ou recusar.',
  '#/rh/folha': 'Eventos variáveis do mês para enviar à contabilidade.',
  '#/relatorios': 'Relatórios de vendas, financeiro e estoque, com exportação.',
  '#/auditoria': 'Quem fez o quê e quando, com antes e depois de cada alteração.',
  '#/chat-lgpd': 'Prazo de guarda das mensagens do chat e exportação de conversas para o jurídico ou o RH.',
  '#/backups': 'Cópias de segurança do banco de dados.',
  '#/importacao': 'Carga dos dados do sistema anterior, com conferência e opção de desfazer.',
  '#/integracoes': 'Credenciais de APIs externas: consulta de NF-e, cotação de frete, boleto e emissão de nota fiscal.',
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
  [/^#\/ponto$/, () => import('./pages/ponto.js')],
  [/^#\/produtividade$/, () => import('./pages/produtividade.js')],
  [/^#\/crm$/, () => import('./pages/crm.js')],
  [/^#\/crm\/cliente\/(\d+)$/, () => import('./pages/crm.js'), 'cliente'],
  [/^#\/crm\/(tarefas|automacoes|safra)$/, () => import('./pages/crm.js')],
  [/^#\/metas$/, () => import('./pages/metas.js')],
  [/^#\/metas\/(ranking|campanhas)$/, () => import('./pages/metas.js')],
  [/^#\/credito$/, () => import('./pages/credito.js')],
  [/^#\/tesouraria$/, () => import('./pages/tesouraria.js')],
  [/^#\/tesouraria\/(resultado|conciliacao)$/, () => import('./pages/tesouraria.js')],
  [/^#\/tabelas-preco$/, () => import('./pages/tabelas-preco.js')],
  [/^#\/analises$/, () => import('./pages/analises.js')],
  [/^#\/analises\/(demanda|recompra)$/, () => import('./pages/analises.js')],
  [/^#\/compras$/, () => import('./pages/compras.js')],
  [/^#\/compras\/(pedidos|receber|reposicao)$/, () => import('./pages/compras.js')],
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
  [/^#\/(auditoria|backups|privacidade|importacao|chat-lgpd)$/, () => import('./pages/seguranca.js')],
  [/^#\/integracoes$/, () => import('./pages/integracoes.js')],
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
  const atual = state.me?.empresa;
  const marca = (on) => (on ? '<i class="bi bi-check2 ms-auto text-agro" aria-label="Atual"></i>' : '');
  $('#lista-empresas').innerHTML = empresas.map((e) => `<button type="button" class="list-group-item list-group-item-action" data-id="${e.id}">
    <i class="bi bi-building fs-5 text-agro"></i><span><strong class="d-block">${esc(e.nome)}</strong><small class="text-body-secondary">${fmt.doc(e.cnpj)}</small></span>${marca(atual?.id === e.id)}</button>`).join('')
    + (empresas.length > 1 ? `<button type="button" class="list-group-item list-group-item-action empresa-todas" data-id="todas">
    <i class="bi bi-buildings fs-5 text-agro"></i><span><strong class="d-block">Todas as empresas</strong><small class="text-body-secondary">Dados das ${empresas.length} empresas juntos · só consulta</small></span>${marca(atual?.todas)}</button>` : '');
  $('#lista-empresas').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    try {
      await post('/api/auth/empresa', { empresa_id: b.dataset.id === 'todas' ? 'todas' : Number(b.dataset.id) });
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
$('#aviso-todas').addEventListener('click', () => escolherEmpresa(state.me.empresas));
$('#btn-empresa').addEventListener('click', () => {
  if (state.me.empresas.length > 1) escolherEmpresa(state.me.empresas);
  else toast('Seu usuário tem acesso a apenas uma empresa.', 'info');
});
$('#btn-mensagens').addEventListener('click', () => { location.hash = '#/mensagens'; });
$('#btn-chat').addEventListener('click', () => { assistente.alternar(false); chat.alternar(); });
$('#btn-assistente').addEventListener('click', () => { chat.alternar(false); assistente.alternar(); });
$('#btn-ia').addEventListener('click', () => { chat.alternar(false); assistente.alternar(true); });
assistente.configurar({
  telas: () => telasLiberadas().map((t) => `${t.grupo} › ${t.l} (${t.href})`),
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
  // Visão consolidada: ícone próprio e aviso de que é só consulta.
  document.documentElement.classList.toggle('todas-empresas', !!state.me.empresa.todas);
  $('#btn-empresa .emp-ico i').className = `bi ${state.me.empresa.todas ? 'bi-buildings' : 'bi-building'}`;
  $('#aviso-todas')?.classList.toggle('d-none', !state.me.empresa.todas);
  $('#dock').classList.remove('d-none');
  $('#btn-chat').classList.toggle('d-none', !pode('chat'));
  state.opcoes = await get('/api/cadastros/opcoes');
  montarMenu();
  conectarEventos();
  atualizarContadores();
  if (pode('chat')) chat.iniciar();
  if ('Notification' in window && Notification.permission === 'granted') inscreverAparelho();
  lembretePonto();
  clearInterval(state.timerContadores);
  state.timerContadores = setInterval(atualizarContadores, 60000);
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  else rotear();
}

/** Endereço de uma área: a última aba usada (se ainda liberada) ou a primeira. */
function hrefArea(item) {
  const abas = abasDe(item);
  const ultima = ler(`agt-aba-${item.l}`);
  return (abas.find((a) => a.href === ultima) || abas[0])?.href;
}
// Contador da área: só as filas do setor da pessoa (a Diretoria conta a fila dela, não todas); sem fila do setor, soma as liberadas.
const etapasDe = (item) => {
  const todas = abasDe(item).map((a) => a.etapa).filter(Boolean);
  const perfil = state.me.usuario.perfil;
  const minhas = todas.filter((e) => state.me.etapas[e]?.perfil === perfil || (perfil === 'admin' && e === 'diretoria') || (perfil === 'gerente' && e === 'supervisao'));
  return (minhas.length ? minhas : todas).join(',');
};

function montarMenu() {
  const fechados = new Set(JSON.parse(ler('agt-grupos') || '[]'));
  $('#menu').innerHTML = MENU.map((g) => {
    const itens = g.itens.filter((it) => abasDe(it).length);
    if (!itens.length) return '';
    const f = fechados.has(g.grupo) ? 'fechado' : '';
    return `<button type="button" class="grupo ${f}" data-grupo="${g.grupo}">${g.grupo}<i class="bi bi-chevron-down"></i></button>
      <div class="itens ${f}">${itens.map((it) => {
        const cont = etapasDe(it);
        return `<a href="${hrefArea(it)}" data-area="${esc(it.l)}" title="${esc(it.l)}"><i class="bi ${it.i}"></i> <span>${esc(it.l)}</span>${cont ? `<span class="contador d-none" data-cont="${cont}"></span>` : ''}</a>`;
      }).join('')}</div>`;
  }).join('');
  $('#menu').querySelectorAll('[data-grupo]').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('fechado');
    b.nextElementSibling.classList.toggle('fechado');
    guardar('agt-grupos', JSON.stringify([...$('#menu').querySelectorAll('.grupo.fechado')].map((x) => x.dataset.grupo)));
  }));
}

/** Área e aba da rota atual (a aba mais específica que casa com o endereço). */
function areaDaRota(hash) {
  let achada = null;
  for (const g of MENU) {
    for (const it of g.itens) {
      for (const a of abasDe(it)) {
        if ((hash === a.href || hash.startsWith(a.href + '/')) && a.href.length > (achada?.aba.href.length || 0)) achada = { grupo: g.grupo, item: it, aba: a };
      }
    }
  }
  if (!achada) {
    const extra = ROTAS_DA_AREA.find(([re]) => re.test(hash));
    if (extra) {
      for (const g of MENU) for (const it of g.itens) if (it.l === extra[1] && abasDe(it).length) achada = { grupo: g.grupo, item: it, aba: null };
    }
  }
  return achada;
}

let ultimosContadores = {};
const somaContador = (lista) => String(lista).split(',').reduce((a, k) => a + (ultimosContadores[k] || 0), 0);
function pintarContadores() {
  document.querySelectorAll('[data-cont]').forEach((b) => {
    const n = somaContador(b.dataset.cont);
    b.textContent = n > 999 ? '999+' : n.toLocaleString('pt-BR');
    b.classList.toggle('d-none', !n);
  });
}

/** Barra de abas da área, logo abaixo do título da tela. */
function barraDeAbas(conteudo, area) {
  conteudo.querySelector(':scope > .area-abas')?.remove();
  const abas = area ? abasDe(area.item) : [];
  if (abas.length < 2) return;
  const nav = document.createElement('nav');
  nav.className = 'area-abas';
  nav.setAttribute('aria-label', area.item.l);
  nav.innerHTML = abas.map((a) => `<a href="${a.href}" class="${a === area.aba ? 'ativa' : ''}" ${a === area.aba ? 'aria-current="page"' : ''}>
    <i class="bi ${a.i}"></i><span>${esc(a.l)}</span>${a.etapa ? `<span class="contador d-none" data-cont="${a.etapa}"></span>` : ''}</a>`).join('');
  const titulo = conteudo.querySelector(':scope > .page-title');
  if (titulo) titulo.after(nav); else conteudo.prepend(nav);
  nav.querySelector('.ativa')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  pintarContadores();
}

export async function atualizarContadores() {
  if (!state.me?.empresa) return;
  try {
    const c = await get('/api/pedidos/contagem');
    if (pode('chamados')) c.chamados = (await get('/api/chamados/contagem')).para_mim;
    if (pode('rh')) c.rh_solicitacoes = (await get('/api/rh/solicitacoes?f_status=aberta&pageSize=1')).total;
    if (pode('crm')) c.crm_tarefas = (await get('/api/crm/contagem')).para_hoje;
    if (pode('compras')) {
      const k = await get('/api/compras/contagem');
      Object.assign(c, { compras_solicitacoes: k.solicitacoes, compras_aprovacao: k.aprovacao, compras_receber: k.receber });
    }
    ultimosContadores = c;
    pintarContadores();
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
  fonte.addEventListener('chat_sinal', (e) => chat.sinal(JSON.parse(e.data)));
  fonte.addEventListener('chamado', (e) => {
    const d = JSON.parse(e.data);
    toast(d.texto, 'warning', 'Chamado interno');
    avisar(`Chamado #${d.numero}`, d.texto, `/#/chamados?id=${d.id}`);
    atualizarContadores();
  });
  fonte.addEventListener('ponto', (e) => {
    const d = JSON.parse(e.data);
    toast(`${d.texto} Abra Meu ponto para registrar.`, 'warning', 'Lembrete de ponto');
    avisar('Lembrete de ponto', d.texto, '/#/ponto');
  });
  fonte.addEventListener('rh', (e) => {
    const d = JSON.parse(e.data);
    toast(d.texto, 'info', 'RH');
    avisar('RH', d.texto, pode('rh') ? '/#/rh/solicitacoes' : '/#/meu-rh');
    atualizarContadores();
  });
  fonte.addEventListener('crm_tarefas', (e) => {
    const d = JSON.parse(e.data);
    const texto = `${d.n} nova(s) tarefa(s) automática(s) do CRM para você.`;
    toast(texto, 'info', 'CRM');
    avisar('CRM', texto, '/#/crm/tarefas');
    atualizarContadores();
  });
  fonte.addEventListener('compras', (e) => {
    const d = JSON.parse(e.data);
    const fmtV = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const [texto, url] = {
      solicitacao: [`Solicitação de compra ${d.numero} (${d.urgencia}) de ${d.por}.`, '/#/compras'],
      solicitacao_recusada: [`Sua solicitação de compra ${d.numero} foi recusada: ${d.motivo}`, '/#/compras'],
      solicitacao_atendida: [`Sua solicitação ${d.numero} virou o pedido de compra ${d.compra}.`, '/#/compras'],
      aprovacao: [`Pedido de compra ${d.numero} (${fmtV(d.valor)}) aguarda sua aprovação.`, '/#/compras/pedidos'],
      aprovada: [`Pedido de compra ${d.numero} aprovado.`, '/#/compras/pedidos'],
      reprovada: [`Pedido de compra ${d.numero} devolvido: ${d.motivo}`, '/#/compras/pedidos'],
      a_receber: [`Pedido de compra ${d.numero} aprovado: aguarde a mercadoria.`, '/#/compras/receber'],
      conta_compra: [`Recebimento da compra ${d.numero} lançou ${fmtV(d.valor)} em contas a pagar.`, '/#/pagar'],
    }[d.tipo] || ['Compras atualizadas.', '/#/compras'];
    toast(texto, 'info', 'Compras');
    avisar('Compras', texto, url);
    atualizarContadores();
    window.dispatchEvent(new CustomEvent('compras-atualizadas', { detail: d }));
  });
}

/** Ao abrir o sistema: avisa quem esqueceu de marcar o ponto (pelo horário cadastrado). Uma vez por tipo e dia. */
async function lembretePonto() {
  if (!state.me?.usuario?.colaborador_id) return;
  try {
    const { lembrete } = await get('/api/ponto/lembrete');
    if (!lembrete) return;
    const chave = `agt-lembrete-${new Date().toISOString().slice(0, 10)}-${lembrete.tipo}`;
    if (sessionStorage.getItem(chave)) return;
    sessionStorage.setItem(chave, '1');
    toast(`${lembrete.texto} Abra Meu ponto para registrar.`, 'warning', 'Lembrete de ponto');
  } catch {}
}

/** Notificação do sistema operacional quando a aba não está em foco. */
function avisar(titulo, corpo, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(titulo, { body: corpo, icon: '/img/icone-192.png', badge: '/img/icone-192.png', data: { url }, tag: url }))
    .catch(() => new Notification(titulo, { body: corpo, icon: '/img/icone-192.png' }));
}
/** Registra este aparelho para notificações com o sistema fechado (chat, lembretes de ponto). */
async function inscreverAparelho() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { chave } = await get('/api/ponto/push/chave');
      const bytes = Uint8Array.from(atob((chave + '='.repeat((4 - (chave.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    }
    await post('/api/ponto/push', { inscricao: sub.toJSON() });
    return true;
  } catch { return false; }
}
$('#btn-notificacoes').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Este navegador não suporta avisos. No iPhone, instale o sistema na tela de início e abra por lá.', 'warning');
  const r = await Notification.requestPermission();
  if (r !== 'granted') return toast('Avisos não autorizados no navegador.', 'warning');
  const push = await inscreverAparelho();
  toast(push ? 'Avisos ativados: mensagens do chat, menções e lembretes chegam neste aparelho mesmo com o sistema fechado.'
    : 'Avisos ativados enquanto o sistema estiver aberto.');
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
const telas = () => telasLiberadas()
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
  // Link de notificação do chat (#/chat/ID): abre a conversa por cima da tela atual.
  const linkChat = /^#\/chat\/(\d+)$/.exec(location.hash);
  if (linkChat) {
    history.replaceState(null, '', state.ultimaRota || '#/dashboard');
    if (pode('chat')) chat.abrirPorLink(linkChat[1]);
    if (state.ultimaRota) return;
  }
  state.ultimaRota = location.hash;
  const hash = (location.hash || '#/dashboard').split('?')[0];
  fecharMenu();
  // Ao trocar de tela, fecha o que ficou aberto por cima (modal de outra tela).
  document.querySelectorAll('.modal.show').forEach((m) => bootstrap.Modal.getInstance(m)?.hide());
  // Marca a área da rota no menu; a aba aparece na barra de abas da tela.
  const area = areaDaRota(hash);
  let ativo = null;
  document.querySelectorAll('#menu a').forEach((a) => {
    const on = !!area && a.dataset.area === area.item.l;
    a.classList.toggle('ativo', on);
    if (on) { a.setAttribute('aria-current', 'page'); ativo = a; } else a.removeAttribute('aria-current');
  });
  if (area?.aba) {
    guardar(`agt-aba-${area.item.l}`, area.aba.href);
    if (ativo) ativo.setAttribute('href', area.aba.href);
  }
  $('#breadcrumb').innerHTML = area ? `<small>${esc(area.grupo)} /</small> ${esc(area.item.l)}${area.aba && area.item.abas ? ` <small>/ ${esc(area.aba.l)}</small>` : ''}` : '';
  const conteudo = $('#conteudo');
  for (const [re, carregar, modo] of ROTAS) {
    const m = hash.match(re);
    if (!m) continue;
    conteudo.innerHTML = '<div class="page-title"><span class="esqueleto" style="height:28px;max-width:280px"></span></div><div class="row g-3">'
      + '<div class="col-md-4"><div class="card"><div class="card-body"><span class="esqueleto"></span><br><br><span class="esqueleto" style="max-width:100px"></span></div></div></div>'.repeat(3) + '</div>';
    try {
      const mod = await carregar();
      await mod.default(conteudo, { params: m.slice(1), modo, hash });
      barraDeAbas(conteudo, area);
      // Botão "?" com a explicação da tela.
      const tituloTela = conteudo.querySelector(':scope > .page-title h2, :scope > .page-title .saudacao');
      if (tituloTela && !tituloTela.querySelector('[data-ajuda]')) tituloTela.insertAdjacentHTML('beforeend', botaoAjuda(hash));
      const sub = SUBTITULOS[hash];
      const h2 = conteudo.querySelector(':scope > .page-title > h2');
      if (sub && h2 && !h2.parentElement.querySelector('.page-sub')) {
        const bloco = document.createElement('div');
        bloco.className = 'min-w-0';
        h2.replaceWith(bloco);
        bloco.append(h2);
        bloco.insertAdjacentHTML('beforeend', `<p class="page-sub">${esc(sub)}</p>`);
      }
      document.title = `${area?.aba?.l || area?.item.l || 'Painel'} · Acelera Fertilizantes`;
    } catch (e) {
      console.error(e);
      const semAcesso = e.status === 403;
      conteudo.innerHTML = `<div class="card"><div class="vazio ${semAcesso ? '' : 'erro'} py-5">
        <i class="bi ${semAcesso ? 'bi-lock' : 'bi-exclamation-triangle'}"></i><b>${semAcesso ? 'Você não tem acesso a esta tela' : 'Não foi possível abrir esta tela'}</b>
        ${esc(semAcesso ? 'Peça a liberação ao administrador, se precisar dela.' : e.message)}
        <div class="d-flex gap-2 justify-content-center">${semAcesso ? '' : '<button type="button" class="btn btn-sm btn-outline-secondary" data-recarregar><i class="bi bi-arrow-clockwise"></i> Tentar de novo</button>'}
          <a class="btn btn-sm btn-success" href="#/dashboard"><i class="bi bi-grid-1x2"></i> Ir para o painel</a></div></div></div>`;
      conteudo.querySelector('[data-recarregar]')?.addEventListener('click', rotear);
    }
    return;
  }
  conteudo.innerHTML = `<div class="card"><div class="vazio py-5"><i class="bi bi-signpost-split"></i><b>Página não encontrada</b>O endereço pode ter mudado ou o link está incompleto.
    <div><a class="btn btn-sm btn-success" href="#/dashboard"><i class="bi bi-grid-1x2"></i> Ir para o painel</a></div></div></div>`;
}
window.addEventListener('hashchange', rotear);

iniciar();
