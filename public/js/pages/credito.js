// Limites de crédito: exposição de cada cliente, situação, limite sugerido, limite automático e regras de bloqueio.
import { get, post, put, esc, fmt, titulo, DataTable, modal, campo, lerForm, toast, tentar, pode, btnAcao, confirmar } from '../core.js';

const SIT = { ok: ['Dentro do limite', 'success'], sem_limite: ['Sem limite definido', 'secondary'], excedido: ['Acima do limite', 'danger'], atraso: ['Bloqueado por atraso', 'danger'] };
const badge = (v) => { const [l, c] = SIT[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };

export default async function (conteudo) {
  const gerir = pode('credito.gerir');
  const pagina = titulo(conteudo, 'Limites de crédito', 'bi-shield-check', gerir ? `
    <button class="btn btn-sm btn-outline-secondary" data-regras><i class="bi bi-sliders"></i> Regras de bloqueio</button>
    <button class="btn btn-sm btn-success" data-aplicar><i class="bi bi-magic"></i> Aplicar limite sugerido aos sem limite</button>` : '');
  pagina.innerHTML = `<p class="small text-muted">Exposição = parcelas em aberto + pedidos em andamento. Venda a prazo acima do limite, ou de cliente com parcela vencida além do prazo das regras,
      não passa da Análise sem liberação da Diretoria. Limite automático segue o sugerido (média de compras × meses de cobertura, ajustada por score e atrasos) e é recalculado todo dia.</p>
    <div class="form-check form-switch small mb-2"><input class="form-check-input" type="checkbox" id="cr-ativos" checked><label class="form-check-label" for="cr-ativos">Só clientes com compra, saldo ou limite</label></div>
    <div data-t></div>`;
  let ativos = true;
  const t = new DataTable(pagina.querySelector('[data-t]'), {
    url: () => `/api/credito/clientes${ativos ? '?ativos=1' : ''}`, title: 'Limites de crédito', sort: 'exposicao', dir: 'desc',
    columns: [
      { k: 'nome', l: 'Cliente' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'vendedor', l: 'Vendedor' },
      { k: 'status', l: 'Situação', filter: { options: Object.entries(SIT).map(([k, [l]]) => [k, l]) }, render: (v, r) => `${badge(v)}${r.automatico ? ' <span class="badge text-bg-info" title="Limite automático">auto</span>' : ''}` },
      { k: 'limite', l: 'Limite', t: 'money' }, { k: 'exposicao', l: 'Exposição', t: 'money' },
      { k: 'disponivel', l: 'Disponível', t: 'money', render: (v) => (v == null ? '—' : `<span class="${v < 0 ? 'text-danger fw-semibold' : ''}">${fmt.money(v)}</span>`) },
      { k: 'uso_pct', l: 'Uso', t: 'num', render: (v) => (v == null ? '—' : `${fmt.num(v)}%`) },
      { k: 'vencido', l: 'Vencido', t: 'money' }, { k: 'maior_atraso', l: 'Maior atraso (dias)', t: 'num' },
      { k: 'compras_12m', l: 'Compras 12 meses', t: 'money' }, { k: 'score', l: 'Score', t: 'num' },
      { k: 'sugerido', l: 'Sugerido', t: 'money', render: (v, r) => `<span title="${esc(r.sugerido_motivos)}">${fmt.money(v)}</span>` },
    ],
    rowClass: (r) => (['excedido', 'atraso'].includes(r.status) ? 'table-danger' : ''),
    actions: () => (gerir ? btnAcao('limite', 'bi-pencil', 'Definir limite') : ''),
    onAction: { limite: (r) => definir(r, () => t.reload()) },
  });
  pagina.querySelector('#cr-ativos').addEventListener('change', (e) => { ativos = e.target.checked; t.reload(); });
  conteudo.querySelector('[data-aplicar]')?.addEventListener('click', async () => {
    if (!(await confirmar('Aplicar o limite sugerido a todos os clientes que ainda não têm limite? Clientes sem compras no último ano ficam sem limite.', { ok: 'Aplicar' }))) return;
    const r = await tentar(() => post('/api/credito/aplicar-sugerido', {}));
    if (r) { toast(`${r.atualizados} cliente(s) com limite definido.`); t.reload(); }
  });
  conteudo.querySelector('[data-regras]')?.addEventListener('click', () => regras());
}

function definir(r, aoSalvar) {
  modal({
    title: `Limite de crédito · ${esc(r.nome)}`, size: 'md',
    body: `<div class="small mb-2">Exposição atual <b>${fmt.money(r.exposicao)}</b> (em aberto ${fmt.money(r.em_aberto)} + pedidos em andamento ${fmt.money(r.em_andamento)})</div>
      <div class="alert alert-light py-2 small"><b>Sugerido: ${fmt.money(r.sugerido)}</b><br>${esc(r.sugerido_motivos)}</div>
      <form class="row g-2"><div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="automatico" id="cr-auto" ${r.automatico ? 'checked' : ''}>
        <label class="form-check-label" for="cr-auto">Automático (segue o sugerido e é recalculado todo dia)</label></div></div>
      ${campo('limite', 'Limite manual (R$)', { type: 'number', col: 'col-12', value: r.limite || '', attrs: 'min="0" step="100"' })}</form>`,
    onShow: ({ body }) => {
      const auto = body.querySelector('[name=automatico]');
      const lim = body.querySelector('[name=limite]');
      const sync = () => { lim.disabled = auto.checked; };
      auto.addEventListener('change', sync);
      sync();
    },
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const r2 = await put(`/api/credito/clientes/${r.id}`, lerForm(body.querySelector('form')));
      toast(`Limite definido: ${fmt.money(r2.limite)}.`);
      aoSalvar?.();
    } }],
  });
}

async function regras() {
  const cfg = await get('/api/credito/regras');
  modal({
    title: 'Regras de crédito', size: 'md',
    body: `<form class="vstack gap-3">${cfg.map((c) => c.tipo === 'opcao'
      ? `<div><label class="form-label">${esc(c.rotulo)}</label><select class="form-select form-select-sm" name="${c.chave}">${c.opcoes.map(([v, l]) => `<option value="${v}" ${v === c.valor ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`
      : `<div><label class="form-label">${esc(c.rotulo)}</label><input type="number" class="form-control form-control-sm" name="${c.chave}" value="${c.valor ?? ''}" min="0" step="1" style="max-width:140px"><div class="form-text">Padrão: ${c.padrao}</div></div>`).join('')}</form>`,
    buttons: [{ label: 'Salvar regras', onClick: async ({ body }) => {
      const f = body.querySelector('form');
      await put('/api/credito/regras', Object.fromEntries([...f.querySelectorAll('[name]')].map((x) => [x.name, x.value])));
      toast('Regras de crédito salvas.');
    } }],
  });
}
