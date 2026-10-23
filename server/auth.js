const crypto = require('node:crypto');
const db = require('./db');

const SESSION_HOURS = 12;
const COOKIE = 'agt_sessao';

const PERFIS = {
  admin: 'Administrador',
  diretoria: 'Diretoria',
  vendedor: 'Vendedor',
  supervisor: 'Supervisor',
  analista: 'Análise',
  producao: 'Produção',
  faturamento: 'Faturamento',
  expedicao: 'Expedição',
  financeiro: 'Financeiro',
};

// Permissões por perfil. "*" libera tudo.
const PERMISSOES = {
  admin: ['*'],
  diretoria: ['*'],
  vendedor: [
    'dashboard', 'fila.venda', 'pedido.criar', 'clientes', 'clientes.editar', 'clientes.historico',
    'crm', 'arquivos', 'relatorios.vendas',
  ],
  supervisor: [
    'dashboard', 'fila.venda', 'fila.supervisao', 'pedido.criar', 'clientes', 'clientes.editar',
    'clientes.historico', 'blacklist', 'serasa', 'crm', 'arquivos', 'relatorios', 'relatorios.vendas',
  ],
  analista: [
    'dashboard', 'fila.analise', 'clientes', 'clientes.editar', 'clientes.historico', 'blacklist',
    'blacklist.editar', 'serasa', 'crm', 'arquivos', 'relatorios', 'relatorios.vendas',
  ],
  producao: ['dashboard', 'fila.producao', 'arquivos'],
  faturamento: ['dashboard', 'fila.faturamento', 'clientes', 'clientes.historico', 'serasa', 'financeiro.notas', 'arquivos', 'relatorios'],
  expedicao: ['dashboard', 'fila.expedicao', 'fila.transito', 'cadastros.transportadora', 'arquivos'],
  financeiro: [
    'dashboard', 'fila.cobranca', 'fila.devolucao', 'clientes', 'clientes.historico', 'blacklist', 'blacklist.editar',
    'serasa', 'crm', 'arquivos', 'cobranca', 'financeiro', 'financeiro.parcelas', 'financeiro.lancamentos',
    'financeiro.comissoes', 'financeiro.devolucoes', 'financeiro.negativados', 'financeiro.notas',
    'relatorios', 'relatorios.vendas', 'relatorios.financeiro',
  ],
};

function can(perfil, perm) {
  const lista = PERMISSOES[perfil] || [];
  if (lista.includes('*')) return true;
  // "x" libera "x.y"; pedir "x" é atendido por qualquer "x.y".
  return lista.includes(perm) || lista.some((p) => perm.startsWith(p + '.') || p.startsWith(perm + '.'));
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  const [salt, hash] = String(armazenado || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === calc.length && crypto.timingSafeEqual(ref, calc);
}

function criarSessao(usuarioId, empresaId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.run('DELETE FROM sessoes WHERE expira_em < ?', new Date().toISOString());
  db.run('INSERT INTO sessoes (token, usuario_id, empresa_id, expira_em) VALUES (?, ?, ?, ?)', token, usuarioId, empresaId ?? null, expira);
  return token;
}

function lerCookie(req, nome) {
  const header = req.headers.cookie || '';
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

function carregarSessao(token) {
  if (!token) return null;
  const s = db.get(
    `SELECT s.token, s.empresa_id, s.expira_em, u.id, u.nome, u.login, u.email, u.perfil, u.equipe_id, u.ativo
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`,
    token,
  );
  if (!s || !s.ativo || s.expira_em < new Date().toISOString()) return null;
  return s;
}

/** Middleware: exige usuário autenticado e empresa escolhida. */
function autenticado(opts = {}) {
  return (req, res, next) => {
    const token = lerCookie(req, COOKIE) || (req.headers.authorization || '').replace(/^Bearer /, '');
    const s = carregarSessao(token);
    if (!s) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    if (!opts.semEmpresa && !s.empresa_id) return res.status(409).json({ erro: 'Escolha a empresa.' });
    req.user = { id: s.id, nome: s.nome, login: s.login, perfil: s.perfil, equipe_id: s.equipe_id };
    req.empresaId = s.empresa_id;
    req.token = s.token;
    next();
  };
}

function exige(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => can(req.user.perfil, p))) return next();
    res.status(403).json({ erro: 'Seu perfil não tem acesso a esta funcionalidade.' });
  };
}

module.exports = {
  PERFIS, PERMISSOES, COOKIE, SESSION_HOURS,
  can, hashSenha, conferirSenha, criarSessao, carregarSessao, lerCookie, autenticado, exige,
};
