// Portal do cliente: acesso do produtor aos pedidos, entregas, boletos, notas, extrato e novo pedido.
const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const data = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const docFmt = (d) => { const s = String(d || '').replace(/\D/g, ''); return s.length === 11 ? s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : s.length === 14 ? s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : s; };
const COR = { Recebido: 'secondary', 'Em análise': 'info', 'Aguardando pagamento': 'warning', 'Em separação': 'primary', Faturando: 'primary', 'Pronto para envio': 'primary', 'Em transporte': 'warning', Entregue: 'success', Cancelado: 'danger', 'Em devolução': 'danger' };
const badge = (s) => `<span class="badge text-bg-${COR[s] || 'secondary'}">${esc(s)}</span>`;

class ErroApi extends Error { constructor(m, s) { super(m); this.status = s; } }
async function api(url, opts = {}) {
  const r = await fetch(`/api/portal${url}`, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: { 'X-Requested-With': 'agroterra', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/login')) { telaLogin(); throw new ErroApi(j.erro || 'Sessão expirada', 401); }
  if (!r.ok) throw new ErroApi(j.erro || 'Não foi possível concluir. Tente de novo.', r.status);
  return j;
}
const post = (url, body) => api(url, { method: 'POST', body });

function toast(msg, cor = 'success') {
  const el = document.createElement('div');
  el.className = `toast align-items-center t-${cor}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body d-flex gap-2"><i class="bi ${cor === 'danger' ? 'bi-exclamation-octagon-fill' : 'bi-check-circle-fill'}"></i><span>${esc(msg)}</span></div><button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
  document.getElementById('toasts').append(el);
  new bootstrap.Toast(el, { delay: 5000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

const marca = '<div class="d-flex align-items-center gap-3 mb-3"><img src="/img/logo.png" alt="Acelera Fertilizantes" width="88" height="56"><div class="small text-muted border-start ps-3">Portal do Cliente</div></div>';

// ---------- Acesso ----------
function telaLogin(msg) {
  history.replaceState(null, '', '/portal.html');
  app.innerHTML = `<div class="pt-acesso"><div class="pt-card p-4 shadow-sm">${marca}
    <h1 class="h5 mb-3">Entrar</h1>
    ${msg ? `<div class="alert alert-info py-2 small">${esc(msg)}</div>` : ''}
    <form id="f-login" class="vstack gap-3" novalidate>
      <div><label class="form-label" for="doc">CPF ou CNPJ</label><input class="form-control" id="doc" name="documento" inputmode="numeric" autocomplete="username" required></div>
      <div><label class="form-label" for="senha">Senha</label><input class="form-control" type="password" id="senha" name="senha" autocomplete="current-password" required></div>
      <div class="text-danger small" id="erro" role="alert"></div>
      <button class="btn btn-success w-100" type="submit">Entrar</button>
    </form>
    <p class="small text-muted mt-3 mb-0">Primeiro acesso ou esqueceu a senha? Peça ao seu vendedor o link de acesso.</p></div></div>`;
  app.querySelector('#f-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const b = f.querySelector('button');
    b.disabled = true;
    try {
      await post('/login', { documento: f.documento.value, senha: f.senha.value });
      location.hash = '#inicio';
      iniciar();
    } catch (e) { f.querySelector('#erro').textContent = e.message; } finally { b.disabled = false; }
  });
}

async function telaConvite(token) {
  let nome;
  try { nome = (await api(`/convite/${encodeURIComponent(token)}`)).nome; } catch (e) { return telaLogin(e.message); }
  app.innerHTML = `<div class="pt-acesso"><div class="pt-card p-4 shadow-sm">${marca}
    <h1 class="h5">Olá, ${esc(nome)}</h1><p class="small text-muted">Crie sua senha para acompanhar pedidos, entregas e boletos.</p>
    <form id="f-ativar" class="vstack gap-3">
      <div><label class="form-label" for="s1">Nova senha</label><input class="form-control" type="password" id="s1" autocomplete="new-password" required minlength="8">
        <div class="form-text">Ao menos 8 caracteres, com letras e números.</div></div>
      <div><label class="form-label" for="s2">Repita a senha</label><input class="form-control" type="password" id="s2" autocomplete="new-password" required></div>
      <div class="text-danger small" id="erro" role="alert"></div>
      <button class="btn btn-success w-100" type="submit">Criar senha e entrar</button>
    </form></div></div>`;
  app.querySelector('#f-ativar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const s1 = app.querySelector('#s1').value;
    if (s1 !== app.querySelector('#s2').value) { app.querySelector('#erro').textContent = 'As senhas não conferem.'; return; }
    try {
      await post('/ativar', { token, senha: s1 });
      history.replaceState(null, '', '/portal.html#inicio');
      toast('Senha criada. Bem-vindo!');
      iniciar();
    } catch (e) { app.querySelector('#erro').textContent = e.message; }
  });
}

// ---------- Casca ----------
let me = null;
const ABAS = [['inicio', 'bi-house', 'Início'], ['pedidos', 'bi-receipt', 'Pedidos'], ['financeiro', 'bi-cash-coin', 'Boletos'], ['notas', 'bi-file-earmark-text', 'Notas'], ['novo', 'bi-cart-plus', 'Fazer pedido'], ['conta', 'bi-person', 'Minha conta']];

async function iniciar() {
  const conv = location.hash.match(/^#convite=([\w-]+)/);
  if (conv) return telaConvite(conv[1]);
  try { me = await api('/me'); } catch (e) { if (e.status !== 401) telaLogin(e.message); return; }
  app.innerHTML = `<header class="pt-topo"><div class="pt-wrap d-flex align-items-center gap-2 py-3">
      <span class="bg-white rounded-3 px-2 py-1 d-inline-flex"><img src="/img/logo.png" alt="Acelera Fertilizantes" width="47" height="30"></span>
      <div class="me-auto min-w-0"><div class="fw-bold text-truncate">${esc(me.nome)}</div><div class="small opacity-75">${esc(docFmt(me.documento))}${me.empresa ? ` · ${esc(me.empresa)}` : ''}</div></div>
      <button class="btn btn-sm btn-outline-light" id="sair"><i class="bi bi-box-arrow-right"></i> Sair</button></div></header>
    <nav class="pt-nav" aria-label="Seções"><div class="pt-wrap">${ABAS.map(([id, i, l]) => `<a href="#${id}" data-aba="${id}"><i class="bi ${i}"></i> ${l}</a>`).join('')}</div></nav>
    <main class="pt-wrap py-3" id="conteudo"></main>`;
  app.querySelector('#sair').addEventListener('click', async () => { await post('/sair').catch(() => {}); telaLogin('Você saiu do portal.'); });
  rota();
}

async function rota() {
  if (!me) return;
  const [aba, arg] = (location.hash.slice(1) || 'inicio').split('/');
  app.querySelectorAll('[data-aba]').forEach((a) => a.classList.toggle('ativo', a.dataset.aba === (aba === 'pedido' ? 'pedidos' : aba)));
  const el = app.querySelector('#conteudo');
  el.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success" role="status"></div></div>';
  try {
    await ({ inicio, pedidos, pedido: () => pedido(el, arg), financeiro, notas, novo, conta }[aba] || inicio)(el);
  } catch (e) { if (e.status !== 401) el.innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', () => (location.hash.startsWith('#convite=') ? iniciar() : rota()));

const passos = (p) => `<div class="pt-passos mt-2">${['Recebido', 'Em análise', 'Em separação', 'Faturando', 'Em transporte', 'Entregue'].map((l, i) => `<div class="${p.passo >= i ? 'feito' : ''}"><div class="barra"></div><span class="d-none d-sm-inline">${l}</span></div>`).join('')}</div>`;
const cartaoPedido = (p) => `<a class="pt-card pt-pedido d-block p-3 mb-2 text-reset text-decoration-none" href="#pedido/${p.id}">
  <div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-semibold">Pedido ${esc(p.numero)}</div><div class="small text-muted">${data(p.created_at)} · ${p.itens} item(ns)${p.origem_portal ? ' · feito no portal' : ''}</div></div>
  <div class="text-end"><div class="fw-semibold">${money(p.valor_total)}</div>${badge(p.situacao)}</div></div>
  ${p.passo >= 0 ? passos(p) : ''}
  ${p.etapa === 'transito' ? `<div class="small mt-2"><i class="bi bi-truck"></i> ${esc(p.transportadora || 'Transportadora')}${p.data_entrega_prevista ? ` · previsão ${data(p.data_entrega_prevista)}` : ''}${p.rastreio_status ? ` · ${esc(p.rastreio_status)}` : ''}</div>` : ''}</a>`;

async function inicio(el) {
  const r = await api('/resumo');
  const kpi = (l, v, cor = '') => `<div class="col-6 col-md-3"><div class="pt-card pt-kpi p-3 h-100"><div class="l">${l}</div><div class="v ${cor}">${v}</div></div></div>`;
  el.innerHTML = `<div class="row g-2 mb-3">
      ${kpi('Pedidos em andamento', r.andamento)}${kpi('Em transporte', r.transito)}
      ${kpi('Em aberto', money(r.aberto))}${kpi('Vencido', money(r.vencido), r.vencido > 0 ? 'text-danger' : '')}</div>
    ${r.vencido > 0 ? `<div class="alert alert-warning d-flex gap-2 align-items-center"><i class="bi bi-exclamation-triangle"></i><div>Você tem ${r.qtd_vencidas} parcela(s) vencida(s). <a href="#financeiro">Ver boletos</a></div></div>`
      : r.proximo ? `<div class="alert alert-light border d-flex gap-2 align-items-center"><i class="bi bi-calendar-event"></i><div>Próximo vencimento: <b>${data(r.proximo)}</b> · ${money(r.proximo_valor)}. <a href="#financeiro">Ver boletos</a></div></div>` : ''}
    <div class="d-flex align-items-center mb-2"><h2 class="h6 mb-0 me-auto">Últimos pedidos</h2><a href="#novo" class="btn btn-sm btn-success"><i class="bi bi-cart-plus"></i> Fazer pedido</a></div>
    ${r.ultimos.length ? r.ultimos.map(cartaoPedido).join('') : '<div class="pt-card p-4 text-center text-muted">Nenhum pedido ainda.</div>'}
    ${me.vendedor ? `<div class="pt-card p-3 mt-3 small"><div class="text-muted mb-1">Seu vendedor</div><div class="fw-semibold">${esc(me.vendedor.nome)}</div>
      ${me.vendedor.telefone ? `<a href="https://wa.me/55${esc(String(me.vendedor.telefone).replace(/\D/g, ''))}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> ${esc(me.vendedor.telefone)}</a>` : ''}
      ${me.vendedor.email ? ` <a class="ms-2" href="mailto:${esc(me.vendedor.email)}"><i class="bi bi-envelope"></i> ${esc(me.vendedor.email)}</a>` : ''}</div>` : ''}`;
}

async function pedidos(el) {
  const r = await api('/pedidos');
  el.innerHTML = `<h2 class="h6 mb-2">Meus pedidos</h2>${r.pedidos.length ? r.pedidos.map(cartaoPedido).join('') : '<div class="pt-card p-4 text-center text-muted">Nenhum pedido.</div>'}`;
}

async function pedido(el, id) {
  const p = await api(`/pedidos/${Number(id)}`);
  const end = p.cidade ? `${esc(p.logradouro || '')}${p.end_numero ? ', ' + esc(p.end_numero) : ''} · ${esc(p.bairro || '')} · ${esc(p.cidade)}/${esc(p.uf || '')}` : '';
  el.innerHTML = `<a href="#pedidos" class="small"><i class="bi bi-arrow-left"></i> Pedidos</a>
    <div class="pt-card p-3 my-2"><div class="d-flex justify-content-between gap-2"><div><h2 class="h5 mb-0">Pedido ${esc(p.numero)}</h2><div class="small text-muted">${data(p.created_at)}${p.forma ? ` · ${esc(p.forma)}` : ''}${p.condicao ? ` ${esc(p.condicao)}` : ''}</div></div>
      <div class="text-end"><div class="fs-5 fw-bold">${money(p.valor_total)}</div>${badge(p.situacao)}</div></div>
      ${p.passo >= 0 ? `<ol class="list-unstyled mt-3 mb-0 small">${p.passos.map((s, i) => `<li class="d-flex gap-2 mb-1 ${p.passo >= i ? '' : 'text-muted'}"><i class="bi ${p.passo > i || (p.passo === i && i === 5) ? 'bi-check-circle-fill text-success' : p.passo === i ? 'bi-arrow-right-circle-fill text-primary' : 'bi-circle'}"></i>${esc(s.label)}${s.em && p.passo >= i ? ` <span class="text-muted ms-auto">${data(s.em)}</span>` : ''}</li>`).join('')}</ol>` : ''}</div>
    ${p.etapa === 'transito' || p.etapa === 'entregue' || p.rastreio.length ? `<div class="pt-card p-3 mb-2"><h3 class="h6"><i class="bi bi-truck"></i> Entrega</h3>
      <div class="small">${esc(p.transportadora || (p.tipo_entrega === 'retirada' ? 'Retirada na empresa' : ''))}${p.codigo_rastreio ? ` · código ${esc(p.codigo_rastreio)}` : ''}${p.data_embarque ? ` · embarcado em ${data(p.data_embarque)}` : ''}
      ${p.data_entrega ? ` · <b>entregue em ${data(p.data_entrega)}</b>` : p.data_entrega_prevista ? ` · previsão <b>${data(p.data_entrega_prevista)}</b>` : ''}</div>
      ${p.rastreio.length ? `<ul class="list-unstyled small mt-2 mb-0 border-start ps-3">${p.rastreio.map((x) => `<li class="mb-1"><b>${esc(x.descricao)}</b>${x.local ? ` · ${esc(x.local)}` : ''}<div class="text-muted">${esc(String(x.data).replace('T', ' ').slice(0, 16).split(' ').map((v, i) => (i ? v : data(v))).join(' '))}</div></li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="pt-card p-3 mb-2"><h3 class="h6">Itens</h3><div class="table-responsive"><table class="table table-sm mb-0 small"><thead><tr><th>Produto</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Total</th></tr></thead><tbody>
      ${p.itens.map((i) => `<tr><td>${esc(i.produto)}${i.embalagem ? `<div class="text-muted">${esc(i.embalagem)}${i.lote ? ` · lote ${esc(i.lote)}` : ''}${i.validade ? ` · val. ${data(i.validade)}` : ''}</div>` : ''}${i.brinde ? ' <span class="badge text-bg-info">brinde</span>' : ''}</td>
        <td class="num">${num(i.quantidade)}</td><td class="num">${money(i.valor_unitario)}</td><td class="num">${money(i.valor_total)}</td></tr>`).join('')}</tbody>
      <tfoot>${p.valor_desconto ? `<tr><td colspan="3">Desconto</td><td class="num">−${money(p.valor_desconto)}</td></tr>` : ''}${p.frete_valor ? `<tr><td colspan="3">Frete</td><td class="num">${money(p.frete_valor)}</td></tr>` : ''}<tr class="fw-semibold"><td colspan="3">Total</td><td class="num">${money(p.valor_total)}</td></tr></tfoot></table></div>
      ${end ? `<div class="small text-muted mt-2"><i class="bi bi-geo-alt"></i> ${end}</div>` : ''}</div>
    ${p.notas.length ? `<div class="pt-card p-3 mb-2"><h3 class="h6">Notas fiscais</h3>${p.notas.map(linhaNota).join('')}</div>` : ''}
    ${p.parcelas.length ? `<div class="pt-card p-3 mb-2"><h3 class="h6">Parcelas</h3>${p.parcelas.map(linhaParcela).join('')}</div>` : ''}`;
  ligarCopiar(el);
}

const linhaNota = (n) => `<div class="border-bottom py-2 small"><div class="d-flex justify-content-between"><span><b>NF ${esc(n.numero)}</b>${n.serie ? `/${esc(n.serie)}` : ''} · ${data(n.data_emissao)}${n.pedido ? ` · pedido ${esc(n.pedido)}` : ''}</span><span>${money(n.valor)}</span></div>
  ${n.status !== 'autorizada' ? `<span class="badge text-bg-danger">${esc(n.status)}</span>` : ''}${n.chave ? `<div class="linha-digitavel text-muted">${esc(n.chave)} <button class="btn btn-link btn-sm p-0" data-copiar="${esc(n.chave)}">copiar chave</button></div>` : ''}</div>`;

function linhaParcela(x) {
  const cor = x.situacao === 'Vencida' ? 'danger' : x.situacao === 'Paga' ? 'success' : 'secondary';
  return `<div class="border-bottom py-2 small"><div class="d-flex justify-content-between gap-2 align-items-start">
    <div><b>${x.numero}/${x.total_parcelas || '?'}</b> · vence ${data(x.vencimento)}${x.pedido ? ` · pedido ${esc(x.pedido)}` : ''}${x.nota ? ` · NF ${esc(x.nota)}` : ''}
      <div><span class="badge text-bg-${cor}">${x.situacao}${x.dias_atraso ? ` há ${x.dias_atraso} dias` : ''}</span>${x.situacao === 'Paga' ? ` <span class="text-muted">em ${data(x.data_pagamento)}</span>` : ''}</div></div>
    <div class="text-end fw-semibold">${money(x.situacao === 'Paga' ? x.valor_pago : x.saldo)}</div></div>
    ${x.situacao !== 'Paga' && (x.boleto_linha || x.boleto_pix || x.boleto_url) ? `<div class="mt-1 d-flex flex-wrap gap-2">
      ${x.boleto_linha ? `<button class="btn btn-sm btn-outline-secondary" data-copiar="${esc(x.boleto_linha)}"><i class="bi bi-upc"></i> Copiar linha digitável</button>` : ''}
      ${x.boleto_pix ? `<button class="btn btn-sm btn-outline-success" data-copiar="${esc(x.boleto_pix)}"><i class="bi bi-qr-code"></i> Copiar PIX</button>` : ''}
      ${x.boleto_url && /^https:\/\//.test(x.boleto_url) ? `<a class="btn btn-sm btn-outline-primary" href="${esc(x.boleto_url)}" target="_blank" rel="noopener"><i class="bi bi-file-earmark-pdf"></i> Boleto</a>` : ''}</div>` : ''}</div>`;
}

function ligarCopiar(el) {
  el.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Copiado.'); } catch { prompt('Copie:', b.dataset.copiar); }
  }));
}

async function financeiro(el) {
  const [parc, ext] = await Promise.all([api('/parcelas'), api('/extrato')]);
  const abertas = parc.filter((x) => x.situacao !== 'Paga');
  const pagas = parc.filter((x) => x.situacao === 'Paga').reverse();
  el.innerHTML = `<div class="pt-card p-3 mb-2"><h2 class="h6">Em aberto <span class="text-muted fw-normal">· ${money(abertas.reduce((a, x) => a + x.saldo, 0))}</span></h2>
      ${abertas.length ? abertas.map(linhaParcela).join('') : '<div class="text-muted small">Nada em aberto. Obrigado!</div>'}</div>
    <div class="pt-card p-3 mb-2"><h2 class="h6">Extrato (12 meses)</h2><div class="table-responsive"><table class="table table-sm small mb-0"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Compra</th><th class="num">Pagamento</th><th class="num">Saldo</th></tr></thead><tbody>
      <tr class="text-muted"><td>${data(ext.de)}</td><td>Saldo anterior</td><td></td><td></td><td class="num">${money(ext.saldo_anterior)}</td></tr>
      ${ext.movimentos.map((m) => `<tr><td>${data(m.data)}</td><td>${esc(m.descricao)}</td><td class="num">${m.debito ? money(m.debito) : ''}</td><td class="num text-success">${m.credito ? money(m.credito) : ''}</td><td class="num">${money(m.saldo)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="fw-semibold"><td colspan="4">Saldo devedor</td><td class="num">${money(ext.saldo_final)}</td></tr></tfoot></table></div></div>
    ${pagas.length ? `<details class="pt-card p-3"><summary class="h6 mb-0">Pagas nos últimos 12 meses (${pagas.length})</summary>${pagas.map(linhaParcela).join('')}</details>` : ''}`;
  ligarCopiar(el);
}

async function notas(el) {
  const n = await api('/notas');
  el.innerHTML = `<div class="pt-card p-3"><h2 class="h6">Notas fiscais</h2>${n.length ? n.map(linhaNota).join('') : '<div class="text-muted small">Nenhuma nota.</div>'}</div>`;
  ligarCopiar(el);
}

// ---------- Novo pedido ----------
const carrinho = new Map();
async function novo(el, forma, endereco) {
  const c = await api(`/catalogo?${forma ? `forma_id=${forma}&` : ''}${endereco ? `endereco_id=${endereco}` : ''}`);
  for (const k of [...carrinho.keys()]) if (!c.itens.some((i) => i.embalagem_id === k)) carrinho.delete(k);
  const grupos = [...new Set(c.itens.map((i) => i.grupo || 'Outros'))];
  const ordenados = [...c.itens].sort((a, b) => b.ja_comprou - a.ja_comprou);
  el.innerHTML = `<div class="pt-card p-3 mb-2"><h2 class="h6">Fazer pedido</h2>
      <p class="small text-muted">Preços da ${esc(c.tabela || 'tabela vigente')} para a sua região. O pedido vai para o seu vendedor, que confirma frete, prazo e condições com você.</p>
      <div class="row g-2">
        <div class="col-md-4"><label class="form-label small" for="np-forma">Pagamento</label><select class="form-select form-select-sm" id="np-forma">${c.formas.map((f) => `<option value="${f.id}" ${f.id === c.forma_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="col-md-3"><label class="form-label small" for="np-cond">Condição</label><select class="form-select form-select-sm" id="np-cond"><option value="">A combinar</option>${c.condicoes.filter((x) => x.forma_id === c.forma_id).map((x) => `<option value="${x.id}">${esc(x.descricao)}</option>`).join('')}</select></div>
        <div class="col-md-5"><label class="form-label small" for="np-end">Entrega</label><select class="form-select form-select-sm" id="np-end">${c.enderecos.map((e) => `<option value="${e.id}" ${e.id === c.endereco_id ? 'selected' : ''}>${esc(`${e.logradouro || ''}${e.numero ? ', ' + e.numero : ''} · ${e.cidade || ''}/${e.uf || ''}`)}</option>`).join('')}<option value="retirada">Retirar na empresa</option></select></div>
      </div>
      <input class="form-control form-control-sm mt-2" type="search" id="np-busca" placeholder="Buscar produto" aria-label="Buscar produto"></div>
    <div id="np-lista">${grupos.map((g) => `<div class="pt-card p-2 mb-2" data-grupo><div class="small fw-semibold text-muted px-1">${esc(g)}</div>
      ${ordenados.filter((i) => (i.grupo || 'Outros') === g).map((i) => `<div class="d-flex align-items-center gap-2 border-top py-2 px-1" data-item data-busca="${esc(`${i.produto} ${i.codigo || ''} ${i.embalagem}`.toLowerCase())}">
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold small text-truncate">${esc(i.produto)}${i.ja_comprou ? ' <span class="badge text-bg-light border">já comprou</span>' : ''}</div><div class="small text-muted">${esc(i.embalagem)} · ${money(i.preco)}</div></div>
        <input type="number" min="0" step="1" inputmode="numeric" class="form-control form-control-sm" style="width:84px" aria-label="Quantidade de ${esc(i.produto)} ${esc(i.embalagem)}" data-emb="${i.embalagem_id}" data-preco="${i.preco}" value="${carrinho.get(i.embalagem_id) || ''}"></div>`).join('')}</div>`).join('')}
      ${c.itens.length ? '' : '<div class="pt-card p-4 text-center text-muted">Nenhum produto disponível no momento.</div>'}</div>
    <div class="mb-3"><label class="form-label small" for="np-obs">Observação</label><textarea class="form-control form-control-sm" id="np-obs" rows="2" maxlength="1000" placeholder="Cultura, área, prazo desejado..."></textarea></div>
    <div class="pt-carrinho py-2"><div class="d-flex align-items-center gap-2"><div class="me-auto"><div class="small text-muted" id="np-qtd">Nenhum item</div><div class="fw-bold" id="np-total">${money(0)}</div></div>
      <button class="btn btn-success" id="np-enviar" disabled><i class="bi bi-send"></i> Enviar pedido</button></div></div>`;
  const total = () => {
    let t = 0;
    let n = 0;
    el.querySelectorAll('[data-emb]').forEach((i) => { const q = Number(i.value) || 0; if (q > 0) { t += q * Number(i.dataset.preco); n++; carrinho.set(Number(i.dataset.emb), q); } else carrinho.delete(Number(i.dataset.emb)); });
    el.querySelector('#np-total').textContent = money(t);
    el.querySelector('#np-qtd').textContent = n ? `${n} item(ns) · valor estimado` : 'Nenhum item';
    el.querySelector('#np-enviar').disabled = !n;
  };
  el.querySelectorAll('[data-emb]').forEach((i) => i.addEventListener('input', total));
  total();
  el.querySelector('#np-busca').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('[data-item]').forEach((d) => { d.classList.toggle('d-none', !!q && !d.dataset.busca.includes(q)); d.classList.toggle('d-flex', !q || d.dataset.busca.includes(q)); });
    el.querySelectorAll('[data-grupo]').forEach((g) => g.classList.toggle('d-none', !g.querySelector('[data-item]:not(.d-none)')));
  });
  el.querySelector('#np-forma').addEventListener('change', (e) => novo(el, e.target.value, endVal()));
  const endVal = () => { const v = el.querySelector('#np-end').value; return v === 'retirada' ? '' : v; };
  el.querySelector('#np-end').addEventListener('change', (e) => { if (e.target.value !== 'retirada') novo(el, el.querySelector('#np-forma').value, e.target.value); });
  el.querySelector('#np-enviar').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    const retirada = el.querySelector('#np-end').value === 'retirada';
    if (!confirm('Enviar este pedido para o seu vendedor?')) return;
    b.disabled = true;
    try {
      const r = await post('/pedidos', {
        forma_id: el.querySelector('#np-forma').value, condicao_id: el.querySelector('#np-cond').value || null,
        endereco_entrega_id: retirada ? null : endVal(), tipo_entrega: retirada ? 'retirada' : 'transportadora', observacao: el.querySelector('#np-obs').value,
        itens: [...carrinho].map(([embalagem_id, quantidade]) => ({ embalagem_id, quantidade })),
      });
      carrinho.clear();
      toast(`Pedido ${r.numero} enviado. Seu vendedor vai confirmar com você.`);
      location.hash = `#pedido/${r.id}`;
    } catch (e) { toast(e.message, 'danger'); b.disabled = false; }
  });
}

async function conta(el) {
  el.innerHTML = `<div class="pt-card p-3" style="max-width:420px"><h2 class="h6">Trocar senha</h2>
    <form id="f-senha" class="vstack gap-2">
      <div><label class="form-label small" for="sa">Senha atual</label><input class="form-control form-control-sm" type="password" id="sa" autocomplete="current-password" required></div>
      <div><label class="form-label small" for="sn">Nova senha</label><input class="form-control form-control-sm" type="password" id="sn" autocomplete="new-password" required minlength="8"><div class="form-text">Ao menos 8 caracteres, com letras e números.</div></div>
      <button class="btn btn-sm btn-success" type="submit">Salvar</button></form></div>
    <p class="small text-muted mt-3">Seus dados são tratados conforme a LGPD. Para corrigir cadastro, endereço ou pedir a exclusão dos dados, fale com seu vendedor.</p>`;
  el.querySelector('#f-senha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/senha', { method: 'PUT', body: { atual: el.querySelector('#sa').value, nova: el.querySelector('#sn').value } });
      toast('Senha alterada.');
      ev.target.reset();
    } catch (e) { toast(e.message, 'danger'); }
  });
}

iniciar();
