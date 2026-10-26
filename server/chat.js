// Chat interno: conversas diretas e grupos, leitura, menções, notificações (Web Push) e sinais de tempo real.
// Tempo real: o servidor publica só um "sinal" (qual conversa mudou) num canal do Supabase Realtime cujo nome é secreto
// (HMAC por usuário); o conteúdo sempre vem da API autenticada. Sem Supabase configurado, o navegador consulta a cada poucos segundos.
const crypto = require('node:crypto');
const db = require('./db');
const S = require('./services');
const sse = require('./sse');

const { ErroNegocio } = S;
const EMOJIS = ['👍', '✅', '👀', '❤️', '😂', '🙏'];
const MAX_TEXTO = 4000;

// ---------- Tempo real ----------
const segredo = () => process.env.SESSION_SECRET || 'agt-dev';
const hmac = (s) => crypto.createHmac('sha256', segredo()).update(s).digest('hex').slice(0, 32);
const topicoUsuario = (id) => `agt-u-${hmac(`chat-u:${id}`)}`;
const topicoConversa = (id) => `agt-c-${hmac(`chat-c:${id}`)}`;
const topicoPresenca = () => `agt-p-${hmac('chat-presenca')}`;
function configRealtime() {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  return url && chave ? { url: url.replace(/\/$/, ''), chave } : null;
}

/** Avisa os usuários que algo mudou numa conversa (Supabase Realtime + SSE local). Nunca derruba a operação. */
async function sinal(usuarioIds, dados) {
  const ids = [...new Set(usuarioIds.map(Number).filter(Boolean))];
  if (!ids.length) return;
  sse.enviar('chat_sinal', dados, { usuarios: ids });
  const rt = configRealtime();
  if (!rt) return;
  try {
    const r = await fetch(`${rt.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: rt.chave, Authorization: `Bearer ${rt.chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: ids.map((id) => ({ topic: topicoUsuario(id), event: 'chat', payload: dados, private: false })) }),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) console.error('chat: tempo real recusou o sinal', r.status, (await r.text().catch(() => '')).slice(0, 200));
  } catch (e) {
    console.error('chat: falha no sinal de tempo real', e.message);
  }
}

// ---------- Conversas e membros ----------
const membrosAtivos = async (conversaId) => (await db.all(`SELECT mb.usuario_id FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id
  WHERE mb.conversa_id = ? AND mb.saiu_em IS NULL AND u.ativo = 1`, conversaId)).map((x) => x.usuario_id);

/** Membro da conversa (ou erro). escrever=true exige que ainda participe. */
async function membro(conversaId, usuarioId, { escrever = false } = {}) {
  const c = await db.get('SELECT * FROM chat_conversas WHERE id = ?', Number(conversaId));
  const m = c && await db.get('SELECT * FROM chat_membros WHERE conversa_id = ? AND usuario_id = ?', c.id, usuarioId);
  if (!c || !m) throw new ErroNegocio('Conversa não encontrada.', 404);
  if (escrever && m.saiu_em) throw new ErroNegocio('Você não participa mais desta conversa.', 403);
  if (escrever && c.tipo === 'direta') {
    const outro = await db.get(`SELECT u.ativo FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id WHERE mb.conversa_id = ? AND mb.usuario_id <> ?`, c.id, usuarioId);
    if (outro && !outro.ativo) throw new ErroNegocio('Este usuário foi desativado. A conversa fica só para consulta.', 403);
  }
  return { conversa: c, membro: m };
}

async function conversaDireta(eu, outro) {
  outro = Number(outro);
  if (outro === eu) throw new ErroNegocio('Escolha outra pessoa.');
  if (!(await db.get('SELECT id FROM usuarios WHERE id = ? AND ativo = 1', outro))) throw new ErroNegocio('Usuário não encontrado.', 404);
  const chave = `dm:${Math.min(eu, outro)}:${Math.max(eu, outro)}`;
  let c = await db.get('SELECT id FROM chat_conversas WHERE chave = ?', chave);
  if (!c) {
    c = await db.get(`INSERT INTO chat_conversas (tipo, chave, criado_por) VALUES ('direta', ?, ?) ON CONFLICT (chave) DO UPDATE SET chave = EXCLUDED.chave RETURNING id`, chave, eu);
    for (const u of [eu, outro]) {
      await db.run('INSERT INTO chat_membros (conversa_id, usuario_id, ultima_lida_id) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', c.id, u);
    }
  }
  return c.id;
}

const tocar = (conversaId) => db.run(`UPDATE chat_conversas SET atualizada_em = sq_datetime('now', 'localtime') WHERE id = ?`, conversaId);

async function mensagemSistema(conversaId, autorId, texto) {
  const m = await db.get(`INSERT INTO chat_mensagens (conversa_id, de_id, texto, tipo) VALUES (?, ?, ?, 'sistema') RETURNING id`, conversaId, autorId, texto);
  await tocar(conversaId);
  return m.id;
}

const nomeDe = async (id) => (await db.get('SELECT nome FROM usuarios WHERE id = ?', id))?.nome || 'Alguém';

async function criarGrupo(eu, { nome, descricao, membros = [] }) {
  nome = String(nome || '').trim();
  if (nome.length < 2) throw new ErroNegocio('Dê um nome ao grupo.');
  const ids = [...new Set(membros.map(Number).filter((x) => x && x !== eu))];
  if (!ids.length) throw new ErroNegocio('Escolha ao menos uma pessoa para o grupo.');
  const ativos = (await db.all(`SELECT id FROM usuarios WHERE ativo = 1 AND id IN (${ids.join(',')})`)).map((x) => x.id);
  const c = await db.get(`INSERT INTO chat_conversas (tipo, nome, descricao, criado_por) VALUES ('grupo', ?, ?, ?) RETURNING id`, nome.slice(0, 80), String(descricao || '').slice(0, 300) || null, eu);
  await db.run(`INSERT INTO chat_membros (conversa_id, usuario_id, papel, ultima_lida_id) VALUES (?, ?, 'admin', 0)`, c.id, eu);
  for (const u of ativos) await db.run(`INSERT INTO chat_membros (conversa_id, usuario_id, ultima_lida_id) VALUES (?, ?, 0)`, c.id, u);
  await mensagemSistema(c.id, eu, `${await nomeDe(eu)} criou o grupo "${nome}"`);
  await sinal([eu, ...ativos], { tipo: 'conversa', conversa_id: c.id });
  return c.id;
}

async function adicionarMembros(conversa, eu, usuarios) {
  const ids = [...new Set((usuarios || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new ErroNegocio('Escolha quem adicionar.');
  const ativos = await db.all(`SELECT id, nome FROM usuarios WHERE ativo = 1 AND id IN (${ids.join(',')})`);
  const novos = [];
  for (const u of ativos) {
    const r = await db.run(`INSERT INTO chat_membros (conversa_id, usuario_id, ultima_lida_id) VALUES (?, ?, 0)
      ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET saiu_em = NULL, saiu_ate_id = NULL, entrou_em = sq_datetime('now', 'localtime') WHERE chat_membros.saiu_em IS NOT NULL`, conversa.id, u.id);
    if (r.changes) novos.push(u.nome);
  }
  if (novos.length) await mensagemSistema(conversa.id, eu, `${await nomeDe(eu)} adicionou ${novos.join(', ')}`);
  await sinal(await membrosAtivos(conversa.id), { tipo: 'conversa', conversa_id: conversa.id });
  return novos.length;
}

async function removerMembro(conversa, eu, usuarioId, motivo) {
  const r = await db.run(`UPDATE chat_membros SET saiu_em = sq_datetime('now', 'localtime'),
    saiu_ate_id = (SELECT COALESCE(MAX(id), 0) FROM chat_mensagens WHERE conversa_id = ?) WHERE conversa_id = ? AND usuario_id = ? AND saiu_em IS NULL`, conversa.id, conversa.id, usuarioId);
  if (!r.changes) return;
  const nome = await nomeDe(usuarioId);
  await mensagemSistema(conversa.id, eu, motivo || (usuarioId === eu ? `${nome} saiu do grupo` : `${await nomeDe(eu)} removeu ${nome}`));
  // Grupo sem administrador: o membro mais antigo assume.
  if (!(await db.get(`SELECT 1 AS x FROM chat_membros WHERE conversa_id = ? AND papel = 'admin' AND saiu_em IS NULL`, conversa.id))) {
    await db.run(`UPDATE chat_membros SET papel = 'admin' WHERE conversa_id = ? AND usuario_id = (
      SELECT usuario_id FROM chat_membros WHERE conversa_id = ? AND saiu_em IS NULL ORDER BY entrou_em, usuario_id LIMIT 1)`, conversa.id, conversa.id);
  }
  await sinal([usuarioId, ...(await membrosAtivos(conversa.id))], { tipo: 'conversa', conversa_id: conversa.id });
}

/** Desligamento ou desativação do usuário: sai de todos os grupos e para de receber notificações; o histórico fica. */
async function encerrarAcesso(usuarioId) {
  const grupos = await db.all(`SELECT c.* FROM chat_conversas c JOIN chat_membros mb ON mb.conversa_id = c.id
    WHERE mb.usuario_id = ? AND mb.saiu_em IS NULL AND c.tipo = 'grupo'`, usuarioId);
  const nome = await nomeDe(usuarioId);
  for (const g of grupos) await removerMembro(g, usuarioId, usuarioId, `${nome} saiu do grupo (acesso encerrado)`);
  await db.run('DELETE FROM push_inscricoes WHERE usuario_id = ?', usuarioId);
  return grupos.length;
}

// ---------- Listagem ----------
const PREVIA = `CASE WHEN m.apagada_em IS NOT NULL THEN '🚫 Mensagem apagada' WHEN m.tipo = 'audio' THEN '🎤 Áudio'
  WHEN m.texto = '' THEN '📎 Anexo' ELSE m.texto END`;
// Mensagens que o membro pode ver: até sair da conversa.
const VISIVEL = '(mb.saiu_em IS NULL OR m.id <= COALESCE(mb.saiu_ate_id, 0))';

async function listarConversas(eu) {
  const linhas = await db.all(`SELECT c.id, c.tipo, c.nome, c.descricao, c.atualizada_em, mb.silenciada, mb.papel, mb.saiu_em,
      o.id AS outro_id, o.nome AS outro_nome, o.perfil AS outro_perfil, o.ativo AS outro_ativo, o.foto IS NOT NULL AS outro_tem_foto,
      (SELECT COUNT(*) FROM chat_membros x WHERE x.conversa_id = c.id AND x.saiu_em IS NULL) AS membros,
      (SELECT COUNT(*) FROM chat_mensagens m WHERE m.conversa_id = c.id AND m.id > COALESCE(mb.ultima_lida_id, 0) AND m.de_id <> mb.usuario_id
         AND m.tipo <> 'sistema' AND ${VISIVEL}) AS nao_lidas,
      (SELECT COUNT(*) FROM chat_mencoes mc JOIN chat_mensagens m ON m.id = mc.mensagem_id WHERE m.conversa_id = c.id AND mc.usuario_id = mb.usuario_id
         AND m.id > COALESCE(mb.ultima_lida_id, 0)) AS mencoes,
      (SELECT json_build_object('texto', ${PREVIA}, 'de_id', m.de_id, 'de_nome', u.nome, 'created_at', m.created_at, 'tipo', m.tipo)
         FROM chat_mensagens m LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.conversa_id = c.id AND ${VISIVEL} ORDER BY m.id DESC LIMIT 1) AS ultima
    FROM chat_membros mb JOIN chat_conversas c ON c.id = mb.conversa_id
    LEFT JOIN chat_membros om ON c.tipo = 'direta' AND om.conversa_id = c.id AND om.usuario_id <> mb.usuario_id
    LEFT JOIN usuarios o ON o.id = om.usuario_id
    WHERE mb.usuario_id = ? AND (c.tipo = 'grupo' OR EXISTS (SELECT 1 FROM chat_mensagens m WHERE m.conversa_id = c.id))
    ORDER BY c.atualizada_em DESC, c.id DESC`, eu);
  return linhas.map((l) => ({
    ...l, ultima: typeof l.ultima === 'string' ? JSON.parse(l.ultima) : l.ultima,
    titulo: l.tipo === 'grupo' ? l.nome : l.outro_nome, nao_lidas: Number(l.nao_lidas), mencoes: Number(l.mencoes), membros: Number(l.membros),
  }));
}

async function naoLidas(eu) {
  const r = await db.get(`SELECT
      COALESCE(SUM((SELECT COUNT(*) FROM chat_mensagens m WHERE m.conversa_id = mb.conversa_id AND m.id > COALESCE(mb.ultima_lida_id, 0)
        AND m.de_id <> mb.usuario_id AND m.tipo <> 'sistema' AND ${VISIVEL})), 0) AS n,
      COALESCE(SUM((SELECT COUNT(*) FROM chat_mencoes mc JOIN chat_mensagens m ON m.id = mc.mensagem_id WHERE m.conversa_id = mb.conversa_id
        AND mc.usuario_id = mb.usuario_id AND m.id > COALESCE(mb.ultima_lida_id, 0))), 0) AS mencoes
    FROM chat_membros mb WHERE mb.usuario_id = ? AND mb.silenciada = 0`, eu);
  return { n: Number(r.n), mencoes: Number(r.mencoes) };
}

// ---------- Mensagens ----------
const MSG_SQL = `SELECT m.id, m.conversa_id, m.de_id, u.nome AS de_nome, u.foto IS NOT NULL AS de_tem_foto, m.texto, m.tipo, m.created_at,
    m.editada_em, m.apagada_em, m.fixada_em, m.responde_a,
    (SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho, 'largura', a.largura, 'altura', a.altura) ORDER BY a.id)
      FROM chat_anexos a WHERE a.mensagem_id = m.id) AS anexos,
    (SELECT json_agg(json_build_object('emoji', r.emoji, 'usuario_id', r.usuario_id)) FROM chat_reacoes r WHERE r.mensagem_id = m.id) AS reacoes,
    (SELECT json_agg(mc.usuario_id) FROM chat_mencoes mc WHERE mc.mensagem_id = m.id) AS mencoes,
    (SELECT json_build_object('id', o.id, 'de_nome', ou.nome, 'texto', CASE WHEN o.apagada_em IS NOT NULL THEN '' ELSE o.texto END,
       'apagada', o.apagada_em IS NOT NULL, 'tipo', o.tipo, 'anexo', EXISTS (SELECT 1 FROM chat_anexos x WHERE x.mensagem_id = o.id))
      FROM chat_mensagens o LEFT JOIN usuarios ou ON ou.id = o.de_id WHERE o.id = m.responde_a) AS resposta
  FROM chat_mensagens m LEFT JOIN usuarios u ON u.id = m.de_id`;
const json = (v, padrao) => (typeof v === 'string' ? JSON.parse(v) : v ?? padrao);
const normalizar = (m) => ({ ...m, anexos: json(m.anexos, []), reacoes: json(m.reacoes, []), mencoes: json(m.mencoes, []), resposta: json(m.resposta, null) });

/** Mensagens da conversa: as últimas, a partir de um id (desde_id), antes de um id (antes) ou em volta de uma (ao_redor). */
async function mensagens(conversaId, mb, { desdeId, antes, aoRedor, limite = 60 } = {}) {
  const base = `${MSG_SQL} JOIN chat_membros mb ON mb.conversa_id = m.conversa_id AND mb.usuario_id = ${Number(mb.usuario_id)} WHERE m.conversa_id = ? AND ${VISIVEL}`;
  let linhas;
  if (aoRedor) {
    const a = await db.all(`${base} AND m.id <= ? ORDER BY m.id DESC LIMIT 30`, conversaId, aoRedor);
    const d = await db.all(`${base} AND m.id > ? ORDER BY m.id LIMIT 30`, conversaId, aoRedor);
    linhas = [...a.reverse(), ...d];
  } else if (desdeId) {
    linhas = await db.all(`${base} AND m.id >= ? ORDER BY m.id LIMIT 400`, conversaId, desdeId);
  } else {
    linhas = (await db.all(`${base}${antes ? ' AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ${Math.min(200, limite)}`, conversaId, ...(antes ? [antes] : []))).reverse();
  }
  return linhas.map(normalizar);
}
const umaMensagem = async (id) => { const m = await db.get(`${MSG_SQL} WHERE m.id = ?`, id); return m && normalizar(m); };

async function marcarLida(conversaId, eu) {
  const ult = (await db.get('SELECT MAX(id) AS id FROM chat_mensagens WHERE conversa_id = ?', conversaId))?.id || 0;
  const r = await db.run('UPDATE chat_membros SET ultima_lida_id = ? WHERE conversa_id = ? AND usuario_id = ? AND COALESCE(ultima_lida_id, 0) < ?', ult, conversaId, eu, ult);
  if (r.changes) {
    await tocar(conversaId);
    await sinal((await membrosAtivos(conversaId)).filter((x) => x !== eu), { tipo: 'lida', conversa_id: conversaId, usuario_id: eu });
  }
}

/** Menções válidas: membros ativos citados; "@todos" num grupo menciona todos. */
async function resolverMencoes(conversa, eu, texto, ids) {
  const ativos = await membrosAtivos(conversa.id);
  let lista = (ids || []).map(Number).filter((x) => ativos.includes(x) && x !== eu);
  if (conversa.tipo === 'grupo' && /(^|\s)@todos\b/i.test(texto)) lista = ativos.filter((x) => x !== eu);
  return [...new Set(lista)];
}

async function gravar({ conversa, eu, texto = '', tipo = 'texto', respondeA, mencoes = [], arquivos = [], medidas = [] }) {
  texto = String(texto || '').trim();
  if (texto.length > MAX_TEXTO) throw new ErroNegocio('Mensagem muito longa (máx. 4.000 caracteres).');
  if (!texto && !arquivos.length) throw new ErroNegocio('Escreva a mensagem.');
  let resp = null;
  if (respondeA) {
    resp = await db.get('SELECT id FROM chat_mensagens WHERE id = ? AND conversa_id = ?', Number(respondeA), conversa.id);
    if (!resp) throw new ErroNegocio('A mensagem respondida não está nesta conversa.');
  }
  const citados = await resolverMencoes(conversa, eu, texto, mencoes);
  const id = await db.tx(async () => {
    const m = await db.get('INSERT INTO chat_mensagens (conversa_id, de_id, texto, tipo, responde_a) VALUES (?, ?, COALESCE(?, \'\'), ?, ?) RETURNING id',
      conversa.id, eu, texto, tipo, resp?.id || null);
    for (const [i, f] of arquivos.entries()) {
      const med = medidas[i] || {};
      await db.run('INSERT INTO chat_anexos (mensagem_id, nome, mime, tamanho, conteudo, largura, altura) VALUES (?, ?, ?, ?, ?, ?, ?)',
        m.id, f.originalname.slice(0, 200), f.mimetype, f.size, f.buffer, Number(med.largura) || null, Number(med.altura) || null);
    }
    for (const u of citados) await db.run('INSERT INTO chat_mencoes (mensagem_id, usuario_id) VALUES (?, ?) ON CONFLICT DO NOTHING', m.id, u);
    await db.run('UPDATE chat_membros SET ultima_lida_id = ? WHERE conversa_id = ? AND usuario_id = ?', m.id, conversa.id, eu);
    await tocar(conversa.id);
    return m.id;
  });
  const msg = await umaMensagem(id);
  await notificar(conversa, msg, citados);
  return msg;
}

/** Sinal para todos e notificação no aparelho de quem não silenciou (menção notifica sempre). */
async function notificar(conversa, msg, citados = []) {
  const membros = await db.all(`SELECT mb.usuario_id, mb.silenciada FROM chat_membros mb JOIN usuarios u ON u.id = mb.usuario_id
    WHERE mb.conversa_id = ? AND mb.saiu_em IS NULL AND u.ativo = 1 AND mb.usuario_id <> ?`, conversa.id, msg.de_id);
  await sinal([msg.de_id, ...membros.map((x) => x.usuario_id)], { tipo: 'msg', conversa_id: conversa.id, id: msg.id, de_id: msg.de_id });
  const previa = msg.tipo === 'audio' ? '🎤 Áudio' : msg.texto || (msg.anexos.length ? `📎 ${msg.anexos.length} anexo(s)` : '');
  const grupo = conversa.tipo === 'grupo' ? conversa.nome : null;
  const push = require('./push');
  const enviar = (ids, titulo) => (ids.length ? push.enviar(ids, { titulo, corpo: previa.slice(0, 160), url: `/#/chat/${conversa.id}`, tag: `chat-${conversa.id}` }).catch(() => 0) : 0);
  const mencionados = membros.filter((x) => citados.includes(x.usuario_id)).map((x) => x.usuario_id);
  const demais = membros.filter((x) => !x.silenciada && !citados.includes(x.usuario_id)).map((x) => x.usuario_id);
  await Promise.all([
    enviar(mencionados, `${msg.de_nome} mencionou você${grupo ? ` em ${grupo}` : ''}`),
    enviar(demais, grupo ? `${msg.de_nome} em ${grupo}` : msg.de_nome),
  ]);
}

async function editar(id, eu, texto) {
  const m = await db.get('SELECT * FROM chat_mensagens WHERE id = ?', Number(id));
  if (!m || m.de_id !== eu || m.tipo === 'sistema') throw new ErroNegocio('Só dá para editar as próprias mensagens.', 403);
  if (m.apagada_em) throw new ErroNegocio('Mensagem apagada.');
  await membro(m.conversa_id, eu, { escrever: true });
  texto = String(texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva a mensagem.');
  if (texto.length > MAX_TEXTO) throw new ErroNegocio('Mensagem muito longa (máx. 4.000 caracteres).');
  if (texto === m.texto) return;
  await require('./auditoria').registrar('alterar', 'chat_mensagem', m.id, { texto: m.texto }, { texto });
  await db.run(`UPDATE chat_mensagens SET texto = ?, editada_em = sq_datetime('now', 'localtime') WHERE id = ?`, texto, m.id);
  await tocar(m.conversa_id);
  await sinal(await membrosAtivos(m.conversa_id), { tipo: 'alterada', conversa_id: m.conversa_id, id: m.id });
}

/** Apagar para todos: o texto e os anexos saem da conversa; o original fica na auditoria. */
async function apagar(id, eu) {
  const m = await db.get('SELECT * FROM chat_mensagens WHERE id = ?', Number(id));
  if (!m || m.tipo === 'sistema') throw new ErroNegocio('Mensagem não encontrada.', 404);
  const { conversa, membro: mb } = await membro(m.conversa_id, eu, { escrever: true });
  if (m.de_id !== eu && !(conversa.tipo === 'grupo' && mb.papel === 'admin')) throw new ErroNegocio('Só quem enviou (ou o administrador do grupo) pode apagar.', 403);
  if (m.apagada_em) return;
  const anexos = await db.all('SELECT nome, mime, tamanho FROM chat_anexos WHERE mensagem_id = ?', m.id);
  await require('./auditoria').registrar('excluir', 'chat_mensagem', m.id, { texto: m.texto, anexos, de_id: m.de_id, conversa_id: m.conversa_id, enviada_em: m.created_at }, null);
  await db.tx(async () => {
    await db.run('DELETE FROM chat_anexos WHERE mensagem_id = ?', m.id);
    await db.run('DELETE FROM chat_reacoes WHERE mensagem_id = ?', m.id);
    await db.run(`UPDATE chat_mensagens SET texto = '', apagada_em = sq_datetime('now', 'localtime'), apagada_por = ?, fixada_em = NULL WHERE id = ?`, eu, m.id);
    await tocar(m.conversa_id);
  });
  await sinal(await membrosAtivos(m.conversa_id), { tipo: 'alterada', conversa_id: m.conversa_id, id: m.id });
}

async function reagir(id, eu, emoji) {
  if (!EMOJIS.includes(emoji)) throw new ErroNegocio('Reação inválida.');
  const m = await db.get('SELECT * FROM chat_mensagens WHERE id = ?', Number(id));
  if (!m || m.apagada_em || m.tipo === 'sistema') throw new ErroNegocio('Mensagem não encontrada.', 404);
  await membro(m.conversa_id, eu, { escrever: true });
  const r = await db.run('DELETE FROM chat_reacoes WHERE mensagem_id = ? AND usuario_id = ? AND emoji = ?', m.id, eu, emoji);
  if (!r.changes) await db.run('INSERT INTO chat_reacoes (mensagem_id, usuario_id, emoji) VALUES (?, ?, ?)', m.id, eu, emoji);
  await tocar(m.conversa_id);
  await sinal(await membrosAtivos(m.conversa_id), { tipo: 'alterada', conversa_id: m.conversa_id, id: m.id });
  return !r.changes;
}

async function fixar(id, eu) {
  const m = await db.get('SELECT * FROM chat_mensagens WHERE id = ?', Number(id));
  if (!m || m.apagada_em || m.tipo === 'sistema') throw new ErroNegocio('Mensagem não encontrada.', 404);
  await membro(m.conversa_id, eu, { escrever: true });
  const fixa = !m.fixada_em;
  await db.run(`UPDATE chat_mensagens SET fixada_em = ${fixa ? "sq_datetime('now', 'localtime')" : 'NULL'}, fixada_por = ? WHERE id = ?`, fixa ? eu : null, m.id);
  await tocar(m.conversa_id);
  await sinal(await membrosAtivos(m.conversa_id), { tipo: 'alterada', conversa_id: m.conversa_id, id: m.id });
  return fixa;
}

// ---------- Busca ----------
async function buscar(eu, { q, pessoa, de, ate }) {
  const termo = String(q || '').trim();
  if (termo.length < 2 && !pessoa) throw new ErroNegocio('Digite ao menos 2 letras ou escolha uma pessoa.');
  const cond = ['mb.usuario_id = :eu', VISIVEL, 'm.apagada_em IS NULL', "m.tipo <> 'sistema'"];
  const p = { eu };
  if (termo.length >= 2) {
    cond.push(`(m.texto ILIKE :q OR EXISTS (SELECT 1 FROM chat_anexos a WHERE a.mensagem_id = m.id AND a.nome ILIKE :q))`);
    p.q = `%${termo.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
  }
  if (pessoa) { cond.push('m.de_id = :pessoa'); p.pessoa = Number(pessoa); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(de || '')) { cond.push('m.created_at >= :de'); p.de = de; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) { cond.push('m.created_at <= :ate'); p.ate = `${ate} 23:59:59`; }
  const linhas = await db.all(`SELECT m.id, m.conversa_id, m.de_id, u.nome AS de_nome, m.texto, m.tipo, m.created_at,
      CASE WHEN c.tipo = 'grupo' THEN c.nome ELSE (SELECT o.nome FROM chat_membros om JOIN usuarios o ON o.id = om.usuario_id
        WHERE om.conversa_id = c.id AND om.usuario_id <> :eu LIMIT 1) END AS conversa,
      (SELECT string_agg(a.nome, ', ') FROM chat_anexos a WHERE a.mensagem_id = m.id) AS anexos
    FROM chat_mensagens m JOIN chat_membros mb ON mb.conversa_id = m.conversa_id JOIN chat_conversas c ON c.id = m.conversa_id
    LEFT JOIN usuarios u ON u.id = m.de_id WHERE ${cond.join(' AND ')} ORDER BY m.id DESC LIMIT 60`, p);
  return linhas;
}

// ---------- Guarda e exportação ----------
async function retencaoDias() {
  const r = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'chat.retencao_dias'`);
  return Number(r?.valor) || 0;
}
async function definirRetencao(dias, usuarioId) {
  dias = Math.round(Number(dias) || 0);
  if (dias && dias < 90) throw new ErroNegocio('Guarde por pelo menos 90 dias (ou 0 para guardar sem limite).');
  await db.run(`INSERT INTO configuracoes (chave, valor, updated_by) VALUES ('chat.retencao_dias', ?, ?)
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_by = EXCLUDED.updated_by, updated_at = sq_datetime('now', 'localtime')`, String(dias), usuarioId);
  return dias;
}
/** Apaga mensagens (e anexos) mais antigas que o prazo de guarda. Roda na rotina diária. */
async function aplicarRetencao() {
  const dias = await retencaoDias();
  if (!dias) return { apagadas: 0 };
  const limite = `${S.addDias(S.hoje(), -dias)} 00:00:00`;
  const r = await db.run('DELETE FROM chat_mensagens WHERE created_at < ?', limite);
  return { apagadas: r.changes, antes_de: limite };
}

async function exportarLinhas(conversaId) {
  return db.all(`SELECT m.created_at, u.nome AS autor, m.tipo, CASE WHEN m.apagada_em IS NOT NULL THEN '(mensagem apagada)' ELSE m.texto END AS texto,
      (SELECT string_agg(a.nome, ', ') FROM chat_anexos a WHERE a.mensagem_id = m.id) AS anexos,
      m.editada_em, m.apagada_em, m.responde_a
    FROM chat_mensagens m LEFT JOIN usuarios u ON u.id = m.de_id WHERE m.conversa_id = ? ORDER BY m.id`, conversaId);
}

module.exports = {
  EMOJIS, configRealtime, topicoUsuario, topicoConversa, topicoPresenca, sinal, membro, membrosAtivos, conversaDireta, criarGrupo, adicionarMembros,
  removerMembro, encerrarAcesso, listarConversas, naoLidas, mensagens, umaMensagem, marcarLida, gravar, editar, apagar, reagir, fixar, buscar,
  retencaoDias, definirRetencao, aplicarRetencao, exportarLinhas, tocar,
};
