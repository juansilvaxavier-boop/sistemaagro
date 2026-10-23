// Comunicação interna entre setores.
import { get, post, esc, fmt, titulo, abas, campo, opcoes, lerForm, tentar, state } from '../core.js';
import { abrirPedido } from './pedido-detalhe.js';

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Mensagens', 'bi-chat-dots', '<button class="btn btn-sm btn-outline-secondary" id="btn-todas"><i class="bi bi-check2-all"></i> Marcar todas como lidas</button>');
  const setores = [...new Set(Object.values(state.me.etapas).map((e) => e.perfil).filter(Boolean))];
  pagina.innerHTML = `<div class="row g-3"><div class="col-lg-4"><div class="card"><div class="card-header py-2">Nova mensagem</div><div class="card-body">
    <form class="row g-2" id="f-msg">
      ${campo('setor_destino', 'Para o setor', { type: 'select', col: 'col-12', options: [['', 'Todos os setores'], ...setores.map((s) => [s, state.me.perfis[s]])] })}
      ${campo('destinatario_id', 'ou para a pessoa', { type: 'select', col: 'col-12', options: opcoes(state.opcoes.usuarios.filter((u) => u.id !== state.me.usuario.id), '—') })}
      ${campo('pedido_numero', 'Nº do pedido (vincula a mensagem)', { type: 'number', col: 'col-12' })}
      ${campo('texto', 'Mensagem', { type: 'textarea', col: 'col-12', required: true })}
      <div class="col-12"><button class="btn btn-success btn-sm w-100"><i class="bi bi-send"></i> Enviar</button></div></form></div></div></div>
    <div class="col-lg-8">${abas([{ id: 'rec', label: 'Recebidas', html: '<div data-cx="recebidas"></div>' }, { id: 'env', label: 'Enviadas', html: '<div data-cx="enviadas"></div>' }], 'msg')}</div></div>`;

  const carregar = async (caixa) => {
    const el = pagina.querySelector(`[data-cx="${caixa}"]`);
    const rows = await get(`/api/mensagens?caixa=${caixa}`);
    el.innerHTML = rows.length ? `<div class="list-group">${rows.map((m) => `<div class="list-group-item msg-item small ${caixa === 'recebidas' && !m.lida_em ? 'nao-lida' : ''}" data-id="${m.id}">
      <div class="d-flex gap-2"><b>${esc(caixa === 'recebidas' ? m.remetente : m.destinatario || (m.setor_destino ? state.me.perfis[m.setor_destino] : 'Todos'))}</b>
        ${m.pedido_numero ? `<a href="#" data-ped="${m.pedido_id}" class="badge text-bg-primary text-decoration-none">Pedido ${m.pedido_numero}</a>` : ''}
        ${caixa === 'recebidas' && m.setor_destino ? `<span class="badge text-bg-light">${esc(state.me.perfis[m.setor_destino])}</span>` : ''}
        <span class="ms-auto text-muted">${fmt.datetime(m.created_at)}</span></div>
      <div>${esc(m.texto)}</div>
      ${caixa === 'recebidas' && !m.lida_em ? '<button class="btn btn-sm btn-link p-0" data-lida>Marcar como lida</button>' : caixa === 'recebidas' ? `<small class="text-muted">Lida em ${fmt.datetime(m.lida_em)}</small>` : ''}</div>`).join('')}</div>`
      : '<div class="vazio">Nenhuma mensagem.</div>';
    el.querySelectorAll('[data-lida]').forEach((b) => b.addEventListener('click', async () => {
      await tentar(() => post(`/api/mensagens/${b.closest('[data-id]').dataset.id}/lida`));
      window.atualizarContadores?.();
      carregar(caixa);
    }));
    el.querySelectorAll('[data-ped]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); abrirPedido(Number(a.dataset.ped)); }));
  };
  carregar('recebidas');
  carregar('enviadas');
  pagina.querySelector('#f-msg').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await tentar(() => post('/api/mensagens', lerForm(e.target)), 'Mensagem enviada.')) { e.target.reset(); carregar('enviadas'); }
  });
  conteudo.querySelector('#btn-todas').addEventListener('click', async () => {
    await tentar(() => post('/api/mensagens/todas-lidas'), 'Mensagens marcadas como lidas.');
    window.atualizarContadores?.();
    carregar('recebidas');
  });
  const onMsg = () => { if (document.body.contains(pagina)) carregar('recebidas'); else window.removeEventListener('nova-mensagem', onMsg); };
  window.addEventListener('nova-mensagem', onMsg);
}
