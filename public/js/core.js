// Utilitários de interface: API, formatação, modais, notificações e a tabela padrão das telas de lista.

export const state = { me: null, opcoes: null };

// ---------- API ----------
export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

export async function api(url, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'agroterra' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  if (raw) {
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).erro || res.statusText, res.status);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent('sessao-expirada'));
  }
  if (res.status === 428 && data.erro && !url.includes('/serasa')) window.dispatchEvent(new CustomEvent('pendencia-acesso'));
  if (!res.ok) throw new ApiError(data.erro || `Erro ${res.status}`, res.status);
  return data;
}
export const get = (u) => api(u);
export const post = (u, body) => api(u, { method: 'POST', body: body ?? {} });
export const put = (u, body) => api(u, { method: 'PUT', body: body ?? {} });
export const del = (u) => api(u, { method: 'DELETE' });

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

export async function baixar(url, nomePadrao = 'arquivo') {
  const res = await api(url, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
  const nome = m ? decodeURIComponent(m[1] || m[2]) : nomePadrao;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Formatação ----------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const fmt = {
  money: (v) => (v == null || v === '' ? '' : brl.format(Number(v))),
  num: (v) => (v == null || v === '' ? '' : num.format(Number(v))),
  pct: (v) => (v == null || v === '' ? '' : num.format(Number(v)) + '%'),
  date: (v) => {
    if (!v) return '';
    const [d] = String(v).split(/[ T]/);
    const [y, m, dd] = d.split('-');
    return dd ? `${dd}/${m}/${y}` : v;
  },
  datetime: (v) => (v ? `${fmt.date(v)} ${String(v).slice(11, 16)}` : ''),
  bool: (v) => (v ? '<i class="bi bi-check-lg text-success"></i>' : '<span class="text-muted">—</span>'),
  doc: (v) => {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return v || '';
  },
  periodo: (v) => (v ? v.split('-').reverse().join('/') : ''),
};

export const ROTULOS = {
  status: {
    a_pagar: ['A pagar', 'primary'], vencida: ['Vencida', 'danger'], liquidada: ['Liquidada', 'success'], negociada: ['Negociada', 'info'],
    acordo_judicial: ['Acordo judicial', 'warning'], cancelada: ['Cancelada', 'secondary'], devolvida: ['Devolvida', 'dark'],
    autorizada: ['Autorizada', 'success'], devolvida_parcial: ['Devolvida parcial', 'warning'],
    aberta: ['Aberta', 'primary'], revisada: ['Revisada', 'info'], paga: ['Paga', 'success'],
    inclusao_solicitada: ['Pedido de inclusão', 'warning'], inclusao_aceita: ['Inclusão aceita', 'danger'], inclusao_rejeitada: ['Inclusão rejeitada', 'secondary'],
    baixa_solicitada: ['Pedido de baixa', 'info'], baixa_aceita: ['Baixa aceita', 'success'], baixa_rejeitada: ['Baixa rejeitada', 'dark'],
    pendente: ['Pendente', 'warning'], pago: ['Pago', 'success'], expirado: ['Expirado', 'secondary'],
    alerta: ['Alerta', 'warning'], bloqueio: ['Bloqueio', 'danger'],
    prospeccao: ['Prospecção', 'secondary'], qualificacao: ['Qualificação', 'info'], proposta: ['Proposta', 'primary'], negociacao: ['Negociação', 'warning'], ganha: ['Ganha', 'success'], perdida: ['Perdida', 'danger'],
  },
  tipo_entrega: { transportadora: 'Transportadora', posta_restante: 'Posta restante', veiculo_proprio: 'Veículo próprio', retirada: 'Retirada no local' },
  tipo_baixa: { PIX: 'PIX', boleto: 'Boleto', TED: 'TED', dinheiro: 'Dinheiro', cheque: 'Cheque', cartao: 'Cartão', outros: 'Outros' },
  tipo_acao: { ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', sms: 'SMS', visita: 'Visita', carta: 'Carta', promessa: 'Promessa', acordo: 'Acordo', reuniao: 'Reunião', pos_venda: 'Pós-venda', reclamacao: 'Reclamação' },
  resultado: { contato_efetivo: 'Contato efetivo', sem_contato: 'Sem contato', promessa: 'Promessa de pagamento', recusa: 'Recusa', numero_invalido: 'Número inválido', acordo: 'Acordo' },
};
/** Troca códigos internos (ligacao, contato_efetivo...) pelos rótulos em português. */
export function humanizar(texto) {
  const mapa = { ...ROTULOS.tipo_acao, ...ROTULOS.resultado };
  return String(texto ?? '').replace(/\b[a-z]+(?:_[a-z]+)*\b/g, (w) => mapa[w] || w);
}
export function badge(valor, mapa = ROTULOS.status) {
  if (valor == null || valor === '') return '';
  const [l, c] = mapa[valor] || [valor, 'secondary'];
  return `<span class="badge text-bg-${c} badge-etapa">${esc(l)}</span>`;
}
// Etapas: cinza = ainda com o vendedor; azul = em aprovação; âmbar = depende de decisão/pagamento; verde-marca = em operação; verde = concluído; vermelho = devolução.
const CORES_ETAPA = { venda: 'secondary', supervisao: 'info', analise: 'info', diretoria: 'warning', cobranca: 'warning', producao: 'primary', faturamento: 'primary', expedicao: 'primary', transito: 'info', entregue: 'success', devolucao: 'danger', cancelado: 'secondary' };
export function badgeEtapa(etapa) {
  const e = state.me?.etapas?.[etapa];
  return `<span class="badge text-bg-${CORES_ETAPA[etapa] || 'secondary'} badge-etapa">${esc(e?.label || etapa)}</span>`;
}
export function renderCell(col, v, row) {
  if (col.render) return col.render(v, row);
  switch (col.t) {
    case 'money': return fmt.money(v);
    case 'num': return fmt.num(v);
    case 'pct': return fmt.pct(v);
    case 'date': return fmt.date(v);
    case 'datetime': return fmt.datetime(v);
    case 'bool': return fmt.bool(v);
    case 'doc': return fmt.doc(v);
    case 'status': return badge(v);
    case 'etapa': return badgeEtapa(v);
    default: return esc(v);
  }
}

// ---------- Notificações ----------
export function toast(msg, tipo = 'success', titulo) {
  const el = document.createElement('div');
  const icone = { success: 'bi-check-circle-fill', danger: 'bi-exclamation-octagon-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill', primary: 'bi-chat-dots-fill' }[tipo] || 'bi-info-circle-fill';
  el.className = `toast align-items-center t-${tipo}`;
  el.setAttribute('role', tipo === 'danger' ? 'alert' : 'status');
  el.setAttribute('aria-live', tipo === 'danger' ? 'assertive' : 'polite');
  const tituloPadrao = { danger: 'Não foi possível concluir', warning: 'Atenção' }[tipo];
  const t1 = titulo || tituloPadrao;
  el.innerHTML = `<div class="d-flex"><div class="toast-body d-flex gap-2"><i class="bi ${icone}"></i><div>${t1 ? `<strong class="d-block">${esc(t1)}</strong>` : ''}<span class="${t1 ? 'text-body-secondary' : ''}">${esc(msg)}</span></div></div>
    <button type="button" class="btn-close me-2 mt-2 align-self-start" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
  document.getElementById('toasts').appendChild(el);
  const t = new bootstrap.Toast(el, { delay: tipo === 'danger' ? 7000 : 4000 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}
export const erro = (e) => toast(e?.message || String(e), 'danger');

/** Executa uma ação assíncrona mostrando erro em toast; retorna o resultado ou undefined. */
export async function tentar(fn, msgOk) {
  try {
    const r = await fn();
    if (msgOk) toast(msgOk);
    return r ?? true;
  } catch (e) {
    erro(e);
    return undefined;
  }
}

// ---------- Modais ----------
export function modal({ title, body = '', size = 'lg', buttons = [], onShow, onClose, static: estatico }) {
  const el = document.createElement('div');
  el.className = 'modal fade';
  el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-${size} modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header py-2"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
    <div class="modal-body"></div>
    <div class="modal-footer py-2"></div></div></div>`;
  const corpo = el.querySelector('.modal-body');
  if (typeof body === 'string') corpo.innerHTML = body;
  else corpo.appendChild(body);
  const rodape = el.querySelector('.modal-footer');
  // Rodapé padrão: [Fechar/Cancelar] [utilitários] ··· [destrutivas] [principal]. A ação principal fica sempre à direita.
  const peso = (b) => {
    const c = b.cls || 'btn-success';
    if (/btn-(success|primary)\b/.test(c)) return 3;
    if (/danger|warning/.test(c)) return 2;
    return 1;
  };
  const ordenados = buttons.map((b, i) => ({ b, i })).sort((x, y) => peso(x.b) - peso(y.b) || x.i - y.i).map((x) => x.b);
  const botoes = [{ label: buttons.length === 1 ? 'Cancelar' : 'Fechar', cls: 'btn-outline-secondary', close: true }, ...ordenados];
  let espaco = false;
  for (const b of botoes) {
    if (!b.close && !espaco && peso(b) > 1) { rodape.appendChild(Object.assign(document.createElement('span'), { className: 'ms-auto' })); espaco = true; }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-sm ${b.cls || 'btn-success'}`;
    btn.innerHTML = b.label;
    if (b.id) btn.id = b.id;
    btn.addEventListener('click', async () => {
      if (b.close) return inst.hide();
      btn.disabled = true;
      btn.classList.add('carregando');
      rodape.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        const r = await b.onClick?.(api_);
        if (r !== false) inst.hide();
      } catch (e) {
        erro(e);
      } finally {
        btn.classList.remove('carregando');
        rodape.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
    rodape.appendChild(btn);
  }
  if (!espaco) rodape.insertBefore(Object.assign(document.createElement('span'), { className: 'ms-auto' }), rodape.firstChild);
  document.body.appendChild(el);
  autoPreencher(corpo);
  const inst = new bootstrap.Modal(el, { backdrop: estatico ? 'static' : true });
  const api_ = { el, body: corpo, close: () => inst.hide(), footer: rodape };
  el.addEventListener('shown.bs.modal', () => {
    onShow?.(api_);
    el.querySelector('input:not([type=hidden]):not([readonly]),select,textarea')?.focus();
  });
  el.addEventListener('hidden.bs.modal', () => { onClose?.(); el.remove(); });
  inst.show();
  return api_;
}

// ---------- Preenchimento automático (CEP e CNPJ) ----------
const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const campoDe = (escopo, nome) => escopo.querySelector(`[name="${nome}"], [data-k="${nome}"]`);

async function buscarCep(cep) {
  try { return await get(`/api/consulta/cep/${cep}`); } catch (e) {
    if (e.status === 404) return null;
    // Servidor sem acesso ao serviço: tenta direto do navegador (ViaCEP permite).
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json()).catch(() => null);
    return r && !r.erro ? { cep, logradouro: r.logradouro, bairro: r.bairro, cidade: r.localidade, uf: r.uf, complemento: r.complemento } : null;
  }
}

function definir(el, valor, { soVazio = false } = {}) {
  if (!el || valor == null || valor === '' || (soVazio && el.value)) return false;
  if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(valor))) el.add(new Option(valor, valor));
  el.value = valor;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Liga CEP e CNPJ dentro de um formulário: CEP completo preenche logradouro, bairro, cidade e UF;
 * CNPJ válido preenche razão social, fantasia, contato e endereço (só nos campos vazios).
 * Campos por name ou data-k (linhas de endereço). Emite "cnpj-encontrado" com os dados.
 */
export function autoPreencher(raiz) {
  if (raiz.dataset.autoPreencher) return;
  raiz.dataset.autoPreencher = '1';
  raiz.addEventListener('input', async (e) => {
    const el = e.target;
    const nome = el.name || el.dataset?.k;
    if (nome !== 'cep' || !e.isTrusted) return;
    const d = soDigitos(el.value).slice(0, 8);
    if (el.value !== (d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d)) el.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    if (d.length !== 8 || el.dataset.ultimo === d) return;
    el.dataset.ultimo = d;
    const escopo = el.closest('tr') || el.closest('form') || raiz;
    el.classList.add('buscando');
    const r = await buscarCep(d).catch(() => null);
    el.classList.remove('buscando');
    if (!r) { el.classList.add('is-invalid'); toast('CEP não encontrado. Confira o número ou preencha o endereço.', 'warning'); return; }
    el.classList.remove('is-invalid');
    definir(campoDe(escopo, 'logradouro') || campoDe(escopo, 'endereco'), r.logradouro);
    definir(campoDe(escopo, 'bairro'), r.bairro);
    definir(campoDe(escopo, 'cidade'), r.cidade);
    definir(campoDe(escopo, 'uf'), r.uf);
    definir(campoDe(escopo, 'complemento'), r.complemento, { soVazio: true });
    const num = campoDe(escopo, 'numero');
    if (num && !num.value) num.focus();
  });
  raiz.addEventListener('change', async (e) => {
    const el = e.target;
    const nome = el.name || el.dataset?.k;
    if (!['cnpj', 'documento'].includes(nome) || !e.isTrusted) return;
    const d = soDigitos(el.value);
    if (d.length !== 14 || el.dataset.ultimo === d) return;
    el.dataset.ultimo = d;
    let r;
    try { r = await get(`/api/consulta/cnpj/${d}`); } catch (err) { if (err.status !== 503) toast(err.message, 'warning'); return; }
    const escopo = el.closest('form') || raiz;
    const preenchidos = [
      definir(campoDe(escopo, 'razao_social') || campoDe(escopo, 'nome'), r.razao_social, { soVazio: true }),
      definir(campoDe(escopo, 'nome_fantasia'), r.nome_fantasia, { soVazio: true }),
      definir(campoDe(escopo, 'email'), r.email, { soVazio: true }),
      definir(campoDe(escopo, 'telefone'), r.telefone, { soVazio: true }),
      definir(campoDe(escopo, 'tipo_pessoa'), 'J', { soVazio: false }),
    ];
    if (campoDe(escopo, 'cep') && !campoDe(escopo, 'cep').value) {
      for (const k of ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']) preenchidos.push(definir(campoDe(escopo, k), r[k], { soVazio: true }));
    }
    raiz.dispatchEvent(new CustomEvent('cnpj-encontrado', { detail: r }));
    const ok = preenchidos.some(Boolean);
    const situacao = r.situacao && r.situacao.toUpperCase() !== 'ATIVA' ? ` · situação ${r.situacao}` : '';
    toast(`${r.razao_social}${situacao}${ok ? ' — dados preenchidos pela Receita.' : ''}`, situacao ? 'warning' : 'success', 'CNPJ consultado');
  });
}

export function confirmar(msg, { titulo = 'Confirmar', ok = 'Confirmar', cls = 'btn-success' } = {}) {
  return new Promise((resolve) => {
    let resp = false;
    modal({ title: titulo, size: 'md', body: `<p class="mb-0">${msg}</p>`, buttons: [{ label: ok, cls, onClick: () => { resp = true; } }], onClose: () => resolve(resp) });
  });
}

/** Pede um texto (motivo, observação). Resolve null se cancelado. */
export function pedirTexto(msg, { titulo = 'Informe', obrigatorio = true, valor = '', ok = 'Confirmar', min = 0 } = {}) {
  return new Promise((resolve) => {
    let resp = null;
    modal({
      title: titulo, size: 'md',
      body: `<label class="form-label">${msg}</label><textarea class="form-control" rows="3">${esc(valor)}</textarea>`,
      buttons: [{ label: ok, onClick: ({ body }) => {
        const v = body.querySelector('textarea').value.trim();
        if (obrigatorio && v.length < Math.max(min, 1)) { toast(min ? `Mínimo de ${min} caracteres.` : 'Campo obrigatório.', 'warning'); return false; }
        resp = v;
      } }],
      onClose: () => resolve(resp),
    });
  });
}

// ---------- Formulários ----------
export function lerForm(form) {
  const o = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.disabled && !el.dataset.sempre) continue;
    const k = el.name;
    if (el.type === 'checkbox') o[k] = el.checked ? 1 : 0;
    else if (el.type === 'radio') { if (el.checked) o[k] = el.value; }
    else if (el.type === 'number') o[k] = el.value === '' ? null : Number(el.value);
    else if (el.multiple) o[k] = [...el.selectedOptions].map((x) => Number(x.value) || x.value);
    else o[k] = el.value === '' ? null : el.value;
  }
  return o;
}
export function preencherForm(form, dados) {
  for (const el of form.querySelectorAll('[name]')) {
    const v = dados?.[el.name];
    if (v === undefined) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = String(el.value) === String(v);
    else if (el.multiple) [...el.options].forEach((o) => { o.selected = (v || []).map(String).includes(o.value); });
    else if (el.type === 'date' && v) el.value = String(v).slice(0, 10);
    else el.value = v ?? '';
  }
}

/** Campo de formulário Bootstrap. */
export function campo(name, label, { type = 'text', col = 'col-md-4', options, required, attrs = '', value = '', help } = {}) {
  let input;
  const req = required ? 'required' : '';
  if (type === 'select') {
    input = `<select name="${name}" class="form-select form-select-sm" ${req} ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea name="${name}" class="form-control form-control-sm" rows="3" ${req} ${attrs}>${esc(value)}</textarea>`;
  } else if (type === 'checkbox') {
    return `<div class="${col} d-flex align-items-end"><div class="form-check mb-1"><input type="checkbox" class="form-check-input" name="${name}" id="f-${name}-${Math.random().toString(36).slice(2, 7)}" ${value ? 'checked' : ''} ${attrs}><label class="form-check-label small">${label}</label></div></div>`;
  } else {
    input = `<input type="${type}" name="${name}" class="form-control form-control-sm" value="${esc(value)}" ${req} ${attrs}>`;
  }
  return `<div class="${col}"><label class="form-label">${label}${required ? '<span class="obrigatorio" title="Obrigatório">*</span>' : ''}</label>${input}${help ? `<div class="form-text">${help}</div>` : ''}</div>`;
}
export const opcoes = (lista, vazio = 'Selecione...', label = 'nome') => [['', vazio], ...(lista || []).map((x) => [x.id, x[label]])];

/** Abas Bootstrap. abas = [{id, label, html}] */
export function abas(lista, prefixo = 'aba') {
  const id = prefixo + Math.random().toString(36).slice(2, 7);
  return `<ul class="nav nav-tabs mb-3" role="tablist">${lista.map((a, i) =>
    `<li class="nav-item"><button class="nav-link ${i ? '' : 'active'}" data-bs-toggle="tab" data-bs-target="#${id}-${a.id}" type="button">${a.label}</button></li>`).join('')}</ul>
    <div class="tab-content">${lista.map((a, i) => `<div class="tab-pane fade ${i ? '' : 'show active'}" id="${id}-${a.id}" data-aba="${a.id}">${a.html}</div>`).join('')}</div>`;
}

export function debounce(fn, ms = 350) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Mesma regra do servidor: permissão exata; pedir o grupo ("fila") vale se houver algum item dele.
export const pode = (perm) => {
  const l = state.me?.permissoes || [];
  return l.includes('*') || l.includes(perm) || l.some((p) => p.startsWith(perm + '.'));
};

/** Avatar com foto (quando houver) ou iniciais. */
export function avatar(usuario, cls = '') {
  const ini = String(usuario?.nome || '?').split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const foto = usuario?.tem_foto ? ` style="background-image:url('/api/auth/foto/${usuario.id}?v=${state.fotoVersao || 0}')"` : '';
  return `<span class="avatar ${cls}"${foto} aria-hidden="true">${usuario?.tem_foto ? '' : esc(ini)}</span>`;
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- Tabela padrão ----------
/**
 * Lista com filtro por coluna, ordenação, paginação, Limpar Filtros, Exportar para Excel e Imprimir.
 * columns: [{k, l, t?, filter?: false | {options:[[v,l]]}, render?, cls?}]
 */
export class DataTable {
  constructor(container, opts) {
    this.c = typeof container === 'string' ? document.querySelector(container) : container;
    this.o = { pageSize: 20, ...opts };
    // Visão de todas as empresas: listas marcadas com empresa: true ganham a coluna Empresa (com filtro).
    if (opts.empresa && state.me?.empresa?.todas) {
      this.o.columns = [{ k: 'empresa', l: 'Empresa', filter: { options: (state.me.empresas || []).map((e) => [e.nome, e.nome]) } }, ...opts.columns];
    }
    this.filtros = { ...(opts.filtrosIniciais || {}) };
    // Painel de filtros (opts.painel): parâmetros extras como de_/ate_/em_/f_, lembrados por tela nesta sessão.
    this.extras = {};
    if (opts.painel && opts.chave) {
      try { this.extras = JSON.parse(sessionStorage.getItem(`agt-filtros-${opts.chave}`) || '{}'); } catch { this.extras = {}; }
    }
    this.painelAberto = Object.keys(this.extras).length > 0;
    this.sort = opts.sort || null;
    this.dir = opts.dir || null;
    this.page = 1;
    this.pageSize = this.o.pageSize;
    this.rows = [];
    this.render();
    this.load();
  }

  url(extra = {}) {
    const base = typeof this.o.url === 'function' ? this.o.url() : this.o.url;
    const p = { ...(this.o.params ? this.o.params() : {}), page: this.page, pageSize: this.pageSize, sort: this.sort, dir: this.dir, ...extra };
    for (const [k, v] of Object.entries(this.filtros)) if (v !== '' && v != null) p['f_' + k] = v;
    for (const [k, v] of Object.entries(this.extras)) if (v !== '' && v != null && p[k] == null) p[k] = v;
    return base + (base.includes('?') ? '&' + qs(p).slice(1) : qs(p));
  }

  render() {
    const cols = this.o.columns;
    const filtro = (c) => {
      if (c.filter === false) return '<th></th>';
      const v = esc(this.filtros[c.k] ?? '');
      if (c.filter?.options) {
        return `<th data-l="${esc(c.l)}"><select class="form-select form-select-sm ${this.filtros[c.k] ? 'com-valor' : ''}" data-f="${c.k}" aria-label="Filtrar ${esc(c.l)}"><option value="">Todos</option>${c.filter.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(this.filtros[c.k] ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></th>`;
      }
      return `<th data-l="${esc(c.l)}"><input class="form-control form-control-sm" data-f="${c.k}" value="${v}" placeholder="Filtrar" aria-label="Filtrar ${esc(c.l)}"></th>`;
    };
    const ordenaveis = cols.filter((c) => c.filter !== false && c.export !== false && c.sort !== false);
    this.c.innerHTML = `<div class="card dt-card ${this.o.cartoes === false ? '' : 'dt-cards'}">
      ${this.o.painel ? `<div class="dt-painel ${this.painelAberto ? 'aberto' : ''}">${this.htmlPainel()}</div>` : ''}
      <div class="dt-toolbar">
        ${this.o.painel ? `<button class="btn btn-sm btn-outline-secondary" data-a="painel" aria-expanded="${this.painelAberto}"><i class="bi bi-sliders"></i> Filtros${this.qtdExtras() ? ` <span class="dt-qtd">${this.qtdExtras()}</span>` : ''}</button>
          <div class="dt-chips">${this.htmlChips()}</div>` : ''}
        ${this.o.toolbar || ''}
        <div class="ms-auto d-flex gap-1 dt-acoes">
          <button class="btn btn-sm btn-outline-secondary d-md-none" data-a="filtros-col" aria-expanded="false" title="Filtrar por coluna"><i class="bi bi-funnel"></i><span class="dt-qtd d-none" data-qtd-col></span></button>
          <select class="form-select form-select-sm d-md-none dt-ordem" data-a="ordem" aria-label="Ordenar por">
            <option value="">Ordenar…</option>${ordenaveis.map((c) => `<option value="${c.k}|asc" ${this.sort === c.k && this.dir === 'asc' ? 'selected' : ''}>${esc(c.l)} ↑</option><option value="${c.k}|desc" ${this.sort === c.k && this.dir === 'desc' ? 'selected' : ''}>${esc(c.l)} ↓</option>`).join('')}</select>
          <button class="btn btn-sm btn-outline-secondary" data-a="limpar" title="Limpar filtros"><i class="bi bi-x-circle"></i> <span class="dt-rot">Limpar filtros</span></button>
          <button class="btn btn-sm btn-outline-success" data-a="excel" title="Exportar para Excel"><i class="bi bi-file-earmark-excel"></i> <span class="dt-rot">Excel</span></button>
          <button class="btn btn-sm btn-outline-secondary" data-a="imprimir" title="Imprimir"><i class="bi bi-printer"></i> <span class="dt-rot">Imprimir</span></button>
        </div>
      </div>
      <div class="dt-wrap"><table class="table table-sm table-hover dt">
        <thead><tr>${this.o.actions ? '<th class="sem-ordem acoes"><span class="visually-hidden">Ações</span></th>' : ''}${cols.map((c) => `<th data-s="${c.k}" class="${c.t === 'money' || c.t === 'num' ? 'num' : ''}" aria-sort="${this.sort === c.k ? (this.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${esc(c.l)} <i class="bi"></i></th>`).join('')}</tr>
          <tr class="filtros">${this.o.actions ? '<th></th>' : ''}${cols.map(filtro).join('')}</tr></thead>
        <tbody aria-busy="true">${Array.from({ length: 6 }, () => `<tr class="dt-esqueleto">${this.o.actions ? '<td class="acoes"></td>' : ''}${cols.map((c) => `<td data-l="${esc(c.l)}"><span class="esqueleto"></span></td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="dt-footer">
        <div class="info text-muted"></div>
        <div class="d-flex align-items-center gap-2">
          <select class="form-select form-select-sm" data-a="pagesize" style="width:auto">${[10, 20, 50, 100].map((n) => `<option ${n === this.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <nav><ul class="pagination pagination-sm mb-0"></ul></nav>
        </div>
      </div></div>`;
    const deb = debounce(() => { this.page = 1; this.load(); });
    this.c.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        this.filtros[el.dataset.f] = el.value;
        if (el.tagName === 'SELECT') el.classList.toggle('com-valor', !!el.value);
        this.marcarFiltrosCol();
        deb();
      });
    });
    this.c.querySelector('[data-a=filtros-col]').addEventListener('click', (e) => {
      const card = this.c.querySelector('.dt-card');
      const aberto = card.classList.toggle('dt-filtros-abertos');
      e.currentTarget.setAttribute('aria-expanded', aberto);
      if (aberto) card.querySelector('tr.filtros input, tr.filtros select')?.focus();
    });
    this.c.querySelector('[data-a=ordem]').addEventListener('change', (e) => {
      if (!e.target.value) return;
      [this.sort, this.dir] = e.target.value.split('|');
      this.page = 1;
      this.load();
    });
    this.marcarFiltrosCol();
    this.c.querySelectorAll('th[data-s]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.s;
      this.dir = this.sort === k && this.dir === 'asc' ? 'desc' : 'asc';
      this.sort = k;
      this.load();
    }));
    this.c.querySelector('[data-a=limpar]').addEventListener('click', () => { this.filtros = {}; this.definirExtras({}); });
    if (this.o.painel) this.ligarPainel();
    this.c.querySelector('[data-a=excel]').addEventListener('click', () => this.exportar());
    this.c.querySelector('[data-a=imprimir]').addEventListener('click', () => this.imprimir());
    this.c.querySelector('[data-a=pagesize]').addEventListener('change', (e) => { this.pageSize = Number(e.target.value); this.page = 1; this.load(); });
    this.o.onRender?.(this.c);
  }

  /** Quantidade de filtros por coluna em uso (mostrada no botão de filtros do celular). */
  marcarFiltrosCol() {
    const n = Object.values(this.filtros).filter((v) => v !== '' && v != null).length;
    const el = this.c.querySelector('[data-qtd-col]');
    if (el) { el.textContent = n; el.classList.toggle('d-none', !n); }
  }

  temFiltros() {
    return Object.values(this.filtros).some((v) => v !== '' && v != null) || Object.keys(this.extras).length > 0;
  }

  // ---------- Painel de filtros ----------
  // painel: [{ k, l, tipo: 'periodo'|'faixa'|'select'|'texto', options?, atalhos? }]
  //   periodo/faixa → de_<k> e ate_<k>; select → em_<k> (vários) ou f_<k>; texto → f_<k>
  qtdExtras() {
    return this.o.painel.filter((c) => (c.tipo === 'periodo' || c.tipo === 'faixa'
      ? this.extras[`de_${c.k}`] || this.extras[`ate_${c.k}`]
      : this.extras[`${c.tipo === 'select' ? 'em' : 'f'}_${c.k}`])).length;
  }

  htmlPainel() {
    const x = this.extras;
    const campo = (c) => {
      if (c.tipo === 'periodo') {
        return `<div class="dt-campo dt-campo-periodo"><label class="form-label">${esc(c.l)}</label>
          <div class="d-flex gap-1 align-items-center"><input type="date" class="form-control form-control-sm" data-x="de_${c.k}" value="${esc(x[`de_${c.k}`] || '')}" aria-label="${esc(c.l)} de">
          <span class="text-muted small">até</span><input type="date" class="form-control form-control-sm" data-x="ate_${c.k}" value="${esc(x[`ate_${c.k}`] || '')}" aria-label="${esc(c.l)} até"></div>
          ${c.atalhos !== false ? `<div class="dt-atalhos">${ATALHOS_PERIODO.map(([id, l]) => `<button type="button" class="btn btn-sm" data-atalho="${id}" data-campo="${c.k}">${l}</button>`).join('')}</div>` : ''}</div>`;
      }
      if (c.tipo === 'faixa') {
        return `<div class="dt-campo"><label class="form-label">${esc(c.l)}</label>
          <div class="d-flex gap-1 align-items-center"><input type="number" step="any" class="form-control form-control-sm" data-x="de_${c.k}" value="${esc(x[`de_${c.k}`] || '')}" placeholder="mín." aria-label="${esc(c.l)} mínimo">
          <span class="text-muted small">a</span><input type="number" step="any" class="form-control form-control-sm" data-x="ate_${c.k}" value="${esc(x[`ate_${c.k}`] || '')}" placeholder="máx." aria-label="${esc(c.l)} máximo"></div></div>`;
      }
      if (c.tipo === 'select') {
        const marcados = String(x[`em_${c.k}`] || '').split(',').filter(Boolean);
        return `<div class="dt-campo"><label class="form-label">${esc(c.l)}</label>
          <div class="dropdown dt-multi"><button type="button" class="form-select form-select-sm text-start text-truncate" data-bs-toggle="dropdown" data-bs-auto-close="outside">${marcados.length ? esc(marcados.map((v) => c.options.find(([ov]) => String(ov) === v)?.[1] || v).join(', ')) : 'Todos'}</button>
          <div class="dropdown-menu dt-multi-menu">${c.options.map(([ov, ol]) => `<label class="dropdown-item"><input type="checkbox" class="form-check-input m-0" data-em="${c.k}" value="${esc(ov)}" ${marcados.includes(String(ov)) ? 'checked' : ''}> ${esc(ol)}</label>`).join('') || '<span class="dropdown-item-text text-muted">Sem opções</span>'}</div></div></div>`;
      }
      return `<div class="dt-campo"><label class="form-label">${esc(c.l)}</label><input class="form-control form-control-sm" data-x="f_${c.k}" value="${esc(x[`f_${c.k}`] || '')}" placeholder="${esc(c.placeholder || 'Contém...')}"></div>`;
    };
    return `<div class="dt-painel-grade">${this.o.painel.map(campo).join('')}</div>
      <div class="dt-painel-acoes"><button type="button" class="btn btn-sm btn-outline-secondary" data-a="painel-limpar"><i class="bi bi-x-lg"></i> Limpar</button>
        <button type="button" class="btn btn-sm btn-success" data-a="painel-aplicar"><i class="bi bi-check2"></i> Aplicar filtros</button></div>`;
  }

  htmlChips() {
    const x = this.extras;
    const out = [];
    for (const c of this.o.painel) {
      let txt = '';
      const fmtV = (v) => (c.tipo === 'periodo' ? fmt.date(v) : c.tipo === 'faixa' && c.moeda ? fmt.money(v) : v);
      if (c.tipo === 'periodo' || c.tipo === 'faixa') {
        const de = x[`de_${c.k}`];
        const ate = x[`ate_${c.k}`];
        if (de && ate) txt = `${fmtV(de)} a ${fmtV(ate)}`;
        else if (de) txt = `a partir de ${fmtV(de)}`;
        else if (ate) txt = `até ${fmtV(ate)}`;
      } else if (c.tipo === 'select') {
        const v = String(x[`em_${c.k}`] || '').split(',').filter(Boolean);
        if (v.length) txt = v.length > 2 ? `${v.length} selecionados` : v.map((i) => c.options.find(([ov]) => String(ov) === i)?.[1] || i).join(', ');
      } else if (x[`f_${c.k}`]) txt = `"${x[`f_${c.k}`]}"`;
      if (txt) out.push(`<span class="dt-chip">${esc(c.l)}: <b>${esc(txt)}</b><button type="button" data-tirar="${c.k}" aria-label="Remover filtro ${esc(c.l)}"><i class="bi bi-x"></i></button></span>`);
    }
    return out.join('');
  }

  definirExtras(novo) {
    this.extras = Object.fromEntries(Object.entries(novo).filter(([, v]) => v !== '' && v != null));
    if (this.o.chave) {
      try { sessionStorage.setItem(`agt-filtros-${this.o.chave}`, JSON.stringify(this.extras)); } catch { /* sem armazenamento */ }
    }
    this.page = 1;
    this.render();
    this.load();
  }

  lerPainel() {
    const novo = {};
    this.c.querySelectorAll('.dt-painel [data-x]').forEach((el) => { if (el.value) novo[el.dataset.x] = el.value; });
    for (const c of this.o.painel.filter((p) => p.tipo === 'select')) {
      const v = [...this.c.querySelectorAll(`.dt-painel [data-em="${c.k}"]:checked`)].map((el) => el.value);
      if (v.length) novo[`em_${c.k}`] = v.join(',');
    }
    return novo;
  }

  ligarPainel() {
    const painel = this.c.querySelector('.dt-painel');
    this.c.querySelector('[data-a=painel]').addEventListener('click', (e) => {
      this.painelAberto = !this.painelAberto;
      painel.classList.toggle('aberto', this.painelAberto);
      e.currentTarget.setAttribute('aria-expanded', this.painelAberto);
      if (this.painelAberto) painel.querySelector('input')?.focus();
    });
    this.c.querySelector('[data-a=painel-aplicar]').addEventListener('click', () => this.definirExtras(this.lerPainel()));
    this.c.querySelector('[data-a=painel-limpar]').addEventListener('click', () => this.definirExtras({}));
    painel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); this.definirExtras(this.lerPainel()); } });
    painel.querySelectorAll('[data-em]').forEach((cb) => cb.addEventListener('change', () => {
      const menu = cb.closest('.dt-multi');
      const marcados = [...menu.querySelectorAll('[data-em]:checked')].map((el) => el.parentElement.textContent.trim());
      menu.querySelector('[data-bs-toggle]').textContent = marcados.length ? marcados.join(', ') : 'Todos';
    }));
    painel.querySelectorAll('[data-atalho]').forEach((b) => b.addEventListener('click', () => {
      const [de, ate] = periodoAtalho(b.dataset.atalho);
      painel.querySelector(`[data-x="de_${b.dataset.campo}"]`).value = de;
      painel.querySelector(`[data-x="ate_${b.dataset.campo}"]`).value = ate;
      this.definirExtras(this.lerPainel());
    }));
    this.c.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tirar;
      const novo = { ...this.extras };
      for (const pre of ['de_', 'ate_', 'em_', 'f_']) delete novo[pre + k];
      this.definirExtras(novo);
    }));
  }

  async load() {
    const meu = (this._req = (this._req || 0) + 1);
    try {
      const d = await get(this.url());
      if (meu !== this._req) return;
      this.rows = d.rows;
      this.total = d.total;
      this.desenhar();
      this.o.onLoad?.(d, this);
    } catch (e) {
      if (meu !== this._req) return;
      const tb = this.c.querySelector('tbody');
      tb.removeAttribute('aria-busy');
      tb.innerHTML = `<tr class="dt-estado"><td colspan="99" class="vazio erro"><i class="bi bi-exclamation-triangle"></i><b>Não foi possível carregar a lista</b>${esc(e.message)}
        <div><button type="button" class="btn btn-sm btn-outline-secondary" data-a="tentar"><i class="bi bi-arrow-clockwise"></i> Tentar de novo</button></div></td></tr>`;
      tb.querySelector('[data-a=tentar]').addEventListener('click', () => this.load());
    }
  }
  reload() { return this.load(); }

  desenhar() {
    const cols = this.o.columns;
    const tb = this.c.querySelector('tbody');
    this.c.querySelectorAll('th[data-s] i').forEach((i) => { i.className = 'bi'; });
    if (this.sort) {
      const i = this.c.querySelector(`th[data-s="${this.sort}"] i`);
      if (i) i.className = `bi bi-caret-${this.dir === 'asc' ? 'up' : 'down'}-fill`;
    }
    tb.removeAttribute('aria-busy');
    if (!this.rows.length) {
      const filtrado = this.temFiltros();
      tb.innerHTML = `<tr class="dt-estado"><td colspan="${cols.length + 1}" class="vazio">${filtrado
        ? '<i class="bi bi-search"></i><b>Nenhum resultado para os filtros</b>Ajuste ou limpe os filtros para ver mais registros.<div><button type="button" class="btn btn-sm btn-outline-secondary" data-a="limpar-vazio"><i class="bi bi-x-circle"></i> Limpar filtros</button></div>'
        : `<i class="bi bi-inbox"></i><b>${esc(this.o.vazio || 'Nenhum registro ainda')}</b>${esc(this.o.vazioDica || '')}`}</td></tr>`;
      tb.querySelector('[data-a=limpar-vazio]')?.addEventListener('click', () => { this.filtros = {}; this.definirExtras({}); });
    } else {
      // Primeira coluna de dados vira o título do cartão no celular.
      const nomeIdx = cols.findIndex((c) => !c.t && /^(nome|cliente|produto|razao_social|fornecedor|titulo|descricao|colaborador|vendedor|usuario|arquivo)$/.test(c.k));
      const prim = this.o.prim ? Math.max(0, cols.findIndex((c) => c.k === this.o.prim)) : nomeIdx >= 0 ? nomeIdx : 0;
      tb.innerHTML = this.rows.map((r, idx) => `<tr data-i="${idx}" class="${this.o.rowClick ? 'clicavel' : ''} ${this.o.rowClass ? this.o.rowClass(r) : ''}">
        ${this.o.actions ? `<td class="acoes text-nowrap">${this.o.actions(r)}</td>` : ''}
        ${cols.map((c, j) => `<td data-l="${esc(c.l)}" class="${c.t === 'money' || c.t === 'num' ? 'num' : ''} ${j === prim ? 'dt-prim' : ''} ${c.cls || ''}">${renderCell(c, r[c.k], r)}</td>`).join('')}</tr>`).join('');
    }
    tb.querySelectorAll('tr[data-i]').forEach((tr) => {
      const row = this.rows[tr.dataset.i];
      if (this.o.rowClick) tr.addEventListener('click', (e) => { if (!e.target.closest('button,a,input')) this.o.rowClick(row, this); });
      tr.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.o.onAction?.[b.dataset.acao]?.(row, this, b); }));
    });
    const paginas = Math.max(1, Math.ceil(this.total / this.pageSize));
    const ini = this.total ? (this.page - 1) * this.pageSize + 1 : 0;
    this.c.querySelector('.info').innerHTML = this.total ? `Mostrando <b>${ini}–${Math.min(this.page * this.pageSize, this.total)}</b> de <b>${this.total.toLocaleString('pt-BR')}</b> registro${this.total === 1 ? '' : 's'}` : 'Nenhum registro';
    this.c.querySelectorAll('th[data-s]').forEach((th) => th.setAttribute('aria-sort', this.sort === th.dataset.s ? (this.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    const ul = this.c.querySelector('.pagination');
    const item = (p, l, dis, at) => `<li class="page-item ${dis ? 'disabled' : ''} ${at ? 'active' : ''}"><a class="page-link" href="#" data-p="${p}">${l}</a></li>`;
    const ps = [];
    for (let p = Math.max(1, this.page - 2); p <= Math.min(paginas, this.page + 2); p++) ps.push(item(p, p, false, p === this.page));
    ul.innerHTML = item(1, '<i class="bi bi-chevron-double-left" aria-label="Primeira página"></i>', this.page === 1) + item(this.page - 1, '<i class="bi bi-chevron-left" aria-label="Página anterior"></i>', this.page === 1)
      + ps.join('') + item(this.page + 1, '<i class="bi bi-chevron-right" aria-label="Próxima página"></i>', this.page === paginas) + item(paginas, '<i class="bi bi-chevron-double-right" aria-label="Última página"></i>', this.page === paginas);
    this.c.querySelector('.dt-footer nav').classList.toggle('d-none', paginas <= 1 && this.pageSize <= 20);
    ul.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const p = Number(a.dataset.p);
      if (p >= 1 && p <= paginas && p !== this.page) { this.page = p; this.load(); }
    }));
  }

  colunasExport() {
    return this.o.columns.filter((c) => c.export !== false).map((c) => ({ k: c.k, l: c.l, t: c.t === 'money' ? 'money' : c.t === 'date' ? 'date' : c.t === 'datetime' ? 'datetime' : c.t === 'bool' ? 'bool' : undefined }));
  }

  async exportar() {
    await tentar(() => baixar(this.url({ export: 'xlsx', page: undefined, pageSize: undefined, cols: JSON.stringify(this.colunasExport()), title: this.o.title || 'Lista' }), 'lista.xlsx'));
  }

  async imprimir() {
    const d = await tentar(() => get(this.url({ all: 1 })));
    if (!d) return;
    const cols = this.o.columns.filter((c) => c.export !== false);
    const chips = this.o.painel ? [...this.c.querySelectorAll('.dt-chip')].map((el) => el.textContent.trim()) : [];
    const filtrosTxt = [...chips, ...Object.entries(this.filtros).filter(([, v]) => v).map(([k, v]) => `${cols.find((c) => c.k === k)?.l || k}: ${v}`)].join(' · ');
    const w = window.open('', '_blank');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(this.o.title || 'Lista')}</title>
      <style>body{font:11px Arial,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}th{background:#e8f5e9}.num{text-align:right}h1{font-size:16px;margin:0}small{color:#666}</style>
      </head><body><h1>${esc(this.o.title || 'Lista')}</h1><small>${esc(state.me?.empresa?.nome || '')} · ${new Date().toLocaleString('pt-BR')} · ${d.rows.length} registros${filtrosTxt ? ' · ' + esc(filtrosTxt) : ''}</small>
      <table><thead><tr>${cols.map((c) => `<th>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>
      ${d.rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.t === 'money' || c.t === 'num' ? 'num' : ''}">${c.t === 'etapa' ? esc(state.me.etapas[r[c.k]]?.label || r[c.k]) : c.t === 'status' ? esc(ROTULOS.status[r[c.k]]?.[0] || r[c.k] || '') : c.t === 'bool' ? (r[c.k] ? 'Sim' : 'Não') : c.render && !c.t ? esc(String(c.render(r[c.k], r)).replace(/<[^>]+>/g, '')) : renderCell({ ...c, render: undefined }, r[c.k], r)}</td>`).join('')}</tr>`).join('')}
      </tbody></table><script>window.onload=()=>{window.print()}<\/script></body></html>`);
    w.document.close();
  }
}

const ATALHOS_PERIODO = [['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['mes_ant', 'Mês passado'], ['ano', 'Este ano']];
export function periodoAtalho(id) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const h = new Date();
  const dia = (n) => new Date(h.getFullYear(), h.getMonth(), h.getDate() + n);
  switch (id) {
    case 'hoje': return [iso(h), iso(h)];
    case '7d': return [iso(dia(-6)), iso(h)];
    case '30d': return [iso(dia(-29)), iso(h)];
    case '90d': return [iso(dia(-89)), iso(h)];
    case 'mes': return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)];
    case 'mes_ant': return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))];
    default: return [iso(new Date(h.getFullYear(), 0, 1)), iso(h)];
  }
}

/** Botão de ação pequeno para a coluna de ações da tabela. */
export const btnAcao = (acao, icone, titulo, cls = 'outline-secondary') =>
  `<button type="button" class="btn btn-${cls} btn-sm py-0 px-1" data-acao="${acao}" title="${esc(titulo)}" aria-label="${esc(titulo)}"><i class="bi ${icone}" aria-hidden="true"></i></button>`;

/** Tabela simples (somente leitura) a partir de um array. */
export function tabelaSimples(colunas, linhas, { vazio = 'Nenhum registro.', cls = '' } = {}) {
  if (!linhas?.length) return `<div class="vazio py-4"><i class="bi bi-inbox"></i>${vazio}</div>`;
  return `<div class="table-responsive"><table class="table table-sm table-striped ${cls} mb-0"><thead><tr>${colunas.map((c) => `<th class="${c.t === 'money' || c.t === 'num' ? 'num' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((r) => `<tr>${colunas.map((c) => `<td class="${c.t === 'money' || c.t === 'num' ? 'num' : ''} ${c.cls || ''}">${renderCell(c, r[c.k], r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Campo de busca de cliente com autocompletar. onSelect(cliente) */
export function buscaCliente(input, onSelect) {
  const lista = document.createElement('div');
  lista.className = 'list-group position-absolute w-100 shadow-sm';
  lista.style.zIndex = 2000;
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(lista);
  const buscar = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { lista.innerHTML = ''; return; }
    const rows = await get('/api/clientes/busca' + qs({ q })).catch(() => []);
    lista.innerHTML = rows.map((c) => `<button type="button" class="list-group-item list-group-item-action py-1 small" data-id="${c.id}">${esc(c.nome)} <span class="text-muted">${fmt.doc(c.documento)}</span></button>`).join('')
      || '<div class="list-group-item small text-muted">Nenhum cliente encontrado</div>';
    lista.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const c = rows.find((x) => x.id === Number(b.dataset.id));
      input.value = c.nome;
      lista.innerHTML = '';
      onSelect(c);
    }));
  }, 250);
  input.addEventListener('input', buscar);
  input.addEventListener('blur', () => setTimeout(() => { lista.innerHTML = ''; }, 200));
}

export function titulo(conteudo, texto, icone, extra = '') {
  conteudo.innerHTML = `<div class="page-title"><h2><i class="bi ${icone}"></i> <span>${texto}</span></h2><div class="ms-auto d-flex gap-2 flex-wrap">${extra}</div></div><div id="pagina"></div>`;
  return conteudo.querySelector('#pagina');
}

/**
 * Editor de lista (linhas repetidas) usado nas abas dos cadastros.
 * campos: [{k, l, type?: 'text'|'number'|'date'|'checkbox'|'select', options?, w?}]
 */
export class EditorLista {
  constructor(container, campos, itens = [], { novo = {}, rotuloAdd = 'Adicionar' } = {}) {
    this.c = container;
    this.campos = campos;
    this.novo = novo;
    this.c.innerHTML = `<div class="table-responsive"><table class="table table-sm align-middle mb-2"><thead><tr>${campos.map((f) => `<th style="${f.w ? 'width:' + f.w : ''}">${esc(f.l)}</th>`).join('')}<th></th></tr></thead><tbody></tbody></table></div>
      <button type="button" class="btn btn-sm btn-outline-success" data-add><i class="bi bi-plus-lg"></i> ${esc(rotuloAdd)}</button>`;
    this.tb = this.c.querySelector('tbody');
    itens.forEach((i) => this.add(i));
    this.c.querySelector('[data-add]').addEventListener('click', () => this.add({ ...this.novo }));
  }
  add(item) {
    const tr = document.createElement('tr');
    if (item.id) tr.dataset.id = item.id;
    tr.innerHTML = this.campos.map((f) => {
      const v = item[f.k] ?? '';
      if (f.type === 'checkbox') return `<td class="text-center"><input type="checkbox" class="form-check-input" data-k="${f.k}" ${v ? 'checked' : ''}></td>`;
      if (f.type === 'select') return `<td><select class="form-select form-select-sm" data-k="${f.k}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></td>`;
      return `<td><input type="${f.type || 'text'}" class="form-control form-control-sm" data-k="${f.k}" value="${esc(f.type === 'date' ? String(v).slice(0, 10) : v)}" ${f.type === 'number' ? 'step="any"' : ''} ${f.attrs || ''}></td>`;
    }).join('') + '<td><button type="button" class="btn btn-sm btn-outline-danger py-0" data-rem>&times;</button></td>';
    tr.querySelector('[data-rem]').addEventListener('click', () => tr.remove());
    this.tb.appendChild(tr);
  }
  valores() {
    return [...this.tb.querySelectorAll('tr')].map((tr) => {
      const o = tr.dataset.id ? { id: Number(tr.dataset.id) } : {};
      tr.querySelectorAll('[data-k]').forEach((el) => {
        const f = this.campos.find((c) => c.k === el.dataset.k);
        if (el.type === 'checkbox') o[el.dataset.k] = el.checked ? 1 : 0;
        else if (f.type === 'number') o[el.dataset.k] = el.value === '' ? null : Number(el.value);
        else o[el.dataset.k] = el.value === '' ? null : el.value;
      });
      return o;
    });
  }
}

/**
 * Variação contra o período anterior. comparacao: { anterior, diferenca, pct, de, ate, melhor: 'alta'|'baixa' }.
 * A cor diz se a mudança foi boa ou ruim (para "melhor: baixa", subir é ruim), não só se subiu.
 */
export function deltaHtml(cmp, { moeda = false } = {}) {
  if (!cmp) return '';
  const valorFmt = (v) => (moeda ? fmt.money(v) : Number(v || 0).toLocaleString('pt-BR'));
  const periodo = cmp.de && cmp.ate ? `${fmt.date(cmp.de).slice(0, 5)} a ${fmt.date(cmp.ate).slice(0, 5)}` : 'período anterior';
  const dica = `Período anterior (${fmt.date(cmp.de)} a ${fmt.date(cmp.ate)}): ${valorFmt(cmp.anterior)}. Diferença: ${cmp.diferenca > 0 ? '+' : ''}${valorFmt(cmp.diferenca)}.`;
  if (!cmp.diferenca) return `<div class="delta" title="${esc(dica)}"><span class="delta-chip neutro"><i class="bi bi-dash"></i>0%</span> igual a ${esc(periodo)}</div>`;
  const subiu = cmp.diferenca > 0;
  const bom = (cmp.melhor === 'baixa') !== subiu;
  const txt = cmp.pct == null ? (subiu ? 'novo' : '—') : `${subiu ? '+' : ''}${Number(cmp.pct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const ref = cmp.pct == null ? `antes ${valorFmt(cmp.anterior)}` : `vs ${esc(periodo)}`;
  return `<div class="delta" title="${esc(dica)}"><span class="delta-chip ${bom ? 'bom' : 'ruim'}"><i class="bi bi-arrow-${subiu ? 'up' : 'down'}-short"></i>${txt}</span> ${ref}</div>`;
}

/** Card de indicador (mesmo visual do painel). */
export function kpi(label, valor, { icone = 'bi-graph-up', cor = 'primary', sub = '', link, comparacao, moeda = false, dica } = {}) {
  const card = `<div class="card kpi cor-${cor} h-100"${dica ? ` title="${esc(dica)}"` : ''}><div class="card-body d-flex gap-3 align-items-start">
    <span class="icone" aria-hidden="true"><i class="bi ${icone}"></i></span>
    <div class="flex-grow-1 min-w-0"><div class="rotulo">${esc(label)}</div><div class="valor">${valor}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${deltaHtml(comparacao, { moeda })}</div>
    ${link ? '<i class="bi bi-arrow-up-right" aria-hidden="true"></i>' : ''}</div></div>`;
  return `<div>${link ? `<a class="kpi-link" href="${link}" aria-label="${esc(label)}: abrir">${card}</a>` : card}</div>`;
}

// ---------- Gráficos ----------
/** Paleta categórica validada (claro e escuro): ordem fixa, a cor segue a série. Vermelho fica reservado para status. */
const PALETA = {
  light: ['#2a8a4a', '#2a78d6', '#eb6834', '#6250d6', '#1baf7a', '#eda100', '#e87ba4'],
  dark: ['#3e9b58', '#3987e5', '#d95926', '#9085e9', '#199e70', '#c98500', '#d55181'],
};
export const coresGrafico = () => PALETA[document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'light'];

/** Estilo único dos gráficos (Chart.js): fonte, cores do tema, grade discreta, tooltip e barras com cantos arredondados. */
export function estiloGraficos() {
  if (!window.Chart) return {};
  const css = getComputedStyle(document.documentElement);
  const v = (k) => css.getPropertyValue(k).trim();
  const D = Chart.defaults;
  D.color = v('--texto-2');
  D.font.family = v('--bs-body-font-family');
  D.font.size = 12;
  D.borderColor = v('--borda');
  D.animation.duration = 350;
  D.plugins.legend.labels.usePointStyle = true;
  D.plugins.legend.labels.pointStyle = 'circle';
  D.plugins.legend.labels.boxWidth = 8;
  D.plugins.legend.labels.boxHeight = 8;
  D.plugins.legend.labels.padding = 14;
  Object.assign(D.plugins.tooltip, {
    backgroundColor: v('--superficie'), titleColor: v('--texto'), bodyColor: v('--texto-2'), borderColor: v('--borda-forte'), borderWidth: 1,
    padding: 10, cornerRadius: 10, boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' }, displayColors: true,
  });
  D.elements.bar.borderRadius = 6;
  D.elements.bar.borderSkipped = 'start';
  D.datasets.bar.maxBarThickness = 36;
  D.datasets.bar.categoryPercentage = 0.7;
  D.elements.line.borderWidth = 2;
  D.elements.line.tension = 0.3;
  D.elements.line.cubicInterpolationMode = 'monotone';
  D.elements.point.radius = 0;
  D.elements.point.hoverRadius = 5;
  D.elements.point.hitRadius = 12;
  D.elements.arc.borderWidth = 2;
  D.elements.arc.borderColor = v('--superficie');
  D.interaction.mode = 'index';
  D.interaction.intersect = false;
  return { grade: v('--borda'), texto: v('--texto-2'), agro: v('--agro'), superficie: v('--superficie'), cores: coresGrafico() };
}
