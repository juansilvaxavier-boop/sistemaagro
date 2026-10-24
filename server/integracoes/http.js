// Cliente HTTP das integrações (node:https), com certificado de cliente (mTLS) quando a API exige — caso da Cora.
// Nos testes o transporte é trocado por um falso com definirTransporte().
const https = require('node:https');
const http = require('node:http');

const TIMEOUT_MS = 20000;

function transportePadrao({ method, url, headers, body, cert, key, timeout }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method, headers, cert, key, timeout: timeout || TIMEOUT_MS }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao chamar a API.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let transporte = transportePadrao;

/**
 * Requisição: json (objeto → JSON), form (objeto → x-www-form-urlencoded) ou body (texto).
 * Devolve { status, headers, texto, json }.
 */
async function requisicao({ method = 'GET', url, headers = {}, json, form, body, cert, key, timeout, basic, bearer }) {
  const h = { Accept: 'application/json', 'User-Agent': 'AgroterraSistema/1.0', ...headers };
  let corpo = body;
  if (json !== undefined) { corpo = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  if (form !== undefined) { corpo = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (basic) h.Authorization = `Basic ${Buffer.from(`${basic[0]}:${basic[1]}`).toString('base64')}`;
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (corpo) h['Content-Length'] = Buffer.byteLength(corpo);
  const r = await transporte({ method, url, headers: h, body: corpo, cert, key, timeout });
  let dados = null;
  try { dados = r.texto ? JSON.parse(r.texto) : null; } catch { dados = null; }
  return { ...r, json: dados };
}

module.exports = { requisicao, definirTransporte: (fn) => { transporte = fn || transportePadrao; } };
