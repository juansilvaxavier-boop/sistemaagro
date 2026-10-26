// Colaboradores, permissões por usuário, primeiro acesso, auditoria, LGPD, chat, perfil e backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { sessao, parar, db, iniciar } = require('./helpers');

test.after(parar);

async function loginBruto(login, senha) {
  const base = await iniciar();
  let cookie = '';
  const req = async (metodo, url, body) => {
    const r = await fetch(base + url, { method: metodo, headers: { 'X-Requested-With': 'agroterra', 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, dados: await r.json().catch(() => ({})) };
  };
  return { req, login: await req('POST', '/api/auth/login', { login, senha }) };
}

test('colaborador → usuário com permissões individuais e primeiro acesso', async () => {
  const admin = await sessao('diretoria');
  const semColab = await admin.req('POST', '/api/cadastros/usuarios', { login: 'novo', senha: 'Senha1234', perfil: 'vendedor' });
  assert.equal(semColab.status, 400, 'usuário exige colaborador');

  const { id: colab } = await admin.post('/api/cadastros/colaboradores', { nome: 'Paula Nogueira', cpf: '529.982.247-25', cargo: 'Assistente comercial', setor: 'Vendas', empresa_id: 1 });
  assert.equal((await admin.req('POST', '/api/cadastros/usuarios', { colaborador_id: colab, login: 'paula', senha: '123', perfil: 'vendedor' })).status, 400, 'senha fraca');
  const { id: uid } = await admin.post('/api/cadastros/usuarios', {
    colaborador_id: colab, login: 'paula', senha: 'Provisoria1', perfil: 'vendedor', equipe_id: 1, empresas: [1],
    personalizadas: 1, permissoes: ['dashboard', 'clientes', 'chat'],
  });
  const u = await admin.get(`/api/cadastros/usuarios/${uid}`);
  assert.equal(u.nome, 'Paula Nogueira');
  assert.deepEqual(u.permissoes.sort(), ['chat', 'clientes', 'dashboard']);
  assert.ok(u.personalizadas);
  assert.equal((await admin.req('POST', '/api/cadastros/usuarios', { colaborador_id: colab, login: 'paula2', senha: 'Provisoria1', perfil: 'vendedor' })).status, 400, 'um usuário por colaborador');

  // Primeiro acesso: troca de senha e aceite do termo antes de usar o sistema
  const s = await loginBruto('paula', 'Provisoria1');
  assert.equal(s.login.status, 200);
  assert.ok(s.login.dados.trocarSenha);
  assert.equal((await s.req('GET', '/api/clientes')).status, 428);
  assert.equal((await s.req('POST', '/api/auth/senha', { atual: 'Provisoria1', nova: 'NovaSenha9', confirmacao: 'NovaSenha9' })).status, 200);
  assert.equal((await s.req('GET', '/api/clientes')).status, 428, 'ainda falta o termo');
  assert.equal((await s.req('POST', '/api/auth/termo')).status, 200);
  const lista = await s.req('GET', '/api/clientes?pageSize=5');
  assert.equal(lista.status, 200);
  // Sem "lgpd.dados": CPF/CNPJ mascarado e sem acesso ao que não foi liberado
  assert.ok(lista.dados.rows.every((c) => c.documento.includes('***')), 'documento mascarado');
  assert.equal((await s.req('GET', '/api/pedidos/fila/venda')).status, 403, 'fila não liberada');
  assert.equal((await s.req('GET', '/api/cadastros/usuarios')).status, 403);
  const me = await s.req('GET', '/api/auth/me');
  assert.deepEqual(me.dados.permissoes.sort(), ['chat', 'clientes', 'dashboard']);

  // Auditoria registrou a criação e a troca de senha
  const aud = await admin.get(`/api/admin/auditoria?f_entidade=usuarios&f_entidade_id=${uid}&all=1`);
  const acoes = aud.rows.map((a) => a.acao);
  for (const a of ['criar', 'login', 'trocar_senha', 'aceitar_termo']) assert.ok(acoes.includes(a), `auditoria: ${a}`);
  assert.ok(!aud.rows.some((a) => String(a.depois).includes('scrypt') || /"senha_hash":"[0-9a-f]{10}/.test(a.depois)), 'hash da senha não vai para a auditoria');
});

test('bloqueio após tentativas erradas', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await loginBruto('bruno', 'errada')).login.status, 401);
  const r = await loginBruto('bruno', 'agro123');
  assert.equal(r.login.status, 423, 'bloqueado mesmo com a senha certa');
  const admin = await sessao('diretoria');
  const bruno = await db.get(`SELECT id FROM usuarios WHERE login = 'bruno'`);
  await admin.post(`/api/cadastros/usuarios/${bruno.id}/desbloquear`);
  assert.equal((await loginBruto('bruno', 'agro123')).login.status, 200);
});

test('alteração de cadastro fica na auditoria com antes e depois', async () => {
  const admin = await sessao('diretoria');
  await admin.put('/api/cadastros/transportadoras/1', { telefone: '(34) 3333-0000' });
  const aud = await admin.get('/api/admin/auditoria?f_entidade=transportadoras&f_entidade_id=1&f_acao=alterar&all=1');
  const ult = aud.rows[0];
  assert.equal(JSON.parse(ult.depois).telefone, '(34) 3333-0000');
  assert.ok(JSON.parse(ult.antes).telefone);
  assert.equal(ult.usuario_nome, 'Juan Xavier');
});

test('painel: cada usuário vê só o próprio setor', async () => {
  const ana = await sessao('ana');
  const d = await ana.get('/api/dashboard?perfil=financeiro');
  assert.equal(d.perfil, 'vendedor', 'vendedor não abre painel do financeiro');
  assert.deepEqual(d.perfis_disponiveis, ['vendedor']);
  const dir = await sessao('diretoria');
  assert.equal((await dir.get('/api/dashboard?perfil=financeiro')).perfil, 'financeiro');
});

test('chat entre usuários', async () => {
  const ana = await sessao('ana');
  const carlos = await sessao('carlos');
  const idCarlos = (await db.get(`SELECT id FROM usuarios WHERE login = 'carlos'`)).id;
  const { id } = await ana.post(`/api/chat/direta/${idCarlos}`);
  await ana.post(`/api/chat/c/${id}/mensagens`, { texto: 'Carlos, pode aprovar o pedido do Sr. José?' });
  assert.equal((await carlos.get('/api/chat/nao-lidas')).n, 1);
  const c = (await carlos.get('/api/chat/conversas')).find((x) => x.id === id);
  assert.equal(c.nao_lidas, 1);
  assert.match(c.ultima.texto, /aprovar/);
  const conversa = await carlos.get(`/api/chat/c/${id}`);
  assert.equal(conversa.mensagens.at(-1).texto, 'Carlos, pode aprovar o pedido do Sr. José?');
  assert.equal((await carlos.get('/api/chat/nao-lidas')).n, 0, 'abrir a conversa marca como lida');
  await carlos.post(`/api/chat/c/${id}/mensagens`, { texto: 'Aprovado!' });
  const deAna = await ana.get(`/api/chat/c/${id}`);
  assert.deepEqual(deAna.mensagens.map((m) => m.texto), ['Carlos, pode aprovar o pedido do Sr. José?', 'Aprovado!']);
  const carlosMb = deAna.membros.find((x) => x.id === idCarlos);
  assert.ok(carlosMb.ultima_lida_id >= deAna.mensagens[0].id, 'remetente vê que foi lida');
});

test('meu perfil é somente leitura, exceto a foto', async () => {
  const ana = await sessao('ana');
  const p = await ana.get('/api/auth/perfil');
  assert.equal(p.nome, 'Ana Souza');
  assert.equal(p.perfil_label, 'Vendedor');
  assert.ok(p.permissoes.length);
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082', 'hex').toString('base64');
  await ana.put('/api/auth/perfil/foto', { imagem: png });
  assert.equal((await ana.get('/api/auth/perfil')).tem_foto, true);
  const id = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  const foto = await ana.req('GET', `/api/auth/foto/${id}`);
  assert.equal(foto.headers.get('content-type'), 'image/png');
  assert.equal((await ana.req('PUT', '/api/auth/perfil/foto', { imagem: 'data:text/html;base64,PGgxPg==' })).status, 400);
  assert.equal((await ana.req('PUT', '/api/auth/perfil', { nome: 'Outro' })).status, 404, 'não existe rota para alterar dados');
});

test('LGPD: exportar e anonimizar titular', async () => {
  const admin = await sessao('diretoria');
  const livre = await db.get(`SELECT c.id FROM clientes c WHERE NOT EXISTS (SELECT 1 FROM parcelas p WHERE p.cliente_id = c.id AND p.status IN ('a_pagar','acordo_judicial'))
     AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.etapa NOT IN ('entregue','cancelado','devolucao')) LIMIT 1`);
  const exp = await admin.req('GET', `/api/admin/lgpd/cliente/${livre.id}/exportar`);
  const dados = exp.dados;
  assert.equal(dados.dados.cliente.id, livre.id);
  assert.ok(Array.isArray(dados.dados.telefones));
  await admin.post(`/api/admin/lgpd/cliente/${livre.id}/anonimizar`, { motivo: 'Pedido do titular por e-mail' });
  const c = await db.get('SELECT nome, documento, email, anonimizado_em FROM clientes WHERE id = ?', livre.id);
  assert.match(c.nome, /anonimizado/);
  assert.equal(c.documento, `ANON${livre.id}`);
  assert.equal(c.email, null);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cliente_telefones WHERE cliente_id = ?', livre.id)).n, 0);
  const comDivida = await db.get(`SELECT cliente_id AS id FROM parcelas WHERE status = 'a_pagar' LIMIT 1`);
  assert.equal((await admin.req('POST', `/api/admin/lgpd/cliente/${comDivida.id}/anonimizar`, { motivo: 'Pedido do titular por e-mail' })).status, 400);
});

test('backup manual, download e agendado', async () => {
  const admin = await sessao('diretoria');
  const b = await admin.post('/api/admin/backups');
  assert.ok(b.registros > 1000);
  const dl = await admin.req('GET', `/api/admin/backups/${b.id}/download`);
  const json = JSON.parse(zlib.gunzipSync(dl.dados).toString());
  assert.ok(json.tabelas.pedidos.length >= 320);
  assert.ok(!('sessoes' in json.tabelas));
  const base = await iniciar();
  assert.equal((await fetch(base + '/api/cron/backup')).status, 401, 'cron exige segredo');
  process.env.CRON_SECRET = 'segredo-teste';
  const cron = await fetch(base + '/api/cron/backup', { headers: { authorization: 'Bearer segredo-teste' } });
  assert.equal(cron.status, 200);
  const lista = await admin.get('/api/admin/backups');
  assert.deepEqual(lista.map((x) => x.origem).sort(), ['automatico', 'manual']);
  assert.equal((await (await sessao('ana')).req('GET', '/api/admin/backups')).status, 403);
});

test('bootstrap de produção cria só o administrador com senha provisória', async () => {
  const { bootstrap } = require('../server/bootstrap');
  assert.equal((await bootstrap()).criado, false, 'não mexe em banco que já tem usuários');
});
