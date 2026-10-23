// Entrada para hospedagem serverless (Vercel). O banco é o PostgreSQL do Supabase (DATABASE_URL).
process.env.SSE_MAX_SECONDS ||= '55';

const { criarApp } = require('../server/index');
const { bootstrap } = require('../server/bootstrap');

const app = criarApp();
const pronto = bootstrap();

module.exports = async (req, res) => {
  await pronto;
  return app(req, res);
};
