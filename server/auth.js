const crypto = require('node:crypto');
const db = require('./db');

const SESSION_HOURS = 12;
const COOKIE = 'agt_sessao';
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;

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

// Todas as permissões que podem ser liberadas individualmente para um usuário.
const CATALOGO = [
  ['Geral', [['dashboard', 'Ver o painel do próprio setor'], ['dashboard.todos', 'Ver o painel de qualquer setor'], ['chat', 'Usar o chat interno'],
    ['chamados', 'Abrir e acompanhar chamados internos'], ['chamados.gerir', 'Gerir todos os chamados']]],
  ['Comercial', [['propostas', 'Propostas comerciais']]],
  ['Filas do pedido', [
    ['fila.venda', 'Fila do Vendedor'], ['pedido.criar', 'Criar e editar pedidos'], ['fila.supervisao', 'Fila do Supervisor'],
    ['fila.analise', 'Fila da Análise'], ['fila.diretoria', 'Fila da Diretoria'], ['fila.cobranca', 'Cobrança (à vista)'],
    ['fila.producao', 'Fila da Produção'], ['fila.faturamento', 'Fila do Faturamento'], ['fila.expedicao', 'Fila da Expedição'],
    ['fila.transito', 'Expedição – Trânsito'], ['fila.devolucao', 'Fila de Devolução'],
  ]],
  ['Clientes', [
    ['clientes', 'Ver clientes'], ['clientes.editar', 'Cadastrar e editar clientes'], ['clientes.historico', 'Histórico de compra'],
    ['blacklist', 'Ver blacklist'], ['blacklist.editar', 'Incluir e excluir da blacklist'], ['serasa', 'Consultar Serasa'],
  ]],
  ['Relacionamento', [['crm', 'CRM'], ['cobranca', 'Cobrança'], ['arquivos', 'Arquivos e documentos']]],
  ['Estoque e expedição', [['estoque', 'Ver estoque'], ['estoque.movimentar', 'Lançar entradas, saídas e inventário'], ['etiquetas', 'Imprimir etiquetas de envio']]],
  ['Financeiro', [
    ['financeiro.parcelas', 'Gestão de parcelas'], ['financeiro.lancamentos', 'Descontos e créditos'], ['financeiro.comissoes', 'Revisar comissões'],
    ['financeiro.devolucoes', 'Desconto de devolução'], ['financeiro.negativados', 'Clientes negativados'], ['financeiro.notas', 'Notas fiscais'],
    ['financeiro.pagar', 'Contas a pagar'],
  ]],
  ['Relatórios', [['relatorios.vendas', 'Relatórios de vendas'], ['relatorios.financeiro', 'Relatórios financeiros'], ['relatorios.estoque', 'Relatórios de estoque']]],
  ['Cadastros', [
    ['cadastros.produto', 'Produtos'], ['cadastros.forma', 'Formas de pagamento'], ['cadastros.transportadora', 'Transportadoras'],
    ['cadastros.fornecedor', 'Fornecedores'], ['cadastros.colaborador', 'Colaboradores'], ['cadastros.usuario', 'Usuários, equipes e permissões'], ['cadastros.empresa', 'Empresas'],
  ]],
  ['Segurança e LGPD', [
    ['lgpd.dados', 'Ver CPF/CNPJ, telefone e e-mail completos'], ['lgpd.titular', 'Exportar e anonimizar dados de titulares'],
    ['auditoria', 'Ver auditoria'], ['backup', 'Backups do banco'],
  ]],
];

// Permissões padrão de cada perfil. "*" libera tudo.
const PERMISSOES = {
  admin: ['*'],
  diretoria: ['*'],
  vendedor: ['dashboard', 'chat', 'chamados', 'propostas', 'fila.venda', 'pedido.criar', 'clientes', 'clientes.editar', 'clientes.historico', 'crm', 'arquivos', 'relatorios.vendas', 'lgpd.dados'],
  supervisor: [
    'dashboard', 'chat', 'chamados', 'propostas', 'fila.venda', 'fila.supervisao', 'pedido.criar', 'clientes', 'clientes.editar', 'clientes.historico',
    'blacklist', 'serasa', 'crm', 'arquivos', 'relatorios.vendas', 'relatorios.financeiro', 'lgpd.dados',
  ],
  analista: [
    'dashboard', 'chat', 'chamados', 'fila.analise', 'clientes', 'clientes.editar', 'clientes.historico', 'blacklist', 'blacklist.editar',
    'serasa', 'crm', 'arquivos', 'relatorios.vendas', 'relatorios.financeiro', 'lgpd.dados',
  ],
  producao: ['dashboard', 'chat', 'chamados', 'fila.producao', 'arquivos', 'estoque', 'estoque.movimentar', 'relatorios.estoque'],
  faturamento: ['dashboard', 'chat', 'chamados', 'estoque', 'etiquetas', 'fila.faturamento', 'clientes', 'clientes.historico', 'serasa', 'financeiro.notas', 'arquivos', 'relatorios.financeiro', 'lgpd.dados'],
  expedicao: ['dashboard', 'chat', 'chamados', 'fila.expedicao', 'fila.transito', 'cadastros.transportadora', 'arquivos', 'estoque', 'estoque.movimentar', 'etiquetas', 'relatorios.estoque'],
  financeiro: [
    'dashboard', 'chat', 'chamados', 'financeiro.pagar', 'cadastros.fornecedor', 'fila.cobranca', 'fila.devolucao', 'clientes', 'clientes.historico', 'blacklist', 'blacklist.editar',
    'serasa', 'crm', 'arquivos', 'cobranca', 'financeiro.parcelas', 'financeiro.lancamentos', 'financeiro.comissoes',
    'financeiro.devolucoes', 'financeiro.negativados', 'financeiro.notas', 'relatorios.vendas', 'relatorios.financeiro', 'lgpd.dados',
  ],
};

/** Permissões efetivas: as individuais do usuário, se definidas; senão as do perfil. */
function permissoesDe(usuario) {
  if (usuario?.permissoes) {
    try {
      const l = typeof usuario.permissoes === 'string' ? JSON.parse(usuario.permissoes) : usuario.permissoes;
      if (Array.isArray(l)) return l;
    } catch {}
  }
  return PERMISSOES[usuario?.perfil] || [];
}

/** Aceita o usuário (com permissões) ou só o nome do perfil. */
function can(quem, perm) {
  const lista = typeof quem === 'string' ? PERMISSOES[quem] || [] : quem?.permissoesEfetivas || permissoesDe(quem);
  if (lista.includes('*')) return true;
  // Permissão exata; pedir só o grupo ("fila") é atendido por qualquer item dele ("fila.venda").
  return lista.includes(perm) || lista.some((p) => p.startsWith(perm + '.'));
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

/** Senha forte: 8+ caracteres com letras e números. */
function validarSenha(senha) {
  const s = String(senha || '');
  if (s.length < 8 || !/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'A senha deve ter ao menos 8 caracteres, com letras e números.';
  return null;
}

// Com SESSION_SECRET (hospedagem serverless, várias instâncias) o token é assinado e
// carrega usuário, empresa e validade, então qualquer instância reconhece a sessão.
const SEGREDO = process.env.SESSION_SECRET;
const assinar = (dados) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

async function criarSessao(usuarioId, empresaId) {
  const expira = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  let token = crypto.randomBytes(32).toString('hex');
  if (SEGREDO) {
    const dados = `${usuarioId}.${empresaId ?? 0}.${Date.parse(expira)}.${crypto.randomBytes(6).toString('hex')}`;
    token = `${dados}.${assinar(dados)}`;
  }
  await db.run('DELETE FROM sessoes WHERE expira_em < ?', new Date().toISOString());
  await db.run('INSERT INTO sessoes (token, usuario_id, empresa_id, expira_em) VALUES (?, ?, ?, ?)', token, usuarioId, empresaId ?? null, expira);
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

const CAMPOS_USUARIO = 'u.id, u.nome, u.login, u.email, u.perfil, u.equipe_id, u.ativo, u.permissoes, u.trocar_senha, u.termo_aceito_em, u.colaborador_id';

async function carregarSessao(token) {
  if (!token) return null;
  const s = await db.get(`SELECT s.token, s.empresa_id, s.expira_em, ${CAMPOS_USUARIO} FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`, token);
  if (s) return !s.ativo || s.expira_em < new Date().toISOString() ? null : s;
  return SEGREDO ? sessaoAssinada(token) : null;
}

async function sessaoAssinada(token) {
  const partes = String(token).split('.');
  if (partes.length !== 5) return null;
  const dados = partes.slice(0, 4).join('.');
  const esperado = Buffer.from(assinar(dados));
  const recebido = Buffer.from(partes[4]);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  const [uid, emp, exp] = partes.map(Number);
  if (exp < Date.now()) return null;
  const u = await db.get(`SELECT ${CAMPOS_USUARIO} FROM usuarios u WHERE u.id = ?`, uid);
  if (!u || !u.ativo) return null;
  await db.run('INSERT INTO sessoes (token, usuario_id, empresa_id, expira_em) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', token, uid, emp || null, new Date(exp).toISOString());
  return { ...u, token, empresa_id: emp || null };
}

const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

/**
 * Middleware: exige usuário autenticado e empresa escolhida.
 * Enquanto a senha provisória não for trocada ou o termo de privacidade não for aceito, só libera /auth.
 */
function autenticado(opts = {}) {
  return async (req, res, next) => {
    const token = lerCookie(req, COOKIE) || (req.headers.authorization || '').replace(/^Bearer /, '');
    const s = await carregarSessao(token);
    if (!s) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    if (!opts.semEmpresa && !s.empresa_id) return res.status(409).json({ erro: 'Escolha a empresa.' });
    if (!opts.semPendencias && (s.trocar_senha || !s.termo_aceito_em)) {
      return res.status(428).json({ erro: s.trocar_senha ? 'Troque a senha provisória para continuar.' : 'Aceite o termo de privacidade para continuar.' });
    }
    req.user = {
      id: s.id, nome: s.nome, login: s.login, perfil: s.perfil, equipe_id: s.equipe_id, colaborador_id: s.colaborador_id,
      permissoesEfetivas: permissoesDe(s), trocar_senha: !!s.trocar_senha, termo_aceito_em: s.termo_aceito_em,
    };
    req.empresaId = s.empresa_id;
    req.token = s.token;
    db.comUsuario({ usuarioId: s.id, usuarioNome: s.nome, ip: ipDe(req), rota: `${req.method} ${req.originalUrl.split('?')[0]}` }, next);
  };
}

function exige(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => can(req.user, p))) return next();
    res.status(403).json({ erro: 'Seu usuário não tem acesso a esta funcionalidade.' });
  };
}

module.exports = {
  PERFIS, PERMISSOES, CATALOGO, COOKIE, SESSION_HOURS, MAX_TENTATIVAS, BLOQUEIO_MIN,
  can, permissoesDe, hashSenha, conferirSenha, validarSenha, criarSessao, carregarSessao, lerCookie, autenticado, exige, ipDe,
};
