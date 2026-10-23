// Clientes: lista, cadastro com seis abas, histórico de compra e blacklist.
import {
  get, post, put, esc, fmt, modal, abas, campo, opcoes, lerForm, preencherForm, toast, erro, tentar, state,
  DataTable, EditorLista, titulo, pode, pedirTexto, badge, tabelaSimples, buscaCliente, btnAcao,
} from '../core.js';
import { painelArquivos } from './arquivos.js';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export default async function (conteudo, { modo }) {
  if (modo === 'historico') return historicoCompra(conteudo);
  if (modo === 'blacklist') return blacklist(conteudo);
  const pagina = titulo(conteudo, 'Clientes', 'bi-people', pode('clientes.editar') || pode('pedido.criar') ? '<button class="btn btn-success btn-sm" id="btn-novo"><i class="bi bi-person-plus"></i> Novo cliente</button>' : '');
  const t = new DataTable(pagina, {
    url: '/api/clientes', title: 'Clientes', sort: 'nome', dir: 'asc',
    columns: [
      { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'nome', l: 'Nome' }, { k: 'tipo_pessoa', l: 'Tipo', filter: { options: [['F', 'Física'], ['J', 'Jurídica']] }, render: (v) => (v === 'J' ? 'PJ' : 'PF') },
      { k: 'cidade', l: 'Cidade/UF' }, { k: 'telefone', l: 'Telefone' }, { k: 'email', l: 'E-mail' }, { k: 'vendedor', l: 'Vendedor' },
      { k: 'blacklist', l: 'Blacklist', filter: { options: [['alerta', 'Alerta'], ['bloqueio', 'Bloqueio']] }, render: (v) => badge(v) },
    ],
    actions: () => `${btnAcao('crm', 'bi-diagram-3', 'Abrir no CRM')} ${btnAcao('hist', 'bi-clock-history', 'Histórico de compras')}`,
    onAction: {
      crm: (r) => { location.hash = `#/crm/cliente/${r.id}`; },
      hist: (r) => { location.hash = `#/historico-compra?doc=${r.documento}`; },
    },
    rowClick: (r) => abrirCliente(r.id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo')?.addEventListener('click', () => abrirCliente(null, () => t.reload()));
}

/** Janela de cadastro do cliente. aoSalvar(id) */
export async function abrirCliente(id, aoSalvar) {
  let c = { tipo_pessoa: 'F', enderecos: [{ principal: 1, tipo: 'Entrega', zona_rural: 1 }], telefones: [{ tipo: 'Celular', whatsapp: 1 }], areas: [], ref_comerciais: [], ref_bancarias: [] };
  if (id) { try { c = await get(`/api/clientes/${id}`); } catch (e) { return erro(e); } }
  const podeEditar = pode('clientes.editar') || pode('pedido.criar');
  const geral = `<form data-geral><div class="row g-2">
    ${campo('tipo_pessoa', 'Pessoa', { type: 'select', col: 'col-md-2', options: [['F', 'Física'], ['J', 'Jurídica']] })}
    ${campo('documento', 'CPF/CNPJ', { col: 'col-md-3', required: true, attrs: 'inputmode="numeric"' })}
    ${campo('nome', 'Nome / Razão social', { col: 'col-md-7', required: true })}
    ${campo('nome_fantasia', 'Nome fantasia / Fazenda', { col: 'col-md-4' })}
    ${campo('inscricao_estadual', 'Inscrição estadual', { col: 'col-md-3' })}
    ${campo('inscricao_produtor', 'Inscrição de produtor rural', { col: 'col-md-3' })}
    ${campo('data_nascimento', 'Nascimento/Fundação', { type: 'date', col: 'col-md-2' })}
    ${campo('email', 'E-mail', { type: 'email', col: 'col-md-4' })}
    ${state.me.usuario.perfil !== 'vendedor' ? campo('vendedor_id', 'Vendedor responsável', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.usuarios.filter((u) => u.perfil === 'vendedor'), '—') }) : ''}
    ${campo('limite_credito', 'Limite de crédito', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"' })}
    ${campo('observacao', 'Observações', { type: 'textarea', col: 'col-12' })}
  </div></form>`;
  const lista = [
    { id: 'geral', label: 'Geral', html: geral },
    { id: 'end', label: 'Endereços', html: '<div data-ed="enderecos"></div>' },
    { id: 'tel', label: 'Telefones', html: '<div data-ed="telefones"></div>' },
    { id: 'area', label: 'Área de cultivo', html: '<div data-ed="areas"></div>' },
    { id: 'rc', label: 'Referências comerciais', html: '<div data-ed="ref_comerciais"></div>' },
    { id: 'rb', label: 'Referências bancárias', html: '<div data-ed="ref_bancarias"></div>' },
  ];
  if (id && pode('arquivos')) lista.push({ id: 'arq', label: '<i class="bi bi-paperclip"></i> Arquivos', html: '<div data-arquivos></div>' });
  const bl = c.blacklist;
  const alerta = bl?.bloqueio ? `<div class="alert alert-danger py-2"><i class="bi bi-shield-x"></i> Bloqueado: ${esc(bl.bloqueio.motivo)}</div>`
    : bl?.alertas?.length ? `<div class="alert alert-warning py-2"><i class="bi bi-shield-exclamation"></i> ${esc(bl.alertas[0].motivo)}</div>` : '';

  const editores = {};
  const m = modal({
    title: id ? `Cliente: ${esc(c.nome)}` : 'Novo cliente', size: 'xl',
    body: alerta + abas(lista, 'cli'),
    buttons: podeEditar ? [{
      label: '<i class="bi bi-save"></i> Salvar',
      onClick: async ({ body }) => {
        const dados = lerForm(body.querySelector('[data-geral]'));
        for (const [k, ed] of Object.entries(editores)) dados[k] = ed.valores();
        if (dados.enderecos.filter((e) => e.principal).length > 1) { toast('Marque apenas um endereço como principal.', 'warning'); return false; }
        const r = id ? await put(`/api/clientes/${id}`, dados) : await post('/api/clientes', dados);
        toast('Cliente salvo.');
        aoSalvar?.(r.id);
      },
    }] : [],
  });
  const b = m.body;
  preencherForm(b.querySelector('[data-geral]'), c);
  editores.enderecos = new EditorLista(b.querySelector('[data-ed=enderecos]'), [
    { k: 'tipo', l: 'Tipo', type: 'select', options: [['Entrega', 'Entrega'], ['Cobrança', 'Cobrança'], ['Residencial', 'Residencial']], w: '110px' },
    { k: 'cep', l: 'CEP', w: '95px' }, { k: 'logradouro', l: 'Logradouro / Fazenda' }, { k: 'numero', l: 'Nº', w: '65px' }, { k: 'bairro', l: 'Bairro' },
    { k: 'cidade', l: 'Cidade' }, { k: 'uf', l: 'UF', type: 'select', options: [['', ''], ...UFS.map((u) => [u, u])], w: '75px' },
    { k: 'zona_rural', l: 'Rural', type: 'checkbox' }, { k: 'posta_restante', l: 'Posta rest.', type: 'checkbox' }, { k: 'principal', l: 'Principal', type: 'checkbox' },
    { k: 'como_chegar', l: 'Como chegar' },
  ], c.enderecos, { novo: { tipo: 'Entrega' }, rotuloAdd: 'Endereço' });
  editores.telefones = new EditorLista(b.querySelector('[data-ed=telefones]'), [
    { k: 'tipo', l: 'Tipo', type: 'select', options: [['Celular', 'Celular'], ['Fixo', 'Fixo'], ['Comercial', 'Comercial'], ['Recado', 'Recado']] },
    { k: 'numero', l: 'Número' }, { k: 'contato', l: 'Contato' }, { k: 'whatsapp', l: 'WhatsApp', type: 'checkbox' },
  ], c.telefones, { novo: { tipo: 'Celular' }, rotuloAdd: 'Telefone' });
  editores.areas = new EditorLista(b.querySelector('[data-ed=areas]'), [
    { k: 'tipo_cultivo', l: 'Tipo de cultivo' }, { k: 'qtd_pes', l: 'Quantidade de pés', type: 'number' }, { k: 'area', l: 'Área', type: 'number' },
    { k: 'medida', l: 'Medida agrária', type: 'select', options: [['ha', 'Hectare'], ['alqueire', 'Alqueire'], ['m2', 'm²'], ['tarefa', 'Tarefa']] },
  ], c.areas, { novo: { medida: 'ha' }, rotuloAdd: 'Área' });
  editores.ref_comerciais = new EditorLista(b.querySelector('[data-ed=ref_comerciais]'), [
    { k: 'empresa', l: 'Empresa' }, { k: 'contato', l: 'Contato' }, { k: 'telefone', l: 'Telefone' }, { k: 'ultima_checagem', l: 'Última checagem', type: 'date' },
    { k: 'checada', l: 'Checada', type: 'checkbox' }, { k: 'positivo', l: 'Positivo', type: 'checkbox' }, { k: 'observacao', l: 'Observações' },
  ], c.ref_comerciais, { rotuloAdd: 'Referência' });
  editores.ref_bancarias = new EditorLista(b.querySelector('[data-ed=ref_bancarias]'), [
    { k: 'banco', l: 'Banco' }, { k: 'agencia', l: 'Agência', w: '90px' }, { k: 'conta', l: 'Conta', w: '110px' }, { k: 'gerente', l: 'Gerente' }, { k: 'telefone', l: 'Telefone' },
    { k: 'data_checagem', l: 'Checagem', type: 'date' }, { k: 'checada', l: 'Checada', type: 'checkbox' }, { k: 'positivo', l: 'Positivo', type: 'checkbox' }, { k: 'observacao', l: 'Observações' },
  ], c.ref_bancarias, { rotuloAdd: 'Referência' });
  if (!podeEditar) b.querySelectorAll('input,select,textarea,button[data-add],button[data-rem]').forEach((x) => { x.disabled = true; });
  const arq = b.querySelector('[data-arquivos]');
  if (arq) painelArquivos(arq, { cliente_id: id });
}

// ---------- Histórico de compra ----------
async function historicoCompra(conteudo) {
  const pagina = titulo(conteudo, 'Histórico de Compra de Cliente', 'bi-clock-history');
  pagina.innerHTML = `<div class="card mb-3"><div class="card-body"><form class="row g-2 align-items-end" id="f-hist">
    <div class="col-md-4"><label class="form-label">CPF/CNPJ</label><input class="form-control form-control-sm" name="documento" placeholder="Somente números"></div>
    <div class="col-md-5"><label class="form-label">ou busque pelo nome</label><input class="form-control form-control-sm" id="h-busca" autocomplete="off"></div>
    <div class="col-md-3"><button class="btn btn-success btn-sm w-100"><i class="bi bi-search"></i> Buscar</button></div></form></div></div><div id="h-res"></div>`;
  const res = pagina.querySelector('#h-res');
  const buscar = async (params) => {
    const d = await get('/api/clientes/historico/compras?' + new URLSearchParams(params));
    if (!d.cliente) { res.innerHTML = '<div class="vazio">Cliente não encontrado.</div>'; return; }
    const r = d.resumo;
    const k = (l, v) => `<div class="col-6 col-md-3 col-xl"><div class="card kpi h-100"><div class="card-body py-2"><div class="small text-muted">${l}</div><div class="valor fs-6">${v}</div></div></div></div>`;
    res.innerHTML = `<h5>${esc(d.cliente.nome)} <small class="text-muted">${fmt.doc(d.cliente.documento)}</small>
      ${d.blacklist.bloqueio ? badge('bloqueio') : d.blacklist.alertas.length ? badge('alerta') : ''}
      <a class="btn btn-sm btn-outline-primary ms-2" href="#/crm/cliente/${d.cliente.id}"><i class="bi bi-diagram-3"></i> CRM</a></h5>
      <div class="row g-2 mb-3">${k('Pedidos', r.pedidos)}${k('Total comprado', fmt.money(r.total_comprado))}${k('Ticket médio', fmt.money(r.ticket_medio))}
      ${k('Primeira compra', fmt.date(r.primeira_compra))}${k('Última compra', fmt.date(r.ultima_compra))}${k('Em aberto', fmt.money(r.em_aberto))}
      ${k('Vencido', `<span class="${r.vencido > 0 ? 'text-danger' : ''}">${fmt.money(r.vencido)}</span>`)}${k('Maior atraso', r.maior_atraso + ' dias')}</div>
      <div class="card"><div class="card-body p-0">${tabelaSimples([
        { k: 'numero', l: 'Pedido' }, { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'empresa', l: 'Empresa' }, { k: 'forma', l: 'Forma' }, { k: 'condicao', l: 'Condição' },
        { k: 'vendedor', l: 'Vendedor' }, { k: 'nota', l: 'NF' }, { k: 'etapa', l: 'Etapa', t: 'etapa' }, { k: 'valor_total', l: 'Valor', t: 'money' },
      ], d.pedidos, { vazio: 'Sem compras.' })}</div></div>`;
  };
  pagina.querySelector('#f-hist').addEventListener('submit', (e) => { e.preventDefault(); buscar({ documento: e.target.documento.value }).catch(erro); });
  buscaCliente(pagina.querySelector('#h-busca'), (c) => buscar({ cliente_id: c.id }).catch(erro));
  const doc = new URLSearchParams(location.hash.split('?')[1] || '').get('doc');
  if (doc) { pagina.querySelector('[name=documento]').value = doc; buscar({ documento: doc }).catch(erro); }
}

// ---------- Blacklist ----------
async function blacklist(conteudo) {
  const editar = pode('blacklist.editar');
  const pagina = titulo(conteudo, 'Cliente (Blacklist)', 'bi-shield-x', editar ? '<button class="btn btn-danger btn-sm" id="btn-incluir"><i class="bi bi-plus-lg"></i> Incluir cliente</button>' : '');
  const t = new DataTable(pagina, {
    url: '/api/clientes/blacklist/lista', title: 'Blacklist', filtrosIniciais: { ativo: '1' }, sort: 'data_inclusao', dir: 'desc',
    columns: [
      { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'nome', l: 'Cliente' },
      { k: 'tipo', l: 'Tipo', filter: { options: [['alerta', 'Só alerta para o analista'], ['bloqueio', 'Bloqueio de pedidos']] }, render: (v) => badge(v) },
      { k: 'motivo', l: 'Motivo', cls: 'quebra' }, { k: 'data_inclusao', l: 'Inclusão', t: 'datetime' }, { k: 'usuario', l: 'Incluído por' },
      { k: 'ativo', l: 'Situação', filter: { options: [['1', 'Ativo'], ['0', 'Excluído']] }, render: (v) => (v ? '<span class="badge text-bg-danger">Ativo</span>' : '<span class="badge text-bg-secondary">Excluído</span>') },
      { k: 'data_exclusao', l: 'Exclusão', t: 'datetime' }, { k: 'usuario_exclusao', l: 'Excluído por' }, { k: 'motivo_exclusao', l: 'Motivo exclusão', cls: 'quebra' },
    ],
    actions: (r) => (editar && r.ativo ? btnAcao('excluir', 'bi-unlock', 'Excluir da blacklist', 'outline-success') : ''),
    onAction: {
      excluir: async (r) => {
        const motivo = await pedirTexto(`Motivo para excluir ${r.nome} da blacklist`, { titulo: 'Excluir da blacklist' });
        if (motivo && await tentar(() => post(`/api/clientes/blacklist/${r.id}/excluir`, { motivo }), 'Cliente excluído da blacklist.')) t.reload();
      },
    },
  });
  conteudo.querySelector('#btn-incluir')?.addEventListener('click', () => {
    let cid = null;
    const m = modal({
      title: 'Incluir cliente na blacklist', size: 'md',
      body: `<div class="mb-2"><label class="form-label">Cliente *</label><input class="form-control form-control-sm" id="bl-cli" autocomplete="off"></div>
        ${campo('tipo', 'Tipo de bloqueio', { type: 'select', col: 'mb-2', options: [['alerta', 'Só alerta para o analista'], ['bloqueio', 'Bloqueio de pedidos novos e em andamento']] })}
        ${campo('motivo', 'Motivo', { type: 'textarea', col: '', required: true })}`,
      buttons: [{
        label: 'Incluir', cls: 'btn-danger',
        onClick: async ({ body }) => {
          if (!cid) { toast('Selecione o cliente.', 'warning'); return false; }
          await post('/api/clientes/blacklist', { cliente_id: cid, tipo: body.querySelector('[name=tipo]').value, motivo: body.querySelector('[name=motivo]').value });
          toast('Cliente incluído na blacklist.');
          t.reload();
        },
      }],
    });
    buscaCliente(m.body.querySelector('#bl-cli'), (c) => { cid = c.id; });
  });
}

