const path = require('node:path');
const express = require('express');
const db = require('./db');
const A = require('./auth');
const { ErroNegocio } = require('./services');

function criarApp() {
  db.open();
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

  app.get('/api/saude', (req, res) => res.json({ ok: true, pedidos: db.get('SELECT COUNT(*) AS n FROM pedidos').n, node: process.version }));
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
  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  const nm = path.join(__dirname, '..', 'node_modules');
  app.use('/vendor/bootstrap', express.static(path.join(nm, 'bootstrap', 'dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(nm, 'bootstrap-icons', 'font')));
  app.use('/vendor/chart.js', express.static(path.join(nm, 'chart.js', 'dist')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroNegocio) return res.status(err.status).json({ erro: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Arquivo maior que o permitido.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    if (String(err.message).includes('UNIQUE constraint')) return res.status(409).json({ erro: 'Registro duplicado.' });
    if (String(err.message).includes('FOREIGN KEY')) return res.status(400).json({ erro: 'Referência inválida ou registro em uso.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  });
  return app;
}

if (require.main === module) {
  db.open();
  if (!db.get('SELECT id FROM usuarios LIMIT 1')) {
    console.log('Banco vazio: carregando dados de demonstração...');
    require('./seed').seed();
  }
  const port = Number(process.env.PORT || 3000);
  criarApp().listen(port, () => console.log(`Agroterra Sistema em http://localhost:${port}`));
}

module.exports = { criarApp };
