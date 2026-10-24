// Propostas comerciais: orçamento com preço de tabela, impressão para o cliente, aceite e conversão em pedido.
import {
  get, post, put, del, esc, fmt, state, titulo, campo, opcoes, buscaCliente, toast, erro, tentar, ROTULOS, h, DataTable, modal, pode,
  pedirTexto, confirmar, kpi, tabelaSimples, qs,
} from '../core.js';

export const STATUS = {
  rascunho: ['Rascunho', 'secondary'], enviada: ['Enviada', 'primary'], aceita: ['Aceita', 'success'], recusada: ['Recusada', 'danger'],
  convertida: ['Convertida em pedido', 'dark'], expirada: ['Expirada', 'warning'],
};
const bdg = (v) => { const [l, c] = STATUS[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Preços pela tabela regional da UF de entrega: o cache depende do cliente e do endereço.
const cachePrecos = {};
const ctxPreco = { cliente_id: null, endereco_id: null };
async function precosDo(produtoId) {
  const k = `${produtoId}|${ctxPreco.cliente_id || ''}|${ctxPreco.endereco_id || ''}`;
  if (!cachePrecos[k]) cachePrecos[k] = await get(`/api/cadastros/produtos/${produtoId}/precos${qs(ctxPreco)}`);
  return cachePrecos[k];
}

export default async function (conteudo, { modo, params }) {
  if (modo === 'form') return formulario(conteudo, params[0] ? Number(params[0]) : null);
  const pagina = titulo(conteudo, 'Propostas Comerciais', 'bi-file-earmark-text', '<a href="#/propostas/nova" class="btn btn-sm btn-success"><i class="bi bi-plus-lg"></i> Nova proposta</a>');
  pagina.innerHTML = '<div class="kpis mb-3" id="kpis"></div><div id="t-prop"></div>';
  const resumo = async () => {
    const r = await get('/api/propostas/resumo');
    pagina.querySelector('#kpis').innerHTML = [
      kpi('Aguardando o cliente', fmt.money(r.valor_enviadas), { icone: 'bi-send', cor: 'primary', sub: `${r.enviadas} propostas enviadas` }),
      kpi('Vencem em até 3 dias', r.vencendo, { icone: 'bi-hourglass-split', cor: r.vencendo ? 'warning' : 'secondary' }),
      kpi('Ganhas', r.ganhas, { icone: 'bi-trophy', cor: 'success' }),
      kpi('Recusadas', r.recusadas, { icone: 'bi-hand-thumbs-down', cor: 'danger' }),
      kpi('Expiradas', r.expiradas, { icone: 'bi-calendar-x', cor: 'secondary' }),
    ].join('');
  };
  const t = new DataTable(pagina.querySelector('#t-prop'), {
    url: '/api/propostas', title: 'Propostas comerciais', sort: 'numero', dir: 'desc',
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'data', l: 'Data', t: 'datetime' }, { k: 'cliente', l: 'Cliente' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' },
      { k: 'vendedor', l: 'Vendedor' }, { k: 'forma', l: 'Forma' }, { k: 'condicao', l: 'Condição' }, { k: 'itens', l: 'Itens', t: 'num' },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'validade', l: 'Validade', t: 'date' },
      { k: 'status', l: 'Status', filter: { options: Object.entries(STATUS).map(([k, [l]]) => [k, l]) }, render: bdg }, { k: 'pedido', l: 'Pedido' },
    ],
    rowClick: (r) => abrirProposta(r.id, atualizar),
  });
  const atualizar = () => { t.reload(); resumo(); };
  resumo();
}

/** Janela da proposta: itens, totais e ações (enviar, aceite, recusa, converter, duplicar, imprimir). */
export async function abrirProposta(id, aoMudar) {
  const d = await get(`/api/propostas/${id}`);
  const p = d.proposta;
  const s = p.status_atual;
  const atualizar = (novoId) => { m.close(); aoMudar?.(); if (novoId) abrirProposta(novoId, aoMudar); };
  const mudar = (status, extra = {}) => tentar(async () => { await post(`/api/propostas/${p.id}/status`, { status, ...extra }); toast(`Proposta ${STATUS[status][0].toLowerCase()}.`); atualizar(p.id); });
  const botoes = [{ label: '<i class="bi bi-printer"></i> Imprimir / PDF', cls: 'btn-outline-secondary', onClick: () => { imprimirProposta(d); return false; } }];
  if (['rascunho', 'enviada', 'expirada'].includes(s) && p.status !== 'convertida') {
    botoes.push({ label: '<i class="bi bi-pencil"></i> Editar', cls: 'btn-outline-primary', onClick: () => { location.hash = `#/propostas/${p.id}/editar`; } });
  }
  if (p.status === 'rascunho') {
    botoes.push({ label: '<i class="bi bi-send"></i> Marcar como enviada', cls: 'btn-primary', onClick: () => { mudar('enviada'); return false; } });
    botoes.push({ label: '<i class="bi bi-trash"></i>', cls: 'btn-outline-danger', onClick: async () => {
      if (await confirmar('Excluir este rascunho?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/propostas/${p.id}`), 'Rascunho excluído.')) atualizar();
      return false;
    } });
  }
  if (p.status === 'enviada' && s !== 'expirada') {
    botoes.push({ label: '<i class="bi bi-hand-thumbs-up"></i> Cliente aceitou', cls: 'btn-success', onClick: () => { mudar('aceita'); return false; } });
    botoes.push({ label: '<i class="bi bi-hand-thumbs-down"></i> Recusou', cls: 'btn-outline-danger', onClick: async () => {
      const motivo = await pedirTexto('Motivo da recusa', { titulo: 'Proposta recusada' });
      if (motivo) mudar('recusada', { motivo });
      return false;
    } });
  }
  if (['aceita', 'enviada'].includes(p.status) && s !== 'expirada' && !p.pedido_id && pode('pedido.criar')) {
    botoes.push({ label: '<i class="bi bi-cart-check"></i> Gerar pedido', cls: 'btn-success', onClick: async () => {
      if (!await confirmar(`Criar o pedido de venda a partir da proposta ${p.numero}? O pedido fica na fila do Vendedor para conferência.`, { ok: 'Gerar pedido' })) return false;
      const r = await tentar(() => post(`/api/propostas/${p.id}/converter`));
      if (r) { toast(`Pedido ${r.numero} criado.`); atualizar(); location.hash = `#/pedido/${r.id}/editar`; }
      return false;
    } });
  }
  botoes.push({ label: '<i class="bi bi-copy"></i> Duplicar', cls: 'btn-outline-secondary', onClick: async () => {
    const r = await tentar(() => post(`/api/propostas/${p.id}/duplicar`));
    if (r) { toast(`Proposta ${r.numero} criada como rascunho.`); atualizar(r.id); }
    return false;
  } });
  const m = modal({
    title: `Proposta ${p.numero} · ${esc(d.cliente.nome)} ${bdg(s)}`, size: 'xl',
    body: `<div class="row g-3 small mb-3">
      <div class="col-md-4"><div class="text-muted">Cliente</div><b>${esc(d.cliente.nome)}</b><br>${fmt.doc(d.cliente.documento)}${d.endereco ? `<br>${esc(d.endereco.cidade || '')}/${esc(d.endereco.uf || '')}` : ''}</div>
      <div class="col-md-4"><div class="text-muted">Pagamento</div>${esc(p.forma?.nome || '—')} · ${esc(p.condicao?.descricao || '')}<div class="text-muted mt-1">Entrega</div>${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || '')}${p.prazo_entrega ? ' · ' + esc(p.prazo_entrega) : ''}</div>
      <div class="col-md-4"><div class="text-muted">Validade</div><b class="${s === 'expirada' ? 'text-danger' : ''}">${fmt.date(p.validade)}</b>
        <div class="text-muted mt-1">Vendedor</div>${esc(p.vendedor?.nome || '')}
        ${p.pedido_numero ? `<div class="text-muted mt-1">Pedido gerado</div><b>${p.pedido_numero}</b>` : ''}
        ${p.motivo_recusa ? `<div class="text-muted mt-1">Motivo da recusa</div>${esc(p.motivo_recusa)}` : ''}</div></div>
      ${tabelaSimples([{ k: 'produto', l: 'Produto' }, { k: 'embalagem', l: 'Embalagem' }, { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'valor_tabela', l: 'Tabela', t: 'money' },
        { k: 'valor_unitario', l: 'Unitário', t: 'money' }, { k: 'valor_total', l: 'Total', t: 'money', render: (v, r) => (r.brinde ? '<span class="badge text-bg-info">Brinde</span>' : fmt.money(v)) }], d.itens)}
      <div class="text-end mt-2">Produtos ${fmt.money(p.valor_produtos)} · Desconto ${fmt.money(p.valor_desconto)}${p.frete_valor ? ` · Frete ${fmt.money(p.frete_valor)}` : ''} · <span class="fs-5">Total <b>${fmt.money(p.valor_total)}</b></span></div>
      ${p.condicoes_comerciais ? `<div class="mt-3 small"><div class="text-muted">Condições comerciais</div><div style="white-space:pre-wrap">${esc(p.condicoes_comerciais)}</div></div>` : ''}
      ${p.observacao ? `<div class="mt-2 small"><div class="text-muted">Observação</div>${esc(p.observacao)}</div>` : ''}`,
    buttons: botoes,
  });
}

function imprimirProposta(d) {
  const p = d.proposta;
  const e = p.empresa || {};
  const w = window.open('', '_blank');
  if (!w) return toast('Libere as janelas pop-up para imprimir.', 'warning');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Proposta ${p.numero} - ${esc(d.cliente.nome)}</title><style>
    @page{size:A4;margin:14mm} body{font:11px Arial,sans-serif;color:#222} h1{font-size:20px;margin:0;color:#1f6f3a} .topo{display:flex;justify-content:space-between;border-bottom:3px solid #1f6f3a;padding-bottom:8px;margin-bottom:12px}
    .caixa{border:1px solid #ccc;border-radius:6px;padding:8px;margin-bottom:10px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px} .rot{font-size:9px;text-transform:uppercase;color:#666;letter-spacing:.5px}
    table{width:100%;border-collapse:collapse;margin:8px 0} th{background:#e8f5e9;text-align:left;font-size:10px;text-transform:uppercase} th,td{border-bottom:1px solid #ddd;padding:5px} .num{text-align:right}
    .total{font-size:15px;text-align:right;margin-top:6px} .assin{margin-top:50px;display:grid;grid-template-columns:1fr 1fr;gap:40px;text-align:center} .assin div{border-top:1px solid #444;padding-top:4px}
    .rodape{margin-top:20px;font-size:9px;color:#777;text-align:center}</style></head><body>
    <div class="topo"><div><h1>${esc(e.nome || 'Agroterra')}</h1><div>${e.cnpj ? 'CNPJ ' + esc(fmt.doc(e.cnpj)) : ''}${e.endereco ? ' · ' + esc(e.endereco) : ''}${e.cidade ? ' · ' + esc(e.cidade) + '/' + esc(e.uf || '') : ''}${e.telefone ? ' · ' + esc(e.telefone) : ''}</div></div>
      <div style="text-align:right"><div class="rot">Proposta comercial</div><div style="font-size:20px;font-weight:bold">Nº ${p.numero}</div><div>Emitida em ${fmt.date(p.enviada_em || p.created_at)}</div><div><b>Válida até ${fmt.date(p.validade)}</b></div></div></div>
    <div class="grid"><div class="caixa"><div class="rot">Cliente</div><b>${esc(d.cliente.nome)}</b>${d.cliente.nome_fantasia ? '<br>' + esc(d.cliente.nome_fantasia) : ''}<br>${fmt.doc(d.cliente.documento)}
      ${d.endereco ? `<br>${esc([d.endereco.logradouro, d.endereco.numero].filter(Boolean).join(', '))} ${esc(d.endereco.bairro || '')}<br>${esc(d.endereco.cidade || '')}/${esc(d.endereco.uf || '')}` : ''}</div>
      <div class="caixa"><div class="rot">Condições</div>Pagamento: <b>${esc(p.forma?.nome || '—')}</b> ${esc(p.condicao?.descricao || '')}<br>Entrega: ${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || '')}${p.prazo_entrega ? '<br>Prazo: ' + esc(p.prazo_entrega) : ''}
      <br>Consultor: ${esc(p.vendedor?.nome || '')}${p.vendedor?.email ? ' · ' + esc(p.vendedor.email) : ''}</div></div>
    <table><thead><tr><th>#</th><th>Produto</th><th>Embalagem</th><th class="num">Qtd</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead><tbody>
      ${d.itens.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.codigo ? i.codigo + ' - ' : '')}${esc(i.produto)}</td><td>${esc(i.embalagem || '')}</td><td class="num">${fmt.num(i.quantidade)}</td>
        <td class="num">${i.brinde ? '—' : fmt.money(i.valor_unitario)}</td><td class="num">${i.brinde ? 'Brinde' : fmt.money(i.valor_total)}</td></tr>`).join('')}</tbody></table>
    <div class="total">Produtos ${fmt.money(p.valor_produtos)}${p.valor_desconto ? ` · Desconto ${fmt.money(p.valor_desconto)}` : ''}${p.frete_valor ? ` · Frete ${fmt.money(p.frete_valor)}` : ''}<br><b style="font-size:18px">Total ${fmt.money(p.valor_total)}</b></div>
    ${p.condicoes_comerciais ? `<div class="caixa" style="margin-top:12px"><div class="rot">Condições comerciais</div><div style="white-space:pre-wrap">${esc(p.condicoes_comerciais)}</div></div>` : ''}
    ${p.observacao ? `<div class="caixa"><div class="rot">Observações</div>${esc(p.observacao)}</div>` : ''}
    <div class="caixa" style="font-size:9.5px">Preços sujeitos à aprovação de crédito. Após a validade, valores e disponibilidade podem mudar.</div>
    <div class="assin"><div>${esc(p.vendedor?.nome || '')}<br>${esc(e.nome || '')}</div><div>De acordo — ${esc(d.cliente.nome)}<br>Data: ____/____/______</div></div>
    <div class="rodape">Documento gerado pelo Agroterra Sistema em ${new Date().toLocaleString('pt-BR')}</div>
    <script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

// ---------- Formulário ----------
async function formulario(conteudo, id) {
  let prop = null;
  let itens = [];
  if (id) {
    const d = await get(`/api/propostas/${id}`);
    prop = { ...d.proposta, cliente_nome: d.cliente.nome };
    itens = d.itens;
  }
  const o = state.opcoes;
  const ehVendedor = state.me.usuario.perfil === 'vendedor';
  const pagina = titulo(conteudo, id ? `Editar proposta ${prop.numero}` : 'Nova proposta comercial', 'bi-file-earmark-plus', '<a href="#/propostas" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left"></i> Propostas</a>');
  pagina.innerHTML = `<form id="form-prop">
    <div class="card mb-3"><div class="card-header py-2">Cliente e condições</div><div class="card-body"><div class="row g-2">
      <div class="col-md-5"><label class="form-label">Cliente *</label><input class="form-control form-control-sm" id="cli-busca" placeholder="Digite nome ou CPF/CNPJ" value="${esc(prop?.cliente_nome || '')}" autocomplete="off">
        <input type="hidden" name="cliente_id" value="${prop?.cliente_id || ''}"></div>
      ${campo('forma_id', 'Forma de pagamento', { type: 'select', col: 'col-md-3', options: opcoes(o.formas), value: prop?.forma_id || '' })}
      ${campo('condicao_id', 'Condição', { type: 'select', col: 'col-md-4', options: [['', 'Selecione a forma']] })}
      ${campo('validade', 'Válida até', { type: 'date', col: 'col-md-2', required: true, value: prop?.validade || somaDias(hoje(), 15) })}
      ${campo('tipo_entrega', 'Entrega', { type: 'select', col: 'col-md-3', options: Object.entries(ROTULOS.tipo_entrega), value: prop?.tipo_entrega || 'transportadora' })}
      ${campo('prazo_entrega', 'Prazo de entrega', { col: 'col-md-3', value: prop?.prazo_entrega || '', attrs: 'placeholder="Ex.: 10 dias após aprovação"' })}
      ${campo('frete_valor', 'Frete (R$)', { type: 'number', col: 'col-md-2', value: prop?.frete_valor ?? '', attrs: 'min="0" step="0.01"' })}
      ${!ehVendedor ? campo('vendedor_id', 'Vendedor', { type: 'select', col: 'col-md-2', options: opcoes(o.vendedores, 'Eu mesmo'), value: prop?.vendedor_id || '' }) : ''}
      ${campo('cultura', 'Cultura do cliente', { type: 'select', col: 'col-md-4', options: [['', '—'], ...o.listas.cultura.map((x) => [x.valor, x.valor])], value: prop?.cultura || '' })}
      ${campo('area_ha', 'Área (ha)', { type: 'number', col: 'col-md-2', value: prop?.area_ha ?? '', attrs: 'min="0.01" step="0.01"' })}
      ${campo('origem_venda', 'De onde veio a venda', { type: 'select', col: 'col-md-6', options: [['', '—'], ...o.listas.origem_venda.map((x) => [x.valor, x.valor])], value: prop?.origem_venda || '' })}
      ${campo('condicoes_comerciais', 'Condições comerciais (saem na proposta impressa)', { type: 'textarea', col: 'col-md-7', value: prop?.condicoes_comerciais || 'Preços válidos para pagamento na condição informada.\nFrete conforme modalidade de entrega.' })}
      ${campo('observacao', 'Observação', { type: 'textarea', col: 'col-md-5', value: prop?.observacao || '' })}
    </div></div></div>
    <div class="card mb-3"><div class="card-header py-2 d-flex align-items-center">Itens
      <button type="button" class="btn btn-sm btn-outline-success ms-auto" id="btn-add"><i class="bi bi-plus-lg"></i> Adicionar item</button></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table table-sm itens-pedido mb-0">
        <thead><tr><th style="min-width:220px">Produto</th><th style="min-width:130px">Embalagem</th><th style="width:90px">Qtd</th><th class="num">Tabela</th>
          <th style="width:120px">Valor unit.</th><th class="num">Desc.</th><th class="num">Total</th><th>Brinde</th><th></th></tr></thead><tbody id="itens"></tbody></table></div></div>
      <div class="card-footer text-end">Produtos <b id="t-prod">R$ 0,00</b> · Desconto <b id="t-desc">R$ 0,00</b> · Frete <b id="t-frete">R$ 0,00</b> · <span class="fs-5">Total <b id="t-total">R$ 0,00</b></span></div>
    </div>
    <div class="d-flex gap-2 justify-content-end">
      <button type="submit" class="btn btn-outline-success" data-depois="ver"><i class="bi bi-save"></i> Salvar</button>
      <button type="submit" class="btn btn-success" data-depois="enviar"><i class="bi bi-send"></i> Salvar e marcar como enviada</button></div></form>`;
  const f = pagina.querySelector('#form-prop');
  const $ = (s) => f.querySelector(s);
  // O cliente define a UF e, com ela, a tabela de preço regional.
  const trocarCliente = async (id) => {
    ctxPreco.cliente_id = id || null;
    for (const tr of tbody.querySelectorAll('tr')) await aplicarPreco(tr, false);
  };
  ctxPreco.cliente_id = prop?.cliente_id || null;
  buscaCliente($('#cli-busca'), (c) => { $('[name=cliente_id]').value = c.id; trocarCliente(c.id).catch(erro); });

  const condicoes = (valor) => {
    const lista = o.condicoes.filter((c) => c.forma_id === Number($('[name=forma_id]').value));
    $('[name=condicao_id]').innerHTML = lista.map((c) => `<option value="${c.id}">${esc(c.descricao)}</option>`).join('') || '<option value="">Selecione a forma</option>';
    if (valor) $('[name=condicao_id]').value = valor;
    recalcular();
  };
  $('[name=forma_id]').addEventListener('change', async () => { condicoes(); for (const tr of tbody.querySelectorAll('tr')) await aplicarPreco(tr, true); });
  $('[name=condicao_id]').addEventListener('change', () => recalcular());
  $('[name=frete_valor]').addEventListener('input', () => recalcular());

  const tbody = $('#itens');
  const linha = (it = {}) => {
    const tr = h(`<tr>
      <td><select class="form-select form-select-sm" data-c="produto_id"><option value="">Selecione...</option>${o.produtos.map((p) => `<option value="${p.id}">${esc(p.codigo ? p.codigo + ' - ' : '')}${esc(p.nome)}</option>`).join('')}</select></td>
      <td><select class="form-select form-select-sm" data-c="embalagem_id"></select></td>
      <td><input type="number" min="0.01" step="0.01" class="form-control form-control-sm" data-c="quantidade" value="${it.quantidade ?? 1}"></td>
      <td class="num small" data-c="tabela"></td>
      <td><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-c="valor_unitario" value="${it.valor_unitario ?? ''}"></td>
      <td class="num small" data-c="desc"></td><td class="num fw-semibold" data-c="total"></td>
      <td class="text-center"><input type="checkbox" class="form-check-input" data-c="brinde" ${it.brinde ? 'checked' : ''}></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger py-0" data-rem>&times;</button></td></tr>`);
    tbody.appendChild(tr);
    const selP = tr.querySelector('[data-c=produto_id]');
    if (it.produto_id) selP.value = it.produto_id;
    selP.addEventListener('change', () => embalagens(tr, null, true));
    tr.querySelector('[data-c=embalagem_id]').addEventListener('change', () => aplicarPreco(tr, true));
    tr.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalcular));
    tr.querySelector('[data-c=brinde]').addEventListener('change', recalcular);
    tr.querySelector('[data-rem]').addEventListener('click', () => { tr.remove(); recalcular(); });
    if (it.produto_id) embalagens(tr, it.embalagem_id, false);
  };
  async function embalagens(tr, embId, aplicar) {
    const pid = tr.querySelector('[data-c=produto_id]').value;
    const sel = tr.querySelector('[data-c=embalagem_id]');
    if (!pid) { sel.innerHTML = ''; return; }
    const d = await precosDo(pid);
    sel.innerHTML = d.embalagens.map((e) => `<option value="${e.id}">${esc(e.descricao)}</option>`).join('') || '<option value="">(sem embalagem)</option>';
    if (embId) sel.value = embId;
    await aplicarPreco(tr, aplicar);
  }
  async function aplicarPreco(tr, sobrescrever) {
    const pid = tr.querySelector('[data-c=produto_id]').value;
    if (!pid) return;
    const d = await precosDo(pid);
    const embId = Number(tr.querySelector('[data-c=embalagem_id]').value) || null;
    const formaId = Number($('[name=forma_id]').value) || null;
    const preco = d.precos.find((x) => x.embalagem_id === embId && x.forma_id === formaId) || d.precos.find((x) => x.embalagem_id === embId && !x.forma_id);
    const anterior = tr.dataset.tabela;
    tr.dataset.tabela = preco?.valor || 0;
    tr.querySelector('[data-c=tabela]').textContent = fmt.money(preco?.valor || 0);
    tr.querySelector('[data-c=tabela]').title = d.tabela ? `Tabela ${d.tabela.nome}${d.uf ? ` · ${d.uf}` : ''}` : 'Tabela base';
    const unit = tr.querySelector('[data-c=valor_unitario]');
    if (sobrescrever || unit.value === '' || (anterior !== undefined && Number(unit.value) === Number(anterior))) unit.value = preco?.valor || '';
    recalcular();
  }
  function recalcular() {
    let soma = 0;
    for (const tr of tbody.querySelectorAll('tr')) {
      const q = Number(tr.querySelector('[data-c=quantidade]').value) || 0;
      const brinde = tr.querySelector('[data-c=brinde]').checked;
      const unitEl = tr.querySelector('[data-c=valor_unitario]');
      unitEl.disabled = brinde;
      const unit = brinde ? 0 : Number(unitEl.value) || 0;
      const tab = Number(tr.dataset.tabela) || 0;
      soma += q * unit;
      tr.querySelector('[data-c=total]').textContent = brinde ? 'Brinde' : fmt.money(q * unit);
      const pct = tab > 0 && !brinde ? ((tab - unit) / tab) * 100 : 0;
      tr.querySelector('[data-c=desc]').innerHTML = pct > 0.05 ? `<span class="${pct > 10 ? 'text-danger fw-semibold' : 'text-muted'}">${fmt.pct(pct.toFixed(1))}</span>` : '';
    }
    const cond = o.condicoes.find((c) => c.id === Number($('[name=condicao_id]').value));
    const desc = soma * ((cond?.desconto_pct || 0) / 100);
    const frete = Number($('[name=frete_valor]').value) || 0;
    $('#t-prod').textContent = fmt.money(soma);
    $('#t-desc').textContent = fmt.money(desc);
    $('#t-frete').textContent = fmt.money(frete);
    $('#t-total').textContent = fmt.money(soma - desc + frete);
  }
  $('#btn-add').addEventListener('click', () => linha());
  condicoes(prop?.condicao_id);
  if (itens.length) itens.forEach((it) => linha(it)); else linha();

  let depois = 'ver';
  f.querySelectorAll('[data-depois]').forEach((b) => b.addEventListener('click', () => { depois = b.dataset.depois; }));
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = (n) => $(`[name=${n}]`)?.value || null;
    const dados = {
      cliente_id: Number(v('cliente_id')) || null, forma_id: Number(v('forma_id')) || null, condicao_id: Number(v('condicao_id')) || null,
      validade: v('validade'), tipo_entrega: v('tipo_entrega'), prazo_entrega: v('prazo_entrega'), frete_valor: v('frete_valor') === null ? null : Number(v('frete_valor')),
      condicoes_comerciais: v('condicoes_comerciais'), observacao: v('observacao'),
      cultura: v('cultura'), area_ha: v('area_ha') === null ? null : Number(v('area_ha')), origem_venda: v('origem_venda'),
      vendedor_id: $('[name=vendedor_id]') ? Number(v('vendedor_id')) || undefined : undefined,
      itens: [...tbody.querySelectorAll('tr')].map((tr) => ({
        produto_id: Number(tr.querySelector('[data-c=produto_id]').value),
        embalagem_id: Number(tr.querySelector('[data-c=embalagem_id]').value) || null,
        quantidade: Number(tr.querySelector('[data-c=quantidade]').value),
        valor_unitario: tr.querySelector('[data-c=valor_unitario]').value === '' ? undefined : Number(tr.querySelector('[data-c=valor_unitario]').value),
        brinde: tr.querySelector('[data-c=brinde]').checked,
      })).filter((i) => i.produto_id),
    };
    if (!dados.cliente_id) return toast('Selecione o cliente.', 'warning');
    if (!dados.itens.length) return toast('Inclua ao menos um item.', 'warning');
    try {
      const r = id ? await put(`/api/propostas/${id}`, dados) : await post('/api/propostas', dados);
      const pid = id || r.id;
      if (depois === 'enviar' && (!prop || prop.status === 'rascunho')) await post(`/api/propostas/${pid}/status`, { status: 'enviada' });
      toast(`Proposta ${r.numero || prop.numero} salva.`);
      location.hash = '#/propostas';
      setTimeout(() => abrirProposta(pid), 300);
    } catch (e) { erro(e); }
  });
}
