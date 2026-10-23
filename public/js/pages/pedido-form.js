// Criação e edição do pedido de venda (etapa Vendedor).
import { get, post, put, esc, fmt, state, titulo, campo, opcoes, buscaCliente, toast, erro, ROTULOS, h } from '../core.js';
import { abrirCliente } from './clientes.js';

const cachePrecos = {};
async function precosDo(produtoId) {
  if (!cachePrecos[produtoId]) cachePrecos[produtoId] = await get(`/api/cadastros/produtos/${produtoId}/precos`);
  return cachePrecos[produtoId];
}

export default async function (conteudo, { params: [id] }) {
  const edicao = !!id;
  let ped = null;
  let itensIniciais = [];
  if (edicao) {
    const d = await get(`/api/pedidos/${id}`);
    if (d.pedido.etapa !== 'venda') { conteudo.innerHTML = '<div class="alert alert-warning">Este pedido não está mais na etapa Vendedor.</div>'; return; }
    ped = { ...d.pedido, cliente_nome: d.cliente.nome };
    itensIniciais = d.itens;
  }
  const o = state.opcoes;
  const pagina = titulo(conteudo, edicao ? `Editar pedido ${ped.numero}` : 'Novo pedido', 'bi-cart-plus', '<a href="#/fila/venda" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left"></i> Voltar à fila</a>');
  const ehVendedor = state.me.usuario.perfil === 'vendedor';
  pagina.innerHTML = `<form id="form-pedido">
    <div class="card mb-3"><div class="card-header py-2">Cliente e pagamento</div><div class="card-body"><div class="row g-2">
      <div class="col-md-5"><label class="form-label">Cliente *</label><div class="input-group input-group-sm">
        <input class="form-control" id="cli-busca" placeholder="Digite nome ou CPF/CNPJ" value="${esc(ped?.cliente_nome || '')}" autocomplete="off">
        <button type="button" class="btn btn-outline-success" id="btn-novo-cli" title="Cadastrar cliente"><i class="bi bi-person-plus"></i></button>
        <button type="button" class="btn btn-outline-secondary" id="btn-ver-cli" title="Ver cadastro"><i class="bi bi-eye"></i></button></div>
        <input type="hidden" name="cliente_id" value="${ped?.cliente_id || ''}"><div id="cli-alerta" class="small mt-1"></div></div>
      ${campo('forma_id', 'Forma de pagamento', { type: 'select', col: 'col-md-3', required: true, options: opcoes(o.formas), value: ped?.forma_id || '' })}
      ${campo('condicao_id', 'Condição de pagamento', { type: 'select', col: 'col-md-4', required: true, options: [['', 'Selecione a forma']] })}
      ${!ehVendedor ? campo('vendedor_id', 'Vendedor', { type: 'select', col: 'col-md-3', options: opcoes(o.vendedores, 'Eu mesmo'), value: ped?.vendedor_id || '' }) : ''}
      ${campo('tipo_entrega', 'Tipo de entrega', { type: 'select', col: 'col-md-3', options: Object.entries(ROTULOS.tipo_entrega), value: ped?.tipo_entrega || 'transportadora' })}
      ${campo('endereco_entrega_id', 'Endereço de entrega', { type: 'select', col: ehVendedor ? 'col-md-9' : 'col-md-6', options: [['', 'Selecione o cliente']] })}
      ${campo('observacao', 'Observação', { col: 'col-12', value: ped?.observacao || '' })}
    </div></div></div>
    <div class="card mb-3"><div class="card-header py-2 d-flex align-items-center">Itens do pedido
      <button type="button" class="btn btn-sm btn-outline-success ms-auto" id="btn-add-item"><i class="bi bi-plus-lg"></i> Adicionar item</button></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table table-sm itens-pedido mb-0">
        <thead><tr><th>Grupo</th><th style="min-width:200px">Produto</th><th style="min-width:130px">Embalagem</th><th style="width:90px">Qtd</th><th>Un</th>
          <th class="num">Valor tabela</th><th class="num">Custo emb.</th><th style="width:120px">Valor unit.</th><th class="num">Total</th><th>Brinde</th><th></th></tr></thead>
        <tbody id="itens"></tbody></table></div>
        <div id="dicas-brinde" class="px-3"></div>
      </div>
      <div class="card-footer text-end">Produtos: <b id="t-prod">R$ 0,00</b> · Desconto da condição: <b id="t-desc">R$ 0,00</b> · <span class="fs-5">Total: <b id="t-total">R$ 0,00</b></span>
        <div class="small text-muted" id="t-min"></div></div>
    </div>
    <div class="d-flex gap-2 justify-content-end">
      <button type="submit" class="btn btn-outline-success" data-enviar="0"><i class="bi bi-save"></i> Salvar</button>
      <button type="submit" class="btn btn-success" data-enviar="1"><i class="bi bi-send"></i> Salvar e enviar</button>
    </div></form>`;

  const f = pagina.querySelector('#form-pedido');
  const $ = (s) => f.querySelector(s);
  let cliente = null;

  const carregarCliente = async (cid, enderecoId) => {
    cliente = await get(`/api/clientes/${cid}`);
    $('[name=cliente_id]').value = cid;
    $('#cli-busca').value = cliente.nome;
    const sel = $('[name=endereco_entrega_id]');
    sel.innerHTML = cliente.enderecos.map((e) => `<option value="${e.id}">${esc(`${e.logradouro || ''}, ${e.numero || 'S/N'} - ${e.cidade}/${e.uf}${e.zona_rural ? ' (rural)' : ''}`)}</option>`).join('') || '<option value="">Cliente sem endereço</option>';
    if (enderecoId) sel.value = enderecoId;
    const bl = cliente.blacklist;
    $('#cli-alerta').innerHTML = bl.bloqueio ? `<span class="text-danger"><i class="bi bi-shield-x"></i> Bloqueado: ${esc(bl.bloqueio.motivo)}</span>`
      : bl.alertas.length ? `<span class="text-warning"><i class="bi bi-shield-exclamation"></i> Alerta: ${esc(bl.alertas[0].motivo)}</span>` : '';
  };
  buscaCliente($('#cli-busca'), (c) => carregarCliente(c.id).catch(erro));
  $('#btn-novo-cli').addEventListener('click', () => abrirCliente(null, (novoId) => carregarCliente(novoId)));
  $('#btn-ver-cli').addEventListener('click', () => { if (cliente) abrirCliente(cliente.id, () => carregarCliente(cliente.id, $('[name=endereco_entrega_id]').value)); });

  const atualizarCondicoes = (valor) => {
    const fid = Number($('[name=forma_id]').value);
    const lista = o.condicoes.filter((c) => c.forma_id === fid);
    $('[name=condicao_id]').innerHTML = lista.length ? lista.map((c) => `<option value="${c.id}">${esc(c.descricao)}</option>`).join('') : '<option value="">Selecione a forma</option>';
    if (valor) $('[name=condicao_id]').value = valor;
    recalcular();
  };
  $('[name=forma_id]').addEventListener('change', async () => {
    atualizarCondicoes();
    for (const tr of f.querySelectorAll('#itens tr')) await aplicarPreco(tr, true);
    recalcular();
  });
  $('[name=condicao_id]').addEventListener('change', recalcular);

  // ---------- Itens ----------
  const tbody = $('#itens');
  function novaLinha(it = {}) {
    const tr = h(`<tr>
      <td><select class="form-select form-select-sm" data-c="grupo">${opcoes(o.grupos, 'Todos').map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></td>
      <td><select class="form-select form-select-sm" data-c="produto_id" required></select></td>
      <td><select class="form-select form-select-sm" data-c="embalagem_id"></select></td>
      <td><input type="number" min="0.01" step="0.01" class="form-control form-control-sm" data-c="quantidade" value="${it.quantidade ?? 1}" required></td>
      <td data-c="unidade" class="small">${esc(it.unidade || '')}</td>
      <td class="num small" data-c="valor_tabela">${fmt.money(it.valor_tabela || 0)}</td>
      <td class="num small" data-c="custo">${fmt.money(it.custo_embalagem || 0)}</td>
      <td><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-c="valor_unitario" value="${it.valor_unitario ?? ''}"></td>
      <td class="num fw-semibold" data-c="total"></td>
      <td class="text-center"><input type="checkbox" class="form-check-input" data-c="brinde" ${it.brinde ? 'checked' : ''}></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger py-0" data-rem>&times;</button></td></tr>`);
    tbody.appendChild(tr);
    const selG = tr.querySelector('[data-c=grupo]');
    const selP = tr.querySelector('[data-c=produto_id]');
    const preencherProdutos = () => {
      const g = Number(selG.value);
      selP.innerHTML = '<option value="">Selecione...</option>' + o.produtos.filter((p) => !g || p.grupo_id === g).map((p) => `<option value="${p.id}">${esc(p.codigo ? p.codigo + ' - ' : '')}${esc(p.nome)}</option>`).join('');
    };
    if (it.grupo_id) selG.value = it.grupo_id;
    preencherProdutos();
    if (it.produto_id) selP.value = it.produto_id;
    tr.dataset.tabela = it.valor_tabela || 0;
    selG.addEventListener('change', () => { preencherProdutos(); carregarEmbalagens(tr); });
    selP.addEventListener('change', () => carregarEmbalagens(tr, null, true));
    tr.querySelector('[data-c=embalagem_id]').addEventListener('change', () => aplicarPreco(tr, true));
    tr.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalcular));
    tr.querySelector('[data-c=brinde]').addEventListener('change', recalcular);
    tr.querySelector('[data-rem]').addEventListener('click', () => { tr.remove(); recalcular(); });
    if (it.produto_id) carregarEmbalagens(tr, it.embalagem_id, false);
    recalcular();
    return tr;
  }

  async function carregarEmbalagens(tr, embId, aplicar) {
    const pid = tr.querySelector('[data-c=produto_id]').value;
    const sel = tr.querySelector('[data-c=embalagem_id]');
    if (!pid) { sel.innerHTML = ''; return; }
    const d = await precosDo(pid);
    sel.innerHTML = d.embalagens.map((e) => `<option value="${e.id}">${esc(e.descricao)}</option>`).join('') || '<option value="">(sem embalagem)</option>';
    if (embId) sel.value = embId;
    await aplicarPreco(tr, aplicar);
  }

  async function aplicarPreco(tr, sobrescreverUnit) {
    const pid = tr.querySelector('[data-c=produto_id]').value;
    if (!pid) return;
    const d = await precosDo(pid);
    const embId = Number(tr.querySelector('[data-c=embalagem_id]').value) || null;
    const emb = d.embalagens.find((e) => e.id === embId);
    const formaId = Number($('[name=forma_id]').value) || null;
    const preco = d.precos.find((p) => p.embalagem_id === embId && p.forma_id === formaId) || d.precos.find((p) => p.embalagem_id === embId && !p.forma_id);
    const valor = preco?.valor || 0;
    tr.dataset.tabela = valor;
    tr.querySelector('[data-c=valor_tabela]').textContent = fmt.money(valor);
    tr.querySelector('[data-c=custo]').textContent = fmt.money(emb?.custo || 0);
    tr.querySelector('[data-c=unidade]').textContent = emb?.unidade || o.produtos.find((p) => p.id === Number(pid))?.unidade || '';
    const unit = tr.querySelector('[data-c=valor_unitario]');
    if (sobrescreverUnit || unit.value === '') unit.value = valor || '';
    tr.dataset.brindes = JSON.stringify(d.brindes);
    recalcular();
  }

  function recalcular() {
    let soma = 0;
    const dicas = [];
    for (const tr of tbody.querySelectorAll('tr')) {
      const q = Number(tr.querySelector('[data-c=quantidade]').value) || 0;
      const brinde = tr.querySelector('[data-c=brinde]').checked;
      const unitEl = tr.querySelector('[data-c=valor_unitario]');
      unitEl.disabled = brinde;
      const unit = brinde ? 0 : Number(unitEl.value) || 0;
      const tot = q * unit;
      soma += tot;
      tr.querySelector('[data-c=total]').textContent = brinde ? 'Brinde' : fmt.money(tot);
      const tab = Number(tr.dataset.tabela) || 0;
      unitEl.classList.toggle('is-invalid', !brinde && tab > 0 && unit < tab * 0.9);
      unitEl.title = !brinde && tab > 0 && unit < tab * 0.9 ? 'Valor mais de 10% abaixo da tabela' : '';
      for (const b of JSON.parse(tr.dataset.brindes || '[]')) {
        if (q >= b.qtd_minima) dicas.push(`Compra de ${fmt.num(q)} un. dá direito a ${fmt.num(Math.floor(q / b.qtd_minima) * b.qtd_brinde)} un. de brinde: <b>${esc(b.brinde_nome)}</b>${b.observacao ? ` (${esc(b.observacao)})` : ''}`);
      }
    }
    const cond = o.condicoes.find((c) => c.id === Number($('[name=condicao_id]').value));
    const desc = soma * ((cond?.desconto_pct || 0) / 100);
    $('#t-prod').textContent = fmt.money(soma);
    $('#t-desc').textContent = fmt.money(desc);
    $('#t-total').textContent = fmt.money(soma - desc);
    $('#t-min').textContent = cond?.valor_minimo ? `Valor mínimo para esta condição: ${fmt.money(cond.valor_minimo)}` : '';
    $('#dicas-brinde').innerHTML = dicas.map((x) => `<div class="alert alert-info py-1 my-2 small"><i class="bi bi-gift"></i> ${x}</div>`).join('');
  }

  $('#btn-add-item').addEventListener('click', () => novaLinha());

  // ---------- Inicialização ----------
  if (ped) {
    atualizarCondicoes(ped.condicao_id);
    await carregarCliente(ped.cliente_id, ped.endereco_entrega_id).catch(erro);
    itensIniciais.forEach((it) => novaLinha(it));
  } else {
    atualizarCondicoes();
    novaLinha();
  }

  let enviar = false;
  f.querySelectorAll('[data-enviar]').forEach((b) => b.addEventListener('click', () => { enviar = b.dataset.enviar === '1'; }));
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {
      cliente_id: Number($('[name=cliente_id]').value) || null,
      forma_id: Number($('[name=forma_id]').value) || null,
      condicao_id: Number($('[name=condicao_id]').value) || null,
      tipo_entrega: $('[name=tipo_entrega]').value,
      endereco_entrega_id: Number($('[name=endereco_entrega_id]').value) || null,
      observacao: $('[name=observacao]').value || null,
      vendedor_id: $('[name=vendedor_id]') ? Number($('[name=vendedor_id]').value) || undefined : undefined,
      enviar,
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
      const r = edicao ? await put(`/api/pedidos/${id}`, dados) : await post('/api/pedidos', dados);
      toast(enviar ? 'Pedido salvo e enviado.' : `Pedido ${r.numero || ped.numero} salvo.`);
      window.atualizarContadores?.();
      location.hash = '#/fila/venda';
    } catch (e) { erro(e); }
  });
}
