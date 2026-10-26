// Notificações Web Push (celular e computador, mesmo com o sistema fechado).
// Chaves VAPID: VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente; sem elas, o sistema gera um par na primeira vez e guarda em configuracoes.
const webpush = require('web-push');
const db = require('./db');

let chaves = null;
async function vapid() {
  if (chaves) return chaves;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    chaves = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    return chaves;
  }
  let r = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'push.vapid'`);
  if (!r) {
    const k = webpush.generateVAPIDKeys();
    await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('push.vapid', ?) ON CONFLICT (chave) DO NOTHING`, JSON.stringify({ pub: k.publicKey, priv: k.privateKey }));
    // Relê: se duas instâncias gerarem ao mesmo tempo, vale o par gravado primeiro.
    r = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'push.vapid'`);
  }
  chaves = JSON.parse(r.valor);
  return chaves;
}

const chavePublica = async () => (await vapid()).pub;

async function inscrever(usuarioId, s, dispositivo) {
  const endpoint = String(s?.endpoint || '');
  const p256dh = String(s?.keys?.p256dh || '');
  const auth = String(s?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new (require('./services').ErroNegocio)('Inscrição de notificação inválida.');
  await db.run(`INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, dispositivo) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, dispositivo = EXCLUDED.dispositivo`,
  usuarioId, endpoint, p256dh, auth, String(dispositivo || '').slice(0, 200) || null);
}

const remover = (usuarioId, endpoint) => db.run('DELETE FROM push_inscricoes WHERE usuario_id = ? AND endpoint = ?', usuarioId, String(endpoint || ''));

/** Envia para todos os aparelhos dos usuários; devolve quantos aparelhos receberam. Inscrições expiradas são apagadas. */
async function enviar(usuarioIds, { titulo, corpo, url = '/', tag }) {
  const ids = [...new Set((usuarioIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  const subs = await db.all(`SELECT id, endpoint, p256dh, auth FROM push_inscricoes WHERE usuario_id IN (${ids.join(',')})`);
  if (!subs.length) return 0;
  const { pub, priv } = await vapid();
  const opcoes = { TTL: 3 * 3600, vapidDetails: { subject: process.env.PUSH_CONTATO || 'https://agroterra-sistema.vercel.app', publicKey: pub, privateKey: priv } };
  const corpoJson = JSON.stringify({ titulo, corpo, url, tag });
  let n = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, corpoJson, opcoes);
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.run('DELETE FROM push_inscricoes WHERE id = ?', s.id);
    }
  }));
  return n;
}

module.exports = { chavePublica, inscrever, remover, enviar };
