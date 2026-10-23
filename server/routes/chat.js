// Chat interno: conversa direta entre dois usuários, com aviso em tempo real e controle de lidas.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const sse = require('../sse');
const { ErroNegocio } = require('../services');

const r = express.Router();
r.use(A.exige('chat'));

r.get('/contatos', async (req, res) => {
  const online = new Set(sse.online());
  const linhas = await db.all(
    `SELECT u.id, u.nome, u.perfil, u.foto IS NOT NULL AS tem_foto, c.cargo,
       (SELECT COUNT(*) FROM chat_mensagens m WHERE m.de_id = u.id AND m.para_id = :eu AND m.lida_em IS NULL) AS nao_lidas,
       (SELECT m.texto FROM chat_mensagens m WHERE (m.de_id = u.id AND m.para_id = :eu) OR (m.de_id = :eu AND m.para_id = u.id) ORDER BY m.id DESC LIMIT 1) AS ultima,
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
    `SELECT id, de_id, para_id, texto, created_at, lida_em FROM chat_mensagens
      WHERE ((de_id = :eu AND para_id = :outro) OR (de_id = :outro AND para_id = :eu)) AND id > :depois
      ORDER BY id DESC LIMIT 200`,
    { eu: req.user.id, outro, depois },
  );
  const lidas = await db.run(`UPDATE chat_mensagens SET lida_em = datetime('now','localtime') WHERE de_id = ? AND para_id = ? AND lida_em IS NULL`, outro, req.user.id);
  if (lidas.changes) sse.enviar('chat_lida', { por: req.user.id }, { usuarios: [outro] });
  res.json(msgs.reverse());
});

r.post('/:id', async (req, res) => {
  const para = Number(req.params.id);
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva a mensagem.');
  if (texto.length > 4000) throw new ErroNegocio('Mensagem muito longa (máx. 4.000 caracteres).');
  if (para === req.user.id) throw new ErroNegocio('Escolha outra pessoa.');
  if (!(await db.get('SELECT id FROM usuarios WHERE id = ? AND ativo = 1', para))) throw new ErroNegocio('Usuário não encontrado.', 404);
  const msg = await db.get(
    'INSERT INTO chat_mensagens (de_id, para_id, texto) VALUES (?, ?, ?) RETURNING id, de_id, para_id, texto, created_at, lida_em',
    req.user.id, para, texto,
  );
  sse.enviar('chat', { ...msg, de_nome: req.user.nome }, { usuarios: [para] });
  res.status(201).json(msg);
});

module.exports = r;
