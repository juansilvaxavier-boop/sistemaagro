// Sobe a aplicação com um banco temporário e dados de demonstração.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agroterra-test-'));
// Por padrão usa o PGlite em memória; com TEST_DATABASE_URL roda contra um PostgreSQL de verdade
// (mesmo driver e configuração da produção). O schema "agroterra" desse banco é recriado a cada execução.
process.env.PGLITE_DIR = ':memory:';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;

const db = require('../server/db');
const { seed } = require('../server/seed');
const { criarApp } = require('../server/index');

let server;
let base;

async function iniciar() {
  if (server) return base;
  if (process.env.TEST_DATABASE_URL) {
    const pg = require('pg');
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    await c.query(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP; END $$`);
    await c.end();
  }
  await db.open();
  await seed();
  server = criarApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function parar() {
  server?.close();
  server = undefined;
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Cliente HTTP com sessão (cookie) de um usuário. */
async function sessao(login, senha = login === 'admin' ? 'admin123' : 'agro123', empresaId = 1) {
  await iniciar();
  let cookie = '';
  const req = async (metodo, url, body) => {
    const headers = { 'X-Requested-With': 'agroterra', cookie };
    let corpo;
    if (body instanceof FormData) corpo = body;
    else if (body !== undefined) { corpo = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method: metodo, headers, body: corpo });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = res.headers.get('content-type') || '';
    const dados = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, dados, headers: res.headers };
  };
  const login_ = await req('POST', '/api/auth/login', { login, senha });
  if (login_.status !== 200) throw new Error(`login ${login}: ${JSON.stringify(login_.dados)}`);
  if (!login_.dados.empresaEscolhida) await req('POST', '/api/auth/empresa', { empresa_id: empresaId });
  const ok = (r) => {
    if (r.status >= 400) throw new Error(`${r.status}: ${JSON.stringify(r.dados)}`);
    return r.dados;
  };
  return {
    req,
    get: async (u) => ok(await req('GET', u)),
    post: async (u, b = {}) => ok(await req('POST', u, b)),
    put: async (u, b = {}) => ok(await req('PUT', u, b)),
    del: async (u) => ok(await req('DELETE', u)),
  };
}

module.exports = { iniciar, parar, sessao, db };
