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

// Com SESSION_SECRET (hospedagem serverless, várias instâncias) o token é assinado e
// carrega usuário, empresa e validade, então qualquer instância reconhece a sessão.
const SEGREDO = process.env.SESSION_SECRET;
const assinar = (dados) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

function criarSessao(usuarioId, empresaId) {
  const expira = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  let token = crypto.randomBytes(32).toString('hex');
  if (SEGREDO) {
    const dados = `${usuarioId}.${empresaId ?? 0}.${Date.parse(expira)}.${crypto.randomBytes(6).toString('hex')}`;
    token = `${dados}.${assinar(dados)}`;
  }
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
  if (s) return !s.ativo || s.expira_em < new Date().toISOString() ? null : s;
  return SEGREDO ? sessaoAssinada(token) : null;
}

function sessaoAssinada(token) {
  const partes = String(token).split('.');
  if (partes.length !== 5) return null;
  const dados = partes.slice(0, 4).join('.');
  const esperado = Buffer.from(assinar(dados));
  const recebido = Buffer.from(partes[4]);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  const [uid, emp, exp] = partes.map(Number);
  if (exp < Date.now()) return null;
  const u = db.get('SELECT id, nome, login, email, perfil, equipe_id, ativo FROM usuarios WHERE id = ?', uid);
  if (!u || !u.ativo) return null;
  // Registra a sessão nesta instância para que a troca de empresa e o logout funcionem nela.
  db.run('INSERT OR IGNORE INTO sessoes (token, usuario_id, empresa_id, expira_em) VALUES (?, ?, ?, ?)', token, uid, emp || null, new Date(exp).toISOString());
  return { ...u, token, empresa_id: emp || null };
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
