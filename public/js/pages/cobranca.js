// Cobrança: carteira de inadimplência, agenda, ações de cobrança por cliente e acordos.
import {
  get, post, esc, fmt, titulo, abas, DataTable, modal, campo, lerForm, toast, tentar, state, badge, ROTULOS,
  tabelaSimples, qs, pode, pedirTexto, humanizar,
} from '../core.js';
import { baixarParcela, prorrogarParcela } from './financeiro.js';

const FAIXAS = ['A vencer', '1-30', '31-60', '61-90', '90+'];
const COR_FAIXA = { 'A vencer': 'secondary', '1-30': 'warning', '31-60': 'warning', '61-90': 'danger', '90+': 'danger' };
const TIPOS = ['ligacao', 'whatsapp', 'email', 'sms', 'visita', 'carta', 'promessa'];

export default async function (conteudo, { modo, params }) {
  if (modo === 'cliente') return clienteCobranca(conteudo, Number(params[0]));
  const pagina = titulo(conteudo, 'Cobrança', 'bi-telephone-outbound');
  const r = await get('/api/cobranca/resumo');
  const faixas = Object.fromEntries(r.faixas.map((f) => [f.faixa, f]));
  pagina.innerHTML = `<div class="row g-2 mb-3">
    ${FAIXAS.map((f) => `<div class="col-6 col-md-4 col-xl"><div class="card kpi cor-${COR_FAIXA[f]} h-100"><div class="card-body py-2">
      <div class="small text-muted">${f === 'A vencer' ? 'A vencer' : `Atraso ${f} dias`}</div><div class="valor fs-5">${fmt.money(faixas[f]?.valor || 0)}</div>
      <div class="small text-muted">${faixas[f]?.parcelas || 0} parcelas · ${faixas[f]?.clientes || 0} clientes</div></div></div></div>`).join('')}
  </div>
  <div class="row g-2 mb-3">
    <div class="col-6 col-md-3"><div class="card h-100"><div class="card-body py-2"><div class="small text-muted">Promessas para hoje</div><div class="fw-bold">${r.promessas_hoje.n} · ${fmt.money(r.promessas_hoje.v)}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card h-100"><div class="card-body py-2"><div class="small text-muted">Promessas quebradas (30 dias)</div><div class="fw-bold text-danger">${r.promessas_vencidas}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card h-100"><div class="card-body py-2"><div class="small text-muted">Ações registradas hoje</div><div class="fw-bold">${r.acoes_hoje}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card h-100"><div class="card-body py-2"><div class="small text-muted">Recuperado no mês (pagos em atraso)</div><div class="fw-bold text-success">${fmt.money(r.recuperado_mes)}</div></div></div></div>
  </div>
  ${abas([
    { id: 'cart', label: '<i class="bi bi-people"></i> Carteira em atraso', html: '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="inc-av"><label class="form-check-label small" for="inc-av">Incluir clientes só com parcelas a vencer</label></div><div id="t-cart"></div>' },
    { id: 'agenda', label: '<i class="bi bi-calendar-check"></i> Agenda (±7 dias)', html: '<div id="t-agenda"></div>' },
    { id: 'acoes', label: '<i class="bi bi-list-ul"></i> Ações registradas', html: '<div id="t-acoes"></div>' },
  ], 'cob')}`;

  const tCart = new DataTable(pagina.querySelector('#t-cart'), {
    url: () => '/api/cobranca/carteira' + qs({ incluir_a_vencer: pagina.querySelector('#inc-av').checked ? 1 : '' }),
    title: 'Carteira de cobrança', sort: 'saldo_vencido', dir: 'desc',
    columns: [
      { k: 'cliente', l: 'Cliente', render: (v, x) => `${esc(v)} ${x.blacklist ? badge(x.blacklist) : ''} ${x.serasa ? badge(x.serasa) : ''}` },
      { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'telefone', l: 'Telefone' }, { k: 'vendedor', l: 'Vendedor' },
      { k: 'faixa', l: 'Faixa', filter: { options: FAIXAS.map((f) => [f, f]) }, render: (v) => `<span class="badge text-bg-${COR_FAIXA[v]}">${esc(v)}</span>` },
      { k: 'parcelas_vencidas', l: 'Parc. vencidas', t: 'num' }, { k: 'saldo_vencido', l: 'Vencido', t: 'money' }, { k: 'saldo_aberto', l: 'Em aberto', t: 'money' },
      { k: 'maior_atraso', l: 'Maior atraso', t: 'num' }, { k: 'ultima_acao', l: 'Última ação', t: 'datetime' }, { k: 'ultima_acao_desc', l: 'Resultado', render: (v) => esc(humanizar(v)) },
      { k: 'promessa', l: 'Promessa', t: 'date' }, { k: 'proxima_acao', l: 'Próxima ação', t: 'date' },
    ],
    rowClick: (x) => { location.hash = `#/cobranca/cliente/${x.id}`; },
  });
  pagina.querySelector('#inc-av').addEventListener('change', () => tCart.reload());

  const ag = await get('/api/cobranca/agenda');
  const hoje = new Date().toISOString().slice(0, 10);
  pagina.querySelector('#t-agenda').innerHTML = ag.length ? `<ul class="list-group">${ag.map((a) => {
    const data = a.data_promessa || a.proxima_acao;
    return `<a class="list-group-item list-group-item-action small d-flex gap-3" href="#/cobranca/cliente/${a.cliente_id}">
      <div class="text-nowrap fw-semibold ${data < hoje ? 'text-danger' : data === hoje ? 'text-success' : ''}">${fmt.date(data)}</div>
      <div class="flex-grow-1"><b>${esc(a.cliente)}</b> · ${a.data_promessa ? `Promessa de ${fmt.money(a.valor_promessa)}` : 'Próxima ação'} · ${esc(ROTULOS.tipo_acao[a.tipo] || a.tipo)}
        <div class="text-muted">${esc(a.descricao || '')}</div></div><div class="text-nowrap text-danger">${fmt.money(a.saldo_vencido)}</div></a>`;
  }).join('')}</ul>` : '<div class="vazio">Nada agendado.</div>';

  new DataTable(pagina.querySelector('#t-acoes'), {
    url: '/api/cobranca/acoes', title: 'Ações de cobrança', sort: 'created_at', dir: 'desc',
    columns: [
      { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'cliente', l: 'Cliente' },
      { k: 'tipo', l: 'Tipo', filter: { options: [...TIPOS, 'acordo'].map((t) => [t, ROTULOS.tipo_acao[t]]) }, render: (v) => esc(ROTULOS.tipo_acao[v] || v) },
      { k: 'resultado', l: 'Resultado', render: (v) => esc(ROTULOS.resultado[v] || v || '') }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'data_promessa', l: 'Promessa', t: 'date' }, { k: 'valor_promessa', l: 'Valor prometido', t: 'money' }, { k: 'proxima_acao', l: 'Próxima ação', t: 'date' }, { k: 'usuario', l: 'Usuário' },
    ],
    rowClick: (x) => { location.hash = `#/cobranca/cliente/${x.cliente_id}`; },
  });
}

async function clienteCobranca(conteudo, id) {
  const d = await get(`/api/cobranca/cliente/${id}`);
  const c = d.cliente;
  const recarregar = () => clienteCobranca(conteudo, id);
  const pagina = titulo(conteudo, `Cobrança: ${esc(c.nome)} <small class="text-muted fs-6">${fmt.doc(c.documento)}</small>`, 'bi-telephone-outbound', `
    <button class="btn btn-sm btn-success" data-a="acao"><i class="bi bi-plus-lg"></i> Registrar ação</button>
    <a class="btn btn-sm btn-outline-primary" href="#/crm/cliente/${id}"><i class="bi bi-diagram-3"></i> CRM</a>
    <a class="btn btn-sm btn-outline-secondary" href="#/cobranca"><i class="bi bi-arrow-left"></i></a>`);
  const vencido = d.parcelas.filter((p) => p.dias_atraso > 0).reduce((a, p) => a + p.saldo, 0);
  const aberto = d.parcelas.reduce((a, p) => a + p.saldo, 0);
  pagina.innerHTML = `
    ${d.blacklist.bloqueio ? `<div class="alert alert-danger py-2"><i class="bi bi-shield-x"></i> Na blacklist: ${esc(d.blacklist.bloqueio.motivo)}</div>` : ''}
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card mb-3"><div class="card-header py-2 d-flex align-items-center flex-wrap gap-2">Parcelas em aberto
          <span class="ms-auto small">Vencido <b class="text-danger">${fmt.money(vencido)}</b> · Em aberto <b>${fmt.money(aberto)}</b></span></div>
          <div class="card-body p-0"><div class="table-responsive"><table class="table table-sm mb-0 align-middle"><thead><tr><th><input type="checkbox" class="form-check-input" id="sel-todas"></th>
            <th>Pedido</th><th>NF</th><th>Parcela</th><th>Vencimento</th><th class="num">Atraso</th><th class="num">Saldo</th><th>Status</th><th></th></tr></thead><tbody>
            ${d.parcelas.map((p) => `<tr><td><input type="checkbox" class="form-check-input" data-sel="${p.id}"></td><td>${p.pedido || ''}</td><td>${p.nota || ''}</td>
              <td>${p.numero}/${p.total_parcelas || ''}</td><td>${fmt.date(p.vencimento)}</td><td class="num ${p.dias_atraso > 0 ? 'text-danger fw-semibold' : ''}">${p.dias_atraso || ''}</td>
              <td class="num">${fmt.money(p.saldo)}</td><td>${badge(p.status_atual)}</td>
              <td class="text-nowrap">${pode('financeiro.parcelas') ? `<button class="btn btn-sm btn-outline-success py-0" data-baixa="${p.id}" title="Baixar"><i class="bi bi-check2"></i></button>` : ''}
                <button class="btn btn-sm btn-outline-secondary py-0" data-prorrogar="${p.id}" title="Prorrogar"><i class="bi bi-calendar-plus"></i></button>
                ${pode('financeiro.negativados') && p.dias_atraso > 0 ? `<button class="btn btn-sm btn-outline-danger py-0" data-serasa="${p.id}" title="Enviar ao Serasa"><i class="bi bi-shield-x"></i></button>` : ''}</td></tr>`).join('')
              || '<tr><td colspan="9" class="vazio">Nenhuma parcela em aberto.</td></tr>'}
            </tbody></table></div></div>
          <div class="card-footer d-flex gap-2 flex-wrap"><button class="btn btn-sm btn-outline-primary" data-a="acordo"><i class="bi bi-hand-thumbs-up"></i> Fazer acordo com selecionadas</button>
            ${pode('blacklist.editar') ? '<button class="btn btn-sm btn-outline-danger" data-a="blacklist"><i class="bi bi-shield-x"></i> Enviar à blacklist</button>' : ''}</div></div>
        <div class="card"><div class="card-header py-2">Histórico de ações de cobrança</div><div class="card-body p-0">${tabelaSimples([
          { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'tipo', l: 'Tipo', render: (v) => esc(ROTULOS.tipo_acao[v] || v) }, { k: 'resultado', l: 'Resultado', render: (v) => esc(ROTULOS.resultado[v] || v || '') },
          { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'data_promessa', l: 'Promessa', t: 'date' }, { k: 'valor_promessa', l: 'Valor', t: 'money' }, { k: 'proxima_acao', l: 'Próxima', t: 'date' }, { k: 'usuario', l: 'Usuário' },
        ], d.acoes, { vazio: 'Nenhuma ação registrada.' })}</div></div>
      </div>
      <div class="col-lg-4">
        <div class="card mb-3"><div class="card-header py-2">Contato</div><div class="card-body small">
          ${d.telefones.map((t) => `<div class="d-flex align-items-center gap-2 mb-1"><i class="bi bi-telephone"></i> ${esc(t.numero)} ${t.contato ? '(' + esc(t.contato) + ')' : ''}
            ${t.whatsapp ? `<a class="btn btn-sm btn-outline-success py-0 ms-auto" target="_blank" rel="noopener" href="https://wa.me/55${t.numero.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${c.nome.split(' ')[0]}, aqui é da ${state.me.empresa.nome}. Identificamos parcelas em aberto no valor de ${fmt.money(vencido)}. Podemos conversar?`)}"><i class="bi bi-whatsapp"></i></a>` : ''}</div>`).join('')}
          ${c.email ? `<div><i class="bi bi-envelope"></i> ${esc(c.email)}</div>` : ''}<div class="mt-2 text-muted">Vendedor: ${esc(c.vendedor || '-')}</div></div></div>
        <div class="card"><div class="card-header py-2">Acordos</div><div class="card-body p-0">${tabelaSimples([
          { k: 'created_at', l: 'Data', t: 'date' }, { k: 'valor_original', l: 'Original', t: 'money' }, { k: 'desconto', l: 'Desc.', t: 'money' }, { k: 'valor_acordo', l: 'Acordo', t: 'money' },
          { k: 'parcelas', l: 'Parc.' }, { k: 'judicial', l: 'Judicial', t: 'bool' }], d.acordos, { vazio: 'Nenhum acordo.' })}</div></div>
      </div>
    </div>`;

  const selecionadas = () => [...pagina.querySelectorAll('[data-sel]:checked')].map((x) => Number(x.dataset.sel));
  pagina.querySelector('#sel-todas')?.addEventListener('change', (e) => pagina.querySelectorAll('[data-sel]').forEach((x) => { x.checked = e.target.checked; }));
  pagina.querySelectorAll('[data-baixa]').forEach((b) => b.addEventListener('click', () => baixarParcela(d.parcelas.find((p) => p.id === Number(b.dataset.baixa)), recarregar)));
  pagina.querySelectorAll('[data-prorrogar]').forEach((b) => b.addEventListener('click', () => prorrogarParcela(d.parcelas.find((p) => p.id === Number(b.dataset.prorrogar)), recarregar)));
  pagina.querySelectorAll('[data-serasa]').forEach((b) => b.addEventListener('click', async () => {
    if (await tentar(() => post(`/api/financeiro/parcelas/${b.dataset.serasa}/serasa`), 'Pedido de inclusão no Serasa registrado.')) recarregar();
  }));
  conteudo.querySelector('[data-a=acao]').addEventListener('click', () => registrarAcao(id, d.parcelas, recarregar));
  pagina.querySelector('[data-a=blacklist]')?.addEventListener('click', async () => {
    const motivo = await pedirTexto('Motivo da inclusão na blacklist', { titulo: 'Blacklist', valor: `Inadimplência: ${fmt.money(vencido)} vencidos.` });
    if (motivo && await tentar(() => post('/api/clientes/blacklist', { cliente_id: id, tipo: 'bloqueio', motivo }), 'Cliente enviado à blacklist.')) recarregar();
  });
  pagina.querySelector('[data-a=acordo]').addEventListener('click', () => {
    const ids = selecionadas();
    if (!ids.length) return toast('Selecione as parcelas do acordo.', 'warning');
    const total = d.parcelas.filter((p) => ids.includes(p.id)).reduce((a, p) => a + p.saldo, 0);
    const em30 = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
    const m = modal({
      title: `Acordo · ${ids.length} parcelas · ${fmt.money(total)}`, size: 'lg',
      body: `<form class="row g-2">
        ${campo('juros', 'Juros/multa (R$)', { type: 'number', col: 'col-md-3', value: 0, attrs: 'step="0.01"' })}
        ${campo('desconto', 'Desconto (R$)', { type: 'number', col: 'col-md-3', value: 0, attrs: 'step="0.01"' })}
        ${campo('num_parcelas', 'Nº de parcelas', { type: 'number', col: 'col-md-2', value: 1, attrs: 'min="1" max="36"' })}
        ${campo('intervalo_dias', 'Intervalo (dias)', { type: 'number', col: 'col-md-2', value: 30 })}
        ${campo('primeiro_vencimento', '1º vencimento', { type: 'date', col: 'col-md-2', value: em30, required: true })}
        ${campo('tipo_baixa', 'Forma', { type: 'select', col: 'col-md-3', options: Object.entries(ROTULOS.tipo_baixa) })}
        ${campo('judicial', 'Acordo judicial', { type: 'checkbox', col: 'col-md-3' })}
        ${campo('observacao', 'Observação', { col: 'col-md-6' })}
        <div class="col-12"><div class="alert alert-light border small mb-0" id="simul"></div></div></form>`,
      buttons: [{ label: 'Confirmar acordo', onClick: async ({ body }) => {
        const r = await post('/api/cobranca/acordos', { ...lerForm(body.querySelector('form')), cliente_id: id, parcelas: ids });
        toast(`Acordo #${r.id} registrado: ${fmt.money(r.valor_acordo)}.`);
        recarregar();
      } }],
    });
    const f = m.body.querySelector('form');
    const simular = () => {
      const v = lerForm(f);
      const tot = total + (v.juros || 0) - (v.desconto || 0);
      m.body.querySelector('#simul').innerHTML = `Valor do acordo: <b>${fmt.money(tot)}</b> em ${v.num_parcelas || 1}x de <b>${fmt.money(tot / (v.num_parcelas || 1))}</b>. As parcelas originais ficam como <i>negociadas</i>.`;
    };
    f.addEventListener('input', simular);
    simular();
  });
}

export function registrarAcao(clienteId, parcelas, aoSalvar) {
  const amanha = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  modal({
    title: 'Registrar ação de cobrança', size: 'lg',
    body: `<form class="row g-2">
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-4', options: TIPOS.map((t) => [t, ROTULOS.tipo_acao[t]]) })}
      ${campo('resultado', 'Resultado', { type: 'select', col: 'col-md-4', options: Object.entries(ROTULOS.resultado).filter(([k]) => k !== 'acordo') })}
      ${campo('parcela_id', 'Parcela (opcional)', { type: 'select', col: 'col-md-4', options: [['', 'Todas'], ...parcelas.map((p) => [p.id, `${p.numero}/${p.total_parcelas || ''} · ${fmt.date(p.vencimento)} · ${fmt.money(p.saldo)}`])] })}
      ${campo('descricao', 'Descrição', { type: 'textarea', col: 'col-12' })}
      ${campo('data_promessa', 'Data da promessa', { type: 'date', col: 'col-md-4' })}
      ${campo('valor_promessa', 'Valor prometido', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"' })}
      ${campo('proxima_acao', 'Próxima ação em', { type: 'date', col: 'col-md-4', value: amanha })}</form>`,
    buttons: [{ label: 'Registrar', onClick: async ({ body }) => {
      await post('/api/cobranca/acoes', { ...lerForm(body.querySelector('form')), cliente_id: clienteId });
      toast('Ação registrada.');
      aoSalvar?.();
    } }],
  });
}

