// Controle de estoque: saldos por embalagem, lotes, entradas e saídas, inventário e estoque mínimo.
import {
  get, post, put, esc, fmt, titulo, abas, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, pode, btnAcao, tabelaSimples, kpi,
} from '../core.js';

const SITUACAO = { ok: ['Normal', 'success'], baixo: ['Abaixo do mínimo', 'warning'], zerado: ['Sem saldo', 'danger'] };
const ORIGENS = {
  compra: 'Compra', producao: 'Produção', venda: 'Venda (NF)', devolucao: 'Devolução', cancelamento: 'Cancelamento de NF', inventario: 'Inventário',
  perda: 'Perda/avaria', consumo: 'Consumo interno', amostra: 'Amostra', ajuste: 'Ajuste', manual: 'Manual',
};
const ENTRADAS = ['compra', 'producao', 'devolucao', 'ajuste'];
const SAIDAS = ['perda', 'consumo', 'amostra', 'ajuste'];
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const sit = (v) => { const [l, c] = SITUACAO[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };

export default async function (conteudo) {
  const mov = pode('estoque.movimentar');
  const pagina = titulo(conteudo, 'Estoque', 'bi-boxes', `${pode('compras') ? '<a class="btn btn-sm btn-outline-secondary" href="#/compras/reposicao"><i class="bi bi-arrow-repeat"></i> Repor estoque</a>' : ''}` + (mov ? `
    <button class="btn btn-sm btn-success" id="btn-entrada"><i class="bi bi-box-arrow-in-down"></i> Entrada</button>
    <button class="btn btn-sm btn-outline-danger" id="btn-saida"><i class="bi bi-box-arrow-up"></i> Saída</button>` : ''));
  pagina.innerHTML = `<div class="kpis mb-3" id="kpis"></div>${abas([
    { id: 'saldos', label: '<i class="bi bi-boxes"></i> Saldos', html: '<div id="t-saldos"></div>' },
    { id: 'mov', label: '<i class="bi bi-arrow-left-right"></i> Movimentações', html: '<div id="t-mov"></div>' },
    { id: 'val', label: '<i class="bi bi-calendar-x"></i> Validade e parados', html: '<div id="val"></div>' },
    ...(mov ? [{ id: 'inv', label: '<i class="bi bi-clipboard-check"></i> Inventário', html: '<div id="inv"></div>' }] : []),
  ], 'est')}`;

  const resumo = async () => {
    const r = await get('/api/estoque/resumo');
    pagina.querySelector('#kpis').innerHTML = [
      kpi('Itens em estoque', fmt.num(r.itens), { icone: 'bi-boxes', cor: 'primary' }),
      kpi('Valor em estoque (custo)', fmt.money(r.valor), { icone: 'bi-cash-stack', cor: 'success' }),
      kpi('Abaixo do mínimo', fmt.num(r.baixos), { icone: 'bi-exclamation-triangle', cor: r.baixos ? 'warning' : 'success' }),
      kpi('Sem saldo', fmt.num(r.zerados), { icone: 'bi-x-octagon', cor: r.zerados ? 'danger' : 'success' }),
      kpi(`Lotes vencendo em ${r.dias_validade} dias`, fmt.num(r.vencendo), { icone: 'bi-calendar-x', cor: r.vencidos ? 'danger' : r.vencendo ? 'warning' : 'secondary', sub: r.vencidos ? `${fmt.num(r.vencidos)} já vencido(s)` : '' }),
      kpi('Produtos parados', fmt.num(r.parados), { icone: 'bi-hourglass-bottom', cor: r.parados ? 'warning' : 'secondary' }),
    ].join('');
  };

  const tSaldos = new DataTable(pagina.querySelector('#t-saldos'), {
    url: '/api/estoque/saldos', title: 'Saldos de estoque', sort: 'produto', dir: 'asc',
    columns: [
      { k: 'codigo', l: 'Código' }, { k: 'produto', l: 'Produto' }, { k: 'grupo', l: 'Grupo', filter: { options: state.opcoes.grupos.map((g) => [g.nome, g.nome]) } },
      { k: 'embalagem', l: 'Embalagem' }, { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'reservado', l: 'Em pedidos', t: 'num' },
      { k: 'disponivel', l: 'Disponível', t: 'num', filter: false, export: false, render: (v, r) => `<b class="${r.saldo - r.reservado < 0 ? 'text-danger' : ''}">${fmt.num(r.saldo - r.reservado)}</b>` },
      { k: 'minimo', l: 'Mínimo', t: 'num' }, { k: 'situacao', l: 'Situação', filter: { options: Object.entries(SITUACAO).map(([k, [l]]) => [k, l]) }, render: sit },
      { k: 'lotes', l: 'Lotes', t: 'num' }, { k: 'custo_medio', l: 'Custo médio', t: 'money' }, { k: 'valor_estoque', l: 'Valor', t: 'money' },
      { k: 'ultimo_movimento', l: 'Última mov.', t: 'datetime' },
    ],
    rowClass: (r) => (r.situacao === 'zerado' ? 'table-danger' : r.situacao === 'baixo' ? 'table-warning' : ''),
    actions: () => [
      btnAcao('lotes', 'bi-upc', 'Lotes e movimentações'),
      mov ? btnAcao('entrada', 'bi-box-arrow-in-down', 'Entrada', 'outline-success') : '',
      mov ? btnAcao('saida', 'bi-box-arrow-up', 'Saída', 'outline-danger') : '',
      mov ? btnAcao('minimo', 'bi-sliders', 'Estoque mínimo e peso') : '',
    ].join(' '),
    onAction: {
      lotes: (r) => verLotes(r),
      entrada: (r) => movimentar('entrada', r, atualizar),
      saida: (r) => movimentar('saida', r, atualizar),
      minimo: (r) => modal({
        title: `Estoque mínimo · ${esc(r.produto)} ${esc(r.embalagem)}`, size: 'md',
        body: `<form class="row g-2">${campo('estoque_minimo', 'Estoque mínimo (embalagens)', { type: 'number', col: 'col-md-6', value: r.minimo, attrs: 'min="0" step="1"' })}
          ${campo('peso_kg', 'Peso bruto por embalagem (kg)', { type: 'number', col: 'col-md-6', attrs: 'min="0" step="0.01"', help: 'Usado no peso das etiquetas de envio.' })}</form>`,
        buttons: [{ label: 'Salvar', onClick: async ({ body }) => { await put(`/api/estoque/minimo/${r.embalagem_id}`, lerForm(body.querySelector('form'))); toast('Salvo.'); atualizar(); } }],
      }),
    },
  });
  const tMov = new DataTable(pagina.querySelector('#t-mov'), {
    url: '/api/estoque/movimentos', title: 'Movimentações de estoque', sort: 'id', dir: 'desc',
    columns: [
      { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'produto', l: 'Produto' }, { k: 'embalagem', l: 'Embalagem' },
      { k: 'tipo', l: 'Tipo', filter: { options: [['entrada', 'Entrada'], ['saida', 'Saída'], ['ajuste', 'Ajuste']] }, render: (v) => ({ entrada: '<span class="text-success"><i class="bi bi-arrow-down-circle"></i> Entrada</span>', saida: '<span class="text-danger"><i class="bi bi-arrow-up-circle"></i> Saída</span>', ajuste: '<i class="bi bi-arrow-repeat"></i> Ajuste' })[v] || esc(v) },
      { k: 'origem', l: 'Origem', filter: { options: Object.entries(ORIGENS) }, render: (v) => esc(ORIGENS[v] || v) },
      { k: 'quantidade', l: 'Quantidade', t: 'num', render: (v) => `<span class="${v < 0 ? 'text-danger' : 'text-success'} fw-semibold">${v > 0 ? '+' : ''}${fmt.num(v)}</span>` },
      { k: 'lote', l: 'Lote' }, { k: 'validade', l: 'Validade', t: 'date' }, { k: 'custo_unitario', l: 'Custo unit.', t: 'money' },
      { k: 'fornecedor', l: 'Fornecedor' }, { k: 'pedido', l: 'Pedido' }, { k: 'documento', l: 'Documento' }, { k: 'observacao', l: 'Observação', cls: 'quebra' }, { k: 'usuario', l: 'Usuário' },
    ],
  });
  const val = validadeParados(pagina.querySelector('#val'), mov, () => atualizar());
  const atualizar = () => { tSaldos.reload(); tMov.reload(); val.reload(); resumo(); };
  resumo();
  if (mov) {
    conteudo.querySelector('#btn-entrada').addEventListener('click', () => movimentar('entrada', null, atualizar));
    conteudo.querySelector('#btn-saida').addEventListener('click', () => movimentar('saida', null, atualizar));
    inventario(pagina.querySelector('#inv'), atualizar);
  }
}

async function verLotes(r) {
  const [lotes, movs] = await Promise.all([get(`/api/estoque/lotes/${r.embalagem_id}`), get(`/api/estoque/movimentos?f_embalagem_id=${r.embalagem_id}&pageSize=30`)]);
  const venc = (v) => (v && v < hoje() ? `<span class="text-danger">${fmt.date(v)} (vencido)</span>` : fmt.date(v));
  modal({
    title: `${esc(r.produto)} · ${esc(r.embalagem)}`, size: 'xl',
    body: `<div class="d-flex gap-4 mb-3 small"><div>Saldo <b class="fs-5">${fmt.num(r.saldo)}</b></div><div>Em pedidos <b class="fs-5">${fmt.num(r.reservado)}</b></div><div>Mínimo <b class="fs-5">${fmt.num(r.minimo)}</b></div><div>${sit(r.situacao)}</div></div>
      <h6>Lotes com saldo</h6>${tabelaSimples([{ k: 'lote', l: 'Lote', render: (v) => esc(v || '(sem lote)') }, { k: 'validade', l: 'Validade', render: venc }, { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'entrada', l: 'Primeira entrada', t: 'datetime' }], lotes, { vazio: 'Nenhum lote com saldo.' })}
      <h6 class="mt-3">Últimas movimentações</h6>${tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'origem', l: 'Origem', render: (v) => esc(ORIGENS[v] || v) },
        { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'lote', l: 'Lote' }, { k: 'documento', l: 'Documento' }, { k: 'usuario', l: 'Usuário' }], movs.rows)}`,
  });
}

/** Lançamento de entrada ou saída. Quantidade sempre positiva; o tipo define o sinal. */
export function movimentar(tipo, item, aoSalvar) {
  const o = state.opcoes;
  const entrada = tipo === 'entrada';
  const embs = o.embalagens.map((e) => [e.id, `${e.produto} · ${e.descricao}`]);
  modal({
    title: entrada ? '<i class="bi bi-box-arrow-in-down text-success"></i> Entrada no estoque' : '<i class="bi bi-box-arrow-up text-danger"></i> Saída do estoque', size: 'lg',
    body: `<form class="row g-2">
      ${campo('embalagem_id', 'Produto e embalagem', { type: 'select', col: 'col-md-8', required: true, options: [['', 'Selecione...'], ...embs], value: item?.embalagem_id || '' })}
      ${campo('quantidade', 'Quantidade (embalagens)', { type: 'number', col: 'col-md-4', required: true, attrs: 'min="0.01" step="0.01"' })}
      ${campo('origem', 'Motivo', { type: 'select', col: 'col-md-4', options: (entrada ? ENTRADAS : SAIDAS).map((k) => [k, ORIGENS[k]]) })}
      ${entrada ? campo('lote', 'Lote', { col: 'col-md-4' }) : `<div class="col-md-4"><label class="form-label">Lote</label><select name="lote" class="form-select form-select-sm"><option value="">Qualquer / sem lote</option></select></div>`}
      ${entrada ? campo('validade', 'Validade', { type: 'date', col: 'col-md-4' }) : '<div class="col-md-4"></div>'}
      ${entrada ? campo('fornecedor_id', 'Fornecedor', { type: 'select', col: 'col-md-6', options: opcoes(o.fornecedores, '—') }) : ''}
      ${entrada ? campo('custo_unitario', 'Custo unitário (R$)', { type: 'number', col: 'col-md-3', attrs: 'min="0" step="0.01"' }) : ''}
      ${campo('documento', entrada ? 'Documento (NF, ordem de produção)' : 'Documento', { col: entrada ? 'col-md-3' : 'col-md-6' })}
      ${campo('observacao', 'Observação', { col: entrada ? 'col-12' : 'col-md-6' })}</form>`,
    onShow: ({ body }) => {
      if (entrada) return;
      const sel = body.querySelector('[name=embalagem_id]');
      const lotes = async () => {
        const l = sel.value ? await get(`/api/estoque/lotes/${sel.value}`) : [];
        body.querySelector('[name=lote]').innerHTML = '<option value="">Qualquer / sem lote</option>' + l.filter((x) => x.lote && x.saldo > 0)
          .map((x) => `<option value="${esc(x.lote)}">${esc(x.lote)} · saldo ${fmt.num(x.saldo)}${x.validade ? ' · val. ' + fmt.date(x.validade) : ''}</option>`).join('');
      };
      sel.addEventListener('change', lotes);
      lotes();
    },
    buttons: [{ label: entrada ? 'Lançar entrada' : 'Lançar saída', cls: entrada ? 'btn-success' : 'btn-danger', onClick: async ({ body }) => {
      const r = await post('/api/estoque/movimentos', { ...lerForm(body.querySelector('form')), tipo });
      toast(`Movimento lançado. Novo saldo: ${fmt.num(r.saldo)}`);
      aoSalvar?.();
    } }],
  });
}

async function inventario(el, aoSalvar) {
  el.innerHTML = `<div class="card"><div class="card-body">
    <p class="small text-muted mb-2">Digite a quantidade contada de cada item (por lote, se houver). Só os itens preenchidos são ajustados; a diferença é lançada como movimento de inventário.</p>
    <div class="d-flex gap-2 mb-2 flex-wrap"><select class="form-select form-select-sm w-auto" data-grupo>${opcoes(state.opcoes.grupos, 'Todos os grupos').map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-outline-secondary" data-carregar><i class="bi bi-arrow-clockwise"></i> Carregar itens</button>
      <button class="btn btn-sm btn-outline-secondary" data-imprimir><i class="bi bi-printer"></i> Folha de contagem</button>
      <button class="btn btn-sm btn-success ms-auto" data-salvar><i class="bi bi-check2-all"></i> Lançar ajustes</button></div>
    <div data-lista class="table-responsive"></div></div></div>`;
  let linhas = [];
  const carregar = async () => {
    const g = el.querySelector('[data-grupo]');
    const grupo = g.value ? g.selectedOptions[0].textContent : '';
    const saldos = (await get(`/api/estoque/saldos?all=1${grupo ? '&f_grupo=' + encodeURIComponent(grupo) : ''}`)).rows;
    linhas = [];
    for (const s of saldos) {
      const lotes = s.lotes ? (await get(`/api/estoque/lotes/${s.embalagem_id}`)).filter((l) => l.lote) : [];
      if (lotes.length) lotes.forEach((l) => linhas.push({ ...s, lote: l.lote, validade: l.validade, sistema: l.saldo }));
      else linhas.push({ ...s, lote: null, sistema: s.saldo });
    }
    el.querySelector('[data-lista]').innerHTML = `<table class="table table-sm align-middle"><thead><tr><th>Produto</th><th>Embalagem</th><th>Lote</th><th>Validade</th><th class="num">Sistema</th><th style="width:130px">Contado</th><th class="num">Diferença</th></tr></thead>
      <tbody>${linhas.map((l, i) => `<tr><td>${esc(l.produto)}</td><td>${esc(l.embalagem)}</td><td>${esc(l.lote || '—')}</td><td>${fmt.date(l.validade)}</td><td class="num">${fmt.num(l.sistema)}</td>
        <td><input type="number" step="0.01" min="0" class="form-control form-control-sm" data-i="${i}"></td><td class="num" data-dif="${i}"></td></tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-i]').forEach((inp) => inp.addEventListener('input', () => {
      const l = linhas[inp.dataset.i];
      const d = inp.value === '' ? '' : Number(inp.value) - l.sistema;
      el.querySelector(`[data-dif="${inp.dataset.i}"]`).innerHTML = d === '' ? '' : `<span class="${d < 0 ? 'text-danger' : d > 0 ? 'text-success' : ''} fw-semibold">${d > 0 ? '+' : ''}${fmt.num(d)}</span>`;
    }));
  };
  el.querySelector('[data-carregar]').addEventListener('click', () => tentar(carregar));
  el.querySelector('[data-imprimir]').addEventListener('click', async () => {
    if (!linhas.length) await carregar();
    const w = window.open('', '_blank');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Folha de inventário</title><style>body{font:12px Arial;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:5px}th{background:#e8f5e9}td.c{width:110px}</style></head>
      <body><h2 style="margin:0">Folha de contagem de estoque</h2><small>${esc(state.me.empresa?.nome || '')} · ${new Date().toLocaleString('pt-BR')} · Responsável: ____________________</small>
      <table style="margin-top:10px"><thead><tr><th>Produto</th><th>Embalagem</th><th>Lote</th><th>Validade</th><th>Contado</th><th>Observação</th></tr></thead><tbody>
      ${linhas.map((l) => `<tr><td>${esc(l.produto)}</td><td>${esc(l.embalagem)}</td><td>${esc(l.lote || '')}</td><td>${fmt.date(l.validade)}</td><td class="c"></td><td class="c"></td></tr>`).join('')}
      </tbody></table><script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  });
  el.querySelector('[data-salvar]').addEventListener('click', async () => {
    const itens = [...el.querySelectorAll('[data-i]')].filter((i) => i.value !== '').map((i) => ({ embalagem_id: linhas[i.dataset.i].embalagem_id, lote: linhas[i.dataset.i].lote, contado: Number(i.value) }));
    if (!itens.length) return toast('Preencha ao menos uma contagem.', 'warning');
    const r = await tentar(() => post('/api/estoque/inventario', { itens }));
    if (r) { toast(`${r.ajustes.length} ajuste(s) lançado(s).`); carregar(); aoSalvar?.(); }
  });
}

const VAL = { vencido: ['Vencido', 'danger'], vence_30: ['Vence em até 30 dias', 'warning'], vence_depois: ['Vence depois', 'info'] };

/** Lotes vencidos e vencendo, e produtos sem saída há muito tempo: baixa como perda ou campanha para girar. */
function validadeParados(el, mov, aoMudar) {
  const camp = pode('metas.gerir');
  el.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-end mb-2"><h6 class="mb-0 me-auto"><i class="bi bi-calendar-x"></i> Lotes vencidos e vencendo</h6>
      ${mov ? '<button class="btn btn-sm btn-outline-secondary" data-regras><i class="bi bi-sliders"></i> Regras</button>' : ''}
      <label class="small text-muted">Vencendo em até <input type="number" class="form-control form-control-sm d-inline-block" style="width:80px" data-dias-val min="0" step="15"> dias</label></div>
    <div data-tv></div>
    <div class="d-flex flex-wrap gap-2 align-items-end mb-2 mt-4"><h6 class="mb-0 me-auto"><i class="bi bi-hourglass-bottom"></i> Produtos parados</h6>
      <label class="small text-muted">Sem saída há mais de <input type="number" class="form-control form-control-sm d-inline-block" style="width:80px" data-dias-par min="1" step="30"> dias</label></div>
    <p class="small text-muted mb-2">Conta como saída a venda, o consumo interno e a amostra (ou o último pedido faturado do item). Item nunca vendido conta desde a primeira entrada.</p>
    <div data-tp></div>`;
  const dv = el.querySelector('[data-dias-val]');
  const dp = el.querySelector('[data-dias-par]');
  const tv = new DataTable(el.querySelector('[data-tv]'), {
    url: () => `/api/estoque/validade${dv.value ? `?dias=${dv.value}` : ''}`, title: 'Lotes vencidos e vencendo', sort: 'validade', dir: 'asc',
    columns: [
      { k: 'produto', l: 'Produto' }, { k: 'embalagem', l: 'Embalagem' }, { k: 'lote', l: 'Lote' }, { k: 'validade', l: 'Validade', t: 'date' },
      { k: 'dias_para_vencer', l: 'Dias', t: 'num', render: (v) => `<span class="${v < 0 ? 'text-danger fw-semibold' : v <= 30 ? 'text-warning-emphasis fw-semibold' : ''}">${v < 0 ? `vencido há ${-v}` : v}</span>` },
      { k: 'situacao', l: 'Situação', filter: { options: Object.entries(VAL).map(([k, [l]]) => [k, l]) }, render: (v) => `<span class="badge text-bg-${VAL[v][1]}">${VAL[v][0]}</span>` },
      { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'custo', l: 'Custo unit.', t: 'money' }, { k: 'valor', l: 'Valor em risco', t: 'money' },
    ],
    rowClass: (r) => (r.situacao === 'vencido' ? 'table-danger' : r.situacao === 'vence_30' ? 'table-warning' : ''),
    actions: (r) => [
      camp && r.situacao !== 'vencido' ? btnAcao('campanha', 'bi-megaphone', 'Criar campanha para vender antes de vencer', 'outline-primary') : '',
      mov ? btnAcao('perda', 'bi-trash3', 'Baixar como perda', 'outline-danger') : '',
    ].join(' '),
    onAction: { campanha: (r) => campanha(r, `vender o lote ${r.lote} antes de ${fmt.date(r.validade)}`), perda: (r) => perda(r, aoMudar) },
  });
  const tp = new DataTable(el.querySelector('[data-tp]'), {
    url: () => `/api/estoque/parados${dp.value ? `?dias=${dp.value}` : ''}`, title: 'Produtos parados', sort: 'valor', dir: 'desc',
    columns: [
      { k: 'codigo', l: 'Código' }, { k: 'produto', l: 'Produto' }, { k: 'grupo', l: 'Grupo' }, { k: 'embalagem', l: 'Embalagem' },
      { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'ultima_venda', l: 'Última saída', t: 'date', render: (v, r) => (r.nunca_vendido ? '<span class="badge text-bg-secondary">nunca vendido</span>' : fmt.date(v)) },
      { k: 'dias_parado', l: 'Dias parado', t: 'num' }, { k: 'valor', l: 'Capital parado', t: 'money' },
    ],
    actions: () => (camp ? btnAcao('campanha', 'bi-megaphone', 'Criar campanha para girar', 'outline-primary') : ''),
    onAction: { campanha: (r) => campanha(r, `girar estoque parado há ${r.dias_parado} dias`) },
  });
  get('/api/estoque/regras').then((cfg) => {
    const v = Object.fromEntries(cfg.map((c) => [c.chave, c.valor]));
    dv.placeholder = v['estoque.alerta_validade_dias'];
    dp.placeholder = v['estoque.dias_parado'];
  }).catch(() => {});
  el.querySelector('[data-regras]')?.addEventListener('click', async () => {
    const cfg = await get('/api/estoque/regras');
    modal({
      title: 'Regras de validade e produto parado', size: 'md',
      body: `<form class="vstack gap-3">${cfg.map((c) => (c.tipo === 'opcao'
        ? `<div><label class="form-label">${esc(c.rotulo)}</label><select class="form-select form-select-sm" name="${c.chave}">${c.opcoes.map(([v, l]) => `<option value="${v}" ${v === c.valor ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`
        : `<div><label class="form-label">${esc(c.rotulo)}</label><input type="number" class="form-control form-control-sm" name="${c.chave}" value="${c.valor ?? ''}" min="0" step="1" style="max-width:140px"><div class="form-text">Padrão: ${c.padrao}</div></div>`)).join('')}</form>`,
      buttons: [{ label: 'Salvar regras', onClick: async ({ body }) => {
        const f = body.querySelector('form');
        await put('/api/estoque/regras', Object.fromEntries([...f.querySelectorAll('[name]')].map((x) => [x.name, x.value])));
        toast('Regras salvas.');
        aoMudar?.();
      } }],
    });
  });
  let t;
  for (const [inp, tab] of [[dv, tv], [dp, tp]]) inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => tab.reload(), 400); });
  return { reload: () => { tv.reload(); tp.reload(); } };
}

function perda(r, aoSalvar) {
  modal({
    title: `<i class="bi bi-trash3 text-danger"></i> Baixar como perda · ${esc(r.produto)} lote ${esc(r.lote)}`, size: 'md',
    body: `<form class="row g-2">${campo('quantidade', 'Quantidade (embalagens)', { type: 'number', col: 'col-md-5', required: true, value: r.saldo, attrs: `min="0.01" max="${r.saldo}" step="0.01"` })}
      ${campo('documento', 'Documento (laudo, descarte)', { col: 'col-md-7' })}
      ${campo('observacao', 'Observação', { col: 'col-12', value: r.situacao === 'vencido' ? `Lote vencido em ${fmt.date(r.validade)}` : '' })}</form>
      <div class="small text-muted mt-2">Valor da perda: ${fmt.money(r.valor)} (saldo total do lote).</div>`,
    buttons: [{ label: 'Baixar como perda', cls: 'btn-danger', onClick: async ({ body }) => {
      await post('/api/estoque/movimentos', { ...lerForm(body.querySelector('form')), tipo: 'saida', origem: 'perda', embalagem_id: r.embalagem_id, lote: r.lote });
      toast('Perda lançada.');
      aoSalvar?.();
    } }],
  });
}

function campanha(r, objetivo) {
  const ini = hoje();
  const fim = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const fimSug = r.validade && r.validade < fim ? r.validade : fim;
  modal({
    title: `<i class="bi bi-megaphone"></i> Campanha · ${esc(r.produto)}`, size: 'md',
    body: `<p class="small text-muted">Objetivo: ${esc(objetivo)}. Saldo ${fmt.num(r.saldo)} ${esc(r.embalagem || '')}. Acompanhe em Metas e campanhas.</p>
      <form class="row g-2">${campo('nome', 'Nome', { col: 'col-12', required: true, value: `Giro ${r.produto}` })}
      ${campo('inicio', 'Início', { type: 'date', col: 'col-md-6', value: ini })}${campo('fim', 'Fim', { type: 'date', col: 'col-md-6', value: fimSug })}
      ${campo('indicador', 'Medir por', { type: 'select', col: 'col-md-6', options: [['valor', 'Valor vendido'], ['volume', 'Volume (kg/L)'], ['pedidos', 'Pedidos']] })}
      ${campo('meta_individual', 'Meta por vendedor', { type: 'number', col: 'col-md-6', required: true, attrs: 'min="0" step="any"' })}
      ${campo('premio', 'Prêmio', { col: 'col-12' })}${campo('descricao', 'Descrição', { col: 'col-12', value: `Campanha para ${objetivo}.` })}</form>`,
    buttons: [{ label: 'Criar campanha', onClick: async ({ body }) => {
      await post('/api/metas/campanhas', { ...lerForm(body.querySelector('form')), produto_id: r.produto_id });
      toast('Campanha criada. Ela aparece em Metas e campanhas para os vendedores.');
    } }],
  });
}
