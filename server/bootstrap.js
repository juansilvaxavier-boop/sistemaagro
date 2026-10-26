// Primeira execução em produção: cria só a empresa e o administrador (sem dados de demonstração).
// A senha inicial vem de ADMIN_SENHA_INICIAL e precisa ser trocada no primeiro acesso.
const crypto = require('node:crypto');
const db = require('./db');
const A = require('./auth');

const BANCOS = [['001', 'Banco do Brasil'], ['033', 'Santander'], ['104', 'Caixa Econômica Federal'], ['237', 'Bradesco'], ['341', 'Itaú'],
  ['748', 'Sicredi'], ['756', 'Sicoob'], ['077', 'Banco Inter'], ['260', 'Nubank'], ['336', 'C6 Bank']];

async function bootstrap() {
  await db.open();
  if (await db.get('SELECT id FROM usuarios LIMIT 1')) return { criado: false };
  return db.comUsuario({ semAuditoria: true }, () => db.tx(async () => {
    const empresa = await db.insert('empresas', { nome: process.env.EMPRESA_NOME || 'Acelera Fertilizantes', cnpj: process.env.EMPRESA_CNPJ || null, uf: process.env.EMPRESA_UF || null });
    let senha = process.env.ADMIN_SENHA_INICIAL;
    if (!senha) {
      senha = crypto.randomBytes(9).toString('base64url') + '9a';
      console.warn(`[bootstrap] ADMIN_SENHA_INICIAL não definida. Senha provisória do usuário admin: ${senha}`);
    }
    const admin = await db.insert('usuarios', {
      nome: 'Administrador', login: (process.env.ADMIN_LOGIN || 'admin').toLowerCase(), email: process.env.ADMIN_EMAIL || null,
      perfil: 'admin', senha_hash: A.hashSenha(senha), trocar_senha: 1,
    });
    await db.run('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)', admin, empresa);
    for (const nome of ['Linha Solo', 'Linha Foliar']) await db.insert('grupos_produto', { nome });
    for (const [codigo, nome] of BANCOS) await db.insert('bancos', { codigo, nome });
    return { criado: true, admin, empresa };
  }));
}

module.exports = { bootstrap };
