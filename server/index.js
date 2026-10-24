const path = require('node:path');
const express = require('express');
const db = require('./db');
const A = require('./auth');
const { ErroNegocio } = require('./services');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Proteção CSRF simples: requisições que alteram dados precisam vir do próprio site.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-requested-with'] !== 'agroterra') return res.status(403).json({ erro: 'Requisição inválida.' });
    next();
  });

  app.get('/api/saude', async (req, res) => {
    try {
      const r = await db.get('SELECT current_schema() AS schema, (SELECT COUNT(*) FROM usuarios) AS usuarios');
      res.json({ ok: true, banco: 'conectado', schema: r.schema, usuarios: r.usuarios, node: process.version });
    } catch (e) {
      res.status(503).json({ ok: false, banco: 'indisponível', erro: e.code || 'erro', detalhe: String(e.message).slice(0, 160) });
    }
  });
  app.get('/api/cron/backup', (req, res, next) => require('./routes/admin').cronBackup(req, res).catch(next));
  app.get('/api/cron/crm', (req, res, next) => require('./routes/admin').cronCrm(req, res).catch(next));
  app.use('/api/auth', require('./routes/auth'));
  const api = express.Router();
  api.use(A.autenticado());
  api.use('/cadastros', require('./routes/cadastros'));
  api.use('/clientes', require('./routes/clientes'));
  api.use('/pedidos', require('./routes/pedidos'));
  api.use('/mensagens', require('./routes/mensagens'));
  api.use('/financeiro', require('./routes/financeiro'));
  api.use('/cobranca', require('./routes/cobranca'));
  api.use('/crm', require('./routes/crm'));
  api.use('/arquivos', require('./routes/arquivos'));
  api.use('/dashboard', require('./routes/dashboards'));
  api.use('/relatorios', require('./routes/relatorios'));
  api.use('/chat', require('./routes/chat'));
  api.use('/estoque', require('./routes/estoque'));
  api.use('/pagar', require('./routes/pagar'));
  api.use('/compras', require('./routes/compras'));
  api.use('/chamados', require('./routes/chamados'));
  api.use('/propostas', require('./routes/propostas'));
  api.use('/rh', require('./routes/rh'));
  api.use('/assistente', require('./routes/assistente'));
  api.use('/consulta', require('./routes/consulta'));
  api.use('/admin', require('./routes/admin'));
  api.use('/integracoes', require('./routes/integracoes'));
  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  const nm = path.join(__dirname, '..', 'node_modules');
  app.use('/vendor/bootstrap', express.static(path.join(nm, 'bootstrap', 'dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(nm, 'bootstrap-icons', 'font')));
  app.use('/vendor/chart.js', express.static(path.join(nm, 'chart.js', 'dist')));
  app.use('/vendor/fonte', express.static(path.join(nm, '@fontsource-variable', 'plus-jakarta-sans')));
  app.use('/vendor/mapa-brasil', express.static(path.join(nm, '@svg-maps', 'brazil')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroNegocio) return res.status(err.status).json({ erro: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Arquivo maior que o permitido.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    if (err.code === '23505') return res.status(409).json({ erro: 'Registro duplicado.' });
    if (err.code === '23503') return res.status(400).json({ erro: 'Referência inválida ou registro em uso.' });
    if (err.code === '22P02' || err.code === '22007') return res.status(400).json({ erro: 'Valor inválido em um dos campos.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  });
  return app;
}

if (require.main === module) {
  (async () => {
    await db.open();
    if (process.env.DEMO === '1' && !(await db.get('SELECT id FROM usuarios LIMIT 1'))) {
      console.log('DEMO=1 e banco vazio: carregando dados de demonstração...');
      (await require('./seed')).seed();
    }
    (await require('./bootstrap')).bootstrap();
    const port = Number(process.env.PORT || 3000);
    criarApp().listen(port, () => console.log(`Agroterra Sistema em http://localhost:${port}`));
  })();
}

module.exports = { criarApp };
