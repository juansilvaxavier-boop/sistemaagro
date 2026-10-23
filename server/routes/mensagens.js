// Comunicação interna entre setores, vinculada ao número do pedido.
const express = require('express');
const db = require('../db');
const sse = require('../sse');
const W = require('../workflow');
const { ErroNegocio } = require('../services');

const r = express.Router();

// Uma mensagem é do usuário quando foi enviada a ele, ao setor (perfil) dele, ou a todos.
const PARA_MIM = `(m.destinatario_id = :uid OR m.setor_destino = :perfil OR (m.destinatario_id IS NULL AND m.setor_destino IS NULL)) AND m.remetente_id <> :uid`;

r.get('/', (req, res) => {
  const caixa = req.query.caixa === 'enviadas' ? 'enviadas' : 'recebidas';
  const params = { uid: req.user.id, emp: req.empresaId };
  let filtro = 'm.remetente_id = :uid';
  if (req.query.pedido_id) {
    filtro = 'm.pedido_id = :pid';
    params.pid = Number(req.query.pedido_id);
  } else if (caixa === 'recebidas') {
    filtro = PARA_MIM;
    params.perfil = req.user.perfil;
  }
  const rows = db.open().prepare(`
    SELECT m.*, u.nome AS remetente, d.nome AS destinatario, p.numero AS pedido_numero,
      (SELECT lida_em FROM mensagem_leituras l WHERE l.mensagem_id = m.id AND l.usuario_id = :uid) AS lida_em
    FROM mensagens m JOIN usuarios u ON u.id = m.remetente_id
    LEFT JOIN usuarios d ON d.id = m.destinatario_id
    LEFT JOIN pedidos p ON p.id = m.pedido_id
    WHERE (p.id IS NULL OR p.empresa_id = :emp) AND ${filtro}
    ORDER BY m.id DESC LIMIT 200`).all(params);
  res.json(rows);
});

r.get('/nao-lidas', (req, res) => {
  const n = db.open().prepare(`
    SELECT COUNT(*) AS n FROM mensagens m LEFT JOIN pedidos p ON p.id = m.pedido_id
    WHERE (p.id IS NULL OR p.empresa_id = :emp) AND ${PARA_MIM}
      AND NOT EXISTS (SELECT 1 FROM mensagem_leituras l WHERE l.mensagem_id = m.id AND l.usuario_id = :uid)`)
    .get({ uid: req.user.id, perfil: req.user.perfil, emp: req.empresaId }).n;
  res.json({ n });
});

r.post('/', (req, res) => {
  const b = req.body || {};
  const texto = String(b.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva a mensagem.');
  let pedidoId = null;
  if (b.pedido_numero || b.pedido_id) {
    const p = db.get('SELECT id FROM pedidos WHERE (numero = ? OR id = ?) AND empresa_id = ?', Number(b.pedido_numero) || 0, Number(b.pedido_id) || 0, req.empresaId);
    if (!p) throw new ErroNegocio('Pedido não encontrado.');
    pedidoId = p.id;
  }
  const setor = b.setor_destino || null;
  const destinatario = b.destinatario_id ? Number(b.destinatario_id) : null;
  const id = db.insert('mensagens', { pedido_id: pedidoId, remetente_id: req.user.id, destinatario_id: destinatario, setor_destino: setor, texto });
  const msg = db.get(
    `SELECT m.*, u.nome AS remetente, p.numero AS pedido_numero FROM mensagens m JOIN usuarios u ON u.id = m.remetente_id
     LEFT JOIN pedidos p ON p.id = m.pedido_id WHERE m.id = ?`, id,
  );
  const filtro = destinatario ? { usuarios: [destinatario] } : setor ? { perfis: [setor] } : { todos: true };
  sse.enviar('mensagem', msg, { ...filtro, exceto: req.user.id });
  res.status(201).json(msg);
});

r.post('/:id/lida', (req, res) => {
  db.run('INSERT OR IGNORE INTO mensagem_leituras (mensagem_id, usuario_id) VALUES (?, ?)', req.params.id, req.user.id);
  res.json({ ok: true });
});

r.post('/todas-lidas', (req, res) => {
  db.open().prepare(`
    INSERT OR IGNORE INTO mensagem_leituras (mensagem_id, usuario_id)
    SELECT m.id, :uid FROM mensagens m WHERE ${PARA_MIM}`).run({ uid: req.user.id, perfil: req.user.perfil });
  res.json({ ok: true });
});

r.get('/setores', (req, res) => {
  const setores = [...new Set(Object.values(W.ETAPAS).map((e) => e.perfil).filter(Boolean))];
  res.json(setores);
});

module.exports = r;
