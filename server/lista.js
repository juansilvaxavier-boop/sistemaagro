// Resposta padrão das telas de lista: paginação, filtro por coluna e exportação para Excel.
const ExcelJS = require('exceljs');
const db = require('./db');
const { mascararLinhas } = require('./lgpd');

async function enviarXlsx(res, { titulo, colunas, linhas }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Acelera Fertilizantes';
  const ws = wb.addWorksheet(String(titulo || 'Dados').slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
  ws.columns = colunas.map((c) => ({ header: c.l, key: c.k, width: Math.min(Math.max(String(c.l).length + 4, 12), 45) }));
  for (const l of linhas) {
    const row = {};
    for (const c of colunas) row[c.k] = formatarCelula(l[c.k], c.t);
    ws.addRow(row);
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
  colunas.forEach((c, i) => {
    if (c.t === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
    if (c.t === 'date' || c.t === 'datetime') ws.getColumn(i + 1).numFmt = c.t === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  const nome = `${String(titulo || 'dados').normalize('NFD').replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.end(Buffer.from(await wb.xlsx.writeBuffer()));
}

function formatarCelula(v, tipo) {
  if (v == null) return '';
  if ((tipo === 'date' || tipo === 'datetime') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return new Date(v.length <= 10 ? v + 'T00:00:00' : v.replace(' ', 'T'));
  }
  if (tipo === 'bool') return v ? 'Sim' : 'Não';
  return v;
}

function colunasExport(req) {
  try {
    const cols = JSON.parse(req.query.cols || '[]');
    if (Array.isArray(cols) && cols.length) return cols;
  } catch {}
  return null;
}

/** Responde uma lista paginada (ou o arquivo Excel quando ?export=xlsx). */
async function responderLista(req, res, opts) {
  const resultado = await db.paginate(req.query, opts);
  mascararLinhas(req.user, resultado.rows);
  if (req.query.export === 'xlsx') {
    const colunas = colunasExport(req) || resultado.columns.map((k) => ({ k, l: k }));
    return enviarXlsx(res, { titulo: req.query.title || opts.titulo, colunas, linhas: resultado.rows });
  }
  res.json(resultado);
}

/**
 * Mesma resposta de responderLista para linhas já calculadas em memória (telas com valores calculados):
 * f_<coluna> (contém ou igual), ordenação, paginação e exportação.
 */
async function responderMemoria(req, res, linhas, { titulo, exatos = [] } = {}) {
  let rows = linhas;
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [k, v] of Object.entries(req.query)) {
    if (!k.startsWith('f_') || v === '') continue;
    const col = k.slice(2);
    rows = exatos.includes(col) ? rows.filter((r) => String(r[col] ?? '') === String(v)) : rows.filter((r) => norm(r[col]).includes(norm(v)));
  }
  const sort = req.query.sort;
  if (sort) {
    const dir = req.query.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * dir;
    });
  }
  mascararLinhas(req.user, rows);
  if (req.query.export === 'xlsx') {
    const colunas = colunasExport(req) || Object.keys(rows[0] || {}).map((k) => ({ k, l: k }));
    return enviarXlsx(res, { titulo: req.query.title || titulo, colunas, linhas: rows });
  }
  if (req.query.all) return res.json({ rows, total: rows.length });
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
}

module.exports = { responderLista, responderMemoria, enviarXlsx };
