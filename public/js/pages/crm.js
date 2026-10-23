// CRM: visão 360º do cliente, interações, funil de oportunidades, tarefas e clientes sem compra.
import {
  get, post, put, esc, fmt, titulo, abas, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, badge, ROTULOS,
  tabelaSimples, buscaCliente, pedirTexto, erro, qs, pode, humanizar,
} from '../core.js';
import { abrirCliente } from './clientes.js';
import { painelArquivos } from './arquivos.js';

const ESTAGIOS = ['prospeccao', 'qualificacao', 'proposta', 'negociacao', 'ganha', 'perdida'];
const TIPOS = ['ligacao', 'visita', 'whatsapp', 'email', 'reuniao', 'pos_venda', 'reclamacao'];

export default async function (conteudo, { modo, params }) {
  if (modo === 'cliente') return cliente360(conteudo, Number(params[0]));
  const pagina = titulo(conteudo, 'CRM', 'bi-diagram-3', `
    <button class="btn btn-sm btn-success" id="btn-int"><i class="bi bi-plus-lg"></i> Registrar interação</button>
    <button class="btn btn-sm btn-outline-success" id="btn-op"><i class="bi bi-plus-lg"></i> Oportunidade</button>`);
  pagina.innerHTML = abas([
    { id: 'funil', label: '<i class="bi bi-kanban"></i> Funil de oportunidades', html: '<div id="crm-funil"></div>' },
    { id: 'int', label: '<i class="bi bi-chat-square-text"></i> Interações', html: '<div id="crm-int"></div>' },
    { id: 'tar', label: '<i class="bi bi-check2-square"></i> Minhas tarefas', html: '<div id="crm-tar"></div>' },
    { id: 'clientes', label: '<i class="bi bi-people"></i> Clientes', html: '<div id="crm-cli"></div>' },
    { id: 'inativos', label: '<i class="bi bi-hourglass-bottom"></i> Sem compra (reativação)', html: '<div class="mb-2 d-flex gap-2 align-items-center small">Sem comprar há pelo menos <select class="form-select form-select-sm w-auto" id="dias-inat"><option>90</option><option selected>180</option><option>365</option></select> dias</div><div id="crm-inat"></div>' },
  ], 'crm');

  const funil = pagina.querySelector('#crm-funil');
  const carregarFunil = async () => {
    const d = await get('/api/crm/oportunidades?all=1');
    funil.innerHTML = `<div class="kanban">${ESTAGIOS.map((e) => {
      const ops = d.rows.filter((o) => o.estagio === e);
      const total = ops.reduce((a, o) => a + (o.valor_estimado || 0), 0);
      return `<div class="coluna" data-estagio="${e}"><h6 class="d-flex">${badge(e)}<span class="ms-auto small text-muted">${ops.length} · ${fmt.money(total)}</span></h6>
        ${ops.map((o) => `<div class="op" draggable="true" data-id="${o.id}"><div class="fw-semibold">${esc(o.titulo)}</div>
          <a href="#/crm/cliente/${o.cliente_id}" class="small">${esc(o.cliente)}</a>
          <div class="d-flex small text-muted"><span>${fmt.money(o.valor_estimado)}</span><span class="ms-auto">${fmt.date(o.previsao_fechamento)}</span></div>
          <div class="small text-muted">${esc(o.responsavel || '')}${o.safra ? ' · Safra ' + esc(o.safra) : ''}</div></div>`).join('')}</div>`;
    }).join('')}</div><div class="small text-muted mt-2">Arraste os cartões entre as colunas para mudar o estágio.</div>`;
    funil.querySelectorAll('.op').forEach((c) => c.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text', c.dataset.id)));
    funil.querySelectorAll('.coluna').forEach((col) => {
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('sobre'); });
      col.addEventListener('dragleave', () => col.classList.remove('sobre'));
      col.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        col.classList.remove('sobre');
        const id = ev.dataTransfer.getData('text');
        const estagio = col.dataset.estagio;
        const body = { estagio };
        if (estagio === 'perdida') {
          body.motivo_perda = await pedirTexto('Motivo da perda', { titulo: 'Oportunidade perdida' });
          if (!body.motivo_perda) return;
        }
        if (estagio === 'ganha') {
          const n = await pedirTexto('Nº do pedido gerado (opcional)', { titulo: 'Oportunidade ganha', obrigatorio: false });
          if (n) body.pedido_numero = Number(n);
        }
        if (await tentar(() => put(`/api/crm/oportunidades/${id}`, body), 'Estágio atualizado.')) carregarFunil();
      });
    });
  };
  carregarFunil().catch(erro);

  const tInt = new DataTable(pagina.querySelector('#crm-int'), {
    url: '/api/crm/interacoes', title: 'Interações CRM', sort: 'data', dir: 'desc',
    columns: [
      { k: 'data', l: 'Data', t: 'datetime' }, { k: 'cliente', l: 'Cliente', render: (v, r) => `<a href="#/crm/cliente/${r.cliente_id}">${esc(v)}</a>` },
      { k: 'tipo', l: 'Tipo', filter: { options: TIPOS.map((t) => [t, ROTULOS.tipo_acao[t]]) }, render: (v) => esc(ROTULOS.tipo_acao[v] || v) },
      { k: 'assunto', l: 'Assunto' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'pedido', l: 'Pedido' }, { k: 'usuario', l: 'Usuário' },
    ],
  });

  const tar = pagina.querySelector('#crm-tar');
  const carregarTarefas = async () => {
    const rows = await get('/api/crm/tarefas');
    const hoje = new Date().toISOString().slice(0, 10);
    tar.innerHTML = `<form class="row g-2 mb-3" id="f-tarefa"><div class="col-md-6"><input class="form-control form-control-sm" name="titulo" placeholder="Nova tarefa" required></div>
      <div class="col-md-3"><input type="date" class="form-control form-control-sm" name="vencimento"></div><div class="col-md-3"><button class="btn btn-sm btn-success w-100">Adicionar</button></div></form>
      ${rows.length ? `<ul class="list-group">${rows.map((t) => `<li class="list-group-item d-flex align-items-center gap-2 small ${t.concluida ? 'text-decoration-line-through text-muted' : ''}">
        <input type="checkbox" class="form-check-input" data-t="${t.id}" ${t.concluida ? 'checked' : ''}>
        <div class="flex-grow-1">${esc(t.titulo)} ${t.cliente ? `· <a href="#/crm/cliente/${t.cliente_id}">${esc(t.cliente)}</a>` : ''}</div>
        <span class="${!t.concluida && t.vencimento && t.vencimento < hoje ? 'text-danger fw-semibold' : ''}">${fmt.date(t.vencimento)}</span></li>`).join('')}</ul>` : '<div class="vazio">Nenhuma tarefa.</div>'}`;
    tar.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', async () => { await tentar(() => put(`/api/crm/tarefas/${c.dataset.t}`, { concluida: c.checked ? 1 : 0 })); carregarTarefas(); }));
    tar.querySelector('#f-tarefa').addEventListener('submit', async (e) => { e.preventDefault(); if (await tentar(() => post('/api/crm/tarefas', lerForm(e.target)), 'Tarefa criada.')) carregarTarefas(); });
  };
  carregarTarefas().catch(erro);

  new DataTable(pagina.querySelector('#crm-cli'), {
    url: '/api/clientes', title: 'Clientes CRM', sort: 'nome', dir: 'asc',
    columns: [{ k: 'nome', l: 'Cliente' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'cidade', l: 'Cidade/UF' }, { k: 'telefone', l: 'Telefone' }, { k: 'vendedor', l: 'Vendedor' }, { k: 'blacklist', l: 'Blacklist', render: (v) => badge(v) }],
    rowClick: (r) => { location.hash = `#/crm/cliente/${r.id}`; },
  });
  const tInat = new DataTable(pagina.querySelector('#crm-inat'), {
    url: () => '/api/crm/inativos' + qs({ dias: pagina.querySelector('#dias-inat').value }), title: 'Clientes sem compra', sort: 'total_historico', dir: 'desc',
    columns: [{ k: 'cliente', l: 'Cliente' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'vendedor', l: 'Vendedor' }, { k: 'ultima_compra', l: 'Última compra', t: 'date' },
      { k: 'dias_sem_compra', l: 'Dias sem compra', t: 'num' }, { k: 'pedidos', l: 'Pedidos', t: 'num' }, { k: 'total_historico', l: 'Total histórico', t: 'money' }],
    rowClick: (r) => { location.hash = `#/crm/cliente/${r.id}`; },
  });
  pagina.querySelector('#dias-inat').addEventListener('change', () => tInat.reload());

  conteudo.querySelector('#btn-int').addEventListener('click', () => novaInteracao(null, () => tInt.reload()));
  conteudo.querySelector('#btn-op').addEventListener('click', () => novaOportunidade(null, carregarFunil));
}

function seletorCliente(clienteId) {
  return clienteId ? '' : '<div class="col-12"><label class="form-label">Cliente *</label><input class="form-control form-control-sm" data-cli autocomplete="off"></div>';
}

export function novaInteracao(clienteId, aoSalvar) {
  let cid = clienteId;
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const m = modal({
    title: 'Registrar interação', size: 'lg',
    body: `<form class="row g-2">${seletorCliente(clienteId)}
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-4', options: TIPOS.map((t) => [t, ROTULOS.tipo_acao[t]]) })}
      ${campo('data', 'Data/hora', { type: 'datetime-local', col: 'col-md-4', value: agora })}
      ${campo('pedido_numero', 'Pedido (opcional)', { type: 'number', col: 'col-md-4' })}
      ${campo('assunto', 'Assunto', { col: 'col-12', required: true })}
      ${campo('descricao', 'Descrição', { type: 'textarea', col: 'col-12' })}
      ${campo('proxima_tarefa', 'Próximo passo (cria tarefa)', { col: 'col-md-8' })}
      ${campo('proxima_data', 'Para quando', { type: 'date', col: 'col-md-4' })}</form>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      if (!cid) { toast('Selecione o cliente.', 'warning'); return false; }
      await post('/api/crm/interacoes', { ...lerForm(body.querySelector('form')), cliente_id: cid });
      toast('Interação registrada.');
      aoSalvar?.();
    } }],
  });
  const inp = m.body.querySelector('[data-cli]');
  if (inp) buscaCliente(inp, (c) => { cid = c.id; });
}

export function novaOportunidade(clienteId, aoSalvar) {
  let cid = clienteId;
  const m = modal({
    title: 'Nova oportunidade', size: 'lg',
    body: `<form class="row g-2">${seletorCliente(clienteId)}
      ${campo('titulo', 'Título', { col: 'col-md-8', required: true })}
      ${campo('safra', 'Safra', { col: 'col-md-4', value: '26/27' })}
      ${campo('valor_estimado', 'Valor estimado', { type: 'number', col: 'col-md-4', attrs: 'step="0.01"' })}
      ${campo('estagio', 'Estágio', { type: 'select', col: 'col-md-4', options: ESTAGIOS.slice(0, 4).map((e) => [e, ROTULOS.status[e][0]]) })}
      ${campo('previsao_fechamento', 'Previsão de fechamento', { type: 'date', col: 'col-md-4' })}
      ${state.me.usuario.perfil !== 'vendedor' ? campo('responsavel_id', 'Responsável', { type: 'select', col: 'col-md-6', options: opcoes(state.opcoes.usuarios, 'Eu mesmo') }) : ''}</form>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      if (!cid) { toast('Selecione o cliente.', 'warning'); return false; }
      await post('/api/crm/oportunidades', { ...lerForm(body.querySelector('form')), cliente_id: cid });
      toast('Oportunidade criada.');
      aoSalvar?.();
    } }],
  });
  const inp = m.body.querySelector('[data-cli]');
  if (inp) buscaCliente(inp, (c) => { cid = c.id; });
}

const ROTULO_ORIGEM = { interacao: 'Interações', pedido: 'Pedidos', nota: 'Notas', pagamento: 'Pagamentos', cobranca: 'Cobrança', serasa: 'Serasa', blacklist: 'Blacklist', arquivo: 'Arquivos' };
const ICONE_ORIGEM = { interacao: 'bi-chat-square-text', pedido: 'bi-cart', nota: 'bi-receipt', pagamento: 'bi-cash-coin', cobranca: 'bi-telephone-outbound', serasa: 'bi-shield-check', blacklist: 'bi-shield-x', arquivo: 'bi-paperclip' };

async function cliente360(conteudo, id) {
  const d = await get(`/api/crm/cliente/${id}`);
  const c = d.cliente;
  const pagina = titulo(conteudo, `${esc(c.nome)} <small class="text-muted fs-6">${fmt.doc(c.documento)}</small>`, 'bi-person-vcard', `
    <button class="btn btn-sm btn-success" data-a="int"><i class="bi bi-plus-lg"></i> Interação</button>
    <button class="btn btn-sm btn-outline-success" data-a="op"><i class="bi bi-plus-lg"></i> Oportunidade</button>
    <button class="btn btn-sm btn-outline-secondary" data-a="cad"><i class="bi bi-pencil"></i> Cadastro</button>
    ${pode('pedido.criar') ? '<a class="btn btn-sm btn-outline-primary" href="#/pedido/novo"><i class="bi bi-cart-plus"></i> Novo pedido</a>' : ''}
    <a class="btn btn-sm btn-outline-secondary" href="#/crm"><i class="bi bi-arrow-left"></i></a>`);
  const k = d.kpi;
  const kpi = (l, v, cor = '') => `<div class="col-6 col-md-4 col-xl-2"><div class="card kpi h-100 ${cor}"><div class="card-body py-2"><div class="small text-muted">${l}</div><div class="valor fs-6">${v}</div></div></div></div>`;
  const filtros = Object.keys(ICONE_ORIGEM).map((o) => `<input type="checkbox" class="btn-check" id="tl-${o}" data-o="${o}" checked><label class="btn btn-sm btn-outline-secondary py-0" for="tl-${o}"><i class="bi ${ICONE_ORIGEM[o]}"></i> ${ROTULO_ORIGEM[o]}</label>`).join(' ');
  pagina.innerHTML = `
    ${d.blacklist.bloqueio ? `<div class="alert alert-danger py-2"><i class="bi bi-shield-x"></i> Bloqueado: ${esc(d.blacklist.bloqueio.motivo)}</div>` : ''}
    ${d.blacklist.alertas.map((a) => `<div class="alert alert-warning py-2"><i class="bi bi-shield-exclamation"></i> ${esc(a.motivo)}</div>`).join('')}
    <div class="row g-2 mb-3">${kpi('Pedidos', k.pedidos)}${kpi('Total comprado', fmt.money(k.total))}${kpi('Ticket médio', fmt.money(k.ticket_medio))}
      ${kpi('Última compra', fmt.date(k.ultima_compra) || '-')}${kpi('Em aberto', fmt.money(k.em_aberto))}${kpi('Vencido', fmt.money(k.vencido), k.vencido > 0 ? 'cor-danger' : 'cor-success')}</div>
    <div class="row g-3">
      <div class="col-lg-4">
        <div class="card mb-3"><div class="card-header py-2">Contato</div><div class="card-body small">
          ${d.telefones.map((t) => `<div><i class="bi bi-telephone"></i> ${esc(t.numero)} ${t.contato ? '(' + esc(t.contato) + ')' : ''} ${t.whatsapp ? `<a target="_blank" rel="noopener" href="https://wa.me/55${t.numero.replace(/\D/g, '')}"><i class="bi bi-whatsapp text-success"></i></a>` : ''}</div>`).join('')}
          ${c.email ? `<div><i class="bi bi-envelope"></i> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
          ${d.enderecos.map((e) => `<div class="mt-1"><i class="bi bi-geo-alt"></i> ${esc(e.logradouro || '')}, ${esc(e.numero || '')} - ${esc(e.cidade || '')}/${esc(e.uf || '')}</div>`).join('')}
        </div></div>
        <div class="card mb-3"><div class="card-header py-2">Áreas de cultivo</div><div class="card-body p-0">${tabelaSimples([{ k: 'tipo_cultivo', l: 'Cultura' }, { k: 'area', l: 'Área', t: 'num' }, { k: 'medida', l: 'Medida' }, { k: 'qtd_pes', l: 'Pés', t: 'num' }], d.areas, { vazio: 'Não informado.' })}</div></div>
        <div class="card mb-3"><div class="card-header py-2">Produtos mais comprados</div><div class="card-body p-0">${tabelaSimples([{ k: 'nome', l: 'Produto' }, { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'valor', l: 'Valor', t: 'money' }], d.produtos, { vazio: 'Sem compras.' })}</div></div>
        <div class="card mb-3"><div class="card-header py-2">Oportunidades</div><div class="card-body p-0">${tabelaSimples([{ k: 'titulo', l: 'Título' }, { k: 'estagio', l: 'Estágio', t: 'status' }, { k: 'valor_estimado', l: 'Valor', t: 'money' }], d.oportunidades, { vazio: 'Nenhuma.' })}</div></div>
        <div class="card"><div class="card-header py-2">Tarefas</div><div class="card-body p-0">${tabelaSimples([{ k: 'titulo', l: 'Tarefa' }, { k: 'vencimento', l: 'Vencimento', t: 'date' }, { k: 'concluida', l: 'Feita', t: 'bool' }], d.tarefas, { vazio: 'Nenhuma.' })}</div></div>
      </div>
      <div class="col-lg-8">
        <div class="card mb-3"><div class="card-header py-2 d-flex flex-wrap gap-1 align-items-center">Histórico de relacionamento <span class="ms-auto">${filtros}</span></div>
          <div class="card-body"><ul class="timeline" id="tl"></ul></div></div>
        <div class="card"><div class="card-header py-2">Arquivos e documentos</div><div class="card-body" id="arq"></div></div>
      </div>
    </div>`;
  const tl = pagina.querySelector('#tl');
  const desenharTl = () => {
    const ativos = [...pagina.querySelectorAll('[data-o]:checked')].map((x) => x.dataset.o);
    const itens = d.timeline.filter((t) => ativos.includes(t.origem));
    tl.innerHTML = itens.map((t) => `<li class="t-${t.origem}"><div class="small text-muted"><i class="bi ${ICONE_ORIGEM[t.origem]}"></i> ${fmt.datetime(t.quando)} ${t.usuario ? '· ' + esc(t.usuario) : ''}
      ${t.origem === 'interacao' ? '· ' + esc(ROTULOS.tipo_acao[t.tipo] || t.tipo) : ''}</div><div class="fw-semibold">${esc(humanizar(t.titulo))}</div>${t.descricao ? `<div class="small">${esc(t.descricao)}</div>` : ''}</li>`).join('') || '<div class="vazio">Sem registros.</div>';
  };
  pagina.querySelectorAll('[data-o]').forEach((x) => x.addEventListener('change', desenharTl));
  desenharTl();
  painelArquivos(pagina.querySelector('#arq'), { cliente_id: id });
  const recarregar = () => cliente360(conteudo, id);
  conteudo.querySelector('[data-a=int]').addEventListener('click', () => novaInteracao(id, recarregar));
  conteudo.querySelector('[data-a=op]').addEventListener('click', () => novaOportunidade(id, recarregar));
  conteudo.querySelector('[data-a=cad]').addEventListener('click', () => abrirCliente(id, recarregar));
}

