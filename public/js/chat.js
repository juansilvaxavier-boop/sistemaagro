// Chat interno: caixinha fixa no canto inferior direito, com contatos, conversa e aviso em tempo real.
// Sem conexão em tempo real (hospedagem serverless), a conversa aberta é atualizada a cada poucos segundos.
import { get, post, esc, fmt, avatar, state, erro, toast } from './core.js';

const $ = (s) => document.querySelector(s);
let aberta = null; // usuário da conversa aberta
let mensagens = [];
let contatos = [];
let timer;
let pendentes = []; // arquivos escolhidos/colados ainda não enviados

const MAX_BYTES = 4 * 1024 * 1024;
const tamanho = (n) => (n > 1048576 ? `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICONES = { pdf: 'bi-file-earmark-pdf', doc: 'bi-file-earmark-word', docx: 'bi-file-earmark-word', xls: 'bi-file-earmark-excel', xlsx: 'bi-file-earmark-excel',
  csv: 'bi-file-earmark-spreadsheet', ppt: 'bi-file-earmark-ppt', pptx: 'bi-file-earmark-ppt', zip: 'bi-file-earmark-zip', mp4: 'bi-file-earmark-play', mp3: 'bi-file-earmark-music' };
const icone = (nome) => ICONES[String(nome).split('.').pop().toLowerCase()] || 'bi-file-earmark';
const ehImagem = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(mime || '');

/** Reduz imagens grandes (prints e fotos) para caber no envio e carregar rápido. */
async function prepararImagem(arquivo) {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return { arquivo };
  const img = await createImageBitmap(arquivo).catch(() => null);
  if (!img) return { arquivo };
  const max = 1920;
  const escala = Math.min(1, max / Math.max(img.width, img.height));
  if (escala === 1 && arquivo.size <= 1.5 * 1024 * 1024) return { arquivo, largura: img.width, altura: img.height };
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * escala), height: Math.round(img.height * escala) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
  if (!blob || blob.size >= arquivo.size) return { arquivo, largura: img.width, altura: img.height };
  const nome = arquivo.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
  return { arquivo: new File([blob], nome, { type: 'image/jpeg' }), largura: canvas.width, altura: canvas.height };
}

async function adicionarArquivos(lista) {
  for (const original of lista) {
    if (pendentes.length >= 5) { toast('Envie no máximo 5 arquivos por vez.', 'warning'); break; }
    const nomeado = original.name ? original : new File([original], `print-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: original.type });
    const p = await prepararImagem(nomeado);
    if (p.arquivo.size > MAX_BYTES) { toast(`${p.arquivo.name} passa de 4 MB.`, 'warning'); continue; }
    p.url = ehImagem(p.arquivo.type) ? URL.createObjectURL(p.arquivo) : null;
    pendentes.push(p);
  }
  desenharPendentes();
}

function desenharPendentes() {
  const box = $('#chat-pendentes');
  box.classList.toggle('d-none', !pendentes.length);
  box.innerHTML = pendentes.map((p, i) => `<div class="chat-pendente">${p.url ? `<img src="${p.url}" alt="">` : `<i class="bi ${icone(p.arquivo.name)}"></i>`}
    <span class="text-truncate">${esc(p.arquivo.name)}<small>${tamanho(p.arquivo.size)}</small></span>
    <button type="button" data-tirar="${i}" aria-label="Remover ${esc(p.arquivo.name)}"><i class="bi bi-x"></i></button></div>`).join('');
  box.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', () => {
    const [p] = pendentes.splice(Number(b.dataset.tirar), 1);
    if (p?.url) URL.revokeObjectURL(p.url);
    desenharPendentes();
  }));
}
function limparPendentes() {
  pendentes.forEach((p) => p.url && URL.revokeObjectURL(p.url));
  pendentes = [];
  desenharPendentes();
}

function htmlAnexos(anexos = []) {
  if (!anexos.length) return '';
  return `<div class="chat-anexos">${anexos.map((a) => (ehImagem(a.mime)
    ? `<a href="/api/chat/anexos/${a.id}" target="_blank" rel="noopener" class="chat-img" title="${esc(a.nome)}"><img src="/api/chat/anexos/${a.id}" alt="${esc(a.nome)}" loading="lazy"
        ${a.largura && a.altura ? `width="${a.largura}" height="${a.altura}"` : ''}></a>`
    : `<a href="/api/chat/anexos/${a.id}${/pdf|mp4|audio/.test(a.mime || '') ? '' : '?baixar=1'}" target="_blank" rel="noopener" class="chat-arq"><i class="bi ${icone(a.nome)}"></i>
        <span class="text-truncate">${esc(a.nome)}<small>${tamanho(a.tamanho || 0)}</small></span><i class="bi bi-download ms-auto"></i></a>`)).join('')}</div>`;
}

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
  limparPendentes();
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
    return `${sep}<div class="bolha ${minha ? 'minha' : 'dele'} ${m.anexos?.length ? 'com-anexo' : ''}">${htmlAnexos(m.anexos)}${m.texto ? esc(m.texto) : ''}<span class="hora">${m.created_at.slice(11, 16)}${minha ? ` <i class="bi ${m.lida_em ? 'bi-check2-all' : 'bi-check2'}" title="${m.lida_em ? 'Lida' : 'Enviada'}"></i>` : ''}</span></div>`;
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
    toast((m.texto || (m.anexos?.length ? `📎 ${m.anexos.length} anexo(s)` : '')).slice(0, 120), 'primary', m.de_nome);
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
  if ((!t && !pendentes.length) || !aberta) return;
  const enviando = pendentes;
  texto.value = '';
  texto.style.height = 'auto';
  const botao = $('#chat-form button:not([type=button])');
  botao.disabled = true;
  try {
    let m;
    if (enviando.length) {
      const total = enviando.reduce((a, p) => a + p.arquivo.size, 0);
      if (total > MAX_BYTES) throw new Error('Os anexos somam mais de 4 MB. Envie em partes.');
      const fd = new FormData();
      enviando.forEach((p) => fd.append('arquivos', p.arquivo, p.arquivo.name));
      fd.append('texto', t);
      fd.append('medidas', JSON.stringify(enviando.map((p) => ({ largura: p.largura, altura: p.altura }))));
      const r = await fetch(`/api/chat/${aberta.id}/anexos`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'agroterra' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Falha ao enviar o anexo.');
      m = d;
      limparPendentes();
    } else {
      m = await post(`/api/chat/${aberta.id}`, { texto: t });
    }
    mensagens.push(m);
    desenharConversa();
  } catch (err) {
    texto.value = t;
    erro(err);
  } finally {
    botao.disabled = false;
  }
});
$('#chat-anexar').addEventListener('click', () => $('#chat-arquivo').click());
$('#chat-arquivo').addEventListener('change', (e) => { adicionarArquivos([...e.target.files]); e.target.value = ''; });
// Colar print (Ctrl+V) direto na caixa de mensagem.
texto.addEventListener('paste', (e) => {
  const arquivos = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (arquivos.length) { e.preventDefault(); adicionarArquivos(arquivos); }
});
// Arrastar arquivos para a conversa.
const painelChat = $('#chat');
painelChat.addEventListener('dragover', (e) => { if (aberta && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); painelChat.classList.add('soltando'); } });
painelChat.addEventListener('dragleave', (e) => { if (!painelChat.contains(e.relatedTarget)) painelChat.classList.remove('soltando'); });
painelChat.addEventListener('drop', (e) => {
  painelChat.classList.remove('soltando');
  if (!aberta || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  adicionarArquivos([...e.dataTransfer.files]);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#chat').hidden && !document.querySelector('.modal.show')) alternar(false); });
