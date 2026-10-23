// Assistente de IA: caixinha no canto inferior direito que tira dúvidas de uso e consulta dados (só leitura).
import { post, get, esc, state, erro } from './core.js';

const $ = (s) => document.querySelector(s);
const SUGESTOES = ['O que tenho pendente hoje?', 'Como faço um pedido novo?', 'Por que meu pedido voltou?', 'Quantos dias de férias eu tenho?'];
let conversa = [];
let enviando = false;
let telas = () => [];
let statusCarregado = false;

const chave = () => `agt-assistente-${state.me?.usuario?.id}`;
function guardar() { try { sessionStorage.setItem(chave(), JSON.stringify(conversa.slice(-20))); } catch { /* sem armazenamento */ } }
function recuperar() { try { conversa = JSON.parse(sessionStorage.getItem(chave()) || '[]'); } catch { conversa = []; } }

export function configurar(op) { telas = op.telas || telas; }

export function alternar(forcar) {
  const painel = $('#assistente');
  const abrir = forcar ?? painel.hidden;
  painel.hidden = !abrir;
  $('#btn-assistente').classList.toggle('ativo', abrir);
  if (!abrir) return;
  if (!conversa.length) recuperar();
  desenhar();
  if (!statusCarregado) {
    statusCarregado = true;
    get('/api/assistente/status').then(({ ia }) => {
      $('#ass-modo').textContent = ia ? 'IA · tira dúvidas e consulta seus dados' : 'modo manual · respostas do guia do sistema';
    }).catch(() => {});
  }
  setTimeout(() => $('#ass-texto').focus(), 50);
}

/** Markdown simples: negrito, itálico, código e links internos (#/...). O texto já chega escapado. */
function formatar(texto) {
  return esc(texto)
    .replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((#\/[\w/?=&.-]*)\)/g, '<a href="$2">$1</a>');
}

function desenhar() {
  const corpo = $('#ass-corpo');
  if (!conversa.length) {
    const nome = esc(state.me.usuario.nome.split(' ')[0]);
    corpo.innerHTML = `<div class="ass-boas-vindas"><i class="bi bi-stars"></i><p>Olá, ${nome}! Posso explicar como usar o sistema e consultar seus pedidos, clientes, pendências e férias.</p>
      <div class="ass-sugestoes">${SUGESTOES.map((s) => `<button type="button" class="btn btn-sm btn-outline-secondary">${esc(s)}</button>`).join('')}</div></div>`;
    corpo.querySelectorAll('.ass-sugestoes button').forEach((b) => b.addEventListener('click', () => perguntar(b.textContent)));
    return;
  }
  corpo.innerHTML = `<div class="bolhas">${conversa.map((m) => `<div class="bolha ${m.role === 'user' ? 'minha' : 'dele ass-resposta'}">${m.role === 'user' ? esc(m.content) : formatar(m.content)}</div>`).join('')}
    ${enviando ? '<div class="bolha dele ass-digitando" aria-live="polite"><span></span><span></span><span></span></div>' : ''}</div>`;
  // Mostra o início da última resposta, não o fim.
  const ultima = corpo.querySelector('.bolha:last-child');
  corpo.scrollTop = ultima && !enviando ? ultima.offsetTop - corpo.offsetTop - 8 : corpo.scrollHeight;
}

async function perguntar(texto) {
  const t = texto.trim();
  if (!t || enviando) return;
  conversa.push({ role: 'user', content: t });
  enviando = true;
  desenhar();
  try {
    const { resposta } = await post('/api/assistente', { mensagens: conversa.slice(-20), telas: telas() });
    conversa.push({ role: 'assistant', content: resposta });
  } catch (e) {
    conversa.pop();
    $('#ass-texto').value = t;
    erro(e);
  } finally {
    enviando = false;
    guardar();
    desenhar();
  }
}

$('#ass-fechar').addEventListener('click', () => alternar(false));
$('#ass-nova').addEventListener('click', () => { conversa = []; guardar(); desenhar(); $('#ass-texto').focus(); });
$('#ass-corpo').addEventListener('click', async (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  const ped = a.getAttribute('href').match(/^#\/pedido\/(\d+)$/);
  if (ped) {
    e.preventDefault();
    const { abrirPedido } = await import('./pages/pedido-detalhe.js');
    abrirPedido(Number(ped[1]));
  }
  if (window.matchMedia('(max-width: 575.98px)').matches) alternar(false);
});
const caixa = $('#ass-texto');
caixa.addEventListener('input', () => { caixa.style.height = 'auto'; caixa.style.height = Math.min(caixa.scrollHeight, 120) + 'px'; });
caixa.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ass-form').requestSubmit(); }
});
$('#ass-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = caixa.value;
  caixa.value = '';
  caixa.style.height = 'auto';
  perguntar(t);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#assistente').hidden && !document.querySelector('.modal.show')) alternar(false); });
