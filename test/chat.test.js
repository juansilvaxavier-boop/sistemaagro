// Chat: migração das conversas antigas, grupos, menções, respostas, edição, apagar, reações, fixar, silenciar,
// busca, áudio, cartões, desligamento, guarda e exportação.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sessao, parar, db } = require('./helpers');
const S = require('../server/services');
const C = require('../server/chat');

test.after(parar);
const idDe = async (login) => (await db.get('SELECT id FROM usuarios WHERE login = ?', login)).id;

test('migração das mensagens antigas para conversas diretas', async () => {
  await sessao('admin');
  const [a, b] = [await idDe('bruno'), await idDe('diego')];
  await db.run('INSERT INTO chat_mensagens (de_id, para_id, texto, lida_em) VALUES (?, ?, ?, ?)', a, b, 'antiga 1', S.agora());
  await db.run('INSERT INTO chat_mensagens (de_id, para_id, texto) VALUES (?, ?, ?)', b, a, 'antiga 2');
  const sql = fs.readFileSync(path.join(__dirname, '../server/schema.sql'), 'utf8');
  const mig = sql.slice(sql.indexOf('-- Migração das conversas antigas'));
  for (const st of mig.split(/;\s*\n/).map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await db.run(st);
  const conv = await db.get(`SELECT * FROM chat_conversas WHERE chave = ?`, `dm:${Math.min(a, b)}:${Math.max(a, b)}`);
  assert.ok(conv);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM chat_mensagens WHERE conversa_id = ?', conv.id)).n, 2);
  const naoLidas = await C.naoLidas(a);
  assert.equal(naoLidas.n, 1, 'a resposta não lida continua não lida');
  assert.equal((await C.naoLidas(b)).n, 0);
});

test('grupo, menções, resposta, edição, apagar, reações, fixar, silenciar e busca', async () => {
  const ana = await sessao('ana');
  const carlos = await sessao('carlos');
  const bruno = await sessao('bruno');
  const [idAna, idCarlos, idBruno, idHelena] = [await idDe('ana'), await idDe('carlos'), await idDe('bruno'), await idDe('helena')];
  assert.equal((await ana.req('POST', '/api/chat/grupos', { nome: 'Comercial', membros: [] })).status, 400);
  const { id: g } = await ana.post('/api/chat/grupos', { nome: 'Comercial GO', membros: [idCarlos, idBruno] });
  let d = await carlos.get(`/api/chat/c/${g}`);
  assert.equal(d.conversa.tipo, 'grupo');
  assert.equal(d.membros.length, 3);
  assert.match(d.mensagens[0].texto, /criou o grupo/);
  assert.ok(d.conversa.topico.startsWith('agt-c-'));

  // Menção notifica mesmo silenciado; não lidas de grupo silenciado não contam no total.
  await bruno.post(`/api/chat/c/${g}/silenciar`, { silenciada: true });
  const brunoAntes = (await bruno.get('/api/chat/nao-lidas')).n;
  const m1 = await ana.post(`/api/chat/c/${g}/mensagens`, { texto: 'Bom dia @Carlos Mendes, veja o pedido #1001', mencoes: [idCarlos, 9999] });
  assert.deepEqual(m1.mencoes, [idCarlos], 'só membros são mencionados');
  assert.equal((await carlos.get('/api/chat/nao-lidas')).mencoes, 1);
  assert.equal((await bruno.get('/api/chat/nao-lidas')).n, brunoAntes, 'silenciado não soma no contador');
  const lista = await bruno.get('/api/chat/conversas');
  assert.equal(lista.find((x) => x.id === g).nao_lidas, 1, 'aviso de criação não conta');
  const todos = await carlos.post(`/api/chat/c/${g}/mensagens`, { texto: 'Atenção @todos: reunião às 14h' });
  assert.deepEqual(todos.mencoes.sort(), [idAna, idBruno].sort());

  // Resposta, reação e fixar.
  const r1 = await carlos.post(`/api/chat/c/${g}/mensagens`, { texto: 'Visto!', responde_a: m1.id });
  assert.equal(r1.resposta.id, m1.id);
  assert.match(r1.resposta.texto, /Bom dia/);
  assert.equal((await bruno.post(`/api/chat/mensagens/${m1.id}/reacao`, { emoji: '👍' })).ativa, true);
  assert.equal((await bruno.post(`/api/chat/mensagens/${m1.id}/reacao`, { emoji: '👍' })).ativa, false, 'segunda vez tira a reação');
  await carlos.post(`/api/chat/mensagens/${m1.id}/reacao`, { emoji: '✅' });
  assert.equal((await carlos.req('POST', `/api/chat/mensagens/${m1.id}/reacao`, { emoji: '💩' })).status, 400);
  await ana.post(`/api/chat/mensagens/${m1.id}/fixar`);
  d = await bruno.get(`/api/chat/c/${g}`);
  assert.equal(d.fixadas[0].id, m1.id);
  assert.deepEqual(d.mensagens.find((x) => x.id === m1.id).reacoes, [{ emoji: '✅', usuario_id: idCarlos }]);

  // Editar (só o autor) e apagar para todos (autor ou admin), com o original na auditoria.
  assert.equal((await carlos.req('PUT', `/api/chat/mensagens/${m1.id}`, { texto: 'x' })).status, 403);
  await ana.put(`/api/chat/mensagens/${m1.id}`, { texto: 'Bom dia @Carlos Mendes, veja o pedido #1002' });
  let msg = (await carlos.get(`/api/chat/c/${g}`)).mensagens.find((x) => x.id === m1.id);
  assert.ok(msg.editada_em);
  assert.match(msg.texto, /1002/);
  assert.equal((await bruno.req('DELETE', `/api/chat/mensagens/${r1.id}`)).status, 403);
  await ana.del(`/api/chat/mensagens/${r1.id}`);
  msg = (await bruno.get(`/api/chat/c/${g}`)).mensagens.find((x) => x.id === r1.id);
  assert.ok(msg.apagada_em);
  assert.equal(msg.texto, '');
  const aud = await db.get(`SELECT antes FROM auditoria WHERE entidade = 'chat_mensagem' AND entidade_id = ? AND acao = 'excluir'`, String(r1.id));
  assert.match(JSON.stringify(aud.antes), /Visto!/);

  // Busca só nas conversas em que a pessoa participa.
  const achou = await bruno.get('/api/chat/busca?q=reunião');
  assert.ok(achou.some((x) => x.id === todos.id && x.conversa === 'Comercial GO'));
  const helena = await sessao('helena');
  assert.equal((await helena.get('/api/chat/busca?q=reunião')).length, 0);
  assert.equal((await helena.req('GET', `/api/chat/c/${g}`)).status, 404);
  assert.ok((await carlos.get(`/api/chat/busca?pessoa=${idAna}`)).length >= 1);

  // Administração do grupo e saída: quem sai não vê o que vem depois.
  assert.equal((await bruno.req('POST', `/api/chat/c/${g}/membros`, { usuarios: [idHelena] })).status, 403);
  assert.equal((await ana.post(`/api/chat/c/${g}/membros`, { usuarios: [idHelena] })).adicionados, 1);
  assert.equal((await helena.get(`/api/chat/c/${g}`)).conversa.tipo, 'grupo');
  await bruno.del(`/api/chat/c/${g}/membros/${idBruno}`);
  await ana.post(`/api/chat/c/${g}/mensagens`, { texto: 'mensagem depois que o Bruno saiu' });
  d = await bruno.get(`/api/chat/c/${g}`);
  assert.equal(d.conversa.somente_leitura, true);
  assert.ok(!d.mensagens.some((x) => /depois que o Bruno/.test(x.texto)));
  assert.equal((await bruno.req('POST', `/api/chat/c/${g}/mensagens`, { texto: 'oi' })).status, 403);

  // Novidades: a conversa alterada aparece.
  const nov = await carlos.get('/api/chat/novidades?desde=2000-01-01 00:00:00');
  assert.ok(nov.conversas.includes(g));
});

test('áudio, anexos, cartões e desligamento', async () => {
  const ana = await sessao('ana');
  const carlos = await sessao('carlos');
  const idCarlos = await idDe('carlos');
  const { id } = await ana.post(`/api/chat/direta/${idCarlos}`);
  const fd = new FormData();
  fd.append('tipo', 'audio');
  fd.append('arquivos', new Blob([Buffer.from('OggS-teste')], { type: 'audio/webm' }), 'audio.webm');
  const r = await ana.req('POST', `/api/chat/c/${id}/anexos`, fd);
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  assert.equal(r.dados.tipo, 'audio');
  const anexo = r.dados.anexos[0].id;
  assert.equal((await carlos.req('GET', `/api/chat/anexos/${anexo}`)).status, 200);
  const helena = await sessao('helena');
  assert.equal((await helena.req('GET', `/api/chat/anexos/${anexo}`)).status, 404, 'quem não participa não baixa');

  // Cartões respeitam o acesso de quem lê.
  const p = await db.get('SELECT id, numero, vendedor_id FROM pedidos ORDER BY id LIMIT 1');
  const admin = await sessao('admin');
  const card = await admin.get(`/api/chat/cartao/pedido/${p.numero}`);
  assert.equal(card.numero, p.numero);
  assert.ok(card.etapa_label);
  const outroVend = await db.get(`SELECT login FROM usuarios WHERE perfil = 'vendedor' AND id <> ? LIMIT 1`, p.vendedor_id);
  const v = await sessao(outroVend.login);
  assert.equal((await v.req('GET', `/api/chat/cartao/pedido/${p.numero}`)).status, 404, 'vendedor não vê pedido de outro');
  assert.equal((await admin.req('GET', '/api/chat/cartao/xyz/1')).status, 404);

  // Desligamento: sai dos grupos, conversa direta fica só para consulta.
  const { id: g } = await ana.post('/api/chat/grupos', { nome: 'Teste desligamento', membros: [idCarlos] });
  await admin.put(`/api/cadastros/usuarios/${idCarlos}`, { ...(await admin.get(`/api/cadastros/usuarios/${idCarlos}`)), ativo: 0 });
  const mb = await db.get('SELECT saiu_em FROM chat_membros WHERE conversa_id = ? AND usuario_id = ?', g, idCarlos);
  assert.ok(mb.saiu_em, 'saiu do grupo');
  const dg = await ana.get(`/api/chat/c/${g}`);
  assert.match(dg.mensagens.at(-1).texto, /acesso encerrado/);
  const dd = await ana.get(`/api/chat/c/${id}`);
  assert.equal(dd.conversa.somente_leitura, true);
  assert.ok(dd.mensagens.length, 'histórico preservado');
  assert.equal((await ana.req('POST', `/api/chat/c/${id}/mensagens`, { texto: 'oi' })).status, 403);
  await db.run('UPDATE usuarios SET ativo = 1 WHERE id = ?', idCarlos);
});

test('guarda das mensagens e exportação (LGPD)', async () => {
  const ana = await sessao('ana');
  const admin = await sessao('admin');
  assert.equal((await ana.req('GET', '/api/chat/admin/config')).status, 403);
  assert.equal((await admin.req('PUT', '/api/chat/admin/config', { retencao_dias: 30 })).status, 400);
  await admin.put('/api/chat/admin/config', { retencao_dias: 365 });
  const idBruno = await idDe('bruno');
  const { id } = await ana.post(`/api/chat/direta/${idBruno}`);
  const velha = await ana.post(`/api/chat/c/${id}/mensagens`, { texto: 'mensagem muito antiga' });
  await db.run('UPDATE chat_mensagens SET created_at = ? WHERE id = ?', '2020-01-01 10:00:00', velha.id);
  await ana.post(`/api/chat/c/${id}/mensagens`, { texto: 'mensagem nova' });
  const r = await C.aplicarRetencao();
  assert.ok(r.apagadas >= 1);
  assert.equal(await db.get('SELECT id FROM chat_mensagens WHERE id = ?', velha.id), undefined);
  const conversas = await admin.get(`/api/chat/admin/conversas?usuario_id=${idBruno}`);
  assert.ok(conversas.some((x) => x.id === id));
  const x = await admin.req('GET', `/api/chat/admin/conversas/${id}/exportar`);
  assert.equal(x.status, 200);
  assert.ok(x.headers.get('content-type').includes('spreadsheet'));
  assert.ok(await db.get(`SELECT 1 AS x FROM auditoria WHERE acao = 'lgpd_exportar' AND entidade = 'chat_conversas'`));
  await admin.put('/api/chat/admin/config', { retencao_dias: 0 });
});
