// Chat interno: caixinha no canto inferior direito com conversas diretas e grupos.
// Tempo real pelo Supabase Realtime (só um sinal de "mudou"; o conteúdo vem da API). Sem ele, consulta a cada poucos segundos.
// Recursos: menções (@), responder, editar, apagar para todos, reações, fixar, silenciar, áudio, anexos, busca e cartões de pedido/cliente/chamado.
import { get, post, put, del, esc, fmt, avatar, state, erro, toast, modal, confirmar, pode, tentar } from './core.js';

const $ = (s) => document.querySelector(s);
const painel = $('#chat');
const corpo = $('#chat-corpo');
const texto = $('#chat-texto');

let cfg = null;
let conversas = [];
let contatos = null;
let aberta = null; // { conversa, membros, fixadas, mensagens, tem_mais }
let pendentes = []; // arquivos escolhidos/colados ainda não enviados
let respondendo = null;
let editando = null;
let mencoesSel = new Map(); // nome → id
let online = new Set();
const digitando = new Map(); // usuario_id → { nome, ate }
let ultimaNovidade = null;
let timer;
let visao = 'lista'; // lista | conversa | busca
let gravacao = null;

const MAX_BYTES = 4 * 1024 * 1024;
const tamanho = (n) => (n > 1048576 ? `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICONES = { pdf: 'bi-file-earmark-pdf', doc: 'bi-file-earmark-word', docx: 'bi-file-earmark-word', xls: 'bi-file-earmark-excel', xlsx: 'bi-file-earmark-excel',
  csv: 'bi-file-earmark-spreadsheet', ppt: 'bi-file-earmark-ppt', pptx: 'bi-file-earmark-ppt', zip: 'bi-file-earmark-zip', mp4: 'bi-file-earmark-play', mp3: 'bi-file-earmark-music' };
const icone = (nome) => ICONES[String(nome).split('.').pop().toLowerCase()] || 'bi-file-earmark';
const ehImagem = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(mime || '');
const eu = () => state.me?.usuario?.id;
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const quando = (dt) => (dt.slice(0, 10) === hojeIso() ? dt.slice(11, 16) : fmt.date(dt).slice(0, 5));
const CORES_NOME = ['#2a8a4a', '#2a78d6', '#eb6834', '#6250d6', '#1baf7a', '#c98500', '#e87ba4'];
const corNome = (id) => CORES_NOME[Number(id) % CORES_NOME.length];

// ======================= Tempo real =======================
let rt = null; // { cli, canal, presenca, ativo, conversa }
async function carregarScript(src) {
  if (window.supabase) return;
  await new Promise((ok, falha) => document.head.appendChild(Object.assign(document.createElement('script'), { src, onload: ok, onerror: falha })));
}
async function iniciarTempoReal() {
  if (!cfg?.realtime || rt) return;
  try {
    await carregarScript('/vendor/supabase/supabase.js');
    const cli = window.supabase.createClient(cfg.realtime.url, cfg.realtime.chave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    rt = { cli, ativo: false };
    rt.canal = cli.channel(cfg.topico, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'chat' }, ({ payload }) => sinal(payload))
      .subscribe((st) => { rt.ativo = st === 'SUBSCRIBED'; agendar(); });
    rt.presenca = cli.channel(cfg.presenca, { config: { presence: { key: String(eu()) } } });
    rt.presenca.on('presence', { event: 'sync' }, () => {
      online = new Set(Object.keys(rt.presenca.presenceState()).map(Number));
      atualizarOnline();
    }).subscribe(async (st) => { if (st === 'SUBSCRIBED') await rt.presenca.track({ id: eu() }); });
  } catch (e) {
    console.warn('Chat: tempo real indisponível, usando consulta periódica.', e);
    rt = null;
  }
}
function entrarNaConversa(c) {
  if (!rt?.cli) return;
  if (rt.conversa) rt.cli.removeChannel(rt.conversa);
  rt.conversa = rt.cli.channel(c.topico, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'digitando' }, ({ payload }) => {
      if (payload.id === eu()) return;
      digitando.set(payload.id, { nome: payload.nome, ate: Date.now() + 4000 });
      desenharCabecalho();
      setTimeout(desenharCabecalho, 4200);
    }).subscribe();
}
let ultimoDigitando = 0;
function avisarDigitando() {
  if (!rt?.conversa || Date.now() - ultimoDigitando < 2500) return;
  ultimoDigitando = Date.now();
  rt.conversa.send({ type: 'broadcast', event: 'digitando', payload: { id: eu(), nome: state.me.usuario.nome.split(' ')[0] } }).catch(() => {});
}

// Sem tempo real: conversa aberta a cada 4 s, painel aberto a cada 8 s, fechado a cada 30 s. Com tempo real, só uma conferência por minuto.
function agendar() {
  clearInterval(timer);
  const ms = rt?.ativo ? 60000 : painel.hidden ? 30000 : visao === 'conversa' ? 4000 : 8000;
  timer = setInterval(novidades, ms);
}
let buscando = false;
async function novidades() {
  if (buscando) return;
  buscando = true;
  try {
    const d = await get(`/api/chat/novidades${ultimaNovidade ? `?desde=${encodeURIComponent(ultimaNovidade)}` : ''}`);
    ultimaNovidade = d.agora;
    desenharBadge(d);
    if (!d.conversas.length || painel.hidden) return;
    if (aberta && d.conversas.includes(aberta.conversa.id)) await atualizarConversa();
    if (visao === 'lista') await listar();
  } catch { /* sem rede: tenta de novo no próximo ciclo */ } finally { buscando = false; }
}

/** Sinal de mudança (tempo real ou SSE): avisa e atualiza o que estiver aberto. */
let pendenteSinal;
export function sinal(d) {
  if (d.tipo === 'msg' && d.de_id !== eu() && (painel.hidden || aberta?.conversa.id !== d.conversa_id || document.visibilityState !== 'visible')) avisarNova(d);
  clearTimeout(pendenteSinal);
  pendenteSinal = setTimeout(novidades, 250);
}
async function avisarNova(d) {
  const lista = await get('/api/chat/conversas').catch(() => null);
  if (!lista) return;
  conversas = lista;
  const c = lista.find((x) => x.id === d.conversa_id);
  if (!c || (c.silenciada && !c.mencoes)) return;
  const titulo = c.tipo === 'grupo' ? `${c.ultima?.de_nome || ''} em ${c.titulo}` : c.titulo;
  if (document.visibilityState === 'visible') toast((c.ultima?.texto || '').slice(0, 140), 'primary', titulo);
  else if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification(titulo, { body: (c.ultima?.texto || '').slice(0, 140), icon: '/img/icone-192.png', tag: `chat-${c.id}`, data: { url: `/#/chat/${c.id}` } })).catch(() => {});
  }
}

// ======================= Abrir e fechar =======================
export async function alternar(forcar) {
  const abrir = forcar ?? painel.hidden;
  painel.hidden = !abrir;
  $('#btn-chat').classList.toggle('ativo', abrir);
  if (abrir) {
    await garantirConfig();
    if (aberta) await abrirConversa(aberta.conversa.id);
    else await listar();
  }
  agendar();
}
async function garantirConfig() {
  if (cfg) return;
  cfg = await get('/api/chat/config').catch(() => ({ realtime: null, emojis: ['👍', '✅', '👀', '❤️', '😂', '🙏'] }));
  iniciarTempoReal();
}
/** Chamado ao entrar no sistema: tempo real, contador e notificações já ficam ativos com o painel fechado. */
export async function iniciar() {
  await garantirConfig();
  await novidades();
  agendar();
}
/** Abre direto numa conversa (link de notificação: #/chat/ID). */
export async function abrirPorLink(id) {
  painel.hidden = false;
  $('#btn-chat').classList.add('ativo');
  await garantirConfig();
  await abrirConversa(Number(id));
  agendar();
}

function desenharBadge(d) {
  const b = $('#badge-chat');
  b.classList.toggle('d-none', !d.n);
  b.textContent = d.mencoes ? '@' : d.n > 99 ? '99+' : d.n || '';
  b.title = `${d.n} não lida(s)${d.mencoes ? `, ${d.mencoes} menção(ões)` : ''}`;
}
export async function atualizarBadge() {
  desenharBadge(await get('/api/chat/nao-lidas').catch(() => ({ n: 0, mencoes: 0 })));
}

function cabecalho(html, { voltar = false, botoes = '' } = {}) {
  $('#chat-voltar').classList.toggle('d-none', !voltar);
  $('#chat-titulo').innerHTML = html;
  $('#chat-acoes').innerHTML = botoes;
}

// ======================= Lista de conversas =======================
async function listar(filtro = $('#chat-filtro')?.value || '') {
  visao = 'lista';
  aberta = null;
  respondendo = null;
  editando = null;
  limparPendentes();
  if (rt?.conversa) { rt.cli.removeChannel(rt.conversa); rt.conversa = null; }
  $('#chat-form').classList.add('d-none');
  $('#chat-fixada').classList.add('d-none');
  cabecalho('<strong>Chat</strong> <small class="text-body-secondary">· equipe</small>', {
    botoes: `<button class="btn btn-icon" data-acao="buscar" title="Buscar mensagens" aria-label="Buscar mensagens"><i class="bi bi-search"></i></button>
      <button class="btn btn-icon" data-acao="grupo" title="Novo grupo" aria-label="Novo grupo"><i class="bi bi-people"></i></button>`,
  });
  [conversas, contatos] = await Promise.all([get('/api/chat/conversas').catch((e) => { erro(e); return []; }), contatos ? Promise.resolve(contatos) : get('/api/chat/contatos').catch(() => [])]);
  if (visao !== 'lista') return;
  corpo.innerHTML = `<input class="form-control form-control-sm mb-2" id="chat-filtro" placeholder="Buscar conversa ou pessoa" value="${esc(filtro)}" aria-label="Buscar conversa ou pessoa"><div id="chat-lista"></div>`;
  const desenhar = (f) => {
    const t = f.toLowerCase();
    const conv = conversas.filter((c) => !t || `${c.titulo} ${c.ultima?.texto || ''}`.toLowerCase().includes(t));
    const comConversa = new Set(conversas.filter((c) => c.tipo === 'direta').map((c) => c.outro_id));
    const pessoas = (t || !conversas.length) ? contatos.filter((p) => !comConversa.has(p.id) && `${p.nome} ${p.perfil_label} ${p.cargo || ''} ${p.departamento || ''}`.toLowerCase().includes(t)) : [];
    $('#chat-lista').innerHTML = (conv.map(itemConversa).join('') || (t ? '' : '<div class="vazio py-3"><i class="bi bi-chat-dots"></i>Nenhuma conversa ainda.</div>'))
      + (pessoas.length ? `<div class="chat-secao">Pessoas</div>${pessoas.slice(0, 40).map((p) => `<button class="chat-contato" data-pessoa="${p.id}">
        ${avatar(p, online.has(p.id) ? 'online' : '')}<span class="meta"><strong>${esc(p.nome)}</strong><small>${esc(p.perfil_label)}${p.cargo ? ` · ${esc(p.cargo)}` : ''}</small></span></button>`).join('')}` : '')
      || '<div class="vazio">Ninguém encontrado.</div>';
    $('#chat-lista').querySelectorAll('[data-conversa]').forEach((b) => b.addEventListener('click', () => abrirConversa(Number(b.dataset.conversa))));
    $('#chat-lista').querySelectorAll('[data-pessoa]').forEach((b) => b.addEventListener('click', async () => {
      const r = await tentar(() => post(`/api/chat/direta/${b.dataset.pessoa}`));
      if (r) abrirConversa(r.id);
    }));
  };
  desenhar(filtro);
  $('#chat-filtro').addEventListener('input', (e) => desenhar(e.target.value));
  atualizarBadge();
}
function itemConversa(c) {
  const av = c.tipo === 'grupo' ? '<span class="avatar chat-grupo-av" aria-hidden="true"><i class="bi bi-people-fill"></i></span>'
    : avatar({ id: c.outro_id, nome: c.outro_nome, tem_foto: c.outro_tem_foto }, online.has(c.outro_id) ? 'online' : '');
  const prev = c.ultima ? `${c.tipo === 'grupo' && c.ultima.tipo !== 'sistema' ? `${esc((c.ultima.de_id === eu() ? 'Você' : c.ultima.de_nome || '').split(' ')[0])}: ` : c.ultima.de_id === eu() && c.ultima.tipo !== 'sistema' ? 'Você: ' : ''}${esc(c.ultima.texto)}` : esc(c.descricao || '');
  return `<button class="chat-contato ${c.nao_lidas ? 'tem-nl' : ''}" data-conversa="${c.id}">${av}
    <span class="meta"><strong>${esc(c.titulo || 'Conversa')}${c.outro_ativo === 0 ? ' <span class="badge text-bg-secondary">desativado</span>' : ''}${c.saiu_em ? ' <span class="badge text-bg-secondary">saiu</span>' : ''}</strong><small>${prev}</small></span>
    <span class="d-flex flex-column align-items-end gap-1">${c.ultima ? `<small class="text-body-secondary">${quando(c.ultima.created_at)}</small>` : ''}
      <span class="d-flex gap-1 align-items-center">${c.silenciada ? '<i class="bi bi-bell-slash text-body-secondary" title="Silenciada"></i>' : ''}${c.mencoes ? '<span class="nl" title="Você foi mencionado">@</span>' : ''}${c.nao_lidas ? `<span class="nl">${c.nao_lidas}</span>` : ''}</span></span></button>`;
}
function atualizarOnline() {
  if (visao === 'lista' && $('#chat-filtro')) listar($('#chat-filtro').value);
  else if (visao === 'conversa') desenharCabecalho();
}

// ======================= Conversa =======================
async function abrirConversa(id, { aoRedor } = {}) {
  visao = 'conversa';
  respondendo = null;
  editando = null;
  mencoesSel = new Map();
  limparPendentes();
  const d = await get(`/api/chat/c/${id}${aoRedor ? `?ao_redor=${aoRedor}` : ''}`).catch((e) => { erro(e); return null; });
  if (!d) return listar();
  aberta = d;
  entrarNaConversa(d.conversa);
  desenharCabecalho();
  $('#chat-form').classList.toggle('d-none', !!d.conversa.somente_leitura);
  desenharConversa({ rolar: aoRedor ? `[data-msg="${aoRedor}"]` : 'fim' });
  if (aoRedor) corpo.querySelector(`[data-msg="${aoRedor}"]`)?.classList.add('destaque');
  desenharComposer();
  if (!d.conversa.somente_leitura) texto.focus();
  atualizarBadge();
  agendar();
}

async function atualizarConversa() {
  if (!aberta) return;
  const primeiro = aberta.mensagens[0]?.id || 0;
  const d = await get(`/api/chat/c/${aberta.conversa.id}${primeiro ? `?desde_id=${primeiro}` : ''}`).catch(() => null);
  if (!d || aberta?.conversa.id !== d.conversa.id) return;
  const noFim = corpo.scrollHeight - corpo.scrollTop - corpo.clientHeight < 80;
  const temMais = aberta.tem_mais;
  aberta = { ...d, tem_mais: temMais };
  desenharCabecalho();
  $('#chat-form').classList.toggle('d-none', !!d.conversa.somente_leitura);
  desenharConversa({ rolar: noFim ? 'fim' : null });
}

function desenharCabecalho() {
  if (!aberta) return;
  const c = aberta.conversa;
  const agora = Date.now();
  const dig = [...digitando.entries()].filter(([, v]) => v.ate > agora).map(([, v]) => v.nome);
  let sub;
  if (dig.length) sub = `<span class="text-success">${esc(dig.join(', '))} digitando…</span>`;
  else if (c.tipo === 'grupo') {
    const ativos = aberta.membros.filter((m) => !m.saiu_em);
    const on = ativos.filter((m) => online.has(m.id) && m.id !== eu()).length;
    sub = `${ativos.length} membros${on ? ` · ${on} online` : ''}`;
  } else if (c.outro && !c.outro.ativo) sub = 'usuário desativado';
  else sub = online.has(c.outro?.id) ? '<span class="text-success">online agora</span>' : esc(c.outro?.perfil_label || '');
  const av = c.tipo === 'grupo' ? '<span class="avatar avatar-sm chat-grupo-av" aria-hidden="true"><i class="bi bi-people-fill"></i></span>'
    : avatar({ id: c.outro?.id, nome: c.nome, tem_foto: c.outro?.tem_foto }, `avatar-sm ${online.has(c.outro?.id) ? 'online' : ''}`);
  cabecalho(`<div class="d-flex align-items-center gap-2">${av}<div class="text-truncate"><strong>${esc(c.nome || 'Conversa')}</strong>
    ${c.silenciada ? '<i class="bi bi-bell-slash text-body-secondary small" title="Silenciada"></i>' : ''}<small class="d-block text-body-secondary text-truncate">${sub}</small></div></div>`, {
    voltar: true,
    botoes: `<div class="dropdown"><button class="btn btn-icon" data-bs-toggle="dropdown" aria-label="Opções da conversa"><i class="bi bi-three-dots-vertical"></i></button>
      <ul class="dropdown-menu dropdown-menu-end">
        ${c.tipo === 'grupo' ? '<li><button class="dropdown-item" data-acao="membros"><i class="bi bi-people"></i> Membros</button></li>' : ''}
        ${aberta.fixadas.length ? `<li><button class="dropdown-item" data-acao="fixadas"><i class="bi bi-pin-angle"></i> Mensagens fixadas (${aberta.fixadas.length})</button></li>` : ''}
        <li><button class="dropdown-item" data-acao="silenciar"><i class="bi ${c.silenciada ? 'bi-bell' : 'bi-bell-slash'}"></i> ${c.silenciada ? 'Reativar notificações' : 'Silenciar'}</button></li>
        ${c.tipo === 'grupo' && c.papel === 'admin' && !c.saiu ? '<li><button class="dropdown-item" data-acao="editar-grupo"><i class="bi bi-pencil"></i> Editar grupo</button></li>' : ''}
        ${c.tipo === 'grupo' && !c.saiu ? '<li><hr class="dropdown-divider"></li><li><button class="dropdown-item text-danger" data-acao="sair"><i class="bi bi-box-arrow-right"></i> Sair do grupo</button></li>' : ''}
      </ul></div>`,
  });
  const fx = aberta.fixadas[0];
  const barra = $('#chat-fixada');
  barra.classList.toggle('d-none', !fx);
  if (fx) {
    barra.innerHTML = `<i class="bi bi-pin-angle-fill"></i><span class="text-truncate"><b>${esc(fx.de_nome?.split(' ')[0] || '')}:</b> ${esc(fx.tipo === 'audio' ? '🎤 Áudio' : fx.texto || '📎 Anexo')}</span>${aberta.fixadas.length > 1 ? `<small class="ms-auto text-body-secondary">+${aberta.fixadas.length - 1}</small>` : ''}`;
    barra.onclick = () => irPara(fx.id);
  }
}

/** Texto da mensagem: links, menções e nº de pedido (#1234) viram destaque; refs vira a lista de cartões a carregar. */
function formatarTexto(m, refs) {
  let h = esc(m.texto);
  const nomes = aberta.membros.filter((x) => m.mencoes.includes(x.id)).map((x) => x.nome).sort((a, b) => b.length - a.length);
  for (const n of nomes) h = h.split(`@${esc(n)}`).join(`<span class="mencao${aberta.membros.find((x) => x.nome === n)?.id === eu() ? ' eu' : ''}">@${esc(n)}</span>`);
  h = h.replace(/(^|\s)@todos\b/gi, '$1<span class="mencao eu">@todos</span>');
  h = h.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const limpo = url.replace(/[.,;)]+$/, '');
    const ref = /#\/crm\/cliente\/(\d+)|#\/cobranca\/cliente\/(\d+)/.exec(limpo);
    if (ref) refs.push(['cliente', ref[1] || ref[2]]);
    const ch = /#\/chamados\?id=(\d+)/.exec(limpo);
    if (ch) refs.push(['chamado', ch[1]]);
    return `<a href="${limpo}" target="_blank" rel="noopener">${limpo}</a>${url.slice(limpo.length)}`;
  });
  h = h.replace(/(^|[\s(])#(\d{3,8})\b/g, (x, a, n) => { refs.push(['pedido', n]); return `${a}<a href="#" class="ref-pedido" data-ref-pedido="${n}">#${n}</a>`; });
  return h;
}

function htmlAnexos(m) {
  if (!m.anexos?.length) return '';
  return `<div class="chat-anexos">${m.anexos.map((a) => {
    if (m.tipo === 'audio' || /^audio\//.test(a.mime || '')) return `<audio controls preload="none" src="/api/chat/anexos/${a.id}" class="chat-audio"></audio>`;
    if (ehImagem(a.mime)) {
      return `<a href="/api/chat/anexos/${a.id}" target="_blank" rel="noopener" class="chat-img" title="${esc(a.nome)}"><img src="/api/chat/anexos/${a.id}" alt="${esc(a.nome)}" loading="lazy"
        ${a.largura && a.altura ? `width="${a.largura}" height="${a.altura}"` : ''}></a>`;
    }
    return `<a href="/api/chat/anexos/${a.id}${/pdf|mp4/.test(a.mime || '') ? '' : '?baixar=1'}" target="_blank" rel="noopener" class="chat-arq"><i class="bi ${icone(a.nome)}"></i>
      <span class="text-truncate">${esc(a.nome)}<small>${tamanho(a.tamanho || 0)}</small></span><i class="bi bi-download ms-auto"></i></a>`;
  }).join('')}</div>`;
}

function statusLeitura(m) {
  const outros = aberta.membros.filter((x) => x.id !== eu() && !x.saiu_em);
  const leram = outros.filter((x) => (x.ultima_lida_id || 0) >= m.id);
  if (aberta.conversa.tipo === 'direta') return `<i class="bi ${leram.length ? 'bi-check2-all lida' : 'bi-check2'}" title="${leram.length ? 'Lida' : 'Enviada'}"></i>`;
  const todos = outros.length && leram.length === outros.length;
  return `<i class="bi ${todos ? 'bi-check2-all lida' : 'bi-check2'}" title="${leram.length ? `Lida por ${leram.map((x) => x.nome.split(' ')[0]).join(', ')}` : 'Enviada'}"></i>`;
}

function desenharConversa({ rolar } = {}) {
  const msgs = aberta.mensagens;
  let dia = '';
  const refs = [];
  const grupo = aberta.conversa.tipo === 'grupo';
  const html = msgs.map((m, i) => {
    const d = m.created_at.slice(0, 10);
    const sep = d !== dia ? `<div class="dia-chat">${d === hojeIso() ? 'Hoje' : fmt.date(d)}</div>` : '';
    dia = d;
    if (m.tipo === 'sistema') return `${sep}<div class="chat-sistema" data-msg="${m.id}">${esc(m.texto)}</div>`;
    const minha = m.de_id === eu();
    const seguida = i > 0 && msgs[i - 1].de_id === m.de_id && msgs[i - 1].tipo !== 'sistema' && msgs[i - 1].created_at.slice(0, 10) === d;
    const nome = grupo && !minha && !seguida ? `<div class="chat-autor" style="color:${corNome(m.de_id)}">${esc(m.de_nome || '')}</div>` : '';
    if (m.apagada_em) {
      return `${sep}<div class="bolha ${minha ? 'minha' : 'dele'} apagada" data-msg="${m.id}">${nome}<i class="bi bi-slash-circle"></i> Mensagem apagada<span class="hora">${m.created_at.slice(11, 16)}</span></div>`;
    }
    const resp = m.resposta ? `<button type="button" class="chat-citacao" data-ir="${m.resposta.id}"><b>${esc(m.resposta.de_nome || '')}</b>
      <span>${m.resposta.apagada ? '<i>Mensagem apagada</i>' : esc(m.resposta.tipo === 'audio' ? '🎤 Áudio' : m.resposta.texto || (m.resposta.anexo ? '📎 Anexo' : ''))}</span></button>` : '';
    const reacoes = {};
    for (const r of m.reacoes) (reacoes[r.emoji] ||= []).push(r.usuario_id);
    const nomesDe = (ids) => ids.map((id) => (id === eu() ? 'Você' : aberta.membros.find((x) => x.id === id)?.nome.split(' ')[0] || '')).join(', ');
    const chips = Object.keys(reacoes).length ? `<div class="chat-reacoes">${Object.entries(reacoes).map(([e, ids]) => `<button type="button" class="reacao ${ids.includes(eu()) ? 'minha' : ''}"
      data-reagir="${m.id}" data-emoji="${e}" title="${esc(nomesDe(ids))}">${e} ${ids.length}</button>`).join('')}</div>` : '';
    const refsMsg = [];
    const corpoTexto = m.texto ? formatarTexto(m, refsMsg) : '';
    refs.push(...refsMsg.map((r) => [...r, m.id]));
    return `${sep}<div class="bolha ${minha ? 'minha' : 'dele'} ${m.anexos?.length ? 'com-anexo' : ''} ${m.mencoes.includes(eu()) ? 'me-menciona' : ''} ${m.fixada_em ? 'fixada' : ''}" data-msg="${m.id}" tabindex="0">
      ${nome}${resp}${htmlAnexos(m)}${corpoTexto ? `<span class="chat-texto">${corpoTexto}</span>` : ''}<div class="chat-cartoes" data-cartoes="${m.id}"></div>
      <span class="hora">${m.fixada_em ? '<i class="bi bi-pin-angle-fill" title="Fixada"></i> ' : ''}${m.editada_em ? 'editada · ' : ''}${m.created_at.slice(11, 16)}${minha ? ` ${statusLeitura(m)}` : ''}</span>
      ${aberta.conversa.somente_leitura ? '' : `<span class="chat-acoes-msg">
        <button type="button" data-responder="${m.id}" title="Responder" aria-label="Responder"><i class="bi bi-reply"></i></button>
        <button type="button" data-emojis="${m.id}" title="Reagir" aria-label="Reagir"><i class="bi bi-emoji-smile"></i></button>
        <button type="button" data-mais="${m.id}" title="Mais opções" aria-label="Mais opções"><i class="bi bi-three-dots"></i></button></span>`}
      ${chips}</div>`;
  }).join('');
  corpo.innerHTML = msgs.length
    ? `${aberta.tem_mais ? '<div class="text-center mb-2"><button type="button" class="btn btn-sm btn-link" data-acao="anteriores">Carregar mensagens anteriores</button></div>' : ''}<div class="bolhas">${html}</div>`
    : `<div class="vazio"><i class="bi bi-chat-heart"></i>Comece a conversa${aberta.conversa.tipo === 'direta' ? ` com ${esc((aberta.conversa.nome || '').split(' ')[0])}` : ''}.</div>`;
  if (rolar === 'fim') corpo.scrollTop = corpo.scrollHeight;
  else if (rolar) corpo.querySelector(rolar)?.scrollIntoView({ block: 'center' });
  carregarCartoes(refs);
}

// ---------- Cartões de pedido, cliente e chamado ----------
const cacheCartao = new Map();
function carregarCartoes(refs) {
  for (const [tipo, id, msgId] of refs) {
    const chave = `${tipo}:${id}`;
    const alvo = corpo.querySelector(`[data-cartoes="${msgId}"]`);
    if (!alvo || alvo.querySelector(`[data-cartao="${chave}"]`)) continue;
    const p = cacheCartao.get(chave) || get(`/api/chat/cartao/${tipo}/${id}`).catch(() => null);
    cacheCartao.set(chave, p);
    p.then((c) => {
      if (!c || !document.body.contains(alvo) || alvo.querySelector(`[data-cartao="${chave}"]`)) return;
      alvo.insertAdjacentHTML('beforeend', htmlCartao(c, chave));
    });
  }
}
function htmlCartao(c, chave) {
  const linha = (i, t, s) => `<button type="button" class="chat-cartao" data-cartao="${chave}" data-tipo="${c.tipo}" data-id="${c.id}"><i class="bi ${i}"></i><span class="text-truncate"><b>${t}</b><small>${s}</small></span><i class="bi bi-chevron-right ms-auto"></i></button>`;
  if (c.tipo === 'pedido') return linha('bi-cart3', `Pedido ${c.numero} · ${esc(c.titulo || '')}`, `${esc(c.etapa_label || c.etapa)} · ${fmt.money(c.valor)}`);
  if (c.tipo === 'cliente') return linha('bi-person', esc(c.titulo), `${esc(c.local || '')}${c.em_aberto ? ` · ${fmt.money(c.em_aberto)} em aberto` : ''}`);
  return linha('bi-headset', `Chamado ${c.numero} · ${esc(c.titulo)}`, esc(c.status));
}
async function abrirCartao(tipo, id) {
  if (tipo === 'pedido') return (await import('./pages/pedido-detalhe.js')).abrirPedido(Number(id));
  if (tipo === 'cliente') { location.hash = pode('crm') ? `#/crm/cliente/${id}` : `#/cobranca/cliente/${id}`; return; }
  location.hash = `#/chamados?id=${id}`;
}

// ---------- Ações nas mensagens ----------
const msgPorId = (id) => aberta?.mensagens.find((x) => x.id === Number(id));
async function irPara(id) {
  if (corpo.querySelector(`[data-msg="${id}"]`)) {
    const el = corpo.querySelector(`[data-msg="${id}"]`);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('destaque');
    void el.offsetWidth;
    el.classList.add('destaque');
  } else await abrirConversa(aberta.conversa.id, { aoRedor: id });
}
function menuEmojis(botao, id) {
  fecharFlutuante();
  const box = document.createElement('div');
  box.className = 'chat-flutuante';
  box.innerHTML = cfg.emojis.map((e) => `<button type="button" data-reagir="${id}" data-emoji="${e}" aria-label="Reagir com ${e}">${e}</button>`).join('');
  posicionar(box, botao);
}
function menuMais(botao, m) {
  fecharFlutuante();
  const minha = m.de_id === eu();
  const admin = aberta.conversa.tipo === 'grupo' && aberta.conversa.papel === 'admin';
  const box = document.createElement('div');
  box.className = 'chat-flutuante vertical';
  box.innerHTML = [
    m.texto ? '<button type="button" data-op="copiar"><i class="bi bi-clipboard"></i> Copiar texto</button>' : '',
    `<button type="button" data-op="fixar"><i class="bi bi-pin-angle"></i> ${m.fixada_em ? 'Desafixar' : 'Fixar na conversa'}</button>`,
    minha && m.texto && m.tipo !== 'audio' ? '<button type="button" data-op="editar"><i class="bi bi-pencil"></i> Editar</button>' : '',
    minha || admin ? '<button type="button" data-op="apagar" class="text-danger"><i class="bi bi-trash"></i> Apagar para todos</button>' : '',
  ].join('');
  box.addEventListener('click', async (e) => {
    const op = e.target.closest('[data-op]')?.dataset.op;
    if (!op) return;
    fecharFlutuante();
    if (op === 'copiar') { await navigator.clipboard?.writeText(m.texto); toast('Texto copiado.'); }
    if (op === 'fixar') { await tentar(() => post(`/api/chat/mensagens/${m.id}/fixar`)); atualizarConversa(); }
    if (op === 'editar') { editando = m; respondendo = null; texto.value = m.texto; desenharComposer(); texto.focus(); }
    if (op === 'apagar' && await confirmar('Apagar esta mensagem para todos? Ela some da conversa (o registro fica na auditoria).', { titulo: 'Apagar mensagem', ok: 'Apagar', cls: 'btn-danger' })) {
      await tentar(() => del(`/api/chat/mensagens/${m.id}`));
      atualizarConversa();
    }
  });
  posicionar(box, botao);
}
function posicionar(box, botao) {
  painel.appendChild(box);
  const r = botao.getBoundingClientRect();
  const p = painel.getBoundingClientRect();
  box.style.top = `${Math.max(8, r.top - p.top - box.offsetHeight - 4)}px`;
  box.style.left = `${Math.min(p.width - box.offsetWidth - 8, Math.max(8, r.left - p.left - box.offsetWidth / 2))}px`;
}
const fecharFlutuante = () => painel.querySelectorAll('.chat-flutuante').forEach((x) => x.remove());

corpo.addEventListener('click', async (e) => {
  const alvo = e.target.closest('button, a');
  if (!alvo) {
    // Toque na bolha (celular) mostra as ações.
    const b = e.target.closest('.bolha');
    corpo.querySelectorAll('.bolha.acoes').forEach((x) => x !== b && x.classList.remove('acoes'));
    b?.classList.toggle('acoes');
    return;
  }
  const ds = alvo.dataset;
  if (ds.responder) { respondendo = msgPorId(ds.responder); editando = null; desenharComposer(); texto.focus(); }
  else if (ds.emojis) menuEmojis(alvo, ds.emojis);
  else if (ds.mais) menuMais(alvo, msgPorId(ds.mais));
  else if (ds.reagir) { fecharFlutuante(); await tentar(() => post(`/api/chat/mensagens/${ds.reagir}/reacao`, { emoji: ds.emoji })); atualizarConversa(); }
  else if (ds.ir) irPara(Number(ds.ir));
  else if (ds.refPedido) { e.preventDefault(); const c = await (cacheCartao.get(`pedido:${ds.refPedido}`) || Promise.resolve(null)); if (c) abrirCartao('pedido', c.id); else toast('Pedido não encontrado ou sem acesso.', 'warning'); }
  else if (ds.cartao) abrirCartao(ds.tipo, ds.id);
  else if (ds.acao === 'anteriores') {
    const antes = aberta.mensagens[0]?.id;
    const d = await get(`/api/chat/c/${aberta.conversa.id}?antes=${antes}`).catch(() => null);
    if (!d) return;
    const altura = corpo.scrollHeight;
    aberta.mensagens = [...d.mensagens, ...aberta.mensagens];
    aberta.tem_mais = d.tem_mais;
    desenharConversa();
    corpo.scrollTop = corpo.scrollHeight - altura;
  }
});
painel.addEventListener('click', async (e) => {
  const reagir = e.target.closest('.chat-flutuante [data-reagir]');
  if (reagir) {
    fecharFlutuante();
    await tentar(() => post(`/api/chat/mensagens/${reagir.dataset.reagir}/reacao`, { emoji: reagir.dataset.emoji }));
    return atualizarConversa();
  }
  if (!e.target.closest('.chat-flutuante, [data-emojis], [data-mais]')) fecharFlutuante();
});

// ======================= Escrever =======================
function desenharComposer() {
  const barra = $('#chat-contexto');
  const alvo = editando || respondendo;
  barra.classList.toggle('d-none', !alvo);
  if (alvo) {
    barra.innerHTML = `<i class="bi ${editando ? 'bi-pencil' : 'bi-reply'}"></i><span class="text-truncate"><b>${editando ? 'Editando mensagem' : `Respondendo a ${esc(alvo.de_nome || '')}`}</b>
      <small>${esc(alvo.tipo === 'audio' ? '🎤 Áudio' : alvo.texto || '📎 Anexo')}</small></span><button type="button" class="btn btn-icon ms-auto" data-cancelar aria-label="Cancelar"><i class="bi bi-x"></i></button>`;
    barra.querySelector('[data-cancelar]').onclick = () => { if (editando) texto.value = ''; editando = null; respondendo = null; desenharComposer(); };
  }
  $('#chat-gravar').classList.toggle('d-none', !!editando || !window.MediaRecorder);
  $('#chat-anexar').classList.toggle('d-none', !!editando);
}

// ---------- Menções ----------
function sugestoesMencao() {
  const box = $('#chat-mencoes');
  if (aberta?.conversa.tipo !== 'grupo') return box.classList.add('d-none');
  const pos = texto.selectionStart;
  const m = /(^|\s)@([^\s@]*)$/.exec(texto.value.slice(0, pos));
  if (!m) return box.classList.add('d-none');
  const t = m[2].toLowerCase();
  const opcoes = [...(('todos'.startsWith(t)) ? [{ id: 0, nome: 'todos', sub: 'avisa todos do grupo' }] : []),
    ...aberta.membros.filter((x) => !x.saiu_em && x.id !== eu() && x.ativo && x.nome.toLowerCase().includes(t)).map((x) => ({ id: x.id, nome: x.nome, sub: x.perfil_label }))].slice(0, 6);
  if (!opcoes.length) return box.classList.add('d-none');
  box.classList.remove('d-none');
  box.innerHTML = opcoes.map((o, i) => `<button type="button" class="${i ? '' : 'ativo'}" data-mencionar="${o.id}" data-nome="${esc(o.nome)}"><b>@${esc(o.nome)}</b><small>${esc(o.sub || '')}</small></button>`).join('');
  box.querySelectorAll('[data-mencionar]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); inserirMencao(b.dataset.nome, Number(b.dataset.mencionar)); }));
}
function inserirMencao(nome, id) {
  const pos = texto.selectionStart;
  const antes = texto.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${nome} `);
  texto.value = antes + texto.value.slice(pos);
  texto.selectionStart = texto.selectionEnd = antes.length;
  if (id) mencoesSel.set(nome, id);
  $('#chat-mencoes').classList.add('d-none');
  texto.focus();
}
const mencoesNoTexto = (t) => [...mencoesSel.entries()].filter(([n]) => t.includes(`@${n}`)).map(([, id]) => id);

// ---------- Anexos ----------
async function prepararImagem(arquivo) {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return { arquivo };
  const img = await createImageBitmap(arquivo).catch(() => null);
  if (!img) return { arquivo };
  const escala = Math.min(1, 1920 / Math.max(img.width, img.height));
  if (escala === 1 && arquivo.size <= 1.5 * 1024 * 1024) return { arquivo, largura: img.width, altura: img.height };
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * escala), height: Math.round(img.height * escala) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
  if (!blob || blob.size >= arquivo.size) return { arquivo, largura: img.width, altura: img.height };
  return { arquivo: new File([blob], arquivo.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' }), largura: canvas.width, altura: canvas.height };
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
async function enviarFormulario(campos, arquivos) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v != null) fd.append(k, v);
  arquivos.forEach((f) => fd.append('arquivos', f, f.name));
  const r = await fetch(`/api/chat/c/${aberta.conversa.id}/anexos`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'agroterra' } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Falha ao enviar.');
  return d;
}

// ---------- Áudio ----------
const TIPOS_AUDIO = [['audio/webm;codecs=opus', 'webm'], ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'm4a'], ['audio/webm', 'webm']];
async function gravarAudio() {
  if (gravacao) return pararGravacao(true);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Permita o microfone no navegador para gravar áudio.', 'warning'); }
  const [mime, ext] = TIPOS_AUDIO.find(([t]) => MediaRecorder.isTypeSupported?.(t)) || ['', 'webm'];
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
  const partes = [];
  rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
  const inicio = Date.now();
  gravacao = { rec, stream, partes, ext, inicio, enviar: false };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(gravacao.relogio);
    const { enviar } = gravacao;
    gravacao = null;
    desenharGravacao();
    if (!enviar) return;
    const tipo = (rec.mimeType || mime || 'audio/webm').split(';')[0];
    const arquivo = new File(partes, `audio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, { type: tipo });
    if (arquivo.size > MAX_BYTES) return toast('Áudio longo demais.', 'warning');
    try {
      const m = await enviarFormulario({ tipo: 'audio', responde_a: respondendo?.id }, [arquivo]);
      respondendo = null;
      desenharComposer();
      aberta.mensagens.push(m);
      desenharConversa({ rolar: 'fim' });
    } catch (e) { erro(e); }
  };
  rec.start(1000);
  gravacao.relogio = setInterval(() => {
    desenharGravacao();
    if (Date.now() - inicio > 5 * 60e3) pararGravacao(true);
  }, 500);
  desenharGravacao();
}
function pararGravacao(enviar) {
  if (!gravacao) return;
  gravacao.enviar = enviar;
  gravacao.rec.stop();
}
function desenharGravacao() {
  const box = $('#chat-gravando');
  box.classList.toggle('d-none', !gravacao);
  texto.classList.toggle('d-none', !!gravacao);
  $('#chat-gravar').innerHTML = `<i class="bi ${gravacao ? 'bi-send-fill' : 'bi-mic'}"></i>`;
  $('#chat-gravar').setAttribute('aria-label', gravacao ? 'Enviar áudio' : 'Gravar áudio');
  $('#chat-enviar').classList.toggle('d-none', !!gravacao);
  if (!gravacao) return;
  const s = Math.floor((Date.now() - gravacao.inicio) / 1000);
  box.innerHTML = `<span class="gravando-ponto"></span> Gravando ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}
    <button type="button" class="btn btn-sm btn-link text-danger ms-auto" data-cancelar-audio>Cancelar</button>`;
  box.querySelector('[data-cancelar-audio]').onclick = () => pararGravacao(false);
}

// ---------- Enviar ----------
$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = texto.value.trim();
  if ((!t && !pendentes.length) || !aberta) return;
  const botao = $('#chat-enviar');
  botao.disabled = true;
  const enviando = pendentes;
  try {
    if (editando) {
      await put(`/api/chat/mensagens/${editando.id}`, { texto: t });
      editando = null;
      texto.value = '';
      desenharComposer();
      await atualizarConversa();
      return;
    }
    const mencoes = mencoesNoTexto(t);
    texto.value = '';
    texto.style.height = 'auto';
    let m;
    if (enviando.length) {
      if (enviando.reduce((a, p) => a + p.arquivo.size, 0) > MAX_BYTES) throw new Error('Os anexos somam mais de 4 MB. Envie em partes.');
      m = await enviarFormulario({ texto: t, responde_a: respondendo?.id, mencoes: JSON.stringify(mencoes),
        medidas: JSON.stringify(enviando.map((p) => ({ largura: p.largura, altura: p.altura }))) }, enviando.map((p) => p.arquivo));
      limparPendentes();
    } else {
      m = await post(`/api/chat/c/${aberta.conversa.id}/mensagens`, { texto: t, responde_a: respondendo?.id, mencoes });
    }
    respondendo = null;
    mencoesSel = new Map();
    desenharComposer();
    if (!aberta.mensagens.some((x) => x.id === m.id)) aberta.mensagens.push(m);
    desenharConversa({ rolar: 'fim' });
  } catch (err) {
    if (!editando) texto.value = t;
    erro(err);
  } finally {
    botao.disabled = false;
  }
});
texto.addEventListener('input', () => {
  texto.style.height = 'auto';
  texto.style.height = Math.min(texto.scrollHeight, 120) + 'px';
  sugestoesMencao();
  avisarDigitando();
});
texto.addEventListener('keydown', (e) => {
  const box = $('#chat-mencoes');
  if (!box.classList.contains('d-none') && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
    const itens = [...box.querySelectorAll('button')];
    const i = itens.findIndex((x) => x.classList.contains('ativo'));
    e.preventDefault();
    if (e.key === 'Escape') return box.classList.add('d-none');
    if (e.key === 'Enter' || e.key === 'Tab') { const b = itens[i]; return inserirMencao(b.dataset.nome, Number(b.dataset.mencionar)); }
    itens[i]?.classList.remove('ativo');
    itens[(i + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length].classList.add('ativo');
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); }
  if (e.key === 'Escape' && (editando || respondendo)) { if (editando) texto.value = ''; editando = null; respondendo = null; desenharComposer(); }
  if (e.key === 'ArrowUp' && !texto.value && aberta) {
    const minha = [...aberta.mensagens].reverse().find((m) => m.de_id === eu() && !m.apagada_em && m.texto && m.tipo === 'texto');
    if (minha) { e.preventDefault(); editando = minha; texto.value = minha.texto; desenharComposer(); }
  }
});
texto.addEventListener('blur', () => setTimeout(() => $('#chat-mencoes').classList.add('d-none'), 150));
$('#chat-anexar').addEventListener('click', () => $('#chat-arquivo').click());
$('#chat-arquivo').addEventListener('change', (e) => { adicionarArquivos([...e.target.files]); e.target.value = ''; });
$('#chat-gravar').addEventListener('click', gravarAudio);
texto.addEventListener('paste', (e) => {
  const arquivos = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (arquivos.length) { e.preventDefault(); adicionarArquivos(arquivos); }
});
painel.addEventListener('dragover', (e) => { if (aberta && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); painel.classList.add('soltando'); } });
painel.addEventListener('dragleave', (e) => { if (!painel.contains(e.relatedTarget)) painel.classList.remove('soltando'); });
painel.addEventListener('drop', (e) => {
  painel.classList.remove('soltando');
  if (!aberta || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  adicionarArquivos([...e.dataTransfer.files]);
});

// ======================= Busca =======================
async function abrirBusca() {
  visao = 'busca';
  aberta = null;
  $('#chat-form').classList.add('d-none');
  $('#chat-fixada').classList.add('d-none');
  cabecalho('<strong>Buscar mensagens</strong>', { voltar: true });
  contatos ||= await get('/api/chat/contatos').catch(() => []);
  corpo.innerHTML = `<form class="vstack gap-2 mb-2" id="chat-busca">
      <input class="form-control form-control-sm" name="q" placeholder="Palavra, nº do pedido ou nome do arquivo" aria-label="Texto da busca" autofocus>
      <div class="d-flex gap-2"><select class="form-select form-select-sm" name="pessoa" aria-label="Enviada por"><option value="">Qualquer pessoa</option>
        <option value="${eu()}">Eu</option>${contatos.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></div>
      <div class="d-flex gap-2"><input type="date" class="form-control form-control-sm" name="de" aria-label="De"><input type="date" class="form-control form-control-sm" name="ate" aria-label="Até">
        <button class="btn btn-sm btn-primary" aria-label="Buscar"><i class="bi bi-search"></i></button></div></form><div id="chat-resultados"></div>`;
  const f = corpo.querySelector('#chat-busca');
  f.q.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = new URLSearchParams([...new FormData(f)].filter(([, v]) => v)).toString();
    const r = await get(`/api/chat/busca?${q}`).catch((err) => { erro(err); return null; });
    if (!r) return;
    const termo = f.q.value.trim();
    const marcar = (t) => (termo.length >= 2 ? esc(t).replace(new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (x) => `<mark>${x}</mark>`) : esc(t));
    corpo.querySelector('#chat-resultados').innerHTML = r.length ? r.map((m) => `<button class="chat-contato" data-resultado="${m.id}" data-c="${m.conversa_id}">
        <span class="meta"><strong>${esc(m.conversa || 'Conversa')} <small class="d-inline text-body-secondary">· ${esc(m.de_nome || '')}</small></strong>
        <small style="white-space:normal">${m.tipo === 'audio' ? '🎤 Áudio' : marcar(m.texto || '')}${m.anexos ? ` 📎 ${marcar(m.anexos)}` : ''}</small></span>
        <small class="text-body-secondary">${fmt.date(m.created_at).slice(0, 5)}</small></button>`).join('')
      : '<div class="vazio py-3"><i class="bi bi-search"></i>Nada encontrado.</div>';
    corpo.querySelectorAll('[data-resultado]').forEach((b) => b.addEventListener('click', () => abrirConversa(Number(b.dataset.c), { aoRedor: Number(b.dataset.resultado) })));
  });
}

// ======================= Grupos =======================
const PERFIS_SETOR = { comercial: ['vendedor', 'supervisor', 'gerente'], analista: ['analista'], financeiro: ['financeiro'], producao: ['producao'], faturamento: ['faturamento'],
  expedicao: ['expedicao'], rh: ['rh'], compras: ['compras'], diretoria: ['diretoria', 'admin'] };
const NOMES_SETOR = { comercial: 'Comercial', analista: 'Análise de crédito', financeiro: 'Financeiro', producao: 'Produção', faturamento: 'Faturamento', expedicao: 'Expedição e logística', rh: 'RH', compras: 'Compras', diretoria: 'Diretoria' };
function seletorPessoas(lista, marcados = new Set()) {
  return `<div class="d-flex gap-2 mb-2"><input class="form-control form-control-sm" data-filtro-pessoas placeholder="Filtrar pessoas" aria-label="Filtrar pessoas">
      <select class="form-select form-select-sm" data-setor aria-label="Adicionar um setor inteiro" style="max-width:12rem"><option value="">+ Setor inteiro</option>
        ${Object.entries(NOMES_SETOR).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="chat-escolha">${lista.map((p) => `<label class="form-check" data-nome="${esc(`${p.nome} ${p.perfil_label} ${p.departamento || ''}`.toLowerCase())}" data-perfil="${p.perfil}">
      <input class="form-check-input" type="checkbox" value="${p.id}" ${marcados.has(p.id) ? 'checked' : ''}><span class="form-check-label">${esc(p.nome)} <small class="text-body-secondary">${esc(p.perfil_label)}${p.departamento ? ` · ${esc(p.departamento)}` : ''}</small></span></label>`).join('')}</div>
    <div class="form-text" data-contagem></div>`;
}
function ligarSeletor(body) {
  const conta = () => { body.querySelector('[data-contagem]').textContent = `${body.querySelectorAll('.chat-escolha input:checked').length} selecionada(s)`; };
  body.querySelector('[data-filtro-pessoas]').addEventListener('input', (e) => {
    const t = e.target.value.toLowerCase();
    body.querySelectorAll('.chat-escolha label').forEach((l) => l.classList.toggle('d-none', !!t && !l.dataset.nome.includes(t)));
  });
  body.querySelector('[data-setor]').addEventListener('change', (e) => {
    const perfis = PERFIS_SETOR[e.target.value] || [];
    body.querySelectorAll('.chat-escolha label').forEach((l) => { if (perfis.includes(l.dataset.perfil)) l.querySelector('input').checked = true; });
    if (e.target.value) { const nome = body.querySelector('[name=nome]'); if (nome && !nome.value) nome.value = NOMES_SETOR[e.target.value]; }
    e.target.value = '';
    conta();
  });
  body.addEventListener('change', conta);
  conta();
}
const escolhidos = (body) => [...body.querySelectorAll('.chat-escolha input:checked')].map((x) => Number(x.value));

async function novoGrupo() {
  contatos ||= await get('/api/chat/contatos').catch(() => []);
  modal({
    title: '<i class="bi bi-people"></i> Novo grupo', size: 'md',
    body: `<div class="mb-2"><label class="form-label">Nome do grupo<span class="obrigatorio">*</span></label><input class="form-control form-control-sm" name="nome" maxlength="80" placeholder="Ex.: Financeiro, Logística, Pedido 1234"></div>
      <div class="mb-2"><label class="form-label">Descrição</label><input class="form-control form-control-sm" name="descricao" maxlength="300"></div>
      <label class="form-label">Membros</label>${seletorPessoas(contatos)}`,
    onShow: ({ body }) => ligarSeletor(body),
    buttons: [{ label: 'Criar grupo', onClick: async ({ body }) => {
      const r = await post('/api/chat/grupos', { nome: body.querySelector('[name=nome]').value, descricao: body.querySelector('[name=descricao]').value, membros: escolhidos(body) });
      abrirConversa(r.id);
    } }],
  });
}

function verMembros() {
  const c = aberta.conversa;
  const admin = c.papel === 'admin' && !c.saiu;
  const ativos = aberta.membros.filter((m) => !m.saiu_em);
  modal({
    title: `<i class="bi bi-people"></i> ${esc(c.nome)}`, size: 'md',
    body: `${c.descricao ? `<p class="small text-body-secondary">${esc(c.descricao)}</p>` : ''}<div class="list-group mb-2">${ativos.map((m) => `<div class="list-group-item d-flex align-items-center gap-2">
        ${avatar(m, `avatar-sm ${online.has(m.id) ? 'online' : ''}`)}<span class="flex-grow-1">${esc(m.nome)}${m.id === eu() ? ' (você)' : ''} <small class="d-block text-body-secondary">${esc(m.perfil_label || '')}</small></span>
        ${m.papel === 'admin' ? '<span class="badge text-bg-success">Admin</span>' : ''}
        ${admin && m.id !== eu() ? `<button class="btn btn-sm btn-outline-secondary py-0" data-admin="${m.id}" title="${m.papel === 'admin' ? 'Tirar de administrador' : 'Tornar administrador'}" aria-label="Alterar administrador"><i class="bi bi-shield"></i></button>
          <button class="btn btn-sm btn-outline-danger py-0" data-remover="${m.id}" title="Remover do grupo" aria-label="Remover ${esc(m.nome)}"><i class="bi bi-person-dash"></i></button>` : ''}</div>`).join('')}</div>`,
    onShow: ({ body, close }) => {
      body.querySelectorAll('[data-admin]').forEach((b) => b.addEventListener('click', async () => { await tentar(() => post(`/api/chat/c/${c.id}/membros/${b.dataset.admin}/admin`)); close(); await atualizarConversa(); verMembros(); }));
      body.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmar('Remover esta pessoa do grupo?', { titulo: 'Remover membro', ok: 'Remover', cls: 'btn-danger' }))) return;
        await tentar(() => del(`/api/chat/c/${c.id}/membros/${b.dataset.remover}`));
        close();
        atualizarConversa();
      }));
    },
    buttons: admin ? [{ label: '<i class="bi bi-person-plus"></i> Adicionar pessoas', onClick: () => { adicionarPessoas(); } }] : [],
  });
}
async function adicionarPessoas() {
  contatos ||= await get('/api/chat/contatos').catch(() => []);
  const ja = new Set(aberta.membros.filter((m) => !m.saiu_em).map((m) => m.id));
  modal({
    title: '<i class="bi bi-person-plus"></i> Adicionar ao grupo', size: 'md', body: seletorPessoas(contatos.filter((p) => !ja.has(p.id))),
    onShow: ({ body }) => ligarSeletor(body),
    buttons: [{ label: 'Adicionar', onClick: async ({ body }) => { await post(`/api/chat/c/${aberta.conversa.id}/membros`, { usuarios: escolhidos(body) }); atualizarConversa(); } }],
  });
}
function editarGrupo() {
  const c = aberta.conversa;
  modal({
    title: '<i class="bi bi-pencil"></i> Editar grupo', size: 'md',
    body: `<div class="mb-2"><label class="form-label">Nome</label><input class="form-control form-control-sm" name="nome" maxlength="80" value="${esc(c.nome)}"></div>
      <div><label class="form-label">Descrição</label><input class="form-control form-control-sm" name="descricao" maxlength="300" value="${esc(c.descricao || '')}"></div>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => { await put(`/api/chat/c/${c.id}`, { nome: body.querySelector('[name=nome]').value, descricao: body.querySelector('[name=descricao]').value }); atualizarConversa(); } }],
  });
}
function verFixadas() {
  modal({
    title: '<i class="bi bi-pin-angle"></i> Mensagens fixadas', size: 'md',
    body: `<div class="list-group">${aberta.fixadas.map((f) => `<button class="list-group-item list-group-item-action" data-ir="${f.id}"><b>${esc(f.de_nome || '')}</b>
      <div class="small">${esc(f.tipo === 'audio' ? '🎤 Áudio' : f.texto || '📎 Anexo')}</div><small class="text-body-secondary">fixada em ${fmt.datetime(f.fixada_em)}</small></button>`).join('')}</div>`,
    onShow: ({ body, close }) => body.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => { close(); irPara(Number(b.dataset.ir)); })),
  });
}

// Botões do cabeçalho (lista e conversa).
$('#chat-acoes').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-acao]')?.dataset.acao;
  if (!a) return;
  if (a === 'buscar') abrirBusca();
  if (a === 'grupo') novoGrupo();
  if (a === 'membros') verMembros();
  if (a === 'fixadas') verFixadas();
  if (a === 'editar-grupo') editarGrupo();
  if (a === 'silenciar') {
    await tentar(() => post(`/api/chat/c/${aberta.conversa.id}/silenciar`, { silenciada: !aberta.conversa.silenciada }),
      aberta.conversa.silenciada ? 'Notificações reativadas.' : 'Conversa silenciada: só menções a você avisam.');
    atualizarConversa();
  }
  if (a === 'sair' && await confirmar('Sair deste grupo? Você continua vendo as mensagens até agora, mas não recebe as novas.', { titulo: 'Sair do grupo', ok: 'Sair', cls: 'btn-danger' })) {
    await tentar(() => del(`/api/chat/c/${aberta.conversa.id}/membros/${eu()}`));
    listar();
  }
});
$('#chat-fechar').addEventListener('click', () => alternar(false));
$('#chat-voltar').addEventListener('click', () => { if (gravacao) pararGravacao(false); listar(); });
$('#chat-expandir').addEventListener('click', () => {
  const g = painel.classList.toggle('chat-grande');
  $('#chat-expandir').innerHTML = `<i class="bi ${g ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}"></i>`;
  try { localStorage.setItem('agt-chat-grande', g ? '1' : ''); } catch {}
});
try { if (localStorage.getItem('agt-chat-grande')) { painel.classList.add('chat-grande'); $('#chat-expandir').innerHTML = '<i class="bi bi-fullscreen-exit"></i>'; } } catch {}
// Esc fecha o chat, mas não quando acabou de fechar uma janela (pedido, confirmação) aberta por cima.
let modalFechadoEm = 0;
document.addEventListener('hide.bs.modal', () => { modalFechadoEm = Date.now(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || painel.hidden || document.querySelector('.modal.show') || Date.now() - modalFechadoEm < 500) return;
  if (!editando && !respondendo && $('#chat-mencoes').classList.contains('d-none')) alternar(false);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && aberta) atualizarConversa(); });
