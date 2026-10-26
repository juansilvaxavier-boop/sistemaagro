// Contas a pagar: lançamento avulso, parcelado ou recorrente, baixa, estorno e cancelamento.
import {
  get, post, put, esc, fmt, titulo, DataTable, modal, campo, opcoes, lerForm, preencherForm, toast, tentar, state, btnAcao, pedirTexto, confirmar, kpi,
} from '../core.js';

export const CATEGORIAS = ['Matéria-prima', 'Embalagem', 'Material de consumo', 'Frete', 'Folha', 'Comissões', 'Impostos', 'Aluguel', 'Energia', 'Manutenção', 'Serviços', 'Outros'];
const STATUS = {
  a_pagar: ['A pagar', 'primary'], vence_hoje: ['Vence hoje', 'warning'], vencida: ['Vencida', 'danger'], pago: ['Pago', 'success'], cancelado: ['Cancelado', 'secondary'],
};
const FORMAS = ['Boleto', 'PIX', 'TED', 'Débito automático', 'Cartão', 'Dinheiro', 'Cheque'];
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const st = (v) => { const [l, c] = STATUS[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Contas a pagar', 'bi-credit-card-2-back', '<button class="btn btn-sm btn-success" id="btn-nova"><i class="bi bi-plus-lg"></i> Nova conta</button>');
  pagina.innerHTML = '<div class="kpis mb-3" id="kpis"></div><div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="so-abertas" checked><label class="form-check-label small" for="so-abertas">Só contas em aberto</label></div><div class="row g-3"><div class="col-xl-9" id="t-pagar"></div><div class="col-xl-3"><div class="card"><div class="card-header py-2">Em aberto por categoria</div><div class="card-body" id="cat"></div></div></div></div>';
  const resumo = async () => {
    const r = await get('/api/pagar/resumo');
    pagina.querySelector('#kpis').innerHTML = [
      kpi('Vencido', fmt.money(r.vencido), { icone: 'bi-exclamation-octagon', cor: 'danger', sub: `${r.qtd_vencido} contas` }),
      kpi('Vence hoje', fmt.money(r.hoje), { icone: 'bi-calendar-event', cor: 'warning', sub: `${r.qtd_hoje} contas` }),
      kpi('Próximos 7 dias', fmt.money(r.semana), { icone: 'bi-calendar-week', cor: 'info' }),
      kpi('Total em aberto', fmt.money(r.aberto), { icone: 'bi-wallet2', cor: 'primary' }),
      kpi('Pago no mês', fmt.money(r.pago_mes), { icone: 'bi-check2-circle', cor: 'success' }),
    ].join('');
    const max = Math.max(1, ...r.categorias.map((c) => c.valor));
    pagina.querySelector('#cat').innerHTML = r.categorias.map((c) => `<div class="mb-2 small"><div class="d-flex justify-content-between"><span>${esc(c.categoria)}</span><b>${fmt.money(c.valor)}</b></div>
      <div class="progress" style="height:6px"><div class="progress-bar bg-success" style="width:${(c.valor / max) * 100}%"></div></div></div>`).join('') || '<div class="vazio py-2">Nada em aberto.</div>';
  };
  const t = new DataTable(pagina.querySelector('#t-pagar'), {
    url: () => `/api/pagar?abertos=${pagina.querySelector('#so-abertas').checked ? 1 : ''}`, title: 'Contas a pagar', sort: 'vencimento', dir: 'asc', empresa: true,
    columns: [
      { k: 'vencimento', l: 'Vencimento', t: 'date' }, { k: 'fornecedor', l: 'Fornecedor' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'categoria', l: 'Categoria', filter: { options: CATEGORIAS.map((c) => [c, c]) } }, { k: 'documento', l: 'Documento' }, { k: 'parcela', l: 'Parc.' },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'valor_pago', l: 'Pago', t: 'money' }, { k: 'saldo', l: 'Saldo', t: 'money' },
      { k: 'data_pagamento', l: 'Pagamento', t: 'date' }, { k: 'status', l: 'Status', filter: { options: Object.entries(STATUS).map(([k, [l]]) => [k, l]) }, render: st },
      { k: 'forma_pagamento', l: 'Forma' }, { k: 'banco', l: 'Banco' }, { k: 'lancado_por', l: 'Lançado por' },
    ],
    rowClass: (r) => (r.status === 'vencida' ? 'table-danger' : r.status === 'vence_hoje' ? 'table-warning' : ''),
    actions: (r) => {
      const aberta = ['a_pagar', 'vencida', 'vence_hoje'].includes(r.status);
      return [
        aberta ? btnAcao('pagar', 'bi-check2-circle', 'Pagar', 'outline-success') : '',
        aberta ? btnAcao('editar', 'bi-pencil', 'Editar') : '',
        r.valor_pago > 0 ? btnAcao('estornar', 'bi-arrow-counterclockwise', 'Estornar pagamento', 'outline-warning') : '',
        aberta && !r.valor_pago ? btnAcao('cancelar', 'bi-x-circle', 'Cancelar', 'outline-danger') : '',
      ].join(' ');
    },
    onAction: {
      pagar: (r) => pagar(r, atualizar),
      editar: (r) => abrir(r.id, atualizar),
      estornar: async (r) => { if (await confirmar(`Estornar o pagamento de <b>${esc(r.descricao)}</b>?`) && await tentar(() => post(`/api/pagar/${r.id}/estornar`), 'Pagamento estornado.')) atualizar(); },
      cancelar: async (r) => {
        const motivo = await pedirTexto('Motivo do cancelamento', { titulo: 'Cancelar conta' });
        if (!motivo) return;
        const todas = r.grupo && await confirmar('Cancelar também as próximas parcelas deste lançamento?', { ok: 'Sim, todas as próximas', cls: 'btn-danger' });
        if (await tentar(() => post(`/api/pagar/${r.id}/cancelar`, { motivo, todas }), 'Cancelado.')) atualizar();
      },
    },
  });
  const atualizar = () => { t.reload(); resumo(); };
  pagina.querySelector('#so-abertas').addEventListener('change', () => t.reload());
  resumo();
  conteudo.querySelector('#btn-nova').addEventListener('click', () => abrir(null, atualizar));
}

async function abrir(id, aoSalvar) {
  const o = state.opcoes;
  const c = id ? await get(`/api/pagar/${id}`) : { vencimento: hoje(), emissao: hoje() };
  const m = modal({
    title: id ? `Conta a pagar · ${esc(c.descricao)}` : 'Nova conta a pagar', size: 'lg',
    body: `<form class="row g-2">
      ${campo('fornecedor_id', 'Fornecedor', { type: 'select', col: 'col-md-6', options: opcoes(o.fornecedores, '— Sem fornecedor —') })}
      ${campo('categoria', 'Categoria', { type: 'select', col: 'col-md-3', options: [['', '—'], ...CATEGORIAS.map((x) => [x, x])] })}
      ${campo('documento', 'Documento (NF, boleto)', { col: 'col-md-3' })}
      ${campo('descricao', 'Descrição', { col: 'col-md-12', required: true })}
      ${campo('emissao', 'Emissão', { type: 'date', col: 'col-md-3' })}
      ${campo('vencimento', id ? 'Vencimento' : '1º vencimento', { type: 'date', col: 'col-md-3', required: true })}
      ${campo('valor', id ? 'Valor' : 'Valor total', { type: 'number', col: 'col-md-3', required: true, attrs: 'min="0.01" step="0.01"' })}
      ${campo('competencia', 'Competência', { type: 'month', col: 'col-md-3' })}
      ${id ? '' : `<div class="col-12"><div class="border rounded p-2 row g-2 m-0">
        <div class="col-md-4"><label class="form-label">Repetição</label><select class="form-select form-select-sm" name="modo">
          <option value="unica">Conta única</option><option value="parcelado">Parcelar o valor</option><option value="recorrente">Repetir todo mês (mesmo valor)</option></select></div>
        ${campo('parcelas', 'Quantidade', { type: 'number', col: 'col-md-3', value: 1, attrs: 'min="1" max="120" disabled' })}
        <div class="col-md-5 small text-muted d-flex align-items-end" data-previa></div></div></div>`}
      ${campo('forma_pagamento', 'Forma de pagamento', { type: 'select', col: 'col-md-4', options: [['', '—'], ...FORMAS.map((x) => [x, x])] })}
      ${campo('banco_id', 'Banco', { type: 'select', col: 'col-md-4', options: opcoes(o.bancos, '—') })}
      ${campo('codigo_barras', 'Linha digitável / código de barras', { col: 'col-md-4' })}
      ${campo('observacao', 'Observação', { col: 'col-12' })}</form>
      ${c.parcelas?.length > 1 ? `<div class="small text-muted mt-2">Parcelas do lançamento: ${c.parcelas.map((p) => `${p.parcela}ª ${fmt.date(p.vencimento)} ${fmt.money(p.valor)} (${STATUS[p.status]?.[0] || p.status})`).join(' · ')}</div>` : ''}`,
    buttons: [{ label: '<i class="bi bi-save"></i> Salvar', onClick: async ({ body }) => {
      const d = lerForm(body.querySelector('form'));
      if (d.modo === 'recorrente') d.recorrente = true;
      if (d.modo === 'unica') d.parcelas = 1;
      delete d.modo;
      const r = id ? await put(`/api/pagar/${id}`, d) : await post('/api/pagar', d);
      toast(id ? 'Conta atualizada.' : `${r.ids.length > 1 ? r.ids.length + ' contas lançadas' : 'Conta lançada'}.`);
      aoSalvar?.();
    } }],
  });
  const f = m.body.querySelector('form');
  preencherForm(f, c);
  const forn = f.querySelector('[name=fornecedor_id]');
  forn.addEventListener('change', () => {
    const x = o.fornecedores.find((y) => y.id === Number(forn.value));
    if (!x) return;
    if (!f.querySelector('[name=categoria]').value && x.categoria) f.querySelector('[name=categoria]').value = x.categoria;
    if (!id && x.prazo_pagamento_dias) {
      const em = f.querySelector('[name=emissao]').value || hoje();
      const d = new Date(em + 'T12:00:00');
      d.setDate(d.getDate() + x.prazo_pagamento_dias);
      f.querySelector('[name=vencimento]').value = d.toISOString().slice(0, 10);
    }
  });
  if (!id) {
    const modo = f.querySelector('[name=modo]');
    const qtd = f.querySelector('[name=parcelas]');
    const previa = () => {
      const n = Number(qtd.value) || 1;
      const v = Number(f.querySelector('[name=valor]').value) || 0;
      f.querySelector('[data-previa]').textContent = modo.value === 'parcelado' ? `${n}x de ${fmt.money(v / n)} (mensal)` : modo.value === 'recorrente' ? `${n} meses de ${fmt.money(v)} = ${fmt.money(v * n)}` : '';
    };
    modo.addEventListener('change', () => { qtd.disabled = modo.value === 'unica'; if (modo.value !== 'unica' && Number(qtd.value) < 2) qtd.value = modo.value === 'recorrente' ? 12 : 2; previa(); });
    qtd.addEventListener('input', previa);
    f.querySelector('[name=valor]').addEventListener('input', previa);
  }
}

function pagar(r, aoSalvar) {
  modal({
    title: `Pagar · ${esc(r.descricao)}`, size: 'lg',
    body: `<div class="small mb-2">${esc(r.fornecedor || 'Sem fornecedor')} · Vencimento ${fmt.date(r.vencimento)} · Valor ${fmt.money(r.valor)} · Já pago ${fmt.money(r.valor_pago)} · <b>Saldo ${fmt.money(r.saldo)}</b></div>
      <form class="row g-2">
      ${campo('data_pagamento', 'Data do pagamento', { type: 'date', col: 'col-md-4', value: hoje(), required: true })}
      ${campo('juros', 'Juros/multa', { type: 'number', col: 'col-md-4', value: r.juros || 0, attrs: 'step="0.01" min="0"' })}
      ${campo('desconto', 'Desconto', { type: 'number', col: 'col-md-4', value: r.desconto || 0, attrs: 'step="0.01" min="0"' })}
      ${campo('valor_pago', 'Valor pago agora', { type: 'number', col: 'col-md-4', value: Number(r.saldo).toFixed(2), attrs: 'step="0.01" min="0.01"', required: true })}
      ${campo('forma_pagamento', 'Forma', { type: 'select', col: 'col-md-4', options: FORMAS.map((x) => [x, x]), value: r.forma_pagamento || 'Boleto' })}
      ${campo('banco_id', 'Banco/conta de saída', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.bancos, '—') })}</form>
      <div class="form-text">Juros e desconto alteram o saldo; com valor menor que o saldo, fica registrado um pagamento parcial.</div>`,
    onShow: ({ body }) => {
      const f = body.querySelector('form');
      const recalc = () => {
        const s = r.valor + (Number(f.juros.value) || 0) - (Number(f.desconto.value) || 0) - (r.valor_pago || 0);
        f.valor_pago.value = s.toFixed(2);
      };
      f.juros.addEventListener('input', recalc);
      f.desconto.addEventListener('input', recalc);
    },
    buttons: [{ label: 'Confirmar pagamento', onClick: async ({ body }) => {
      const x = await post(`/api/pagar/${r.id}/pagar`, lerForm(body.querySelector('form')));
      toast(x.quitou ? 'Conta paga.' : 'Pagamento parcial registrado.');
      aoSalvar?.();
    } }],
  });
}
