// Acesso ao PostgreSQL: Supabase em produção (DATABASE_URL) e PGlite (Postgres embutido) em desenvolvimento e testes.
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const DATABASE_URL = process.env.DATABASE_URL;
const PGLITE_DIR = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite');
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const contexto = new AsyncLocalStorage();
let motor; // { query(sql, params) -> {rows, fields}, transacao(fn), fechar() }
let iniciando;

const numero = (v) => (v === null ? null : Number(v));

async function criarMotor() {
  if (DATABASE_URL) {
    const pg = require('pg');
    pg.types.setTypeParser(20, numero); // bigint (COUNT, SUM de inteiros)
    pg.types.setTypeParser(1700, numero); // numeric
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 3),
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
      idleTimeoutMillis: 10000,
    });
    return {
      query: (sql, params) => pool.query(sql, params),
      async transacao(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn((sql, params) => c.query(sql, params));
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
      fechar: () => pool.end(),
    };
  }
  const { PGlite } = require('@electric-sql/pglite');
  const destino = PGLITE_DIR === ':memory:' ? undefined : PGLITE_DIR;
  if (destino) fs.mkdirSync(path.dirname(destino), { recursive: true });
  const lite = new PGlite(destino, { parsers: { 20: numero, 1700: numero } });
  await lite.waitReady;
  await lite.exec(SCHEMA);
  return {
    query: (sql, params) => lite.query(sql, params),
    transacao: (fn) => lite.transaction((tx) => fn((sql, params) => tx.query(sql, params))),
    fechar: () => lite.close(),
  };
}

async function open() {
  if (motor) return motor;
  iniciando ||= criarMotor().then((m) => (motor = m));
  return iniciando;
}

/**
 * Converte o SQL escrito no estilo do sistema para o PostgreSQL:
 * parâmetros `?` ou `:nome` viram $1..$n, IFNULL vira COALESCE e as funções de data
 * (date/datetime/julianday no formato do SQLite) usam as funções sq_* do schema.
 */
function traduzir(sql, params) {
  let lista = params;
  let nomes = null;
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Buffer)) {
    nomes = params[0];
    lista = [];
  }
  const indiceNome = {};
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      const fim = sql.indexOf("'", i + 1);
      out += sql.slice(i, fim + 1);
      i = fim;
    } else if (ch === '?' && !nomes) {
      out += `$${++n}`;
    } else if (ch === ':' && nomes && sql[i + 1] !== ':' && sql[i - 1] !== ':' && /[a-z_]/i.test(sql[i + 1] || '')) {
      const m = sql.slice(i + 1).match(/^[a-z_][a-z0-9_]*/i)[0];
      if (!(m in indiceNome)) {
        lista.push(nomes[m]);
        indiceNome[m] = lista.length;
      }
      out += `$${indiceNome[m]}`;
      i += m.length;
    } else {
      out += ch;
    }
  }
  out = out.replace(/\bIFNULL\(/gi, 'COALESCE(').replace(/\bdatetime\(/g, 'sq_datetime(').replace(/\bdate\(/g, 'sq_date(');
  return { sql: out, params: lista.map(norm) };
}

async function query(sql, ...params) {
  const m = await open();
  const t = traduzir(sql, params);
  const exec = contexto.getStore()?.exec || m.query;
  try {
    return await exec(t.sql, t.params);
  } catch (e) {
    e.sql = t.sql;
    throw e;
  }
}

const all = async (sql, ...p) => (await query(sql, ...p)).rows;
const get = async (sql, ...p) => (await query(sql, ...p)).rows[0];
const run = async (sql, ...p) => {
  const r = await query(sql, ...p);
  return { changes: r.rowCount ?? r.affectedRows ?? 0, rows: r.rows };
};

/** Executa fn numa transação; chamadas aninhadas reaproveitam a mesma. */
async function tx(fn) {
  if (contexto.getStore()?.exec) return fn();
  const m = await open();
  const pai = contexto.getStore() || {};
  return m.transacao((exec) => contexto.run({ ...pai, exec }, fn));
}

/** Guarda quem está fazendo a requisição (usado pela auditoria). */
function comUsuario(info, fn) {
  return contexto.run({ ...(contexto.getStore() || {}), ...info }, fn);
}
const usuarioAtual = () => contexto.getStore() || {};

async function nextSeq(nome, inicial = 1) {
  const r = await get(
    `INSERT INTO sequencias (nome, valor) VALUES (?, ?) ON CONFLICT (nome) DO UPDATE SET valor = sequencias.valor + 1 RETURNING valor`,
    nome, inicial,
  );
  return r.valor;
}

function norm(v) {
  if (v === '' || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

const auditar = () => require('./auditoria');

/** Insere um registro usando apenas as colunas permitidas e devolve o id. */
async function insert(table, data, allowed, { auditoria = true } = {}) {
  const keys = Object.keys(data).filter((k) => (!allowed || allowed.includes(k)) && data[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING id`;
  const r = await get(sql, ...keys.map((k) => data[k]));
  if (auditoria) await auditar().registrar('criar', table, r.id, null, Object.fromEntries(keys.map((k) => [k, data[k]])));
  return r.id;
}

async function update(table, id, data, allowed, { auditoria = true } = {}) {
  const keys = Object.keys(data).filter((k) => (!allowed || allowed.includes(k)) && data[k] !== undefined && k !== 'id');
  if (!keys.length) return;
  const antes = auditoria ? await get(`SELECT * FROM ${table} WHERE id = ?`, id) : null;
  await run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
  if (auditoria && antes) await auditar().registrarDiferenca(table, id, antes, Object.fromEntries(keys.map((k) => [k, norm(data[k])])));
}

async function remove(table, id) {
  const antes = await get(`SELECT * FROM ${table} WHERE id = ?`, id);
  await run(`DELETE FROM ${table} WHERE id = ?`, id);
  if (antes) await auditar().registrar('excluir', table, id, antes, null);
}

/** Converte filtros digitados no formato brasileiro (dd/mm/aaaa) para o formato do banco. */
function normalizeFilter(v) {
  let m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = v.match(/^(\d{2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]}`;
  m = v.match(/^(\d{2})\/(\d{2})$/);
  if (m) return `${m[2]}-${m[1]}`;
  return v;
}

const cacheColunas = new Map();
async function colunasDe(sql, params) {
  if (cacheColunas.has(sql)) return cacheColunas.get(sql);
  const r = await query(`SELECT * FROM (${sql}) t LIMIT 0`, ...params);
  const cols = r.fields.map((f) => f.name);
  cacheColunas.set(sql, cols);
  return cols;
}

/**
 * Lista paginada com filtro por coluna, ordenação e exportação.
 * Filtros chegam como f_<coluna>=valor; ordenação como sort=<coluna>&dir=asc|desc.
 */
async function paginate(q, { sql, params = [], columns, sort = 'id', dir = 'desc', exact = [] }) {
  columns = columns || (await colunasDe(sql, params));
  const where = [];
  const wp = [];
  for (const [k, raw] of Object.entries(q)) {
    if (!k.startsWith('f_')) continue;
    const col = k.slice(2);
    if (!columns.includes(col) || raw === '' || raw == null) continue;
    const v = normalizeFilter(String(raw).trim());
    if (exact.includes(col)) {
      where.push(`CAST(t."${col}" AS TEXT) = ?`);
      wp.push(v);
    } else {
      where.push(`CAST(t."${col}" AS TEXT) ILIKE ?`);
      wp.push(`%${v}%`);
    }
  }
  const base = `SELECT * FROM (${sql}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const sortCol = columns.includes(q.sort) ? q.sort : sort;
  const sortDir = (q.dir || dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const order = ` ORDER BY t."${sortCol}" ${sortDir} NULLS LAST`;
  const allParams = [...params, ...wp];

  if (q.export || q.all) return { rows: await all(base + order, ...allParams), columns };
  const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 20, 1), 500);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const total = (await get(`SELECT COUNT(*) AS n FROM (${base}) q`, ...allParams)).n;
  const rows = await all(`${base}${order} LIMIT ? OFFSET ?`, ...allParams, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pageSize };
}

async function close() {
  if (motor) await motor.fechar();
  motor = undefined;
  iniciando = undefined;
}

module.exports = {
  open, query, all, get, run, tx, insert, update, remove, nextSeq, paginate, close, comUsuario, usuarioAtual, SCHEMA,
};
