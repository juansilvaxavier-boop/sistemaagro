// Chamados internos: pedidos de ajuda entre setores, com prazo por prioridade, atendimento e avaliação.
import { get, post, put, esc, fmt, titulo, DataTable, modal, campo, lerForm, toast, tentar, state, pode, avatar, pedirTexto, kpi } from '../core.js';

export const PRIORIDADE = { urgente: ['Urgente', 'danger', 1], alta: ['Alta', 'warning', 2], media: ['Média', 'info', 5], baixa: ['Baixa', 'secondary', 10] };
export const STATUS = {
  aberto: ['Aberto', 'primary'], em_andamento: ['Em andamento', 'info'], aguardando: ['Aguardando solicitante', 'warning'], resolvido: ['Resolvido', 'success'], fechado: ['Fechado', 'secondary'],
};
const CATEGORIAS = ['TI', 'Financeiro', 'Logística', 'Comercial', 'Produção', 'Manutenção', 'RH', 'Outros'];
const ESCOPOS = [['', 'Todos que posso ver'], ['setor', 'Para o meu setor'], ['atribuidos', 'Atribuídos a mim'], ['meus', 'Abertos por mim']];
const bdg = (mapa, v) => { const [l, c] = mapa[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Chamados Internos', 'bi-headset', '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Abrir chamado</button>');
  pagina.innerHTML = `<div class="kpis mb-3" id="kpis"></div>
    <div class="d-flex gap-2 mb-2 flex-wrap align-items-center">
      <div class="btn-group btn-group-sm" role="group" id="escopo">${ESCOPOS.map(([v, l], i) => `<input type="radio" class="btn-check" name="esc" id="esc-${i}" value="${v}" ${i === (pode('chamados.gerir') ? 0 : 1) ? 'checked' : ''}><label class="btn btn-outline-success" for="esc-${i}">${l}</label>`).join('')}</div>
      <div class="form-check form-switch ms-2"><input class="form-check-input" type="checkbox" id="so-abertos" checked><label class="form-check-label small" for="so-abertos">Só em aberto</label></div>
    </div><div id="t-ch"></div>`;
  const escopo = () => pagina.querySelector('[name=esc]:checked').value;
  const resumo = async () => {
    const c = await get('/api/chamados/contagem');
    pagina.querySelector('#kpis').innerHTML = [
      kpi('Para eu atender', c.para_mim, { icone: 'bi-inbox', cor: 'primary' }),
      kpi('Fora do prazo', c.atrasados, { icone: 'bi-alarm', cor: c.atrasados ? 'danger' : 'success' }),
      kpi('Abertos por mim', c.meus_abertos, { icone: 'bi-person-raised-hand', cor: 'info' }),
      kpi('Aguardando minha avaliação', c.avaliar, { icone: 'bi-star', cor: c.avaliar ? 'warning' : 'secondary' }),
    ].join('');
  };
  const t = new DataTable(pagina.querySelector('#t-ch'), {
    url: () => `/api/chamados?escopo=${escopo()}&abertos=${pagina.querySelector('#so-abertos').checked ? 1 : ''}`,
    title: 'Chamados internos', sort: 'id', dir: 'desc',
    columns: [
      { k: 'numero', l: 'Nº' }, { k: 'aberto_em', l: 'Aberto em', t: 'datetime' }, { k: 'titulo', l: 'Título', cls: 'quebra', render: (v, r) => `<b>${esc(v)}</b>${r.comentarios ? ` <span class="badge text-bg-light"><i class="bi bi-chat"></i> ${r.comentarios}</span>` : ''}` },
      { k: 'categoria', l: 'Categoria', filter: { options: CATEGORIAS.map((c) => [c, c]) } },
      { k: 'setor_destino', l: 'Setor', filter: { options: Object.entries(state.me.perfis) }, render: (v) => esc(state.me.perfis[v] || v) },
      { k: 'prioridade', l: 'Prioridade', filter: { options: Object.entries(PRIORIDADE).map(([k, [l]]) => [k, l]) }, render: (v) => bdg(PRIORIDADE, v) },
      { k: 'status', l: 'Status', filter: { options: Object.entries(STATUS).map(([k, [l]]) => [k, l]) }, render: (v) => bdg(STATUS, v) },
      { k: 'solicitante', l: 'Solicitante' }, { k: 'responsavel', l: 'Responsável' },
      { k: 'prazo', l: 'Prazo', t: 'date', render: (v, r) => (r.atrasado ? `<span class="text-danger fw-semibold"><i class="bi bi-alarm"></i> ${fmt.date(v)}</span>` : fmt.date(v)) },
      { k: 'pedido', l: 'Pedido' }, { k: 'avaliacao', l: 'Avaliação', render: (v) => (v ? '★'.repeat(v) : '') },
    ],
    rowClass: (r) => (r.atrasado ? 'table-danger' : ''),
    rowClick: (r) => abrirChamado(r.id, atualizar),
  });
  const atualizar = () => { t.reload(); resumo(); window.atualizarContadores?.(); };
  pagina.querySelectorAll('[name=esc]').forEach((r) => r.addEventListener('change', () => t.reload()));
  pagina.querySelector('#so-abertos').addEventListener('change', () => t.reload());
  conteudo.querySelector('#btn-novo').addEventListener('click', () => novoChamado({}, atualizar));
  resumo();
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  if (id) abrirChamado(Number(id), atualizar);
}

/** Abre o formulário de novo chamado (também usado a partir do pedido). */
export function novoChamado(pre = {}, aoSalvar) {
  const setores = Object.entries(state.me.perfis);
  modal({
    title: '<i class="bi bi-headset"></i> Abrir chamado interno', size: 'lg',
    body: `<form class="row g-2">
      ${campo('setor_destino', 'Setor que vai atender', { type: 'select', col: 'col-md-4', required: true, options: [['', 'Selecione...'], ...setores], value: pre.setor_destino || '' })}
      ${campo('categoria', 'Categoria', { type: 'select', col: 'col-md-4', options: [['', '—'], ...CATEGORIAS.map((c) => [c, c])] })}
      ${campo('prioridade', 'Prioridade', { type: 'select', col: 'col-md-4', options: Object.entries(PRIORIDADE).map(([k, [l, , d]]) => [k, `${l} (prazo ${d} dia${d > 1 ? 's' : ''})`]), value: 'media' })}
      ${campo('titulo', 'Título', { col: 'col-md-9', required: true, attrs: 'maxlength="140"' })}
      ${campo('pedido_numero', 'Pedido (opcional)', { type: 'number', col: 'col-md-3', value: pre.pedido_numero || '' })}
      ${campo('descricao', 'Descreva o que precisa', { type: 'textarea', col: 'col-12', required: true, attrs: 'rows="5"' })}</form>`,
    buttons: [{ label: '<i class="bi bi-send"></i> Abrir chamado', onClick: async ({ body }) => {
      const r = await post('/api/chamados', lerForm(body.querySelector('form')));
      toast(`Chamado #${r.numero} aberto. O setor foi avisado.`);
      aoSalvar?.(r);
    } }],
  });
}

export async function abrirChamado(id, aoSalvar) {
  const c = await get(`/api/chamados/${id}`);
  const ICONE = { abertura: 'bi-flag', comentario: 'bi-chat-left-text', status: 'bi-arrow-repeat', atribuicao: 'bi-person-check' };
  const fechado = ['resolvido', 'fechado'].includes(c.status);
  const acoes = [];
  if (c.pode_atender && !fechado) {
    if (c.status === 'aberto') acoes.push(['em_andamento', 'Assumir', 'btn-outline-primary', 'bi-hand-index']);
    if (c.status !== 'aguardando') acoes.push(['aguardando', 'Pedir informação', 'btn-outline-warning', 'bi-hourglass-split']);
    acoes.push(['resolvido', 'Resolver', 'btn-success', 'bi-check2-circle']);
  }
  if (c.e_solicitante && !['fechado'].includes(c.status) && c.status !== 'resolvido') acoes.push(['fechado', 'Encerrar chamado', 'btn-outline-secondary', 'bi-x-circle']);
  if ((c.e_solicitante || c.pode_atender) && fechado) acoes.push(['aberto', 'Reabrir', 'btn-outline-danger', 'bi-arrow-counterclockwise']);
  const m = modal({
    title: `Chamado #${c.numero} · ${esc(c.titulo)}`, size: 'xl',
    body: `<div class="row g-3"><div class="col-lg-8">
      <div class="d-flex gap-2 flex-wrap mb-2">${bdg(STATUS, c.status)} ${bdg(PRIORIDADE, c.prioridade)} ${c.categoria ? `<span class="badge text-bg-light">${esc(c.categoria)}</span>` : ''}
        ${c.atrasado ? '<span class="badge text-bg-danger"><i class="bi bi-alarm"></i> Fora do prazo</span>' : ''}</div>
      <div class="p-3 rounded border mb-3" style="white-space:pre-wrap">${esc(c.descricao)}</div>
      <ul class="timeline">${c.interacoes.map((i) => `<li class="${i.tipo === 'status' ? 't-pagamento' : i.tipo === 'atribuicao' ? 't-nota' : ''}">
        <div class="small text-muted"><i class="bi ${ICONE[i.tipo] || 'bi-dot'}"></i> ${fmt.datetime(i.created_at)} · <b>${esc(i.usuario || 'Sistema')}</b></div>
        <div style="white-space:pre-wrap">${esc(i.texto)}</div></li>`).join('')}</ul>
      ${c.status !== 'fechado' ? `<div class="mt-2"><textarea class="form-control form-control-sm" rows="2" placeholder="Escreva um comentário..." data-comentario></textarea>
        <div class="text-end mt-1"><button class="btn btn-sm btn-outline-success" data-comentar><i class="bi bi-send"></i> Comentar</button></div></div>` : ''}
      ${c.e_solicitante && c.status === 'resolvido' && !c.avaliacao ? `<div class="alert alert-success mt-3 mb-0"><div class="mb-1">Como foi o atendimento?</div>
        <div class="d-flex gap-1" data-estrelas>${[1, 2, 3, 4, 5].map((n) => `<button class="btn btn-sm btn-outline-warning" data-nota="${n}">${'★'.repeat(n)}</button>`).join('')}</div></div>` : ''}
    </div><div class="col-lg-4"><div class="card"><div class="card-body small">
      <div class="mb-2"><div class="text-muted">Solicitante</div><div class="d-flex align-items-center gap-2">${avatar({ nome: c.solicitante })} ${esc(c.solicitante)}</div></div>
      <div class="mb-2"><div class="text-muted">Setor</div>${esc(state.me.perfis[c.setor_destino] || c.setor_destino)}</div>
      <div class="mb-2"><div class="text-muted">Responsável</div>${c.pode_atender && !fechado
        ? `<select class="form-select form-select-sm" data-resp><option value="">— Ninguém —</option>${c.atendentes.map((u) => `<option value="${u.id}" ${u.id === c.responsavel_id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>`
        : esc(c.responsavel || '—')}</div>
      <div class="mb-2"><div class="text-muted">Prazo</div>${c.pode_atender && !fechado ? `<input type="date" class="form-control form-control-sm" data-prazo value="${esc(c.prazo || '')}">` : fmt.date(c.prazo)}</div>
      <div class="mb-2"><div class="text-muted">Aberto em</div>${fmt.datetime(c.created_at)}</div>
      ${c.pedido ? `<div class="mb-2"><div class="text-muted">Pedido</div><a href="#/fila/venda?pedido=${c.pedido_id}" data-pedido>${c.pedido}</a></div>` : ''}
      ${c.avaliacao ? `<div class="mb-2"><div class="text-muted">Avaliação</div><span class="text-warning">${'★'.repeat(c.avaliacao)}</span></div>` : ''}
    </div></div></div></div>`,
    buttons: acoes.map(([status, label, cls, icone]) => ({
      label: `<i class="bi ${icone}"></i> ${label}`, cls,
      onClick: async () => {
        let observacao = '';
        if (['resolvido', 'aguardando', 'aberto'].includes(status)) {
          observacao = await pedirTexto(status === 'resolvido' ? 'Descreva a solução' : status === 'aguardando' ? 'O que você precisa do solicitante?' : 'Motivo da reabertura', { obrigatorio: status !== 'aberto' });
          if (observacao === null) return false;
        }
        await post(`/api/chamados/${c.id}/status`, { status, observacao });
        toast(`Chamado ${STATUS[status][0].toLowerCase()}.`);
        aoSalvar?.();
      },
    })),
  });
  const b = m.body;
  b.querySelector('[data-comentar]')?.addEventListener('click', async () => {
    const texto = b.querySelector('[data-comentario]').value.trim();
    if (!texto) return;
    if (await tentar(() => post(`/api/chamados/${c.id}/comentar`, { texto }))) { m.close(); aoSalvar?.(); abrirChamado(c.id, aoSalvar); }
  });
  b.querySelector('[data-resp]')?.addEventListener('change', async (e) => {
    if (await tentar(() => post(`/api/chamados/${c.id}/atribuir`, { responsavel_id: e.target.value || null }), 'Responsável atualizado.')) aoSalvar?.();
  });
  b.querySelector('[data-prazo]')?.addEventListener('change', async (e) => {
    if (await tentar(() => put(`/api/chamados/${c.id}`, { prazo: e.target.value }), 'Prazo alterado.')) aoSalvar?.();
  });
  b.querySelectorAll('[data-nota]').forEach((x) => x.addEventListener('click', async () => {
    if (await tentar(() => post(`/api/chamados/${c.id}/avaliar`, { avaliacao: Number(x.dataset.nota) }), 'Obrigado pela avaliação!')) { m.close(); aoSalvar?.(); }
  }));
  b.querySelector('[data-pedido]')?.addEventListener('click', async (e) => {
    e.preventDefault();
    m.close();
    const { abrirPedido } = await import('./pedido-detalhe.js');
    abrirPedido(c.pedido_id);
  });
}
