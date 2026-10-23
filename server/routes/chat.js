// Chat interno: conversa direta entre dois usuários, com aviso em tempo real e controle de lidas.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const sse = require('../sse');
const path = require('node:path');
const multer = require('multer');
const { ErroNegocio } = require('../services');

const r = express.Router();
r.use(A.exige('chat'));

// Anexos: imagens (prints), PDFs e documentos. O navegador reduz imagens grandes antes de enviar.
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 4);
const EXTENSOES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.txt', '.odt', '.ods', '.xml', '.zip', '.mp4', '.mp3', '.ogg', '.m4a'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ok = EXTENSOES.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new ErroNegocio(`Tipo de arquivo não permitido no chat. Use: ${EXTENSOES.join(', ')}`), ok);
  },
});
const ANEXOS_SQL = `(SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho, 'largura', a.largura, 'altura', a.altura) ORDER BY a.id)
  FROM chat_anexos a WHERE a.mensagem_id = m.id)`;
const comAnexos = (m) => ({ ...m, anexos: typeof m.anexos === 'string' ? JSON.parse(m.anexos) : m.anexos || [] });

r.get('/contatos', async (req, res) => {
  const online = new Set(sse.online());
  const linhas = await db.all(
    `SELECT u.id, u.nome, u.perfil, u.foto IS NOT NULL AS tem_foto, c.cargo,
       (SELECT COUNT(*) FROM chat_mensagens m WHERE m.de_id = u.id AND m.para_id = :eu AND m.lida_em IS NULL) AS nao_lidas,
       (SELECT CASE WHEN m.texto = '' THEN '📎 Anexo' ELSE m.texto END FROM chat_mensagens m WHERE (m.de_id = u.id AND m.para_id = :eu) OR (m.de_id = :eu AND m.para_id = u.id) ORDER BY m.id DESC LIMIT 1) AS ultima,
       (SELECT m.created_at FROM chat_mensagens m WHERE (m.de_id = u.id AND m.para_id = :eu) OR (m.de_id = :eu AND m.para_id = u.id) ORDER BY m.id DESC LIMIT 1) AS ultima_em
     FROM usuarios u LEFT JOIN colaboradores c ON c.id = u.colaborador_id
     WHERE u.ativo = 1 AND u.id <> :eu
     ORDER BY ultima_em DESC NULLS LAST, u.nome`,
    { eu: req.user.id },
  );
  res.json(linhas.map((l) => ({ ...l, perfil_label: A.PERFIS[l.perfil], online: online.has(l.id) })));
});

r.get('/nao-lidas', async (req, res) => {
  res.json({ n: (await db.get('SELECT COUNT(*) AS n FROM chat_mensagens WHERE para_id = ? AND lida_em IS NULL', req.user.id)).n });
});

r.get('/:id', async (req, res) => {
  const outro = Number(req.params.id);
  const depois = Number(req.query.depois) || 0;
  const msgs = await db.all(
    `SELECT m.id, m.de_id, m.para_id, m.texto, m.created_at, m.lida_em, ${ANEXOS_SQL} AS anexos FROM chat_mensagens m
      WHERE ((m.de_id = :eu AND m.para_id = :outro) OR (m.de_id = :outro AND m.para_id = :eu)) AND m.id > :depois
      ORDER BY m.id DESC LIMIT 200`,
    { eu: req.user.id, outro, depois },
  );
  const lidas = await db.run(`UPDATE chat_mensagens SET lida_em = datetime('now','localtime') WHERE de_id = ? AND para_id = ? AND lida_em IS NULL`, outro, req.user.id);
  if (lidas.changes) sse.enviar('chat_lida', { por: req.user.id }, { usuarios: [outro] });
  res.json(msgs.reverse().map(comAnexos));
});

/** Baixa ou mostra um anexo: só quem enviou ou recebeu a mensagem. */
r.get('/anexos/:id', async (req, res) => {
  const a = await db.get(
    `SELECT a.*, m.de_id, m.para_id FROM chat_anexos a JOIN chat_mensagens m ON m.id = a.mensagem_id WHERE a.id = ?`, Number(req.params.id),
  );
  if (!a || (a.de_id !== req.user.id && a.para_id !== req.user.id)) throw new ErroNegocio('Anexo não encontrado.', 404);
  const inline = req.query.baixar !== '1' && /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/mp4|audio\/)/.test(a.mime || '');
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
  res.end(Buffer.from(a.conteudo));
});

async function destinatario(req) {
  const para = Number(req.params.id);
  if (para === req.user.id) throw new ErroNegocio('Escolha outra pessoa.');
  if (!(await db.get('SELECT id FROM usuarios WHERE id = ? AND ativo = 1', para))) throw new ErroNegocio('Usuário não encontrado.', 404);
  return para;
}
async function gravar(req, para, texto, arquivos = [], medidas = []) {
  const msg = await db.tx(async () => {
    const m = await db.get(
      'INSERT INTO chat_mensagens (de_id, para_id, texto) VALUES (?, ?, ?) RETURNING id, de_id, para_id, texto, created_at, lida_em',
      req.user.id, para, texto,
    );
    m.anexos = [];
    for (const [i, f] of arquivos.entries()) {
      const med = medidas[i] || {};
      const largura = Number(med.largura) || null;
      const altura = Number(med.altura) || null;
      const a = await db.get(
        'INSERT INTO chat_anexos (mensagem_id, nome, mime, tamanho, conteudo, largura, altura) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, nome, mime, tamanho, largura, altura',
        m.id, f.originalname.slice(0, 200), f.mimetype, f.size, f.buffer, largura, altura,
      );
      m.anexos.push(a);
    }
    return m;
  });
  sse.enviar('chat', { ...msg, de_nome: req.user.nome }, { usuarios: [para] });
  return msg;
}

r.post('/:id', async (req, res) => {
  const para = await destinatario(req);
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva a mensagem.');
  if (texto.length > 4000) throw new ErroNegocio('Mensagem muito longa (máx. 4.000 caracteres).');
  res.status(201).json(await gravar(req, para, texto));
});

// Mensagem com anexos (texto opcional).
r.post('/:id/anexos', upload.array('arquivos', 5), async (req, res) => {
  const para = await destinatario(req);
  const arquivos = req.files || [];
  if (!arquivos.length) throw new ErroNegocio('Escolha ao menos um arquivo.');
  const texto = String(req.body?.texto || '').trim().slice(0, 4000);
  let medidas = [];
  try { medidas = JSON.parse(req.body?.medidas || '[]'); } catch { medidas = []; }
  res.status(201).json(await gravar(req, para, texto, arquivos, medidas));
});

module.exports = r;
