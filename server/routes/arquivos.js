// Arquivos e documentos (contratos, comprovantes etc.) vinculados ao cliente e ao pedido.
// O conteúdo fica no banco, então entra no backup e funciona em hospedagem sem disco.
const express = require('express');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const A = require('../auth');
const { ErroNegocio } = require('../services');
const { responderLista } = require('../lista');
const { escopoClientes } = require('./clientes');
const { registrar } = require('../auditoria');

const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 4);
const EXTENSOES = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.odt', '.ods', '.xml', '.zip'];
const CATEGORIAS = ['Contrato', 'Documento pessoal', 'Comprovante de pagamento', 'Comprovante de entrega', 'Nota fiscal', 'Laudo/Análise de solo', 'Outros'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ok = EXTENSOES.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new ErroNegocio(`Tipo de arquivo não permitido. Use: ${EXTENSOES.join(', ')}`), ok);
  },
});

const r = express.Router();
r.use(A.exige('arquivos'));

/** Garante que o usuário enxerga o cliente/pedido ao qual o arquivo pertence. */
async function exigirVinculo(req, { cliente_id, pedido_id, pedido_numero }) {
  if (!pedido_id && pedido_numero) {
    pedido_id = (await db.get('SELECT id FROM pedidos WHERE numero = ? AND empresa_id = ?', Number(pedido_numero), req.empresaId))?.id;
    if (!pedido_id) throw new ErroNegocio('Pedido não encontrado.', 404);
  }
  if (pedido_id) {
    const p = await db.get('SELECT id, cliente_id, vendedor_id, supervisor_id, empresa_id FROM pedidos WHERE id = ?', Number(pedido_id));
    if (!p || p.empresa_id !== req.empresaId) throw new ErroNegocio('Pedido não encontrado.', 404);
    if (req.user.perfil === 'vendedor' && p.vendedor_id !== req.user.id) throw new ErroNegocio('Pedido fora da sua carteira.', 403);
    if (req.user.perfil === 'supervisor' && p.supervisor_id !== req.user.id && p.vendedor_id !== req.user.id) throw new ErroNegocio('Pedido fora da sua equipe.', 403);
    if (cliente_id && Number(cliente_id) !== p.cliente_id) throw new ErroNegocio('O pedido não pertence a este cliente.');
    return { cliente_id: p.cliente_id, pedido_id: p.id };
  }
  if (cliente_id) {
    const e = escopoClientes(req.user);
    if (!(await db.get(`SELECT id FROM clientes c WHERE c.id = ? AND ${e.sql}`, Number(cliente_id), ...e.params))) throw new ErroNegocio('Cliente não encontrado.', 404);
    return { cliente_id: Number(cliente_id), pedido_id: null };
  }
  throw new ErroNegocio('Vincule o arquivo a um cliente ou pedido.');
}

r.get('/categorias', (req, res) => res.json({ categorias: CATEGORIAS, extensoes: EXTENSOES, max_mb: MAX_MB }));

r.get('/', async (req, res) => {
  const e = escopoClientes(req.user);
  const filtro = [];
  const params = [...e.params];
  if (req.query.cliente_id) filtro.push('a.cliente_id = ?'), params.push(Number(req.query.cliente_id));
  if (req.query.pedido_id) filtro.push('a.pedido_id = ?'), params.push(Number(req.query.pedido_id));
  await responderLista(req, res, {
    sql: `SELECT a.id, a.cliente_id, c.nome AS cliente, c.documento, a.pedido_id, p.numero AS pedido, a.categoria, a.descricao,
            a.nome_original, a.mime, a.tamanho, u.nome AS usuario, a.usuario_id, a.created_at
          FROM arquivos a LEFT JOIN clientes c ON c.id = a.cliente_id LEFT JOIN pedidos p ON p.id = a.pedido_id
          LEFT JOIN usuarios u ON u.id = a.usuario_id
          WHERE ${e.sql} ${filtro.length ? 'AND ' + filtro.join(' AND ') : ''}`,
    params, sort: 'created_at', exact: ['categoria'],
  });
});

r.post('/', upload.array('arquivos', 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new ErroNegocio('Selecione ao menos um arquivo.');
  const v = await exigirVinculo(req, req.body);
  const categoria = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'Outros';
  const ids = await db.tx(async () => {
    const out = [];
    for (const f of files) {
      out.push(await db.insert('arquivos', {
        ...v, categoria, descricao: req.body.descricao, nome_original: f.originalname, conteudo: f.buffer,
        mime: f.mimetype, tamanho: f.size, usuario_id: req.user.id,
      }));
    }
    return out;
  });
  res.status(201).json({ ids });
});

async function carregar(req) {
  const a = await db.get('SELECT * FROM arquivos WHERE id = ?', Number(req.params.id));
  if (!a) throw new ErroNegocio('Arquivo não encontrado', 404);
  await exigirVinculo(req, a);
  return a;
}

r.get('/:id/download', async (req, res) => {
  const a = await carregar(req);
  const inline = req.query.inline === '1' && /^(image\/|application\/pdf)/.test(a.mime || '');
  await registrar('baixar_arquivo', 'arquivos', a.id, null, { nome: a.nome_original });
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  res.end(Buffer.from(a.conteudo));
});

r.delete('/:id', async (req, res) => {
  const a = await carregar(req);
  if (a.usuario_id !== req.user.id && !['admin', 'diretoria'].includes(req.user.perfil)) {
    throw new ErroNegocio('Só quem enviou o arquivo ou a diretoria pode excluí-lo.', 403);
  }
  await db.remove('arquivos', a.id);
  res.json({ ok: true });
});

module.exports = r;
