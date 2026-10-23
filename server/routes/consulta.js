// Consultas públicas usadas para preencher cadastros sozinhos: CEP (endereço) e CNPJ (dados da Receita).
// O servidor consulta a BrasilAPI e, se falhar, o ViaCEP; as respostas ficam em memória por algumas horas.
const express = require('express');
const { ErroNegocio } = require('../services');

const r = express.Router();
const CACHE = new Map();
const VALIDADE_MS = 6 * 3600e3;
const TIMEOUT_MS = 6000;

let buscar = (url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'User-Agent': 'AgroterraSistema/1.0' } });

async function json(url) {
  const res = await buscar(url);
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function emCache(chave, fn) {
  const c = CACHE.get(chave);
  if (c && c.ate > Date.now()) return c.valor;
  const valor = await fn();
  if (valor) CACHE.set(chave, { valor, ate: Date.now() + VALIDADE_MS });
  if (CACHE.size > 5000) CACHE.delete(CACHE.keys().next().value);
  return valor;
}

/** Endereço do CEP: { cep, logradouro, bairro, cidade, uf, ibge, latitude, longitude }. */
async function consultarCep(cep) {
  return emCache(`cep:${cep}`, async () => {
    let erro;
    try {
      const b = await json(`https://brasilapi.com.br/api/cep/v2/${cep}`);
      if (b) {
        const coord = b.location?.coordinates || {};
        return {
          cep, logradouro: b.street || '', bairro: b.neighborhood || '', cidade: b.city || '', uf: b.state || '', ibge: null,
          latitude: coord.latitude ? Number(coord.latitude) : null, longitude: coord.longitude ? Number(coord.longitude) : null, fonte: 'BrasilAPI',
        };
      }
    } catch (e) { erro = e; }
    try {
      const v = await json(`https://viacep.com.br/ws/${cep}/json/`);
      if (v && !v.erro) {
        return { cep, logradouro: v.logradouro || '', bairro: v.bairro || '', cidade: v.localidade || '', uf: v.uf || '', ibge: v.ibge || null, complemento: v.complemento || '', fonte: 'ViaCEP' };
      }
      if (v?.erro) return null;
    } catch (e) { erro = e; }
    if (erro) throw new ErroNegocio('Serviço de CEP indisponível agora. Preencha o endereço manualmente.', 503);
    return null;
  });
}

/** Dados do CNPJ na Receita (via BrasilAPI). */
async function consultarCnpj(cnpj) {
  return emCache(`cnpj:${cnpj}`, async () => {
    let b;
    try { b = await json(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`); } catch {
      throw new ErroNegocio('Serviço de consulta de CNPJ indisponível agora.', 503);
    }
    if (!b) return null;
    const tel = String(b.ddd_telefone_1 || '').replace(/\D/g, '');
    return {
      cnpj, razao_social: b.razao_social || '', nome_fantasia: b.nome_fantasia || '', situacao: b.descricao_situacao_cadastral || '',
      abertura: b.data_inicio_atividade || null, atividade: b.cnae_fiscal_descricao || '', natureza: b.natureza_juridica || '',
      email: (b.email || '').toLowerCase(), telefone: tel.length >= 10 ? tel : '',
      cep: String(b.cep || '').replace(/\D/g, ''), logradouro: [b.descricao_tipo_de_logradouro, b.logradouro].filter(Boolean).join(' '),
      numero: b.numero || '', complemento: b.complemento || '', bairro: b.bairro || '', cidade: b.municipio || '', uf: b.uf || '',
      porte: b.porte || b.descricao_porte || '', fonte: 'Receita Federal (BrasilAPI)',
    };
  });
}

r.get('/cep/:cep', async (req, res) => {
  const cep = String(req.params.cep).replace(/\D/g, '');
  if (cep.length !== 8) throw new ErroNegocio('CEP deve ter 8 dígitos.');
  const d = await consultarCep(cep);
  if (!d) throw new ErroNegocio('CEP não encontrado.', 404);
  res.json(d);
});

r.get('/cnpj/:cnpj', async (req, res) => {
  const cnpj = String(req.params.cnpj).replace(/\D/g, '');
  if (cnpj.length !== 14 || !require('./clientes').validarCnpj(cnpj)) throw new ErroNegocio('CNPJ inválido.');
  const d = await consultarCnpj(cnpj);
  if (!d) throw new ErroNegocio('CNPJ não encontrado na Receita.', 404);
  res.json(d);
});

module.exports = r;
module.exports.consultarCep = consultarCep;
// Testes trocam a busca externa por uma resposta simulada.
module.exports._definirBusca = (fn) => { buscar = fn; CACHE.clear(); };
