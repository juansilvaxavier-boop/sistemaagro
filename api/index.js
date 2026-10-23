// Entrada para hospedagem serverless (Vercel). O banco é o PostgreSQL do Supabase (DATABASE_URL).
process.env.SSE_MAX_SECONDS ||= '55';

const { criarApp } = require('../server/index');
const { bootstrap } = require('../server/bootstrap');

const app = criarApp();
let pronto;

module.exports = async (req, res) => {
  try {
    pronto ||= bootstrap();
    await pronto;
  } catch (e) {
    pronto = undefined; // tenta de novo na próxima requisição
    console.error('Falha ao iniciar o banco:', e.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, erro: 'Banco de dados indisponível. Tente novamente em instantes.', codigo: e.code || null, detalhe: String(e.message).slice(0, 160) }));
  }
  return app(req, res);
};
