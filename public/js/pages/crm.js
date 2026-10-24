// CRM: visão 360º do cliente, interações, funil de oportunidades, tarefas e clientes sem compra.
import {
  get, post, put, esc, fmt, titulo, abas, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, badge, ROTULOS,
  tabelaSimples, buscaCliente, pedirTexto, erro, qs, pode, humanizar, del, confirmar,
} from '../core.js';
import { abrirCliente } from './clientes.js';
import { painelArquivos } from './arquivos.js';

const ESTAGIOS = ['prospeccao', 'qualificacao', 'proposta', 'negociacao', 'ganha', 'perdida'];
const TIPOS = ['ligacao', 'visita', 'whatsapp', 'email', 'reuniao', 'pos_venda', 'reclamacao'];

// Safra agrícola começa em julho: de jul/2026 a jun/2027 é a safra 26/27.
const SAFRA_ATUAL = () => { const d = new Date(); const a = d.getFullYear() % 100 - (d.getMonth() < 6 ? 1 : 0); return `${a}/${a + 1}`; };
const SAFRAS = () => { const [a] = SAFRA_ATUAL().split('/').map(Number); return [-2, -1, 0, 1, 2].map((k) => `${a + k}/${a + k + 1}`).map((x) => [x, x]); };

export default async function (conteudo, { modo, params }) {
  if (modo === 'cliente') return cliente360(conteudo, Number(params[0]));
  const pagina = titulo(conteudo, 'CRM', 'bi-diagram-3', `
    <button class="btn btn-sm btn-success" id="btn-int"><i class="bi bi-plus-lg"></i> Registrar interação</button>
    <button class="btn btn-sm btn-outline-success" id="btn-op"><i class="bi bi-plus-lg"></i> Oportunidade</button>`);
  pagina.innerHTML = abas([
    { id: 'funil', label: '<i class="bi bi-kanban"></i> Funil de oportunidades', html: '<div id="crm-funil"></div>' },
    { id: 'int', label: '<i class="bi bi-chat-square-text"></i> Interações', html: '<div id="crm-int"></div>' },
    { id: 'tar', label: '<i class="bi bi-check2-square"></i> Tarefas', html: '<div id="crm-tar"></div>' },
    { id: 'clientes', label: '<i class="bi bi-people"></i> Clientes', html: '<div id="crm-cli"></div>' },
    { id: 'inativos', label: '<i class="bi bi-hourglass-bottom"></i> Sem compra (reativação)', html: '<div class="mb-2 d-flex gap-2 align-items-center small">Sem comprar há pelo menos <select class="form-select form-select-sm w-auto" id="dias-inat"><option>90</option><option selected>180</option><option>365</option></select> dias</div><div id="crm-inat"></div>' },
    { id: 'safra', label: '<i class="bi bi-calendar3"></i> Calendário da safra', html: '<div id="crm-safra"></div>' },
    ...(pode('crm.automacoes') ? [{ id: 'aut', label: '<i class="bi bi-robot"></i> Automações', html: '<div id="crm-aut"></div>' }] : []),
  ], 'crm');
  const abrir = { tarefas: 'tar', automacoes: 'aut', safra: 'safra' }[params?.[0]];
  if (abrir) pagina.querySelector(`[data-bs-target$="-${abrir}"]`)?.click();

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

  tarefas(pagina.querySelector('#crm-tar'));
  // O calendário só carrega quando a aba é aberta.
  const abaSafra = pagina.querySelector('[data-bs-target$="-safra"]');
  let safraPronta = false;
  const abrirSafra = () => { if (!safraPronta) { safraPronta = true; safra(pagina.querySelector('#crm-safra')); } };
  abaSafra?.addEventListener('shown.bs.tab', abrirSafra);
  if (params?.[0] === 'safra') abrirSafra();
  if (pode('crm.automacoes')) automacoes(pagina.querySelector('#crm-aut'));

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
      ${campo('safra', 'Safra', { type: 'select', col: 'col-md-4', options: SAFRAS(), value: SAFRA_ATUAL() })}
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
        ${pode('clientes.editar') ? '<div class="card mb-3"><div class="card-header py-2"><i class="bi bi-door-open"></i> Portal do cliente</div><div class="card-body small" id="portal"></div></div>' : ''}
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
  if (pagina.querySelector('#portal')) portalAcesso(pagina.querySelector('#portal'), id, d.telefones.find((t) => t.whatsapp)?.numero);
  const recarregar = () => cliente360(conteudo, id);
  conteudo.querySelector('[data-a=int]').addEventListener('click', () => novaInteracao(id, recarregar));
  conteudo.querySelector('[data-a=op]').addEventListener('click', () => novaOportunidade(id, recarregar));
  conteudo.querySelector('[data-a=cad]').addEventListener('click', () => abrirCliente(id, recarregar));
}


/** Acesso do cliente ao portal: situação, link de primeiro acesso / nova senha e desativação. */
async function portalAcesso(el, clienteId, whatsapp) {
  const a = await get(`/api/portal-acesso/${clienteId}`);
  const ativo = a.ativo && !a.sem_acesso;
  el.innerHTML = `<div class="mb-2">${!ativo ? '<span class="badge text-bg-secondary">Sem acesso</span>'
      : a.tem_senha ? '<span class="badge text-bg-success">Ativo</span>' : '<span class="badge text-bg-warning">Convite enviado</span>'}
      ${a.ultimo_acesso ? ` · último acesso ${fmt.datetime(a.ultimo_acesso)}` : ''}${a.pedidos_portal ? ` · ${a.pedidos_portal} pedido(s) pelo portal` : ''}
      ${ativo && !a.tem_senha && a.convite_expira ? `<div class="text-muted">Link vale até ${fmt.datetime(a.convite_expira)}</div>` : ''}</div>
    <p class="text-muted mb-2">O cliente acompanha pedidos, entregas, boletos e notas, e faz pedido pela tabela da região (cai na fila do vendedor).</p>
    <div class="d-flex flex-wrap gap-1"><button class="btn btn-sm btn-outline-success" data-convite><i class="bi bi-link-45deg"></i> ${a.tem_senha ? 'Link para nova senha' : 'Gerar link de acesso'}</button>
      ${ativo ? '<button class="btn btn-sm btn-outline-danger" data-desativar><i class="bi bi-slash-circle"></i> Desativar</button>' : ''}</div><div data-link class="mt-2"></div>`;
  el.querySelector('[data-convite]').addEventListener('click', async () => {
    const r = await tentar(() => post(`/api/portal-acesso/${clienteId}/convite`, {}));
    if (!r) return;
    const msg = `Olá! Este é o seu acesso ao Portal do Cliente Agroterra, para acompanhar pedidos, entregas e boletos. Crie sua senha pelo link (vale 7 dias): ${r.link}`;
    el.querySelector('[data-link]').innerHTML = `<div class="input-group input-group-sm"><input class="form-control" readonly value="${esc(r.link)}" aria-label="Link de acesso">
      <button class="btn btn-outline-secondary" data-copiar title="Copiar"><i class="bi bi-clipboard"></i></button>
      ${whatsapp ? `<a class="btn btn-outline-success" target="_blank" rel="noopener" title="Enviar por WhatsApp" href="https://wa.me/55${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}"><i class="bi bi-whatsapp"></i></a>` : ''}</div>
      <div class="form-text">O link anterior deixa de valer. Login: CPF/CNPJ do cliente.</div>`;
    el.querySelector('[data-copiar]').addEventListener('click', () => navigator.clipboard?.writeText(r.link).then(() => toast('Link copiado.')));
  });
  el.querySelector('[data-desativar]')?.addEventListener('click', async () => {
    if (await confirmar('Desativar o acesso deste cliente ao portal? Ele é desconectado na hora.', { ok: 'Desativar', cls: 'btn-danger' })
      && await tentar(() => post(`/api/portal-acesso/${clienteId}/desativar`, {}), 'Acesso desativado.')) portalAcesso(el, clienteId, whatsapp);
  });
}

// ---------- Tarefas (manuais e automáticas) ----------
const PRIORIDADE = { alta: ['Alta', 'danger'], normal: ['Normal', 'secondary'], baixa: ['Baixa', 'light'] };
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

function tarefas(el) {
  const equipe = state.me.usuario.perfil !== 'vendedor';
  let ver = 'abertas';
  let daEquipe = false;
  el.innerHTML = `<form class="row g-2 mb-3" data-nova>
      <div class="col-md-5"><input class="form-control form-control-sm" name="titulo" placeholder="Nova tarefa" required></div>
      <div class="col-md-3"><input class="form-control form-control-sm" data-cli placeholder="Cliente (opcional)" autocomplete="off"></div>
      <div class="col-md-2"><input type="date" class="form-control form-control-sm" name="vencimento" value="${hojeIso()}"></div>
      <div class="col-md-2"><button class="btn btn-sm btn-success w-100"><i class="bi bi-plus-lg"></i> Adicionar</button></div></form>
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <div class="painel-periodos" role="group" aria-label="Mostrar">
        <button type="button" class="ativo" data-ver="abertas">Abertas</button><button type="button" data-ver="hoje">Para hoje</button>
        <button type="button" data-ver="auto">Automáticas</button><button type="button" data-ver="feitas">Concluídas</button></div>
      ${equipe ? '<div class="form-check form-switch small mb-0"><input class="form-check-input" type="checkbox" id="tar-equipe" data-equipe><label class="form-check-label" for="tar-equipe">Da equipe</label></div>' : ''}
      <span class="ms-auto small text-muted" data-total></span></div>
    <div data-lista></div>`;
  let cliente = null;
  buscaCliente(el.querySelector('[data-cli]'), (c) => { cliente = c.id; });
  const lista = el.querySelector('[data-lista]');
  const carregar = async () => {
    const rows = await get('/api/crm/tarefas' + (daEquipe ? '?todas=1' : ''));
    const hoje = hojeIso();
    const filtradas = rows.filter((t) => ({
      abertas: !t.concluida, hoje: !t.concluida && (!t.vencimento || t.vencimento <= hoje), auto: !t.concluida && t.automacao_id, feitas: !!t.concluida,
    })[ver]);
    el.querySelector('[data-total]').textContent = `${filtradas.length} tarefa(s)`;
    const vinculo = (t) => [
      t.cliente ? `<a href="#/crm/cliente/${t.cliente_id}">${esc(t.cliente)}</a>` : '',
      t.pedido ? `<a href="#" data-pedido="${t.pedido_id}">Pedido ${t.pedido}</a>` : '',
      t.oportunidade ? `<span><i class="bi bi-kanban"></i> ${esc(t.oportunidade)}</span>` : '',
      t.proposta ? `<a href="#" data-proposta="${t.proposta_id}">Proposta ${t.proposta}</a>` : '',
    ].filter(Boolean).join(' · ');
    lista.innerHTML = filtradas.length ? `<ul class="list-group tarefas">${filtradas.map((t) => {
      const atrasada = !t.concluida && t.vencimento && t.vencimento < hoje;
      const [pl, pc] = PRIORIDADE[t.prioridade] || PRIORIDADE.normal;
      return `<li class="list-group-item d-flex gap-2 align-items-start ${t.concluida ? 'text-muted' : ''}">
        <input type="checkbox" class="form-check-input mt-1" data-t="${t.id}" ${t.concluida ? 'checked' : ''} aria-label="Concluir">
        <div class="flex-grow-1 min-w-0"><div class="${t.concluida ? 'text-decoration-line-through' : 'fw-semibold'}">${esc(t.titulo)}</div>
          ${t.descricao ? `<div class="small">${esc(t.descricao)}</div>` : ''}
          <div class="small text-muted d-flex flex-wrap gap-2">${vinculo(t)}
            ${t.automacao ? `<span class="badge text-bg-info-subtle text-info-emphasis" title="Criada pela automação"><i class="bi bi-robot"></i> ${esc(t.automacao)}</span>` : ''}
            ${daEquipe ? `<span><i class="bi bi-person"></i> ${esc(t.responsavel || '')}</span>` : ''}</div></div>
        <div class="text-end small text-nowrap">${t.prioridade !== 'normal' ? `<span class="badge text-bg-${pc}">${pl}</span><br>` : ''}
          <span class="${atrasada ? 'text-danger fw-semibold' : ''}">${t.vencimento ? fmt.date(t.vencimento) : 'Sem data'}</span>
          ${t.concluida ? '' : `<br><button class="btn btn-link btn-sm p-0" data-adiar="${t.id}">Reagendar</button>`}</div></li>`;
    }).join('')}</ul>` : '<div class="vazio"><i class="bi bi-check2-all"></i>Nenhuma tarefa aqui.</div>';
    lista.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', () => {
      const t = rows.find((x) => x.id === Number(c.dataset.t));
      if (!c.checked) return tentar(() => put(`/api/crm/tarefas/${t.id}`, { concluida: 0 })).then(carregar);
      concluir(t, carregar, () => { c.checked = false; });
    }));
    lista.querySelectorAll('[data-pedido]').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      (await import('./pedido-detalhe.js')).abrirPedido(Number(a.dataset.pedido));
    }));
    lista.querySelectorAll('[data-proposta]').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      (await import('./propostas.js')).abrirProposta(Number(a.dataset.proposta));
    }));
    lista.querySelectorAll('[data-adiar]').forEach((b) => b.addEventListener('click', () => {
      const t = rows.find((x) => x.id === Number(b.dataset.adiar));
      modal({
        title: 'Reagendar tarefa', size: 'md',
        body: `<form class="row g-2">${campo('vencimento', 'Nova data', { type: 'date', col: 'col-md-6', value: t.vencimento || hojeIso(), required: true })}
          ${campo('prioridade', 'Prioridade', { type: 'select', col: 'col-md-6', value: t.prioridade, options: Object.entries(PRIORIDADE).map(([k, [l]]) => [k, l]) })}</form>`,
        buttons: [{ label: 'Salvar', onClick: async ({ body }) => { await put(`/api/crm/tarefas/${t.id}`, lerForm(body.querySelector('form'))); toast('Tarefa reagendada.'); carregar(); } }],
      });
    }));
  };
  el.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    ver = b.dataset.ver;
    el.querySelectorAll('[data-ver]').forEach((x) => x.classList.toggle('ativo', x === b));
    carregar().catch(erro);
  }));
  el.querySelector('[data-equipe]')?.addEventListener('change', (e) => { daEquipe = e.target.checked; carregar().catch(erro); });
  el.querySelector('[data-nova]').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await tentar(() => post('/api/crm/tarefas', { ...lerForm(e.target), cliente_id: cliente }), 'Tarefa criada.')) {
      e.target.reset();
      e.target.querySelector('[name=vencimento]').value = hojeIso();
      cliente = null;
      carregar();
    }
  });
  carregar().catch(erro);
}

/** Concluir a tarefa; com cliente, já registra a interação (aparece na linha do tempo do CRM). */
function concluir(t, aoSalvar, aoCancelar) {
  let salvo = false;
  modal({
    title: 'Concluir tarefa', size: 'md',
    body: `<p class="fw-semibold mb-2">${esc(t.titulo)}</p>${t.cliente_id ? `<form class="row g-2">
      <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="reg-int" checked><label class="form-check-label" for="reg-int">Registrar a interação com ${esc(t.cliente)}</label></div></div>
      ${campo('tipo', 'Como foi o contato', { type: 'select', col: 'col-md-5', options: TIPOS.map((x) => [x, ROTULOS.tipo_acao[x]]) })}
      ${campo('descricao', 'Resultado', { type: 'textarea', col: 'col-12' })}</form>` : '<p class="small text-muted mb-0">Marcar como concluída?</p>'}`,
    onClose: () => { if (!salvo) aoCancelar?.(); },
    buttons: [{ label: 'Concluir', onClick: async ({ body }) => {
      const f = body.querySelector('form');
      const comInt = f && body.querySelector('#reg-int').checked;
      await put(`/api/crm/tarefas/${t.id}`, { concluida: 1, ...(comInt ? { interacao: lerForm(f) } : {}) });
      salvo = true;
      toast(comInt ? 'Tarefa concluída e interação registrada.' : 'Tarefa concluída.');
      aoSalvar?.();
    } }],
  });
}

// ---------- Automações (regras que criam tarefas sozinhas) ----------
const RESP = { vendedor: 'Vendedor do cliente / responsável da oportunidade', supervisor: 'Supervisor da equipe do vendedor', usuario: 'Um usuário fixo' };

async function automacoes(el) {
  const carregar = async () => {
    const { regras, gatilhos } = await get('/api/crm/automacoes');
    const g = Object.fromEntries(gatilhos.map((x) => [x.id, x]));
    el.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div class="small text-muted flex-grow-1">As regras rodam todo dia de manhã e criam as tarefas para o responsável. A mesma situação nunca gera tarefa repetida.</div>
        <button class="btn btn-sm btn-outline-secondary" data-todas><i class="bi bi-play"></i> Executar agora</button>
        <button class="btn btn-sm btn-success" data-nova><i class="bi bi-plus-lg"></i> Nova automação</button></div>
      <div class="row g-3">${regras.map((r) => `<div class="col-md-6 col-xl-4"><div class="card h-100 automacao ${r.ativa ? '' : 'inativa'}"><div class="card-body d-flex flex-column gap-2">
        <div class="d-flex align-items-start gap-2"><div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(r.nome)}</div>
          <div class="small text-muted">${g[r.gatilho] && g[r.gatilho].nome !== r.nome ? `${esc(g[r.gatilho].nome)} · ` : ''}${esc(g[r.gatilho]?.rotuloDias || 'Dias')}: <b>${r.dias}</b></div></div>
          <div class="form-check form-switch m-0" title="${r.ativa ? 'Ligada' : 'Desligada'}"><input class="form-check-input" type="checkbox" role="switch" data-ativa="${r.id}" ${r.ativa ? 'checked' : ''} aria-label="Ligar ou desligar ${esc(r.nome)}"></div></div>
        <div class="small border rounded px-2 py-1 bg-body-tertiary"><i class="bi bi-check2-square"></i> ${esc(r.titulo)}</div>
        <div class="small text-muted">Para: ${esc(r.responsavel === 'usuario' ? r.responsavel_nome || '—' : RESP[r.responsavel])} · prazo ${r.prazo_dias ? `${r.prazo_dias} dia(s)` : 'no mesmo dia'}
          ${r.equipe ? ` · equipe ${esc(r.equipe)}` : ''}${r.valor_minimo ? ` · a partir de ${fmt.money(r.valor_minimo)}` : ''}</div>
        <div class="d-flex gap-3 small mt-auto"><span><b>${r.total_geradas}</b> geradas</span><span><b>${r.abertas}</b> abertas</span><span><b>${r.concluidas}</b> concluídas</span>
          <span class="ms-auto text-muted" title="Última execução">${r.ultima_execucao ? fmt.datetime(r.ultima_execucao) : 'nunca rodou'}</span></div>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-outline-secondary" data-editar="${r.id}"><i class="bi bi-pencil"></i> Editar</button>
          <button class="btn btn-sm btn-outline-secondary" data-simular="${r.id}"><i class="bi bi-eye"></i> Simular</button>
          <button class="btn btn-sm btn-outline-success" data-rodar="${r.id}"><i class="bi bi-play"></i> Executar</button>
          <button class="btn btn-sm btn-outline-danger ms-auto" data-excluir="${r.id}" title="Excluir"><i class="bi bi-trash"></i></button></div>
      </div></div></div>`).join('')}</div>`;
    const regra = (id) => regras.find((r) => r.id === Number(id));
    el.querySelector('[data-nova]').addEventListener('click', () => editar(null, gatilhos, carregar));
    el.querySelector('[data-todas]').addEventListener('click', async () => {
      const r = await tentar(() => post('/api/crm/automacoes/executar', {}));
      if (r) { toast(`${r.reduce((a, x) => a + x.geradas, 0)} tarefa(s) criada(s).`); carregar(); }
    });
    el.querySelectorAll('[data-ativa]').forEach((c) => c.addEventListener('change', async () => {
      if (await tentar(() => put(`/api/crm/automacoes/${c.dataset.ativa}`, { ativa: c.checked ? 1 : 0 }), c.checked ? 'Automação ligada.' : 'Automação desligada.')) carregar();
      else c.checked = !c.checked;
    }));
    el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editar(regra(b.dataset.editar), gatilhos, carregar)));
    el.querySelectorAll('[data-simular]').forEach((b) => b.addEventListener('click', async () => {
      const r = await tentar(() => post(`/api/crm/automacoes/${b.dataset.simular}/simular`));
      if (!r) return;
      const reg = regra(b.dataset.simular);
      modal({
        title: `Simulação · ${esc(reg.nome)}`, size: 'lg',
        body: `<p>Hoje esta regra encontraria <b>${r.encontrados}</b> situação(ões) nova(s)${r.pendentes ? ` — ${Math.min(r.encontrados, reg.limite)} entram nesta execução (limite ${reg.limite}) e o restante nas próximas` : ''}.</p>
          ${r.exemplos.length ? `<h6>Exemplos de tarefas</h6><ul class="small">${r.exemplos.map((x) => `<li>${esc(x.titulo)}${x.responsavel_id ? ` → ${esc(state.opcoes.usuarios.find((u) => u.id === x.responsavel_id)?.nome || '')}` : ' <span class="text-danger">(sem responsável)</span>'}</li>`).join('')}</ul>` : ''}`,
      });
    }));
    el.querySelectorAll('[data-rodar]').forEach((b) => b.addEventListener('click', async () => {
      const r = await tentar(() => post('/api/crm/automacoes/executar', { id: Number(b.dataset.rodar) }));
      if (r) { toast(`${r[0].geradas} tarefa(s) criada(s).`); carregar(); }
    }));
    el.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar(`Excluir a automação "${esc(regra(b.dataset.excluir).nome)}"? As tarefas já criadas continuam.`, { ok: 'Excluir', cls: 'btn-danger' }))) return;
      if (await tentar(() => del(`/api/crm/automacoes/${b.dataset.excluir}`), 'Automação excluída.')) carregar();
    }));
  };
  await carregar().catch(erro);
}

function editar(r, gatilhos, aoSalvar) {
  const o = state.opcoes;
  const g0 = gatilhos.find((g) => g.id === (r?.gatilho || gatilhos[0].id));
  const v = r || { gatilho: g0.id, nome: g0.nome, dias: g0.dias, titulo: g0.titulo, prazo_dias: g0.prazo, prioridade: 'normal', responsavel: 'vendedor', limite: 50, ativa: 1 };
  const m = modal({
    title: r ? 'Editar automação' : 'Nova automação', size: 'lg',
    body: `<form class="row g-2">
      ${campo('gatilho', 'Quando criar a tarefa', { type: 'select', col: 'col-md-6', value: v.gatilho, options: gatilhos.map((g) => [g.id, g.nome]) })}
      ${campo('nome', 'Nome da automação', { col: 'col-md-6', value: v.nome, required: true })}
      <div class="col-12 small text-muted" data-ajuda></div>
      <div class="col-md-4"><label class="form-label" data-rot-dias>Dias</label><input type="number" class="form-control form-control-sm" name="dias" min="0" max="730" step="1" value="${v.dias}" required></div>
      ${campo('prazo_dias', 'Prazo da tarefa (dias)', { type: 'number', col: 'col-md-4', value: v.prazo_dias, attrs: 'min="0" max="90" step="1"', help: '0 = vence no mesmo dia' })}
      ${campo('prioridade', 'Prioridade', { type: 'select', col: 'col-md-4', value: v.prioridade, options: Object.entries(PRIORIDADE).map(([k, [l]]) => [k, l]) })}
      <div class="col-12"><label class="form-label">Título da tarefa</label><input class="form-control form-control-sm" name="titulo" value="${esc(v.titulo)}" maxlength="200" required>
        <div class="form-text">Clique para inserir: <span data-vars></span></div></div>
      ${campo('descricao', 'Orientação para quem recebe (opcional)', { type: 'textarea', col: 'col-12', value: v.descricao || '' })}
      ${campo('responsavel', 'Quem recebe', { type: 'select', col: 'col-md-6', value: v.responsavel, options: Object.entries(RESP) })}
      ${campo('responsavel_id', 'Usuário (fixo ou reserva quando não houver vendedor)', { type: 'select', col: 'col-md-6', value: v.responsavel_id || '', options: opcoes(o.usuarios, '—') })}
      ${campo('equipe_id', 'Só clientes da equipe', { type: 'select', col: 'col-md-4', value: v.equipe_id || '', options: opcoes(o.equipes, 'Todas as equipes') })}
      ${campo('valor_minimo', 'Valor mínimo (R$)', { type: 'number', col: 'col-md-4', value: v.valor_minimo ?? '', attrs: 'min="0" step="any"', help: 'Total comprado, pedido, oportunidade ou valor vencido' })}
      ${campo('limite', 'Máximo de tarefas por dia', { type: 'number', col: 'col-md-4', value: v.limite, attrs: 'min="1" max="500" step="1"' })}
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="ativa" id="aut-ativa" ${v.ativa ? 'checked' : ''}><label class="form-check-label" for="aut-ativa">Automação ligada</label></div></div>
    </form>`,
    onShow: ({ body }) => {
      const f = body.querySelector('form');
      const sel = f.querySelector('[name=gatilho]');
      const mostrar = (trocou) => {
        const g = gatilhos.find((x) => x.id === sel.value);
        body.querySelector('[data-ajuda]').textContent = g.ajuda;
        body.querySelector('[data-rot-dias]').textContent = g.rotuloDias;
        body.querySelector('[data-vars]').innerHTML = ['dias', ...g.variaveis].map((x) => `<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1 me-1" data-var="${x}">{${x}}</button>`).join('');
        body.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
          const inp = f.querySelector('[name=titulo]');
          const pos = inp.selectionStart ?? inp.value.length;
          inp.value = inp.value.slice(0, pos) + `{${b.dataset.var}}` + inp.value.slice(inp.selectionEnd ?? pos);
          inp.focus();
        }));
        if (trocou) ['nome', 'titulo', 'dias', 'prazo_dias'].forEach((k) => { f.querySelector(`[name=${k}]`).value = { nome: g.nome, titulo: g.titulo, dias: g.dias, prazo_dias: g.prazo }[k]; });
      };
      sel.addEventListener('change', () => mostrar(!r));
      const resp = f.querySelector('[name=responsavel]');
      const usuario = f.querySelector('[name=responsavel_id]');
      const req = () => { usuario.required = resp.value === 'usuario'; };
      resp.addEventListener('change', req);
      req();
      mostrar(false);
    },
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const f = body.querySelector('form');
      const d = { ...lerForm(f), ativa: f.querySelector('[name=ativa]').checked ? 1 : 0 };
      if (r) await put(`/api/crm/automacoes/${r.id}`, d); else await post('/api/crm/automacoes', d);
      toast('Automação salva.');
      aoSalvar?.();
    } }],
  });
  return m;
}

// ---------- Calendário da safra ----------
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SIT_SAFRA = { oferecer: ['Hora de oferecer', 'warning'], aberta: ['Janela aberta', 'success'], proxima: ['Próxima', 'secondary'] };

function safra(el) {
  const gerir = pode('crm.automacoes');
  el.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <span class="small">Janelas de plantio e adubação dos clientes nos próximos</span>
      <select class="form-select form-select-sm w-auto" data-dias aria-label="Horizonte"><option>60</option><option selected>120</option><option>180</option><option>365</option></select><span class="small">dias</span>
      ${gerir ? '<button class="btn btn-sm btn-outline-secondary ms-auto" data-cal><i class="bi bi-calendar3"></i> Ajustar calendário</button>' : ''}</div>
    <p class="small text-muted">Cruza as áreas de cultivo do cadastro do cliente com o calendário. "Hora de oferecer" = dentro da antecedência configurada; a automação "Calendário da safra" cria a tarefa para o vendedor.</p>
    <div data-t></div>`;
  let dias = 120;
  const t = new DataTable(el.querySelector('[data-t]'), {
    url: () => `/api/crm/safra/janelas?dias=${dias}`, title: 'Calendário da safra', sort: 'aviso_em', dir: 'asc',
    columns: [
      { k: 'situacao', l: 'Situação', filter: { options: Object.entries(SIT_SAFRA).map(([k, [l]]) => [k, l]) }, render: (v, r) => `<span class="badge text-bg-${SIT_SAFRA[v][1]}">${SIT_SAFRA[v][0]}</span>${r.comprou_na_janela ? ' <i class="bi bi-check-circle text-success" title="Já comprou para esta janela"></i>' : ''}` },
      { k: 'cliente', l: 'Cliente', render: (v, r) => `<a href="#/crm/cliente/${r.cliente_id}">${esc(v)}</a>` }, { k: 'vendedor', l: 'Vendedor' }, { k: 'uf', l: 'UF' },
      { k: 'cultura', l: 'Cultura' }, { k: 'area', l: 'Área', t: 'num', render: (v, r) => (v ? `${fmt.num(v)} ${esc(r.medida || 'ha')}` : '—') }, { k: 'atividade', l: 'Atividade' },
      { k: 'aviso_em', l: 'Oferecer a partir de', t: 'date' }, { k: 'inicio', l: 'Janela', t: 'date', render: (v, r) => `${fmt.date(v)} a ${fmt.date(r.fim)}` }, { k: 'ultima_compra', l: 'Última compra', t: 'date' },
    ],
  });
  el.querySelector('[data-dias]').addEventListener('change', (e) => { dias = Number(e.target.value); t.reload(); });
  el.querySelector('[data-cal]')?.addEventListener('click', () => calendario(() => t.reload()));
}

async function calendario(aoMudar) {
  const linhas = await get('/api/crm/safra/calendario');
  const culturas = (state.opcoes.listas?.cultura || []).map((c) => [c.valor, c.valor]);
  const ufs = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  const selMes = (nome, v) => `<select class="form-select form-select-sm" data-k="${nome}">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === v ? 'selected' : ''}>${m}</option>`).join('')}</select>`;
  const linhaHtml = (c) => `<tr data-id="${c.id || ''}"><td><select class="form-select form-select-sm" data-k="cultura">${culturas.map(([v]) => `<option ${v === c.cultura ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
    <td><input class="form-control form-control-sm" data-k="atividade" value="${esc(c.atividade || '')}" maxlength="60"></td>
    <td><select class="form-select form-select-sm" data-k="uf">${ufs.map((u) => `<option value="${u}" ${u === (c.uf || '') ? 'selected' : ''}>${u || 'Todos'}</option>`).join('')}</select></td>
    <td>${selMes('mes_inicio', c.mes_inicio || 1)}</td><td>${selMes('mes_fim', c.mes_fim || 1)}</td>
    <td><input type="number" class="form-control form-control-sm" data-k="antecedencia_dias" min="0" max="180" value="${c.antecedencia_dias ?? 45}"></td>
    <td><input type="checkbox" class="form-check-input" data-k="ativo" ${c.ativo !== 0 ? 'checked' : ''} aria-label="Ativo"></td>
    <td><button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" data-rem title="Excluir"><i class="bi bi-trash"></i></button></td></tr>`;
  const removidos = [];
  modal({
    title: 'Calendário da safra', size: 'xl',
    body: `<p class="small text-muted">Uma linha por cultura e atividade. Linha com UF vale só para os clientes daquele estado e substitui a geral da mesma atividade.</p>
      <div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Cultura</th><th>Atividade</th><th>UF</th><th>De</th><th>Até</th><th>Antecedência (dias)</th><th>Ativa</th><th></th></tr></thead>
      <tbody data-linhas>${linhas.map(linhaHtml).join('')}</tbody></table></div>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-add><i class="bi bi-plus"></i> Adicionar linha</button>`,
    onShow: ({ body }) => {
      const tb = body.querySelector('[data-linhas]');
      const ligar = (tr) => tr.querySelector('[data-rem]').addEventListener('click', () => { if (tr.dataset.id) removidos.push(tr.dataset.id); tr.remove(); });
      tb.querySelectorAll('tr').forEach(ligar);
      body.querySelector('[data-add]').addEventListener('click', () => {
        tb.insertAdjacentHTML('beforeend', linhaHtml({ cultura: culturas[0]?.[0], atividade: 'Plantio', mes_inicio: 9, mes_fim: 11, antecedencia_dias: 45 }));
        ligar(tb.lastElementChild);
      });
    },
    buttons: [{ label: 'Salvar calendário', onClick: async ({ body }) => {
      for (const id of removidos) await del(`/api/crm/safra/calendario/${id}`);
      for (const tr of body.querySelectorAll('[data-linhas] tr')) {
        const d = Object.fromEntries([...tr.querySelectorAll('[data-k]')].map((x) => [x.dataset.k, x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.value]));
        const orig = linhas.find((l) => String(l.id) === tr.dataset.id);
        if (orig && ['cultura', 'atividade', 'uf', 'mes_inicio', 'mes_fim', 'antecedencia_dias', 'ativo'].every((k) => String(orig[k] ?? '') === String(d[k] ?? ''))) continue;
        if (tr.dataset.id) await put(`/api/crm/safra/calendario/${tr.dataset.id}`, d); else await post('/api/crm/safra/calendario', d);
      }
      toast('Calendário salvo.');
      aoMudar?.();
    } }],
  });
}
