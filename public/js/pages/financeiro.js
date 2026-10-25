// Financeiro: parcelas, descontos/créditos, comissões, devoluções, negativados e notas fiscais.
import {
  get, post, put, del, esc, fmt, titulo, abas, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, badge, ROTULOS,
  tabelaSimples, btnAcao, pedirTexto, confirmar, pode, qs, erro,
} from '../core.js';

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const STATUS_PARCELA = ['a_pagar', 'vencida', 'liquidada', 'negociada', 'acordo_judicial', 'cancelada', 'devolvida'].map((s) => [s, ROTULOS.status[s][0]]);

export function baixarParcela(p, aoSalvar) {
  const saldo = p.saldo ?? (p.valor + (p.juros || 0) - (p.desconto || 0) - (p.valor_pago || 0));
  modal({
    title: `Baixa da parcela ${p.parcela || p.numero} · ${esc(p.cliente || '')}`, size: 'lg',
    body: `<div class="small mb-2">Vencimento ${fmt.date(p.vencimento)} · Valor ${fmt.money(p.valor)} · Já pago ${fmt.money(p.valor_pago)} · <b>Saldo ${fmt.money(saldo)}</b></div>
      <form class="row g-2">
      ${campo('data_pagamento', 'Data do pagamento', { type: 'date', col: 'col-md-4', value: hoje(), required: true })}
      ${campo('juros', 'Juros/multa', { type: 'number', col: 'col-md-4', value: p.juros || 0, attrs: 'step="0.01"' })}
      ${campo('desconto', 'Desconto', { type: 'number', col: 'col-md-4', value: p.desconto || 0, attrs: 'step="0.01"' })}
      ${campo('valor_pago', 'Valor recebido', { type: 'number', col: 'col-md-4', value: saldo.toFixed(2), attrs: 'step="0.01"', required: true })}
      ${campo('tipo_baixa', 'Tipo de baixa', { type: 'select', col: 'col-md-4', options: Object.entries(ROTULOS.tipo_baixa), value: p.tipo_baixa || 'boleto' })}
      ${campo('banco_id', 'Banco', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.bancos, '—') })}</form>
      <div class="form-text">Pagamento com atraso aplica a penalidade de comissão da forma de pagamento. Título negativado gera pedido de baixa no Serasa.</div>`,
    buttons: [{ label: 'Confirmar baixa', onClick: async ({ body }) => {
      const r = await post(`/api/financeiro/parcelas/${p.id}/baixa`, lerForm(body.querySelector('form')));
      toast(r.status === 'liquidada' ? 'Parcela liquidada.' : 'Baixa parcial registrada.');
      aoSalvar?.();
    } }],
  });
}

export function prorrogarParcela(p, aoSalvar) {
  modal({
    title: `Prorrogar parcela ${p.parcela || p.numero}`, size: 'md',
    body: `<form class="row g-2">${campo('vencimento', 'Novo vencimento', { type: 'date', col: 'col-md-6', required: true, value: p.vencimento })}
      ${campo('juros', 'Juros a acrescentar', { type: 'number', col: 'col-md-6', value: 0, attrs: 'step="0.01"' })}
      ${campo('motivo', 'Motivo', { col: 'col-12' })}</form>`,
    buttons: [{ label: 'Prorrogar', onClick: async ({ body }) => {
      await post(`/api/financeiro/parcelas/${p.id}/prorrogar`, lerForm(body.querySelector('form')));
      toast('Parcela prorrogada.');
      aoSalvar?.();
    } }],
  });
}

export default async function (conteudo, { params: [tela] }) {
  const telas = { parcelas, lancamentos, comissoes, devolucoes, negativados, notas };
  if (!telas[tela]) { conteudo.innerHTML = '<div class="vazio">Tela não encontrada.</div>'; return; }
  return telas[tela](conteudo);
}

// ---------- Gestão de Parcelas ----------
function parcelas(conteudo) {
  const pagina = titulo(conteudo, 'Parcelas a receber', 'bi-list-check');
  const t = new DataTable(pagina, {
    url: '/api/financeiro/parcelas', title: 'Parcelas', sort: 'vencimento', dir: 'asc',
    columns: [
      { k: 'pedido', l: 'Pedido' }, { k: 'nota', l: 'NF' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'cliente', l: 'Cliente', render: (v, r) => `${esc(v)} ${r.blacklist ? badge(r.blacklist) : ''}` },
      { k: 'parcela', l: 'Parc.', render: (v, r) => `${v}/${r.total_parcelas || ''}` }, { k: 'vencimento', l: 'Vencimento', t: 'date' },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'juros', l: 'Juros', t: 'money' }, { k: 'valor_pago', l: 'Pago', t: 'money' }, { k: 'saldo', l: 'Saldo', t: 'money' },
      { k: 'data_pagamento', l: 'Pagamento', t: 'date' }, { k: 'dias_atraso', l: 'Atraso', t: 'num' },
      { k: 'status', l: 'Status', t: 'status', filter: { options: STATUS_PARCELA } },
      { k: 'tipo_baixa', l: 'Tipo baixa', filter: { options: Object.entries(ROTULOS.tipo_baixa) } }, { k: 'banco', l: 'Banco emissor' },
      { k: 'prorrogacoes', l: 'Prorrog.', t: 'num' }, { k: 'serasa', l: 'Serasa', t: 'status' }, { k: 'vendedor', l: 'Vendedor' },
    ],
    actions: (r) => {
      const aberta = ['a_pagar', 'vencida', 'acordo_judicial'].includes(r.status);
      return [
        aberta && pode('financeiro.parcelas') ? btnAcao('baixa', 'bi-check2-circle', 'Baixar', 'outline-success') : '',
        aberta ? btnAcao('prorrogar', 'bi-calendar-plus', 'Prorrogar') : '',
        btnAcao('detalhes', 'bi-info-circle', 'Detalhes e eventos'),
        r.status === 'vencida' && pode('financeiro.negativados') && !r.serasa ? btnAcao('serasa', 'bi-shield-x', 'Enviar ao Serasa', 'outline-danger') : '',
      ].join(' ');
    },
    onAction: {
      baixa: (r) => baixarParcela(r, () => t.reload()),
      prorrogar: (r) => prorrogarParcela(r, () => t.reload()),
      serasa: async (r) => { if (await confirmar(`Enviar a parcela ${r.parcela} de <b>${esc(r.cliente)}</b> (${fmt.money(r.saldo)}) para negativação no Serasa?`) && await tentar(() => post(`/api/financeiro/parcelas/${r.id}/serasa`), 'Pedido de inclusão registrado.')) t.reload(); },
      detalhes: async (r) => {
        const d = await get(`/api/financeiro/parcelas/${r.id}`);
        modal({
          title: `Parcela ${d.parcela}/${d.total_parcelas || ''} · Pedido ${d.pedido || '-'} · ${esc(d.cliente)}`, size: 'lg',
          body: `<div class="row small mb-3"><div class="col-md-6">Vencimento: <b>${fmt.date(d.vencimento)}</b> (original ${fmt.date(d.vencimento_original)})<br>Valor ${fmt.money(d.valor)} · Juros ${fmt.money(d.juros)} · Desconto ${fmt.money(d.desconto)}<br>Pago ${fmt.money(d.valor_pago)} em ${fmt.date(d.data_pagamento) || '-'} · Saldo <b>${fmt.money(d.saldo)}</b></div>
            <div class="col-md-6">Status: ${badge(d.status)}<br>Nosso número: ${esc(d.nosso_numero || '')}<br>Tipo de baixa: ${esc(d.tipo_baixa || '')} · Banco: ${esc(d.banco || '-')}</div></div>
            ${pode('financeiro.parcelas') ? `<div class="d-flex gap-2 mb-3 flex-wrap"><select class="form-select form-select-sm w-auto" data-novo-status>${[['a_pagar', 'A pagar'], ['acordo_judicial', 'Acordo judicial'], ['negociada', 'Negociada'], ['cancelada', 'Cancelada']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
              <button class="btn btn-sm btn-outline-primary" data-mudar-status>Alterar status</button>
              ${pode('blacklist.editar') ? '<button class="btn btn-sm btn-outline-danger ms-auto" data-blacklist><i class="bi bi-shield-x"></i> Enviar cliente à blacklist</button>' : ''}</div>` : ''}
            <h6>Eventos</h6>${tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'tipo', l: 'Tipo' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'usuario', l: 'Usuário' }], d.eventos)}
            <h6 class="mt-3">Serasa</h6>${tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'status', l: 'Status', t: 'status' }, { k: 'protocolo', l: 'Protocolo' }, { k: 'motivo_rejeicao', l: 'Motivo' }], d.negativacoes, { vazio: 'Nunca enviada.' })}`,
          onShow: ({ body, close }) => {
            body.querySelector('[data-mudar-status]')?.addEventListener('click', async () => {
              const status = body.querySelector('[data-novo-status]').value;
              const motivo = await pedirTexto('Motivo da alteração', { obrigatorio: false });
              if (motivo !== null && await tentar(() => post(`/api/financeiro/parcelas/${r.id}/status`, { status, motivo }), 'Status alterado.')) { close(); t.reload(); }
            });
            body.querySelector('[data-blacklist]')?.addEventListener('click', async () => {
              const motivo = await pedirTexto('Motivo', { valor: `Inadimplência na parcela ${d.parcela} (venc. ${fmt.date(d.vencimento)})` });
              if (motivo && await tentar(() => post(`/api/financeiro/parcelas/${r.id}/blacklist`, { motivo }), 'Cliente enviado à blacklist.')) { close(); t.reload(); }
            });
          },
        });
      },
    },
  });
}

// ---------- Lançar Descontos/Créditos ----------
const TIPOS_LANC = [['desconto', 'Desconto'], ['credito', 'Crédito'], ['desconto_brinde', 'Desconto de brinde'], ['desconto_devolucao', 'Desconto de devolução']];
function lancamentos(conteudo) {
  const pagina = titulo(conteudo, 'Descontos e créditos', 'bi-plus-slash-minus', '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo lançamento</button>');
  const t = new DataTable(pagina, {
    url: '/api/financeiro/lancamentos', title: 'Descontos e créditos', sort: 'created_at', dir: 'desc',
    columns: [
      { k: 'vendedor', l: 'Vendedor' }, { k: 'periodo', l: 'Período', render: fmt.periodo }, { k: 'tipo_ocorrencia', l: 'Tipo de ocorrência', filter: { options: TIPOS_LANC }, render: (v) => esc(Object.fromEntries(TIPOS_LANC)[v] || v) },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'pedido', l: 'Pedido' }, { k: 'usuario', l: 'Lançado por' }, { k: 'created_at', l: 'Data', t: 'datetime' },
    ],
    actions: () => btnAcao('excluir', 'bi-trash', 'Excluir', 'outline-danger'),
    onAction: { excluir: async (r) => { if (await confirmar('Excluir este lançamento?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/financeiro/lancamentos/${r.id}`), 'Excluído.')) t.reload(); } },
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => modal({
    title: 'Novo lançamento', size: 'lg',
    body: `<form class="row g-2">
      ${campo('vendedor_id', 'Vendedor', { type: 'select', col: 'col-md-6', required: true, options: opcoes(state.opcoes.usuarios.filter((u) => ['vendedor', 'supervisor'].includes(u.perfil))) })}
      ${campo('periodo', 'Período', { type: 'month', col: 'col-md-3', value: hoje().slice(0, 7), required: true })}
      ${campo('tipo_ocorrencia', 'Tipo de ocorrência', { type: 'select', col: 'col-md-3', options: TIPOS_LANC })}
      ${campo('valor', 'Valor', { type: 'number', col: 'col-md-3', required: true, attrs: 'step="0.01" min="0.01"' })}
      ${campo('pedido_id', 'Pedido (id, opcional)', { type: 'number', col: 'col-md-3' })}
      ${campo('descricao', 'Descrição', { col: 'col-md-6' })}</form>`,
    buttons: [{ label: 'Lançar', onClick: async ({ body }) => { await post('/api/financeiro/lancamentos', lerForm(body.querySelector('form'))); toast('Lançamento registrado.'); t.reload(); } }],
  }));
}

// ---------- Revisar Comissões ----------
function comissoes(conteudo) {
  const pagina = titulo(conteudo, 'Revisar comissões', 'bi-percent');
  pagina.innerHTML = abas([
    { id: 'ordens', label: 'Ordens de comissão', html: '<div id="t-com"></div>' },
    { id: 'resumo', label: 'Resumo por colaborador', html: `<div class="d-flex gap-2 align-items-center mb-2 small">Período <input type="month" class="form-control form-control-sm w-auto" id="per" value="${hoje().slice(0, 7)}"></div><div id="t-res"></div>` },
  ], 'com');
  const sel = new Set();
  const t = new DataTable(pagina.querySelector('#t-com'), {
    url: '/api/financeiro/comissoes', title: 'Comissões', sort: 'periodo', dir: 'desc',
    toolbar: `<button class="btn btn-sm btn-outline-info" data-lote="revisada"><i class="bi bi-check2"></i> Marcar revisadas</button>
      <button class="btn btn-sm btn-outline-success" data-lote="paga"><i class="bi bi-cash"></i> Marcar pagas</button>`,
    columns: [
      { k: 'sel', l: '', filter: false, export: false, render: (v, r) => `<input type="checkbox" class="form-check-input" data-c="${r.id}" ${sel.has(r.id) ? 'checked' : ''}>` },
      { k: 'colaborador', l: 'Colaborador' }, { k: 'periodo', l: 'Período', render: fmt.periodo },
      { k: 'perfil', l: 'Perfil', filter: { options: [['vendedor', 'Vendedor'], ['supervisor', 'Supervisor']] } },
      { k: 'tipo_comissao', l: 'Tipo', filter: { options: [['venda', 'Venda'], ['supervisao', 'Supervisão'], ['recebimento', 'Recebimento']] } },
      { k: 'empresa_recibo', l: 'Empresa do recibo' }, { k: 'pedido', l: 'Pedido' }, { k: 'valor_base', l: 'Base', t: 'money' }, { k: 'percentual', l: '%', t: 'pct' },
      { k: 'perda_pct', l: 'Perda %', t: 'pct' }, { k: 'valor', l: 'Comissão', t: 'money' },
      { k: 'status', l: 'Status', t: 'status', filter: { options: [['aberta', 'Aberta'], ['revisada', 'Revisada'], ['paga', 'Paga']] } }, { k: 'observacao', l: 'Obs.', cls: 'quebra' },
    ],
    actions: (r) => (r.status !== 'paga' ? btnAcao('editar', 'bi-pencil', 'Ajustar') : ''),
    onAction: {
      editar: (r) => modal({
        title: `Ajustar comissão · ${esc(r.colaborador)} · Pedido ${r.pedido || '-'}`, size: 'md',
        body: `<form class="row g-2">${campo('valor', 'Valor', { type: 'number', col: 'col-md-6', value: r.valor, attrs: 'step="0.01"' })}
          ${campo('status', 'Status', { type: 'select', col: 'col-md-6', value: r.status, options: [['aberta', 'Aberta'], ['revisada', 'Revisada'], ['paga', 'Paga']] })}
          ${campo('observacao', 'Observação', { col: 'col-12', value: r.observacao || '' })}</form>`,
        buttons: [{ label: 'Salvar', onClick: async ({ body }) => { await put(`/api/financeiro/comissoes/${r.id}`, lerForm(body.querySelector('form'))); toast('Comissão ajustada.'); t.reload(); } }],
      }),
    },
    onLoad: (d, tab) => tab.c.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { const id = Number(c.dataset.c); c.checked ? sel.add(id) : sel.delete(id); })),
  });
  pagina.querySelectorAll('[data-lote]').forEach((b) => b.addEventListener('click', async () => {
    if (!sel.size) return toast('Selecione as comissões.', 'warning');
    if (await tentar(() => post('/api/financeiro/comissoes/lote', { ids: [...sel], status: b.dataset.lote }), `${sel.size} comissões atualizadas.`)) { sel.clear(); t.reload(); }
  }));
  const res = pagina.querySelector('#t-res');
  const carregarResumo = async () => {
    const rows = await get('/api/financeiro/comissoes/resumo' + qs({ periodo: pagina.querySelector('#per').value })).catch((e) => { erro(e); return []; });
    res.innerHTML = tabelaSimples([{ k: 'nome', l: 'Colaborador' }, { k: 'perfil', l: 'Perfil' }, { k: 'comissoes', l: 'Comissões', t: 'money' }, { k: 'creditos', l: 'Créditos', t: 'money' }, { k: 'descontos', l: 'Descontos', t: 'money' }, { k: 'liquido', l: 'Líquido', t: 'money', cls: 'fw-bold' }], rows);
  };
  pagina.querySelector('#per').addEventListener('change', carregarResumo);
  carregarResumo();
}

// ---------- Lançar Desconto Devolução ----------
function devolucoes(conteudo) {
  const pagina = titulo(conteudo, 'Descontos de devolução', 'bi-arrow-counterclockwise', '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Nova devolução</button>');
  const t = new DataTable(pagina, {
    url: '/api/financeiro/devolucoes', title: 'Devoluções', sort: 'created_at', dir: 'desc',
    columns: [
      { k: 'nota', l: 'NF' }, { k: 'pedido', l: 'Pedido' }, { k: 'cliente', l: 'Cliente' }, { k: 'motivo', l: 'Motivo', cls: 'quebra' }, { k: 'tipo', l: 'Tipo' },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'frete', l: 'Frete', t: 'money' }, { k: 'total', l: 'Devolução total', t: 'bool' }, { k: 'baixa_parcelas', l: 'Baixa automática', t: 'bool' },
      { k: 'usuario', l: 'Usuário' }, { k: 'created_at', l: 'Data', t: 'datetime' },
    ],
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => novaDevolucao(null, () => t.reload()));
}

export function novaDevolucao(nota, aoSalvar) {
  modal({
    title: nota ? `Devolução da NF ${nota.numero}` : 'Nova devolução', size: 'lg',
    body: `<form class="row g-2">
      ${nota ? '' : campo('nota_numero', 'Nº da nota fiscal', { type: 'number', col: 'col-md-4', required: true })}
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-4', options: [['mercadoria', 'Mercadoria'], ['avaria', 'Avaria'], ['desacordo', 'Desacordo comercial'], ['outros', 'Outros']] })}
      ${campo('total', 'Devolução total', { type: 'checkbox', col: 'col-md-4' })}
      ${campo('valor', 'Valor devolvido', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"', value: nota ? '' : '' })}
      ${campo('frete', 'Frete', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"', value: 0 })}
      ${campo('desconto_vendedor', 'Desconto ao vendedor (R$)', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"' })}
      ${campo('baixa_parcelas', 'Baixa automática das parcelas', { type: 'checkbox', col: 'col-md-6', value: 1 })}
      ${campo('motivo', 'Motivo', { type: 'textarea', col: 'col-12', required: true })}</form>`,
    buttons: [{ label: 'Registrar devolução', cls: 'btn-danger', onClick: async ({ body }) => {
      const v = lerForm(body.querySelector('form'));
      await post('/api/financeiro/devolucoes', { ...v, nota_id: nota?.id, total: !!v.total, baixa_parcelas: !!v.baixa_parcelas });
      toast('Devolução registrada.');
      aoSalvar?.();
    } }],
  });
}

// ---------- Clientes Negativados ----------
const ACOES_NEG = {
  inclusao_solicitada: [['inclusao_aceita', 'Inclusão aceita', 'danger'], ['inclusao_rejeitada', 'Inclusão rejeitada', 'secondary']],
  inclusao_aceita: [['baixa_solicitada', 'Pedir baixa', 'info']],
  baixa_solicitada: [['baixa_aceita', 'Baixa aceita', 'success'], ['baixa_rejeitada', 'Baixa rejeitada', 'dark']],
  baixa_rejeitada: [['baixa_solicitada', 'Pedir baixa novamente', 'info']],
  inclusao_rejeitada: [['inclusao_solicitada', 'Reenviar inclusão', 'warning']],
};
function negativados(conteudo) {
  const pagina = titulo(conteudo, 'Clientes negativados', 'bi-person-x');
  pagina.insertAdjacentHTML('beforebegin', `<div class="alert alert-light border small py-2">Ciclo: <b>pedido de inclusão</b> → aceita ou rejeitada → <b>pedido de baixa</b> → aceita ou rejeitada. A baixa é pedida automaticamente quando a parcela é liquidada.</div>`);
  const t = new DataTable(pagina, {
    url: '/api/financeiro/negativacoes', title: 'Clientes negativados', sort: 'updated_at', dir: 'desc',
    columns: [
      { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'cliente', l: 'Cliente' }, { k: 'pedido', l: 'Pedido' }, { k: 'parcela', l: 'Parcela' }, { k: 'vencimento', l: 'Vencimento', t: 'date' },
      { k: 'valor', l: 'Valor', t: 'money' }, { k: 'status_parcela', l: 'Parcela', t: 'status' },
      { k: 'status', l: 'Situação Serasa', t: 'status', filter: { options: Object.keys(ACOES_NEG).concat('baixa_aceita').map((s) => [s, ROTULOS.status[s][0]]) } },
      { k: 'protocolo', l: 'Protocolo' }, { k: 'motivo_rejeicao', l: 'Motivo rejeição' }, { k: 'usuario', l: 'Usuário' }, { k: 'updated_at', l: 'Atualizado', t: 'datetime' },
    ],
    actions: (r) => (ACOES_NEG[r.status] || []).map(([s, l, c]) => `<button class="btn btn-sm btn-outline-${c} py-0" data-acao="mudar" data-s="${s}">${l}</button>`).join(' '),
    onAction: {
      mudar: async (r, tab, btn) => {
        const status = btn.dataset.s;
        let motivo = null;
        if (status.endsWith('rejeitada')) { motivo = await pedirTexto('Motivo da rejeição'); if (!motivo) return; }
        if (await tentar(() => post(`/api/financeiro/negativacoes/${r.id}/status`, { status, motivo }), 'Situação atualizada.')) t.reload();
      },
    },
  });
}

// ---------- Nota Fiscal de Saída ----------
function notas(conteudo) {
  const pagina = titulo(conteudo, 'Notas fiscais de saída', 'bi-file-earmark-text');
  const t = new DataTable(pagina, {
    url: '/api/financeiro/notas', title: 'Notas fiscais de saída', sort: 'numero', dir: 'desc',
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'serie', l: 'Série' }, { k: 'data_emissao', l: 'Emissão', t: 'datetime' }, { k: 'pedido', l: 'Pedido' },
      { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'cliente', l: 'Cliente' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'devolvido', l: 'Devolvido', t: 'money' },
      { k: 'status', l: 'Status', t: 'status', filter: { options: [['autorizada', 'Autorizada'], ['cancelada', 'Cancelada'], ['devolvida', 'Devolvida'], ['devolvida_parcial', 'Devolvida parcial']] } },
      { k: 'natureza', l: 'Natureza da operação' }, { k: 'cartas_correcao', l: 'CC-e', t: 'num' }, { k: 'chave', l: 'Chave de acesso', cls: 'small' },
    ],
    actions: (r) => (r.status === 'cancelada' ? '' : [
      r.status === 'autorizada' ? btnAcao('cancelar', 'bi-x-octagon', 'Cancelar nota', 'outline-danger') : '',
      btnAcao('cce', 'bi-pencil-square', 'Carta de correção'),
      pode('financeiro.devolucoes') ? btnAcao('devolver', 'bi-arrow-return-left', 'Registrar devolução', 'outline-warning') : '',
    ].join(' ')),
    rowClick: (r) => detalheNota(r.id),
    onAction: {
      cancelar: async (r) => {
        const motivo = await pedirTexto(`Justificativa do cancelamento da NF ${r.numero} (mín. 15 caracteres)`, { titulo: 'Cancelar nota fiscal', min: 15, ok: 'Cancelar nota' });
        if (!motivo) return;
        try {
          await post(`/api/financeiro/notas/${r.id}/cancelar`, { motivo });
        } catch (e) {
          if (!/24h/.test(e.message)) return erro(e);
          if (!await confirmar(`${esc(e.message)}<br>Confirmar cancelamento extemporâneo?`)) return;
          if (!await tentar(() => post(`/api/financeiro/notas/${r.id}/cancelar`, { motivo, extemporaneo: true }))) return;
        }
        toast('Nota cancelada. O pedido voltou para a fila de faturamento.');
        t.reload();
      },
      cce: async (r) => {
        const texto = await pedirTexto(`Correção da NF ${r.numero} (mín. 15 caracteres)`, { titulo: 'Carta de correção (CC-e)', min: 15, ok: 'Emitir CC-e' });
        if (texto && await tentar(() => post(`/api/financeiro/notas/${r.id}/carta-correcao`, { texto }), 'Carta de correção emitida.')) t.reload();
      },
      devolver: (r) => novaDevolucao(r, () => t.reload()),
    },
  });
}

async function detalheNota(id) {
  const n = await get(`/api/financeiro/notas/${id}`).catch(erro);
  if (!n) return;
  modal({
    title: `NF-e ${n.numero} · ${esc(n.cliente)} ${badge(n.status)}`, size: 'xl',
    body: `<div class="small mb-3">Emissão ${fmt.datetime(n.data_emissao)} · Pedido ${n.pedido || '-'} · ${fmt.doc(n.documento)} · Valor <b>${fmt.money(n.valor)}</b><br>Chave: <code>${esc(n.chave)}</code>
      ${n.motivo_cancelamento ? `<div class="text-danger">Cancelada em ${fmt.datetime(n.data_cancelamento)}: ${esc(n.motivo_cancelamento)}</div>` : ''}</div>
      ${abas([
        { id: 'itens', label: 'Itens', html: tabelaSimples([{ k: 'produto', l: 'Produto' }, { k: 'ncm', l: 'NCM' }, { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'unidade', l: 'Un' }, { k: 'valor_unitario', l: 'Unit.', t: 'money' }, { k: 'valor_total', l: 'Total', t: 'money' }, { k: 'lote', l: 'Lote' }], n.itens) },
        { id: 'parc', label: 'Parcelas', html: tabelaSimples([{ k: 'numero', l: 'Parc.' }, { k: 'vencimento', l: 'Vencimento', t: 'date' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'valor_pago', l: 'Pago', t: 'money' }, { k: 'status_atual', l: 'Status', t: 'status' }], n.parcelas) },
        { id: 'cce', label: `Cartas de correção (${n.cartas.length})`, html: tabelaSimples([{ k: 'sequencia', l: 'Seq.' }, { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'texto', l: 'Correção', cls: 'quebra' }, { k: 'usuario', l: 'Usuário' }], n.cartas) },
        { id: 'dev', label: `Devoluções (${n.devolucoes.length})`, html: tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'motivo', l: 'Motivo', cls: 'quebra' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'total', l: 'Total', t: 'bool' }], n.devolucoes) },
      ], 'nf')}`,
  });
}
