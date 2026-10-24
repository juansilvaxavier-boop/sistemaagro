// Compras: solicitações dos setores, cotação com fornecedores, pedidos de compra com aprovação,
// recebimento da mercadoria (estoque + contas a pagar) e sugestão de reposição pelo estoque mínimo.
import {
  get, post, put, del, esc, fmt, titulo, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, pode, btnAcao, tabelaSimples, kpi, badge,
  pedirTexto, confirmar, erro, qs,
} from '../core.js';

const STATUS_SOL = { aberta: ['Aberta', 'primary'], cotacao: ['Em cotação', 'info'], atendida: ['Atendida', 'success'], recusada: ['Recusada', 'danger'], cancelada: ['Cancelada', 'secondary'] };
const STATUS_PC = {
  rascunho: ['Rascunho', 'secondary'], aprovacao: ['Aguardando aprovação', 'warning'], aprovada: ['Aprovada', 'primary'], enviada: ['Enviada ao fornecedor', 'info'],
  parcial: ['Recebida em parte', 'info'], recebida: ['Recebida', 'success'], cancelada: ['Cancelada', 'secondary'],
};
const URGENCIA = { baixa: ['Baixa', 'light'], normal: ['Normal', 'secondary'], alta: ['Alta', 'warning'], urgente: ['Urgente', 'danger'] };
const FORMAS = ['Boleto bancário', 'PIX', 'Transferência', 'Cartão', 'Dinheiro'];
// Departamento sugerido conforme o perfil de quem pede.
const DEPTO = { producao: 'Produção', expedicao: 'Logística', faturamento: 'Faturamento', financeiro: 'Financeiro', rh: 'RH', compras: 'Compras', analista: 'Crédito', supervisor: 'Comercial', gerente: 'Comercial', vendedor: 'Comercial', diretoria: 'Diretoria', admin: 'TI' };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const numero = (n) => `Nº ${n}`;

let OPC;

export default async function (conteudo, { params }) {
  const tela = params?.[0] || 'solicitacoes';
  OPC = await get('/api/compras/opcoes');
  if (tela === 'pedidos') return pedidos(conteudo);
  if (tela === 'receber') return receberLista(conteudo);
  if (tela === 'reposicao') return reposicao(conteudo);
  return solicitacoes(conteudo);
}

async function resumo(el) {
  const r = await get('/api/compras/resumo');
  el.innerHTML = [
    kpi('Solicitações em aberto', fmt.num(r.solicitacoes), { icone: 'bi-inbox', cor: r.urgentes ? 'danger' : 'primary', sub: `${r.urgentes} urgente(s)`, link: '#/compras' }),
    kpi('Aguardando aprovação', fmt.num(r.aprovacao), { icone: 'bi-hourglass-split', cor: r.aprovacao ? 'warning' : 'success', sub: fmt.money(r.valor_aprovacao), link: '#/compras/pedidos' }),
    kpi('A receber', fmt.num(r.a_receber), { icone: 'bi-truck', cor: r.atrasadas ? 'danger' : 'info', sub: `${r.atrasadas} atrasado(s)`, link: pode('compras.receber') ? '#/compras/receber' : '#/compras/pedidos' }),
    kpi('Recebido no mês', fmt.money(r.recebido_mes), { icone: 'bi-bag-check', cor: 'success' }),
    kpi('Itens para repor', fmt.num(r.reposicao), { icone: 'bi-arrow-repeat', cor: r.reposicao ? 'warning' : 'secondary', link: '#/compras/reposicao' }),
  ].join('');
}

// ---------- Solicitações ----------
function solicitacoes(conteudo) {
  const comprador = pode('compras.comprar');
  const pagina = titulo(conteudo, 'Solicitações de compra', 'bi-inbox', `
    ${pode('compras.solicitar') ? '<button class="btn btn-sm btn-success" data-nova><i class="bi bi-plus-lg"></i> Nova solicitação</button>' : ''}
    ${comprador ? '<button class="btn btn-sm btn-outline-success" data-direta><i class="bi bi-bag-plus"></i> Compra direta</button>' : ''}`);
  pagina.innerHTML = `${comprador || pode('compras.aprovar') ? '<div class="kpis mb-3" data-kpis></div>' : ''}<div data-t></div>`;
  const kp = pagina.querySelector('[data-kpis]');
  const t = new DataTable(pagina.querySelector('[data-t]'), {
    url: '/api/compras/solicitacoes', title: 'Solicitações de compra', sort: 'numero', dir: 'desc', chave: 'compras-sol',
    painel: [
      { tipo: 'periodo', k: 'created_at', l: 'Data da solicitação' }, { tipo: 'periodo', k: 'necessidade_em', l: 'Precisa até', atalhos: false },
      { tipo: 'select', k: 'departamento', l: 'Departamento', options: (state.opcoes.listas?.departamento || []).map((d) => [d.valor, d.valor]) }, { k: 'solicitante', l: 'Solicitante' },
    ],
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'solicitante', l: 'Solicitante' }, { k: 'departamento', l: 'Departamento' },
      { k: 'urgencia', l: 'Urgência', filter: { options: Object.entries(URGENCIA).map(([k, [l]]) => [k, l]) }, render: (v) => badge(v, URGENCIA) },
      { k: 'resumo', l: 'Itens', cls: 'quebra' }, { k: 'necessidade_em', l: 'Precisa até', t: 'date' }, { k: 'cotacoes', l: 'Cotações', t: 'num' },
      { k: 'status', l: 'Situação', filter: { options: Object.entries(STATUS_SOL).map(([k, [l]]) => [k, l]) }, render: (v) => badge(v, STATUS_SOL) },
      { k: 'compra', l: 'Pedido de compra' },
    ],
    rowClass: (r) => (['aberta', 'cotacao'].includes(r.status) && r.urgencia === 'urgente' ? 'table-danger' : ''),
    rowClick: (r) => abrirSolicitacao(r.id, atualizar),
  });
  const atualizar = () => { t.reload(); if (kp) resumo(kp).catch(erro); };
  if (kp) resumo(kp).catch(erro);
  conteudo.querySelector('[data-nova]')?.addEventListener('click', () => novaSolicitacao(atualizar));
  conteudo.querySelector('[data-direta]')?.addEventListener('click', () => formCompra(null, (id) => { atualizar(); abrirCompra(id); }));
  const ouvir = () => (document.body.contains(pagina) ? atualizar() : window.removeEventListener('compras-atualizadas', ouvir));
  window.addEventListener('compras-atualizadas', ouvir);
}

/** Linhas de itens: produto do estoque ou item avulso (descrição + categoria + unidade). */
function editorItens(el, { comPreco = false, itens = [], aoMudar } = {}) {
  const embs = state.opcoes.embalagens.map((e) => [e.id, `${e.produto} · ${e.descricao}`]);
  let linhas = itens.length ? itens.map((i) => ({ ...i, tipo: i.embalagem_id ? 'estoque' : 'outro' })) : [{ tipo: 'estoque', quantidade: '' }];
  const sel = (nome, valor, lista, vazio) => `<select class="form-select form-select-sm" data-k="${nome}">${vazio ? `<option value="">${vazio}</option>` : ''}${lista.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(valor ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const ler = () => {
    el.querySelectorAll('tbody tr').forEach((tr, i) => {
      const l = linhas[i];
      tr.querySelectorAll('[data-k]').forEach((x) => { l[x.dataset.k] = x.value; });
    });
  };
  const total = () => linhas.reduce((a, l) => a + (Number(l.quantidade) || 0) * (Number(l.preco_unitario) || 0), 0);
  const desenhar = () => {
    el.innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle mb-1 itens-compra"><thead><tr><th style="width:130px">Tipo</th><th>Item</th>
        <th style="width:110px" class="num">Quantidade</th>${comPreco ? '<th style="width:120px" class="num">Preço unit.</th><th class="num" style="width:110px">Subtotal</th>' : ''}<th style="width:36px"></th></tr></thead>
      <tbody>${linhas.map((l, i) => `<tr>
        <td>${sel('tipo', l.tipo, [['estoque', 'Produto do estoque'], ['outro', 'Outro item']])}</td>
        <td>${l.tipo === 'estoque' ? sel('embalagem_id', l.embalagem_id, embs, 'Selecione o produto...')
          : `<div class="d-flex gap-1 flex-wrap"><input class="form-control form-control-sm flex-grow-1" style="min-width:160px" data-k="descricao" value="${esc(l.descricao || '')}" placeholder="Descrição do item" maxlength="200">
             <div style="width:150px">${sel('categoria', l.categoria, OPC.categorias.map((c) => [c, c]), 'Categoria...')}</div>
             <div style="width:90px">${sel('unidade', l.unidade, OPC.unidades.map((u) => [u, u]), 'Un...')}</div></div>`}</td>
        <td><input type="number" class="form-control form-control-sm text-end" data-k="quantidade" min="0.01" step="any" value="${esc(l.quantidade ?? '')}"></td>
        ${comPreco ? `<td><input type="number" class="form-control form-control-sm text-end" data-k="preco_unitario" min="0" step="any" value="${esc(l.preco_unitario ?? '')}"></td>
          <td class="num" data-sub="${i}">${fmt.money((Number(l.quantidade) || 0) * (Number(l.preco_unitario) || 0))}</td>` : ''}
        <td><button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" data-rem="${i}" title="Remover" ${linhas.length === 1 ? 'disabled' : ''}><i class="bi bi-x"></i></button></td></tr>`).join('')}</tbody></table></div>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-add><i class="bi bi-plus"></i> Adicionar item</button>`;
    el.querySelectorAll('[data-k=tipo]').forEach((s) => s.addEventListener('change', () => { ler(); desenhar(); }));
    el.querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => { ler(); linhas.splice(Number(b.dataset.rem), 1); desenhar(); aoMudar?.(); }));
    el.querySelector('[data-add]').addEventListener('click', () => { ler(); linhas.push({ tipo: linhas.at(-1)?.tipo || 'estoque', quantidade: '' }); desenhar(); });
    el.querySelectorAll('[data-k=quantidade],[data-k=preco_unitario]').forEach((x) => x.addEventListener('input', () => {
      ler();
      if (comPreco) el.querySelectorAll('[data-sub]').forEach((td) => { const l = linhas[td.dataset.sub]; td.textContent = fmt.money((Number(l.quantidade) || 0) * (Number(l.preco_unitario) || 0)); });
      aoMudar?.();
    }));
  };
  desenhar();
  return {
    total: () => { ler(); return total(); },
    itens: () => {
      ler();
      return linhas.map((l) => (l.tipo === 'estoque'
        ? { embalagem_id: Number(l.embalagem_id) || null, quantidade: Number(l.quantidade), ...(comPreco ? { preco_unitario: Number(l.preco_unitario) } : {}) }
        : { descricao: l.descricao, categoria: l.categoria, unidade: l.unidade, quantidade: Number(l.quantidade), ...(comPreco ? { preco_unitario: Number(l.preco_unitario) } : {}) }));
    },
  };
}

function novaSolicitacao(aoSalvar) {
  const deps = (state.opcoes.listas?.departamento || []).map((d) => [d.valor, d.valor]);
  let ed;
  modal({
    title: '<i class="bi bi-inbox"></i> Nova solicitação de compra', size: 'xl',
    body: `<form class="row g-2" data-f>
      ${campo('departamento', 'Departamento', { type: 'select', col: 'col-md-4', required: true, value: DEPTO[state.me.usuario.perfil] || '', options: [['', 'Selecione...'], ...deps] })}
      ${campo('urgencia', 'Urgência', { type: 'select', col: 'col-md-4', value: 'normal', options: Object.entries(URGENCIA).map(([k, [l]]) => [k, l]) })}
      ${campo('necessidade_em', 'Precisa até', { type: 'date', col: 'col-md-4', attrs: `min="${hoje()}"` })}
      ${campo('justificativa', 'Justificativa', { type: 'textarea', col: 'col-12' })}</form>
      <h6 class="mt-3">Itens</h6><div data-itens></div>`,
    onShow: ({ body }) => { ed = editorItens(body.querySelector('[data-itens]')); },
    buttons: [{ label: '<i class="bi bi-send"></i> Enviar para compras', onClick: async ({ body }) => {
      const r = await post('/api/compras/solicitacoes', { ...lerForm(body.querySelector('[data-f]')), itens: ed.itens() });
      toast(`Solicitação ${r.numero} enviada para o setor de compras.`);
      aoSalvar?.();
    } }],
  });
}

async function abrirSolicitacao(id, aoMudar) {
  const s = await get(`/api/compras/solicitacoes/${id}`);
  const comprador = pode('compras.comprar');
  const aberta = ['aberta', 'cotacao'].includes(s.status);
  const minha = s.solicitante_id === state.me.usuario.id;
  const cot = s.cotacoes;
  // Menor preço de cada item entre as cotações fica destacado.
  const menor = Object.fromEntries(s.itens.map((i) => [i.id, Math.min(...cot.map((q) => q.precos[i.id] ?? Infinity))]));
  const melhorTotal = Math.min(...cot.map((q) => q.total));
  const comparativo = cot.length ? `<div class="table-responsive"><table class="table table-sm align-middle comparativo"><thead><tr><th>Item</th><th class="num">Qtd</th>
      ${cot.map((q) => `<th class="num ${q.vencedora ? 'table-success' : ''}">${esc(q.fornecedor)}${q.vencedora ? ' <i class="bi bi-trophy" title="Vencedora"></i>' : ''}</th>`).join('')}</tr></thead><tbody>
      ${s.itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td class="num">${fmt.num(i.quantidade)} ${esc(i.unidade || '')}</td>
        ${cot.map((q) => { const p = q.precos[i.id]; return `<td class="num ${p === menor[i.id] && cot.length > 1 ? 'text-success fw-semibold' : ''}">${fmt.money(p)}<div class="small text-muted">${fmt.money(p * i.quantidade)}</div></td>`; }).join('')}</tr>`).join('')}
      <tr><td colspan="2">Frete</td>${cot.map((q) => `<td class="num">${fmt.money(q.frete)}</td>`).join('')}</tr>
      <tr class="fw-semibold"><td colspan="2">Total</td>${cot.map((q) => `<td class="num ${q.total === melhorTotal && cot.length > 1 ? 'text-success' : ''}">${fmt.money(q.total)}</td>`).join('')}</tr>
      <tr class="small"><td colspan="2">Entrega</td>${cot.map((q) => `<td class="num">${q.prazo_entrega_dias ? `${q.prazo_entrega_dias} dia(s)` : '—'}</td>`).join('')}</tr>
      <tr class="small"><td colspan="2">Pagamento</td>${cot.map((q) => `<td class="num">${q.parcelas}x · 1º em ${q.prazo_pagamento_dias ?? 30} dias</td>`).join('')}</tr>
      ${comprador && aberta ? `<tr><td colspan="2"></td>${cot.map((q) => `<td class="num text-nowrap"><button class="btn btn-sm btn-success py-0" data-gerar="${q.id}"><i class="bi bi-bag-check"></i> Comprar</button>
        <button class="btn btn-sm btn-outline-danger py-0 px-1" data-delcot="${q.id}" title="Excluir cotação"><i class="bi bi-trash"></i></button></td>`).join('')}</tr>` : ''}
    </tbody></table></div>` : '<div class="vazio py-2">Nenhuma cotação lançada.</div>';
  const formCot = comprador && aberta ? `<div class="card mt-2"><div class="card-header py-2"><i class="bi bi-plus-lg"></i> Lançar cotação de fornecedor</div><div class="card-body"><form class="row g-2" data-cot>
      ${campo('fornecedor_id', 'Fornecedor', { type: 'select', col: 'col-md-5', required: true, options: opcoes(OPC.fornecedores) })}
      ${campo('frete', 'Frete (R$)', { type: 'number', col: 'col-md-2', value: 0, attrs: 'min="0" step="any"' })}
      ${campo('prazo_entrega_dias', 'Entrega (dias)', { type: 'number', col: 'col-md-2', attrs: 'min="0" step="1"' })}
      ${campo('parcelas', 'Parcelas', { type: 'select', col: 'col-md-1', options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}x`]) })}
      ${campo('prazo_pagamento_dias', '1º venc. (dias)', { type: 'number', col: 'col-md-2', value: 30, attrs: 'min="0" step="1"' })}
      <div class="col-12"><div class="row g-2">${s.itens.map((i) => `<div class="col-md-4"><label class="form-label small">${esc(i.descricao)} <span class="text-muted">(${fmt.num(i.quantidade)} ${esc(i.unidade || '')})</span></label>
        <div class="input-group input-group-sm"><span class="input-group-text">R$/un</span><input type="number" class="form-control" data-preco="${i.id}" min="0" step="any" required></div></div>`).join('')}</div></div>
      ${campo('validade', 'Cotação válida até', { type: 'date', col: 'col-md-3' })}
      ${campo('observacao', 'Observação', { col: 'col-md-9' })}
      <div class="col-12 d-flex gap-2"><button class="btn btn-sm btn-outline-success"><i class="bi bi-plus-lg"></i> Salvar cotação</button>
        <button type="button" class="btn btn-sm btn-success ms-auto" data-direto><i class="bi bi-bag-check"></i> Comprar direto com estes preços</button></div></form></div></div>` : '';
  const m = modal({
    title: `Solicitação ${numero(s.numero)} ${badge(s.status, STATUS_SOL)}`, size: 'xl',
    body: `<div class="row g-2 small mb-2">
        <div class="col-md-3"><span class="text-muted">Solicitante</span><div class="fw-semibold">${esc(s.solicitante || '')}</div></div>
        <div class="col-md-3"><span class="text-muted">Departamento</span><div>${esc(s.departamento || '')}</div></div>
        <div class="col-md-2"><span class="text-muted">Urgência</span><div>${badge(s.urgencia, URGENCIA)}</div></div>
        <div class="col-md-2"><span class="text-muted">Precisa até</span><div>${fmt.date(s.necessidade_em) || '—'}</div></div>
        <div class="col-md-2"><span class="text-muted">Aberta em</span><div>${fmt.datetime(s.created_at)}</div></div>
        ${s.justificativa ? `<div class="col-12"><span class="text-muted">Justificativa</span><div>${esc(s.justificativa)}</div></div>` : ''}
        ${s.motivo ? `<div class="col-12"><div class="alert alert-warning py-1 mb-0">${esc(s.motivo)}</div></div>` : ''}
        ${s.compra ? `<div class="col-12"><div class="alert alert-success py-1 mb-0">Atendida pelo pedido de compra <a href="#" data-compra="${s.compra.id}">${numero(s.compra.numero)}</a> (${STATUS_PC[s.compra.status]?.[0] || s.compra.status}, ${fmt.money(s.compra.valor_total)}).</div></div>` : ''}</div>
      <h6>Itens</h6>${tabelaSimples([{ k: 'descricao', l: 'Item' }, { k: 'categoria', l: 'Categoria' }, { k: 'quantidade', l: 'Quantidade', t: 'num' }, { k: 'unidade', l: 'Un.' }], s.itens)}
      ${comprador || cot.length ? `<h6 class="mt-3">Cotações</h6>${comparativo}${formCot}` : ''}`,
    buttons: [
      ...(aberta && (minha || comprador) ? [{ label: minha ? 'Cancelar solicitação' : 'Recusar', cls: 'btn-outline-danger', onClick: async () => {
        const motivo = await pedirTexto('Motivo', { titulo: minha ? 'Cancelar solicitação' : 'Recusar solicitação' });
        if (!motivo) return false;
        await post(`/api/compras/solicitacoes/${s.id}/cancelar`, { motivo });
        toast(minha ? 'Solicitação cancelada.' : 'Solicitação recusada; o solicitante foi avisado.');
        aoMudar?.();
      } }] : []),
    ],
  });
  const b = m.body;
  b.querySelector('[data-compra]')?.addEventListener('click', (e) => { e.preventDefault(); m.close(); abrirCompra(s.compra.id, aoMudar); });
  const reabrir = () => { m.close(); aoMudar?.(); abrirSolicitacao(id, aoMudar); };
  const gerar = async (corpo) => {
    const r = await tentar(() => post(`/api/compras/solicitacoes/${s.id}/gerar-compra`, corpo));
    if (r) { toast(`Pedido de compra ${r.numero} criado. Confira e envie para aprovação.`); m.close(); aoMudar?.(); abrirCompra(r.id, aoMudar); }
  };
  b.querySelectorAll('[data-gerar]').forEach((x) => x.addEventListener('click', () => gerar({ cotacao_id: Number(x.dataset.gerar) })));
  b.querySelectorAll('[data-delcot]').forEach((x) => x.addEventListener('click', async () => {
    if (await confirmar('Excluir esta cotação?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/compras/cotacoes/${x.dataset.delcot}`), 'Cotação excluída.')) reabrir();
  }));
  const f = b.querySelector('[data-cot]');
  if (f) {
    const dados = () => ({ ...lerForm(f), precos: Object.fromEntries([...f.querySelectorAll('[data-preco]')].map((x) => [x.dataset.preco, x.value])) });
    f.querySelector('[name=fornecedor_id]').addEventListener('change', (e) => {
      const fo = OPC.fornecedores.find((x) => x.id === Number(e.target.value));
      if (fo?.prazo_pagamento_dias != null) f.querySelector('[name=prazo_pagamento_dias]').value = fo.prazo_pagamento_dias;
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await tentar(() => post(`/api/compras/solicitacoes/${s.id}/cotacoes`, dados()), 'Cotação salva.')) reabrir();
    });
    f.querySelector('[data-direto]').addEventListener('click', () => {
      if (!f.reportValidity()) return;
      gerar({ ...dados(), cotacao_id: null });
    });
  }
}

// ---------- Pedidos de compra ----------
function pedidos(conteudo) {
  const comprador = pode('compras.comprar');
  const aprovador = pode('compras.aprovar');
  const pagina = titulo(conteudo, 'Pedidos de compra', 'bi-bag-check', `
    ${aprovador ? `<button class="btn btn-sm btn-outline-secondary" data-limite title="Valor acima do qual o pedido precisa de aprovação"><i class="bi bi-sliders"></i> Aprovação acima de ${fmt.money(OPC.limite_aprovacao)}</button>` : ''}
    ${comprador ? '<button class="btn btn-sm btn-success" data-nova><i class="bi bi-plus-lg"></i> Novo pedido de compra</button>' : ''}`);
  let situacao = aprovador && !comprador ? 'aprovacao' : '';
  pagina.innerHTML = `<div class="kpis mb-3" data-kpis></div>
    <div class="painel-periodos mb-2" role="group" aria-label="Situação">${[['', 'Todos'], ['abertas', 'Em andamento'], ['aprovacao', 'Aguardando aprovação'], ['receber', 'A receber']]
      .map(([k, l]) => `<button type="button" data-sit="${k}" class="${k === situacao ? 'ativo' : ''}">${l}</button>`).join('')}</div><div data-t></div>`;
  const t = new DataTable(pagina.querySelector('[data-t]'), {
    url: () => '/api/compras' + qs({ situacao }), title: 'Pedidos de compra', sort: 'numero', dir: 'desc', chave: 'compras-pc',
    painel: [
      { tipo: 'periodo', k: 'created_at', l: 'Data do pedido' }, { tipo: 'periodo', k: 'previsao_entrega', l: 'Previsão de entrega', atalhos: false },
      { tipo: 'select', k: 'fornecedor_id', l: 'Fornecedor', options: OPC.fornecedores.map((f) => [f.id, f.nome]) }, { tipo: 'faixa', k: 'valor_total', l: 'Valor (R$)' },
    ],
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'fornecedor', l: 'Fornecedor' }, { k: 'solicitacao', l: 'Solicitação' },
      { k: 'status', l: 'Situação', filter: { options: Object.entries(STATUS_PC).map(([k, [l]]) => [k, l]) }, render: (v) => badge(v, STATUS_PC) },
      { k: 'valor_total', l: 'Valor', t: 'money' },
      { k: 'previsao_entrega', l: 'Previsão de entrega', t: 'date', render: (v, r) => `<span class="${r.atrasada ? 'text-danger fw-semibold' : ''}">${fmt.date(v) || '—'}${r.atrasada ? ' (atrasado)' : ''}</span>` },
      { k: 'recebido_pct', l: 'Recebido', t: 'num', render: (v) => (v ? `${fmt.num(v)}%` : '—') },
      { k: 'comprador', l: 'Comprador' }, { k: 'aprovador', l: 'Aprovado por' },
    ],
    rowClass: (r) => (r.status === 'aprovacao' && aprovador ? 'table-warning' : r.atrasada ? 'table-danger' : ''),
    rowClick: (r) => abrirCompra(r.id, atualizar),
  });
  const atualizar = () => { t.reload(); resumo(pagina.querySelector('[data-kpis]')).catch(erro); };
  resumo(pagina.querySelector('[data-kpis]')).catch(erro);
  pagina.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => {
    situacao = b.dataset.sit;
    pagina.querySelectorAll('[data-sit]').forEach((x) => x.classList.toggle('ativo', x === b));
    t.reload();
  }));
  conteudo.querySelector('[data-nova]')?.addEventListener('click', () => formCompra(null, (id) => { atualizar(); abrirCompra(id, atualizar); }));
  conteudo.querySelector('[data-limite]')?.addEventListener('click', () => modal({
    title: 'Limite de aprovação de compras', size: 'md',
    body: `<form>${campo('compras.aprovacao_acima', 'Pedidos acima deste valor vão para aprovação (R$)', { type: 'number', col: 'col-12', value: OPC.limite_aprovacao, attrs: 'min="0" step="any"', help: 'Use 0 para que todos os pedidos de compra precisem de aprovação. Abaixo do limite o pedido é aprovado automaticamente.' })}</form>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const v = body.querySelector('input').value;
      await put('/api/compras/config', { 'compras.aprovacao_acima': v });
      OPC.limite_aprovacao = Number(v);
      toast('Limite de aprovação salvo.');
      pedidos(conteudo);
    } }],
  }));
  const ouvir = () => (document.body.contains(pagina) ? atualizar() : window.removeEventListener('compras-atualizadas', ouvir));
  window.addEventListener('compras-atualizadas', ouvir);
}

/** Pedido de compra novo (direto) ou edição do rascunho. aoSalvar(id) */
function formCompra(c, aoSalvar) {
  let ed;
  const v = c || { parcelas: 1, prazo_pagamento_dias: 30, frete: 0, desconto: 0 };
  const atualizarTotal = (body) => {
    const f = body.querySelector('[data-f]');
    const itens = ed.total();
    const tot = itens + (Number(f.querySelector('[name=frete]').value) || 0) - (Number(f.querySelector('[name=desconto]').value) || 0);
    body.querySelector('[data-total]').innerHTML = `Itens ${fmt.money(itens)} · <b>Total ${fmt.money(tot)}</b>${tot > OPC.limite_aprovacao || !OPC.limite_aprovacao ? ' · <span class="text-warning-emphasis">precisa de aprovação</span>' : ' · aprovação automática'}`;
  };
  modal({
    title: c ? `Editar pedido de compra ${numero(c.numero)}` : '<i class="bi bi-bag-plus"></i> Novo pedido de compra', size: 'xl',
    body: `<form class="row g-2" data-f>
      ${campo('fornecedor_id', 'Fornecedor', { type: 'select', col: 'col-md-5', required: true, value: v.fornecedor_id || '', options: opcoes(OPC.fornecedores) })}
      ${campo('categoria', 'Categoria (conta a pagar)', { type: 'select', col: 'col-md-3', value: v.categoria || '', options: [['', 'Pela categoria do 1º item'], ...OPC.categorias.map((x) => [x, x])] })}
      ${campo('previsao_entrega', 'Previsão de entrega', { type: 'date', col: 'col-md-2', value: v.previsao_entrega || '' })}
      ${campo('forma_pagamento', 'Forma de pagamento', { type: 'select', col: 'col-md-2', value: v.forma_pagamento || '', options: [['', '—'], ...FORMAS.map((x) => [x, x])] })}
      ${campo('parcelas', 'Parcelas', { type: 'select', col: 'col-md-2', value: v.parcelas, options: Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}x`]) })}
      ${campo('prazo_pagamento_dias', '1º vencimento (dias após receber)', { type: 'number', col: 'col-md-3', value: v.prazo_pagamento_dias, attrs: 'min="0" max="365" step="1"' })}
      ${campo('frete', 'Frete (R$)', { type: 'number', col: 'col-md-2', value: v.frete || 0, attrs: 'min="0" step="any"' })}
      ${campo('desconto', 'Desconto (R$)', { type: 'number', col: 'col-md-2', value: v.desconto || 0, attrs: 'min="0" step="any"' })}
      ${campo('observacao', 'Observação para o fornecedor', { col: 'col-md-3', value: v.observacao || '' })}</form>
      <h6 class="mt-3">Itens</h6><div data-itens></div><div class="text-end small mt-2" data-total></div>`,
    onShow: ({ body }) => {
      ed = editorItens(body.querySelector('[data-itens]'), { comPreco: true, itens: c?.itens || [], aoMudar: () => atualizarTotal(body) });
      const f = body.querySelector('[data-f]');
      f.querySelectorAll('[name=frete],[name=desconto]').forEach((x) => x.addEventListener('input', () => atualizarTotal(body)));
      f.querySelector('[name=fornecedor_id]').addEventListener('change', (e) => {
        const fo = OPC.fornecedores.find((x) => x.id === Number(e.target.value));
        if (fo?.prazo_pagamento_dias != null) f.querySelector('[name=prazo_pagamento_dias]').value = fo.prazo_pagamento_dias;
      });
      atualizarTotal(body);
    },
    buttons: [{ label: 'Salvar rascunho', onClick: async ({ body }) => {
      const d = { ...lerForm(body.querySelector('[data-f]')), itens: ed.itens() };
      if (c) { await put(`/api/compras/${c.id}`, d); toast('Pedido de compra atualizado.'); aoSalvar?.(c.id); return; }
      const r = await post('/api/compras', d);
      toast(`Pedido de compra ${r.numero} criado.`);
      aoSalvar?.(r.id);
    } }],
  });
}

export async function abrirCompra(id, aoMudar) {
  const c = await get(`/api/compras/${id}`);
  const comprador = pode('compras.comprar');
  const acao = (url, msg, corpo) => async () => { await post(`/api/compras/${c.id}/${url}`, corpo || {}); toast(msg); aoMudar?.(); };
  const botoes = [];
  if (c.status === 'rascunho' && comprador) {
    botoes.push({ label: '<i class="bi bi-pencil"></i> Editar', cls: 'btn-outline-secondary', onClick: () => formCompra(c, () => { aoMudar?.(); abrirCompra(c.id, aoMudar); }) });
    botoes.push({ label: '<i class="bi bi-send"></i> Enviar para aprovação', onClick: async () => {
      const r = await post(`/api/compras/${c.id}/enviar-aprovacao`);
      toast(r.status === 'aprovada' ? 'Dentro do limite: pedido aprovado automaticamente.' : 'Enviado para aprovação.');
      aoMudar?.();
    } });
  }
  if (c.status === 'aprovacao' && pode('compras.aprovar')) {
    botoes.push({ label: '<i class="bi bi-arrow-counterclockwise"></i> Devolver', cls: 'btn-outline-danger', onClick: async () => {
      const motivo = await pedirTexto('O que o comprador precisa ajustar?', { titulo: 'Devolver pedido de compra' });
      if (!motivo) return false;
      await acao('reprovar', 'Pedido devolvido ao comprador.', { motivo })();
    } });
    botoes.push({ label: '<i class="bi bi-check2"></i> Aprovar', onClick: acao('aprovar', 'Pedido de compra aprovado.') });
  }
  if (c.status === 'aprovada' && comprador) botoes.push({ label: '<i class="bi bi-envelope-check"></i> Marcar como enviado', cls: 'btn-outline-primary', onClick: acao('enviar', 'Pedido marcado como enviado ao fornecedor.') });
  if (['aprovada', 'enviada', 'parcial'].includes(c.status) && pode('compras.receber')) {
    botoes.push({ label: '<i class="bi bi-box-arrow-in-down"></i> Receber mercadoria', onClick: () => { receber(c, aoMudar); } });
  }
  if (['rascunho', 'aprovacao', 'aprovada', 'enviada'].includes(c.status) && comprador) {
    botoes.push({ label: 'Cancelar pedido', cls: 'btn-outline-danger', onClick: async () => {
      const motivo = await pedirTexto('Motivo do cancelamento', { titulo: 'Cancelar pedido de compra' });
      if (!motivo) return false;
      await acao('cancelar', 'Pedido de compra cancelado.', { motivo })();
    } });
  }
  botoes.push({ label: '<i class="bi bi-printer"></i> Imprimir', cls: 'btn-outline-secondary', onClick: () => { imprimir(c); return false; } });
  const fo = c.fornecedor;
  const m = modal({
    title: `Pedido de compra ${numero(c.numero)} ${badge(c.status, STATUS_PC)}`, size: 'xl',
    body: `${c.motivo && c.status !== 'recebida' ? `<div class="alert ${c.motivo.startsWith('Devolvido') || c.status === 'cancelada' ? 'alert-warning' : 'alert-info'} py-2">${esc(c.motivo)}</div>` : ''}
      <div class="row g-2 small mb-3">
        <div class="col-md-4"><span class="text-muted">Fornecedor</span><div class="fw-semibold">${esc(fo.razao_social)}</div><div>${fmt.doc(fo.documento)}${fo.contato ? ` · ${esc(fo.contato)}` : ''}${fo.telefone ? ` · ${esc(fo.telefone)}` : ''}</div></div>
        <div class="col-md-2"><span class="text-muted">Comprador</span><div>${esc(c.comprador || '')}</div></div>
        <div class="col-md-2"><span class="text-muted">Aprovação</span><div>${c.aprovador ? `${esc(c.aprovador)} · ${fmt.datetime(c.aprovado_em)}` : c.aprovado_em ? 'Automática' : '—'}</div></div>
        <div class="col-md-2"><span class="text-muted">Previsão de entrega</span><div>${fmt.date(c.previsao_entrega) || '—'}</div></div>
        <div class="col-md-2"><span class="text-muted">Pagamento</span><div>${c.parcelas}x · 1º ${c.prazo_pagamento_dias} dias após receber${c.forma_pagamento ? ` · ${esc(c.forma_pagamento)}` : ''}</div></div>
        ${c.solicitacao ? `<div class="col-md-12"><span class="text-muted">Solicitação</span> ${numero(c.solicitacao.numero)} · ${esc(c.solicitacao.departamento || '')}${c.solicitacao.justificativa ? ` · ${esc(c.solicitacao.justificativa)}` : ''}</div>` : ''}
        ${c.observacao ? `<div class="col-12"><span class="text-muted">Observação</span> ${esc(c.observacao)}</div>` : ''}</div>
      ${tabelaSimples([{ k: 'descricao', l: 'Item' }, { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'unidade', l: 'Un.' }, { k: 'preco_unitario', l: 'Preço unit.', t: 'money' },
        { k: 'subtotal', l: 'Subtotal', t: 'money', render: (_, r) => fmt.money(r.quantidade * r.preco_unitario) },
        { k: 'quantidade_recebida', l: 'Recebido', t: 'num', render: (v, r) => `<span class="${v >= r.quantidade ? 'text-success' : v > 0 ? 'text-warning-emphasis' : ''}">${fmt.num(v)}</span>` }], c.itens)}
      <div class="d-flex justify-content-end gap-4 small mt-2"><span>Itens <b>${fmt.money(c.valor_itens)}</b></span><span>Frete <b>${fmt.money(c.frete)}</b></span>
        <span>Desconto <b>${fmt.money(c.desconto)}</b></span><span class="fs-6">Total <b>${fmt.money(c.valor_total)}</b></span></div>
      ${c.status === 'aprovacao' ? `<div class="small text-muted text-end">Precisa de aprovação: acima de ${fmt.money(c.limite_aprovacao)}.</div>` : ''}
      ${c.recebimentos.length ? `<h6 class="mt-3">Recebimentos</h6>${tabelaSimples([{ k: 'data', l: 'Data', t: 'date' }, { k: 'nota_fiscal', l: 'NF' },
        { k: 'itens', l: 'Itens', render: (v) => v.map((i) => `${esc(i.descricao)}: ${fmt.num(i.quantidade)}${i.lote ? ` (lote ${esc(i.lote)})` : ''}`).join('<br>') },
        { k: 'valor', l: 'Valor', t: 'money' }, { k: 'usuario', l: 'Recebido por' }], c.recebimentos)}` : ''}
      ${c.contas.length ? `<h6 class="mt-3">Contas a pagar geradas</h6>${tabelaSimples([{ k: 'descricao', l: 'Descrição' }, { k: 'vencimento', l: 'Vencimento', t: 'date' },
        { k: 'valor', l: 'Valor', t: 'money' }, { k: 'status', l: 'Situação', render: (v) => badge(v) }], c.contas)}` : ''}`,
    buttons: botoes,
  });
  return m;
}

/** Conferência da mercadoria com a NF do fornecedor. */
function receber(c, aoMudar) {
  const pend = c.itens.filter((i) => i.quantidade_recebida < i.quantidade - 0.0001);
  modal({
    title: `<i class="bi bi-box-arrow-in-down"></i> Receber pedido de compra ${numero(c.numero)}`, size: 'xl',
    body: `<form data-f><div class="row g-2 mb-2">
        ${campo('nota_fiscal', 'Nº da nota fiscal do fornecedor', { col: 'col-md-4', required: true })}
        ${campo('data', 'Data do recebimento', { type: 'date', col: 'col-md-3', value: hoje(), required: true })}
        ${campo('observacao', 'Observação', { col: 'col-md-5' })}</div>
      <div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Item</th><th class="num">Pedido</th><th class="num">Já recebido</th><th style="width:120px" class="num">Recebendo agora</th><th style="width:150px">Lote</th><th style="width:150px">Validade</th></tr></thead>
      <tbody>${pend.map((i) => `<tr data-item="${i.id}"><td>${esc(i.descricao)}${i.embalagem_id ? ' <span class="badge text-bg-light" title="Entra no estoque">estoque</span>' : ''}</td>
        <td class="num">${fmt.num(i.quantidade)} ${esc(i.unidade || '')}</td><td class="num">${fmt.num(i.quantidade_recebida)}</td>
        <td><input type="number" class="form-control form-control-sm text-end" data-q min="0" max="${i.quantidade - i.quantidade_recebida}" step="any" value="${i.quantidade - i.quantidade_recebida}"></td>
        <td>${i.embalagem_id ? '<input class="form-control form-control-sm" data-lote maxlength="40">' : ''}</td>
        <td>${i.embalagem_id ? '<input type="date" class="form-control form-control-sm" data-val>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="small text-muted">Produtos do estoque entram com o custo do pedido (frete e desconto rateados). A conta a pagar é lançada em ${c.parcelas}x, com 1º vencimento ${c.prazo_pagamento_dias} dias após o recebimento.</div></form>`,
    buttons: [{ label: '<i class="bi bi-check2-all"></i> Confirmar recebimento', onClick: async ({ body }) => {
      const f = body.querySelector('[data-f]');
      if (!f.reportValidity()) return false;
      const itens = [...f.querySelectorAll('[data-item]')].map((tr) => ({
        item_id: Number(tr.dataset.item), quantidade: Number(tr.querySelector('[data-q]').value) || 0,
        lote: tr.querySelector('[data-lote]')?.value || null, validade: tr.querySelector('[data-val]')?.value || null,
      }));
      const r = await post(`/api/compras/${c.id}/receber`, { ...lerForm(f), itens });
      toast(`Recebido ${fmt.money(r.valor)}: estoque atualizado e ${r.contas.length} conta(s) a pagar lançada(s).${r.status === 'parcial' ? ' Ainda há itens pendentes.' : ''}`);
      aoMudar?.();
    } }],
  });
}

function imprimir(c) {
  const w = window.open('', '_blank');
  const fo = c.fornecedor;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido de compra ${c.numero}</title><style>
    body{font:12px Arial;margin:24px;color:#111}h1{font-size:18px;margin:0}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #999;padding:5px;text-align:left}
    th{background:#e8f5e9}.n{text-align:right}.cab{display:flex;justify-content:space-between;gap:24px;margin-top:12px}.ass{margin-top:60px;display:flex;gap:60px}.ass div{flex:1;border-top:1px solid #333;text-align:center;padding-top:4px}</style></head><body>
    <h1>Pedido de compra Nº ${c.numero}</h1><div>${esc(state.me.empresa?.nome || '')} · emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
    <div class="cab"><div><b>Fornecedor</b><br>${esc(fo.razao_social)}<br>${fmt.doc(fo.documento)}<br>${esc([fo.cidade, fo.uf].filter(Boolean).join('/'))}${fo.contato ? `<br>Contato: ${esc(fo.contato)}` : ''}</div>
      <div><b>Condições</b><br>Pagamento: ${c.parcelas}x, 1º vencimento ${c.prazo_pagamento_dias} dias após o recebimento${c.forma_pagamento ? ` (${esc(c.forma_pagamento)})` : ''}<br>
        Entrega prevista: ${fmt.date(c.previsao_entrega) || 'a combinar'}<br>Comprador: ${esc(c.comprador || '')}</div></div>
    <table><thead><tr><th>Item</th><th class="n">Qtd</th><th>Un.</th><th class="n">Preço unit.</th><th class="n">Subtotal</th></tr></thead><tbody>
    ${c.itens.map((i) => `<tr><td>${esc(i.descricao)}</td><td class="n">${fmt.num(i.quantidade)}</td><td>${esc(i.unidade || '')}</td><td class="n">${fmt.money(i.preco_unitario)}</td><td class="n">${fmt.money(i.quantidade * i.preco_unitario)}</td></tr>`).join('')}
    <tr><td colspan="4" class="n">Frete</td><td class="n">${fmt.money(c.frete)}</td></tr><tr><td colspan="4" class="n">Desconto</td><td class="n">${fmt.money(c.desconto)}</td></tr>
    <tr><td colspan="4" class="n"><b>Total</b></td><td class="n"><b>${fmt.money(c.valor_total)}</b></td></tr></tbody></table>
    ${c.observacao ? `<p><b>Observação:</b> ${esc(c.observacao)}</p>` : ''}
    <p>Informe o número deste pedido na nota fiscal.</p>
    <div class="ass"><div>Comprador</div><div>Aprovação${c.aprovador ? `: ${esc(c.aprovador)}` : ''}</div></div>
    <script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

// ---------- Receber mercadoria ----------
function receberLista(conteudo) {
  const pagina = titulo(conteudo, 'Receber mercadoria', 'bi-truck');
  pagina.innerHTML = '<div data-t></div>';
  const t = new DataTable(pagina.querySelector('[data-t]'), {
    url: '/api/compras?situacao=receber', title: 'Pedidos de compra a receber', sort: 'previsao_entrega', dir: 'asc',
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'fornecedor', l: 'Fornecedor' },
      { k: 'status', l: 'Situação', filter: { options: ['aprovada', 'enviada', 'parcial'].map((k) => [k, STATUS_PC[k][0]]) }, render: (v) => badge(v, STATUS_PC) },
      { k: 'previsao_entrega', l: 'Previsão', t: 'date', render: (v, r) => `<span class="${r.atrasada ? 'text-danger fw-semibold' : ''}">${fmt.date(v) || '—'}${r.atrasada ? ' (atrasado)' : ''}</span>` },
      { k: 'recebido_pct', l: 'Recebido', t: 'num', render: (v) => (v ? `${fmt.num(v)}%` : '—') }, { k: 'valor_total', l: 'Valor', t: 'money' }, { k: 'comprador', l: 'Comprador' },
    ],
    rowClass: (r) => (r.atrasada ? 'table-danger' : ''),
    actions: () => btnAcao('receber', 'bi-box-arrow-in-down', 'Receber', 'success'),
    onAction: { receber: async (r) => receber(await get(`/api/compras/${r.id}`), () => t.reload()) },
    rowClick: (r) => abrirCompra(r.id, () => t.reload()),
  });
  const ouvir = () => (document.body.contains(pagina) ? t.reload() : window.removeEventListener('compras-atualizadas', ouvir));
  window.addEventListener('compras-atualizadas', ouvir);
}

// ---------- Reposição de estoque ----------
async function reposicao(conteudo) {
  const pagina = titulo(conteudo, 'Reposição de estoque', 'bi-arrow-repeat');
  const linhas = await get('/api/compras/reposicao');
  const deps = (state.opcoes.listas?.departamento || []).map((d) => [d.valor, d.valor]);
  const solicita = pode('compras.solicitar');
  pagina.innerHTML = linhas.length ? `<p class="small text-muted">Itens com disponível (saldo − em pedidos de venda) abaixo do estoque mínimo, já descontado o que está em pedidos de compra ou solicitações abertas.
      A sugestão repõe até o dobro do mínimo. Ajuste as quantidades e gere a solicitação.</p>
    <div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>
      ${solicita ? '<th style="width:32px"><input type="checkbox" class="form-check-input" data-todos checked aria-label="Marcar todos"></th>' : ''}
      <th>Produto</th><th>Embalagem</th><th class="num">Disponível</th><th class="num">Mínimo</th><th class="num">Em compra</th><th class="num" style="width:120px">Comprar</th>
      <th class="num">Último custo</th><th>Último fornecedor</th><th class="num">Estimado</th></tr></thead>
    <tbody>${linhas.map((l, i) => `<tr class="${l.disponivel <= 0 ? 'table-danger' : ''}">
      ${solicita ? `<td><input type="checkbox" class="form-check-input" data-sel="${i}" checked></td>` : ''}
      <td>${esc(l.produto)}<div class="small text-muted">${esc(l.grupo || '')}</div></td><td>${esc(l.embalagem)}</td>
      <td class="num ${l.disponivel <= 0 ? 'text-danger fw-semibold' : ''}">${fmt.num(l.disponivel)}</td><td class="num">${fmt.num(l.minimo)}</td><td class="num">${fmt.num(l.em_compra)}</td>
      <td>${solicita ? `<input type="number" class="form-control form-control-sm text-end" data-q="${i}" min="0" step="1" value="${l.sugerido}">` : fmt.num(l.sugerido)}</td>
      <td class="num">${fmt.money(l.ultimo_custo)}</td><td>${esc(l.ultimo_fornecedor || '—')}</td><td class="num" data-est="${i}">${fmt.money(l.valor_estimado)}</td></tr>`).join('')}</tbody></table></div>
    ${solicita ? `<div class="card-footer d-flex flex-wrap gap-2 align-items-center"><span class="small text-muted">Departamento</span>
      <select class="form-select form-select-sm w-auto" data-dep>${deps.map(([v, l]) => `<option ${v === (DEPTO[state.me.usuario.perfil] || 'Produção') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <span class="ms-auto small" data-tot></span><button class="btn btn-sm btn-success" data-gerar><i class="bi bi-inbox"></i> Gerar solicitação de compra</button></div>` : ''}</div>`
    : '<div class="vazio"><i class="bi bi-check2-circle"></i>Nenhum item abaixo do estoque mínimo. Defina o mínimo de cada embalagem em Estoque → Saldos.</div>';
  if (!solicita || !linhas.length) return;
  const total = () => {
    let t = 0;
    pagina.querySelectorAll('[data-q]').forEach((x) => {
      const l = linhas[x.dataset.q];
      const v = l.ultimo_custo ? (Number(x.value) || 0) * l.ultimo_custo : 0;
      pagina.querySelector(`[data-est="${x.dataset.q}"]`).textContent = fmt.money(v || null);
      if (pagina.querySelector(`[data-sel="${x.dataset.q}"]`).checked) t += v;
    });
    pagina.querySelector('[data-tot]').innerHTML = `Estimado: <b>${fmt.money(t)}</b>`;
  };
  pagina.querySelectorAll('[data-q],[data-sel]').forEach((x) => x.addEventListener('input', total));
  pagina.querySelector('[data-todos]').addEventListener('change', (e) => { pagina.querySelectorAll('[data-sel]').forEach((x) => { x.checked = e.target.checked; }); total(); });
  total();
  pagina.querySelector('[data-gerar]').addEventListener('click', async () => {
    const itens = [...pagina.querySelectorAll('[data-sel]:checked')].map((x) => ({ embalagem_id: linhas[x.dataset.sel].embalagem_id, quantidade: Number(pagina.querySelector(`[data-q="${x.dataset.sel}"]`).value) }))
      .filter((x) => x.quantidade > 0);
    if (!itens.length) return toast('Marque ao menos um item com quantidade.', 'warning');
    const r = await tentar(() => post('/api/compras/reposicao/solicitar', { itens, departamento: pagina.querySelector('[data-dep]').value }));
    if (r) { toast(`Solicitação ${r.numero} criada com ${itens.length} item(ns).`); reposicao(conteudo); }
  });
}
