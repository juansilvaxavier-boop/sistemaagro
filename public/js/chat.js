// Chat interno: caixinha fixa no canto inferior direito, com contatos, conversa e aviso em tempo real.
// Sem conexão em tempo real (hospedagem serverless), a conversa aberta é atualizada a cada poucos segundos.
import { get, post, esc, fmt, avatar, state, erro, toast } from './core.js';

const $ = (s) => document.querySelector(s);
let aberta = null; // usuário da conversa aberta
let mensagens = [];
let contatos = [];
let timer;

export function alternar(forcar) {
  const painel = $('#chat');
  const abrir = forcar ?? painel.hidden;
  painel.hidden = !abrir;
  $('#btn-chat').classList.toggle('ativo', abrir);
  clearInterval(timer);
  if (abrir) {
    aberta ? abrirConversa(aberta.id) : listarContatos();
    timer = setInterval(() => (aberta ? buscarNovas() : listarContatos()), 8000);
  }
}

export async function atualizarBadge() {
  const { n } = await get('/api/chat/nao-lidas').catch(() => ({ n: 0 }));
  const b = $('#badge-chat');
  b.classList.toggle('d-none', !n);
  b.textContent = n > 99 ? '99+' : n || '';
  b.title = `${n} não lida(s)`;
}

async function listarContatos(filtro = '') {
  aberta = null;
  $('#chat-voltar').classList.add('d-none');
  $('#chat-form').classList.add('d-none');
  $('#chat-titulo').innerHTML = '<strong>Chat</strong> <small class="text-body-secondary">· converse com a equipe</small>';
  contatos = await get('/api/chat/contatos').catch((e) => { erro(e); return []; });
  const corpo = $('#chat-corpo');
  corpo.innerHTML = `<input class="form-control form-control-sm mb-2" id="chat-filtro" placeholder="Buscar pessoa" value="${esc(filtro)}" aria-label="Buscar pessoa"><div id="chat-lista"></div>`;
  const desenhar = (f) => {
    const t = f.toLowerCase();
    const lista = contatos.filter((c) => !t || `${c.nome} ${c.perfil_label} ${c.cargo || ''}`.toLowerCase().includes(t));
    $('#chat-lista').innerHTML = lista.map((c) => `<button class="chat-contato" data-id="${c.id}">
      ${avatar(c, c.online ? 'online' : '')}<span class="meta"><strong>${esc(c.nome)}</strong>
      <small>${c.ultima ? esc(c.ultima) : `${esc(c.perfil_label)}${c.cargo ? ' · ' + esc(c.cargo) : ''}`}</small></span>
      ${c.nao_lidas ? `<span class="nl">${c.nao_lidas}</span>` : c.ultima_em ? `<small class="text-body-secondary">${quando(c.ultima_em)}</small>` : ''}</button>`).join('')
      || '<div class="vazio">Ninguém encontrado.</div>';
    $('#chat-lista').querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => abrirConversa(Number(b.dataset.id))));
  };
  desenhar(filtro);
  $('#chat-filtro').addEventListener('input', (e) => desenhar(e.target.value));
  atualizarBadge();
}

function quando(dt) {
  const hoje = new Date().toISOString().slice(0, 10);
  return dt.slice(0, 10) === hoje ? dt.slice(11, 16) : fmt.date(dt).slice(0, 5);
}

async function abrirConversa(id) {
  const c = contatos.find((x) => x.id === id) || aberta || { id, nome: 'Conversa' };
  aberta = c;
  $('#chat-voltar').classList.remove('d-none');
  $('#chat-form').classList.remove('d-none');
  $('#chat-titulo').innerHTML = `<div class="d-flex align-items-center gap-2">${avatar(c, `avatar-sm ${c.online ? 'online' : ''}`)}<div class="text-truncate"><strong>${esc(c.nome)}</strong>
    <small class="d-block text-body-secondary">${c.online ? 'online agora' : esc(c.perfil_label || '')}</small></div></div>`;
  mensagens = await get(`/api/chat/${id}`).catch((e) => { erro(e); return []; });
  desenharConversa();
  $('#chat-texto').focus();
  atualizarBadge();
}

async function buscarNovas() {
  if (!aberta) return;
  const ult = mensagens.at(-1)?.id || 0;
  const novas = await get(`/api/chat/${aberta.id}?depois=${ult}`).catch(() => []);
  if (novas.length) {
    mensagens.push(...novas);
    desenharConversa();
  }
}

function desenharConversa() {
  const corpo = $('#chat-corpo');
  let dia = '';
  const eu = state.me.usuario.id;
  corpo.innerHTML = mensagens.length ? `<div class="bolhas">${mensagens.map((m) => {
    const d = m.created_at.slice(0, 10);
    const sep = d !== dia ? `<div class="dia-chat">${fmt.date(d)}</div>` : '';
    dia = d;
    const minha = m.de_id === eu;
    return `${sep}<div class="bolha ${minha ? 'minha' : 'dele'}">${esc(m.texto)}<span class="hora">${m.created_at.slice(11, 16)}${minha ? ` <i class="bi ${m.lida_em ? 'bi-check2-all' : 'bi-check2'}" title="${m.lida_em ? 'Lida' : 'Enviada'}"></i>` : ''}</span></div>`;
  }).join('')}</div>` : `<div class="vazio"><i class="bi bi-chat-heart"></i>Comece a conversa com ${esc(aberta.nome.split(' ')[0])}.</div>`;
  corpo.scrollTop = corpo.scrollHeight;
}

/** Mensagem recebida em tempo real. */
export function receber(m) {
  if (!$('#chat').hidden && aberta?.id === m.de_id) {
    if (!mensagens.some((x) => x.id === m.id)) mensagens.push(m);
    desenharConversa();
    get(`/api/chat/${m.de_id}?depois=${m.id}`).catch(() => {}); // marca como lida
  } else {
    toast(m.texto.slice(0, 120), 'primary', m.de_nome);
    if (!$('#chat').hidden && !aberta) listarContatos($('#chat-filtro')?.value || '');
  }
  atualizarBadge();
}

export function lidas({ por }) {
  if (aberta?.id !== por) return;
  mensagens.forEach((m) => { if (m.de_id === state.me.usuario.id) m.lida_em ||= 'agora'; });
  desenharConversa();
}

$('#chat-fechar').addEventListener('click', () => alternar(false));
$('#chat-voltar').addEventListener('click', () => listarContatos());
const texto = $('#chat-texto');
texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 120) + 'px'; });
texto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); }
});
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = texto.value.trim();
  if (!t || !aberta) return;
  texto.value = '';
  texto.style.height = 'auto';
  try {
    const m = await post(`/api/chat/${aberta.id}`, { texto: t });
    mensagens.push(m);
    desenharConversa();
  } catch (err) {
    texto.value = t;
    erro(err);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#chat').hidden && !document.querySelector('.modal.show')) alternar(false); });
