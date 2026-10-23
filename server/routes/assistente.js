// Assistente de IA do sistema (ajuda de uso e consultas só de leitura).
const express = require('express');
const AS = require('../assistente');
const { ErroNegocio } = require('../services');

const r = express.Router();

r.get('/status', (req, res) => res.json({ ia: AS.usarIa() }));

r.post('/', async (req, res) => {
  const { mensagens, telas } = req.body || {};
  if (!Array.isArray(mensagens) || !mensagens.length) throw new ErroNegocio('Envie a pergunta.');
  const conversa = mensagens.slice(-20).map((m) => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: String(m?.content || '').slice(0, 4000),
  })).filter((m) => m.content.trim());
  while (conversa.length && conversa[0].role !== 'user') conversa.shift();
  if (!conversa.length || conversa.at(-1).role !== 'user') throw new ErroNegocio('A última mensagem deve ser a pergunta.');
  const lista = Array.isArray(telas) ? telas.slice(0, 80).map((t) => String(t).slice(0, 80)) : [];
  res.json(await AS.responder(req, conversa, lista));
});

module.exports = r;
