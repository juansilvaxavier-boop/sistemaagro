// Entrada para hospedagem serverless (Vercel): banco em /tmp com dados de demonstração.
process.env.DB_PATH ||= '/tmp/agroterra.db';
process.env.UPLOAD_DIR ||= '/tmp/uploads';
process.env.SSE_MAX_SECONDS ||= '55';

const db = require('../server/db');
const { criarApp } = require('../server/index');

db.open();
if (!db.get('SELECT id FROM usuarios LIMIT 1')) require('../server/seed').seed();

module.exports = criarApp();
