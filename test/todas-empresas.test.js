// Visão de todas as empresas: consultas somam as empresas liberadas para o usuário e lançamentos ficam bloqueados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

test('todas as empresas: soma as empresas, só consulta e respeita as empresas do usuário', async () => {
  const e1 = await sessao('admin', undefined, 1);
  const e2 = await sessao('admin', undefined, 2);
  const todas = await sessao('admin', undefined, 'todas');
  const me = await todas.get('/api/auth/me');
  assert.equal(me.empresa.todas, true);
  assert.deepEqual([...me.empresa.ids].sort(), (await db.all('SELECT id FROM empresas')).map((x) => x.id).sort());

  for (const url of ['/api/financeiro/parcelas?pageSize=1', '/api/financeiro/notas?pageSize=1', '/api/pagar?pageSize=1', '/api/pedidos/fila/producao?pageSize=1']) {
    const [a, b, t] = await Promise.all([e1.get(url), e2.get(url), todas.get(url)]);
    assert.equal(t.total, a.total + b.total, url);
  }
  const linha = (await todas.get('/api/financeiro/parcelas?pageSize=200')).rows;
  assert.ok(new Set(linha.map((x) => x.empresa)).size >= 1 && linha.every((x) => x.empresa), 'lista traz a empresa de cada linha');

  const [d1, d2, dt] = await Promise.all([e1.get('/api/dashboard'), e2.get('/api/dashboard'), todas.get('/api/dashboard')]);
  const fat = (d) => d.cards.find((c) => c.label.startsWith('Faturamento')).valor;
  assert.ok(Math.abs(fat(dt) - (fat(d1) + fat(d2))) < 0.01, 'faturamento do painel soma as duas empresas');

  const r = await todas.req('POST', '/api/chamados', { titulo: 'x' });
  assert.equal(r.status, 409);
  assert.equal(r.dados.codigo, 'somente_consulta');
  assert.equal((await todas.req('POST', '/api/mensagens/todas-lidas')).status, 200, 'marcar mensagens como lidas continua liberado');

  // Usuário com uma só empresa não tem a opção.
  const ana = await sessao('ana');
  const n = (await ana.get('/api/auth/me')).empresas.length;
  if (n < 2) assert.equal((await ana.req('POST', '/api/auth/empresa', { empresa_id: 'todas' })).status, 403);
});

test('reescrita do filtro de empresa no SQL', () => {
  const f = db.paraTodasEmpresas;
  assert.equal(f('SELECT 1 FROM p WHERE p.empresa_id = ? AND x', [1, 2]), 'SELECT 1 FROM p WHERE (p.empresa_id IN (1,2) AND CAST(? AS integer) IS NOT NULL) AND x');
  assert.match(f('SELECT 1 WHERE COALESCE(c.empresa_id, :e) = :e', [1, 2]), /COALESCE\(c\.empresa_id, 1\) IN \(1,2\)/);
  assert.equal(f('UPDATE x SET empresa_id = ?', [1, 2]), 'UPDATE x SET empresa_id = ?', 'escrita não é reescrita');
  assert.equal(f('SELECT 1 WHERE fe.empresa_id = e.id', [1, 2]), 'SELECT 1 WHERE fe.empresa_id = e.id');
  assert.equal(f('SELECT 1 WHERE p.empresa_id = ?', null), 'SELECT 1 WHERE p.empresa_id = ?', 'sem a visão consolidada nada muda');
});
