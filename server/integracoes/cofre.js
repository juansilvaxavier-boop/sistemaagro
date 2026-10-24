// Credenciais das integrações: criptografadas com AES-256-GCM antes de ir para o banco.
// A chave vem de INTEGRACOES_CHAVE (recomendado) ou, na falta dela, de SESSION_SECRET.
const crypto = require('node:crypto');

function chave() {
  const base = process.env.INTEGRACOES_CHAVE || process.env.SESSION_SECRET || 'agroterra-desenvolvimento-sem-chave';
  return crypto.createHash('sha256').update(`agroterra-integracoes:${base}`).digest();
}

function cifrar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(obj || {}), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${dados.toString('base64')}`;
}

function decifrar(texto) {
  if (!texto) return {};
  const [v, iv, tag, dados] = String(texto).split(':');
  if (v !== 'v1') return {};
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8'));
  } catch {
    // Chave trocada: as credenciais precisam ser informadas de novo.
    return { _ilegivel: true };
  }
}

const chaveDefinida = () => !!(process.env.INTEGRACOES_CHAVE || process.env.SESSION_SECRET);

module.exports = { cifrar, decifrar, chaveDefinida };
