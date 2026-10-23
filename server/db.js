const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'agroterra.db');

let db;

function open() {
  if (db) return db;
  if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

const all = (sql, ...p) => open().prepare(sql).all(...p);
const get = (sql, ...p) => open().prepare(sql).get(...p);
const run = (sql, ...p) => open().prepare(sql).run(...p);

let txDepth = 0;
function tx(fn) {
  const d = open();
  if (txDepth > 0) return fn();
  d.exec('BEGIN');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    d.exec('COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    d.exec('ROLLBACK');
    throw e;
  }
}

function nextSeq(nome, inicial = 1) {
  const row = get('SELECT valor FROM sequencias WHERE nome = ?', nome);
  const valor = row ? row.valor + 1 : inicial;
  run('INSERT INTO sequencias (nome, valor) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET valor = excluded.valor', nome, valor);
  return valor;
}

/** Insere um registro usando apenas as colunas permitidas. */
function insert(table, data, allowed) {
  const keys = Object.keys(data).filter((k) => (!allowed || allowed.includes(k)) && data[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => norm(data[k]))).lastInsertRowid);
}

function update(table, id, data, allowed) {
  const keys = Object.keys(data).filter((k) => (!allowed || allowed.includes(k)) && data[k] !== undefined && k !== 'id');
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => norm(data[k])), id);
}

function norm(v) {
  if (v === '' || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
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

/**
 * Lista paginada com filtro por coluna, ordenação e exportação.
 * Filtros chegam como f_<coluna>=valor; ordenação como sort=<coluna>&dir=asc|desc.
 */
function paginate(query, { sql, params = [], columns, sort = 'id', dir = 'desc', exact = [] }) {
  columns = columns || open().prepare(sql).columns().map((c) => c.name);
  const where = [];
  const wp = [];
  for (const [k, raw] of Object.entries(query)) {
    if (!k.startsWith('f_')) continue;
    const col = k.slice(2);
    if (!columns.includes(col) || raw === '' || raw == null) continue;
    const v = normalizeFilter(String(raw).trim());
    if (exact.includes(col)) {
      where.push(`t."${col}" = ?`);
      wp.push(v);
    } else {
      where.push(`CAST(t."${col}" AS TEXT) LIKE ?`);
      wp.push(`%${v}%`);
    }
  }
  const base = `SELECT * FROM (${sql}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const sortCol = columns.includes(query.sort) ? query.sort : sort;
  const sortDir = (query.dir || dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const order = ` ORDER BY t."${sortCol}" ${sortDir}`;
  const allParams = [...params, ...wp];

  if (query.export || query.all) {
    return { rows: all(base + order, ...allParams), columns };
  }
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || 20, 1), 500);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const total = get(`SELECT COUNT(*) AS n FROM (${base})`, ...allParams).n;
  const rows = all(`${base}${order} LIMIT ? OFFSET ?`, ...allParams, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pageSize };
}

function close() {
  if (db) db.close();
  db = undefined;
}

module.exports = { open, all, get, run, tx, insert, update, nextSeq, paginate, close, DB_PATH };
