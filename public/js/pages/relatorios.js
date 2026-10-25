// Relatórios: filtros, Gerar Relatório e Gerar Excel.
import { get, esc, fmt, titulo, campo, opcoes, lerForm, state, renderCell, baixar, tentar, erro, qs } from '../core.js';

const inicioMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

function filtrosDe(tipo) {
  const o = state.opcoes;
  const vend = () => campo('vendedor_id', 'Vendedor', { type: 'select', col: 'col-md-3', options: opcoes(o.usuarios.filter((u) => u.perfil === 'vendedor'), 'Todos') });
  const sup = () => campo('supervisor_id', 'Supervisor', { type: 'select', col: 'col-md-3', options: opcoes(o.usuarios.filter((u) => u.perfil === 'supervisor'), 'Todos') });
  const forma = () => campo('forma_id', 'Forma de pagamento', { type: 'select', col: 'col-md-3', options: opcoes(o.formas, 'Todas') });
  const banco = () => campo('banco_id', 'Banco', { type: 'select', col: 'col-md-3', options: opcoes(o.bancos, 'Todos') });
  const per = (pre, l) => campo(`${pre}_de`, `${l} de`, { type: 'date', col: 'col-md-3', value: inicioMes() }) + campo(`${pre}_ate`, 'até', { type: 'date', col: 'col-md-3', value: hoje() });
  const empresa = () => campo('empresa_id', 'Empresa', { type: 'select', col: 'col-md-3', options: opcoes(o.empresas, 'Empresa atual') });
  switch (tipo) {
    case 'contas-receber': return campo('venc_de', 'Vencimento de', { type: 'date', col: 'col-md-3' }) + campo('venc_ate', 'até', { type: 'date', col: 'col-md-3' }) + banco() + forma() + sup() + vend() + campo('agrupar_vendedor', 'Agrupar por vendedor', { type: 'checkbox', col: 'col-md-3' });
    case 'contas-recebidas': return per('baixa', 'Data de baixa') + banco() + forma() + sup() + vend();
    case 'vendas': return per('cad', 'Data de cadastro') + forma() + sup() + vend()
      + campo('etapa', 'Etapa', { type: 'select', col: 'col-md-3', options: [['', 'Todas'], ...Object.entries(state.me.etapas).map(([k, v]) => [k, v.label])] })
      + campo('equipe_id', 'Equipe', { type: 'select', col: 'col-md-3', options: opcoes(o.equipes, 'Todas') });
    case 'faturamento': return per('emissao', 'Emissão') + empresa();
    case 'vencidas': return campo('venc_de', 'Vencimento de', { type: 'date', col: 'col-md-3' }) + campo('venc_ate', 'até', { type: 'date', col: 'col-md-3' }) + sup() + vend()
      + campo('negativado', 'Cliente negativado', { type: 'select', col: 'col-md-3', options: [['', 'Todos'], ['sim', 'Sim'], ['nao', 'Não']] }) + forma() + banco();
    case 'historico-vendas': return per('emissao', 'Emissão') + empresa();
    case 'venda-produtos': return campo('tipo', 'Tipo de relatório', { type: 'select', col: 'col-md-3', options: [['sintetico', 'Sintético'], ['analitico', 'Analítico (por nota)']] })
      + per('emissao', 'Emissão') + campo('quantidade_min', 'Quantidade mínima', { type: 'number', col: 'col-md-2' })
      + campo('prazo_meses', 'Prazo em meses (substitui o período)', { type: 'number', col: 'col-md-3', attrs: 'min="1" max="60"' })
      + campo('sumarizacao', 'Sumarização', { type: 'select', col: 'col-md-3', options: [['produto', 'Produto'], ['grupo', 'Grupo'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['mes', 'Mês']] })
      + campo('por_embalagem', 'Por embalagem', { type: 'checkbox', col: 'col-md-2' });
    case 'contas-pagar': return campo('venc_de', 'Vencimento de', { type: 'date', col: 'col-md-3' }) + campo('venc_ate', 'até', { type: 'date', col: 'col-md-3' })
      + campo('situacao', 'Situação', { type: 'select', col: 'col-md-3', options: [['', 'Todas (exceto canceladas)'], ['abertas', 'Em aberto'], ['vencidas', 'Vencidas'], ['pagas', 'Pagas']] })
      + campo('fornecedor_id', 'Fornecedor', { type: 'select', col: 'col-md-3', options: opcoes(o.fornecedores, 'Todos') })
      + campo('categoria', 'Categoria', { type: 'select', col: 'col-md-3', options: [['', 'Todas'], ...['Matéria-prima', 'Embalagem', 'Frete', 'Folha', 'Impostos', 'Aluguel', 'Energia', 'Manutenção', 'Serviços', 'Outros'].map((c) => [c, c])] })
      + campo('agrupar', 'Agrupar por', { type: 'select', col: 'col-md-3', options: [['', 'Não agrupar'], ['categoria', 'Categoria'], ['fornecedor', 'Fornecedor']] });
    case 'fluxo-caixa': return campo('venc_de', 'De', { type: 'date', col: 'col-md-3', value: hoje() })
      + campo('venc_ate', 'Até', { type: 'date', col: 'col-md-3', value: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) })
      + '<div class="col-md-6 small text-muted d-flex align-items-end">Parcelas a receber em aberto menos contas a pagar em aberto, dia a dia.</div>';
    case 'posicao-estoque': return campo('grupo_id', 'Grupo', { type: 'select', col: 'col-md-3', options: opcoes(o.grupos, 'Todos') })
      + campo('por_lote', 'Abrir por lote', { type: 'checkbox', col: 'col-md-2' }) + campo('zerados', 'Incluir zerados', { type: 'checkbox', col: 'col-md-2' })
      + campo('agrupar_grupo', 'Agrupar por grupo', { type: 'checkbox', col: 'col-md-2' });
    case 'movimentacao-estoque': return per('mov', 'Movimento')
      + campo('origem', 'Origem', { type: 'select', col: 'col-md-3', options: [['', 'Todas'], ['compra', 'Compra'], ['producao', 'Produção'], ['venda', 'Venda'], ['devolucao', 'Devolução'], ['cancelamento', 'Cancelamento de NF'], ['inventario', 'Inventário'], ['perda', 'Perda'], ['consumo', 'Consumo'], ['amostra', 'Amostra'], ['ajuste', 'Ajuste']] });
    default: return '<div class="col-12 small text-muted">Este relatório não tem filtros.</div>';
  }
}

// Grupo, descrição curta e ícone de cada relatório na tela inicial.
const INFO = {
  vendas: ['Vendas', 'Pedidos por período, etapa, vendedor e equipe.', 'bi-cart3'],
  'historico-vendas': ['Vendas', 'Notas emitidas por cliente ao longo do tempo.', 'bi-clock-history'],
  'venda-produtos': ['Vendas', 'Quantidade e valor vendido por produto, grupo, cliente ou mês.', 'bi-box'],
  'vendedores-supervisor': ['Vendas', 'Carteira de vendedores de cada supervisor.', 'bi-people'],
  'contas-receber': ['Financeiro', 'Parcelas em aberto por vencimento, banco e vendedor.', 'bi-wallet2'],
  'contas-recebidas': ['Financeiro', 'Baixas do período por banco e forma de pagamento.', 'bi-cash-coin'],
  vencidas: ['Financeiro', 'Parcelas em atraso, com filtro de negativados.', 'bi-exclamation-triangle'],
  faturamento: ['Financeiro', 'Notas fiscais emitidas no período por empresa.', 'bi-receipt'],
  'contas-pagar': ['Financeiro', 'Contas de fornecedores por situação, categoria e fornecedor.', 'bi-credit-card-2-back'],
  'fluxo-caixa': ['Financeiro', 'A receber menos a pagar, dia a dia.', 'bi-graph-up'],
  'posicao-estoque': ['Estoque', 'Saldo por produto, embalagem e lote.', 'bi-boxes'],
  'movimentacao-estoque': ['Estoque', 'Entradas e saídas do período por origem.', 'bi-arrow-left-right'],
};

export default async function (conteudo, { params: [tipo] }) {
  const lista = await get('/api/relatorios');
  if (!tipo) {
    const pagina = titulo(conteudo, 'Relatórios', 'bi-bar-chart-line');
    const grupos = [...new Set(lista.map((r) => (INFO[r.id] || ['Outros'])[0]))];
    pagina.innerHTML = grupos.map((g) => `<h3 class="secao-titulo">${esc(g)}</h3><div class="row g-3 mb-4">${lista.filter((r) => (INFO[r.id] || ['Outros'])[0] === g).map((r) => {
      const [, desc, icone] = INFO[r.id] || ['', '', 'bi-file-earmark-bar-graph'];
      return `<div class="col-sm-6 col-lg-4 col-xxl-3"><a class="kpi-link" href="#/relatorios/${r.id}"><div class="card kpi cor-primary h-100"><div class="card-body d-flex gap-3">
        <span class="icone" aria-hidden="true"><i class="bi ${icone}"></i></span><div><div class="fw-semibold">${esc(r.titulo)}</div>${desc ? `<div class="sub mt-1">${esc(desc)}</div>` : ''}</div>
        <i class="bi bi-arrow-up-right" aria-hidden="true"></i></div></div></a></div>`;
    }).join('')}</div>`).join('');
    return;
  }
  const def = lista.find((r) => r.id === tipo);
  if (!def) { conteudo.innerHTML = '<div class="vazio">Relatório não disponível para o seu perfil.</div>'; return; }
  const pagina = titulo(conteudo, def.titulo, 'bi-file-earmark-bar-graph', '<a href="#/relatorios" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left"></i> Relatórios</a>');
  pagina.innerHTML = `<div class="card mb-3 no-print"><div class="card-body"><form class="row g-2">${filtrosDe(tipo)}
    <div class="col-12 d-flex gap-2 mt-2"><button class="btn btn-success btn-sm" type="submit"><i class="bi bi-play-fill"></i> Gerar relatório</button>
    <button class="btn btn-outline-success btn-sm" type="button" data-excel><i class="bi bi-file-earmark-excel"></i> Gerar Excel</button>
    <button class="btn btn-outline-secondary btn-sm d-none" type="button" data-print><i class="bi bi-printer"></i> Imprimir</button></div></form></div></div>
    <div id="rel-res"></div>`;
  const f = pagina.querySelector('form');
  const params = () => {
    const v = lerForm(f);
    if (v.agrupar_vendedor === 0) delete v.agrupar_vendedor;
    if (v.por_embalagem === 0) delete v.por_embalagem;
    return v;
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = pagina.querySelector('#rel-res');
    res.innerHTML = '<div class="vazio"><div class="spinner-border spinner-border-sm"></div> Gerando...</div>';
    try {
      const d = await get(`/api/relatorios/${tipo}` + qs(params()));
      res.innerHTML = desenhar(d);
      pagina.querySelector('[data-print]').classList.remove('d-none');
    } catch (err) { res.innerHTML = ''; erro(err); }
  });
  pagina.querySelector('[data-excel]').addEventListener('click', () => tentar(() => baixar(`/api/relatorios/${tipo}` + qs({ ...params(), export: 'xlsx' }), `${tipo}.xlsx`)));
  pagina.querySelector('[data-print]').addEventListener('click', () => window.print());
}

function desenhar(d) {
  if (!d.linhas.length) return '<div class="vazio">Nenhum registro para os filtros informados.</div>';
  const cols = d.colunas;
  const cel = (c, l) => `<td class="${c.t === 'money' ? 'num' : ''}">${renderCell({ ...c, t: c.t === 'money' ? 'money' : c.t }, l[c.k], l)}</td>`;
  const linhaTotal = (rot, linhas) => {
    const tot = {};
    for (const k of Object.keys(d.totais)) tot[k] = linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0);
    return `<tr class="table-light fw-semibold">${cols.map((c, i) => `<td class="${c.t === 'money' ? 'num' : ''}">${i === 0 ? esc(rot) : k(c, tot)}</td>`).join('')}</tr>`;
  };
  const k = (c, tot) => (c.k in tot ? (c.t === 'money' ? fmt.money(tot[c.k]) : fmt.num(tot[c.k])) : '');
  let corpo = '';
  if (d.agrupar) {
    const grupos = {};
    d.linhas.forEach((l) => (grupos[l[d.agrupar] ?? '—'] ||= []).push(l));
    for (const [g, ls] of Object.entries(grupos)) {
      corpo += `<tr class="table-success"><td colspan="${cols.length}" class="fw-semibold">${esc(g)} (${ls.length})</td></tr>`;
      corpo += ls.map((l) => `<tr>${cols.map((c) => cel(c, l)).join('')}</tr>`).join('');
      if (Object.keys(d.totais).length) corpo += linhaTotal(`Subtotal ${g}`, ls);
    }
  } else {
    corpo = d.linhas.map((l) => `<tr>${cols.map((c) => cel(c, l)).join('')}</tr>`).join('');
  }
  if (Object.keys(d.totais).length) corpo += linhaTotal(`TOTAL (${d.linhas.length} registros)`, d.linhas);
  return `<div class="card"><div class="card-header py-2 d-flex">${esc(d.titulo)} <small class="ms-auto text-muted">${esc(state.me.empresa.nome)} · gerado em ${fmt.datetime(d.gerado_em.replace('T', ' '))}</small></div>
    <div class="table-responsive"><table class="table table-sm table-striped mb-0 dt"><thead><tr>${cols.map((c) => `<th class="${c.t === 'money' ? 'num' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div></div>`;
}
