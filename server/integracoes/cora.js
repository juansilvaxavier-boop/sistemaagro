// Banco Cora (Integração Direta): mTLS com o certificado da conta + token OAuth2 client_credentials.
// Boleto registrado com PIX (v2/invoices): emitir, consultar (para a baixa automática) e cancelar.
const crypto = require('node:crypto');
const { erroApi } = require('./index');

const URLS = { homologacao: 'https://matls-clients.api.stage.cora.com.br', producao: 'https://matls-clients.api.cora.com.br' };
const dig = (v) => String(v || '').replace(/\D/g, '');
const tokens = new Map();

const tls = (ctx) => ({ cert: ctx.segredos.certificado, key: ctx.segredos.chave_privada });

async function token(ctx) {
  const chave = `${ctx.empresa.id}:${ctx.config.client_id}:${ctx.modo}`;
  const t = tokens.get(chave);
  if (t && t.expira > Date.now() + 60e3) return t.token;
  const r = await ctx.http({ method: 'POST', url: `${ctx.base(URLS)}/token`, form: { grant_type: 'client_credentials', client_id: ctx.config.client_id }, ...tls(ctx) });
  ctx.ultimoStatus = r.status;
  if (r.status >= 300 || !r.json?.access_token) throw erroApi(r, 'Cora (autenticação)');
  tokens.set(chave, { token: r.json.access_token, expira: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 });
  return r.json.access_token;
}

/** Linha digitável e PIX de exemplo para o modo simulação (formato parecido com o real, sem valor bancário). */
function simulado(dados) {
  const base = crypto.createHash('sha1').update(String(dados.codigo)).digest('hex').replace(/\D/g, '').padEnd(30, '7');
  const linha = `40390.00007 ${base.slice(0, 5)}.${base.slice(5, 11)} ${base.slice(11, 16)}.${base.slice(16, 22)} 1 ${String(Math.round(dados.valor * 100)).padStart(10, '0')}`;
  return {
    id: `inv_sim_${base.slice(0, 16)}`, status: 'OPEN', linha, codigo_barras: dig(linha).padEnd(44, '0').slice(0, 44),
    url: null, pix: dados.pix ? `00020101021226SIMULACAO-AGROTERRA-${dados.codigo}5204000053039865406${dados.valor.toFixed(2)}5802BR6304ABCD` : null,
  };
}

function lerResposta(j) {
  const bs = j?.payment_options?.bank_slip || {};
  return {
    id: j?.id, status: j?.status, linha: bs.digitable || null, codigo_barras: bs.barcode || null, url: bs.url || null,
    pix: j?.pix?.emv || j?.payment_options?.pix?.emv || null, pago_em: j?.paid_at || j?.payments?.[0]?.finalized_at || null,
    valor_pago: j?.total_paid != null ? Number(j.total_paid) / 100 : null,
  };
}

module.exports = {
  URLS,
  async testar(ctx) {
    if (ctx.simulacao) return { mensagem: 'Simulação ativa: os boletos são de exemplo e não têm valor bancário.' };
    await token(ctx);
    return { mensagem: 'Autenticado na Cora com o certificado da conta.' };
  },

  /**
   * dados: { codigo, valor, vencimento, descricao, cliente: { nome, documento, email, endereco: {...} } }
   * Devolve { id, status, linha, codigo_barras, url, pix }.
   */
  async emitir(ctx, dados) {
    const c = dados.cliente;
    if (![11, 14].includes(dig(c.documento).length)) throw new Error('CPF/CNPJ do cliente inválido para o boleto.');
    if (!(dados.valor >= 5)) throw new Error('A Cora só registra boletos a partir de R$ 5,00.');
    if (ctx.simulacao) return simulado({ ...dados, pix: ctx.config.pix !== false });
    const e = c.endereco || {};
    const corpo = {
      code: String(dados.codigo),
      customer: {
        name: String(c.nome).slice(0, 60), email: c.email || undefined,
        document: { identity: dig(c.documento), type: dig(c.documento).length === 14 ? 'CNPJ' : 'CPF' },
        address: e.cep ? {
          street: e.logradouro || '', number: e.numero || 'S/N', district: e.bairro || '', city: e.cidade || '', state: e.uf || '',
          complement: e.complemento || '', zip_code: dig(e.cep),
        } : undefined,
      },
      services: [{ name: String(dados.descricao).slice(0, 100), description: String(dados.descricao).slice(0, 100), amount: Math.round(dados.valor * 100) }],
      payment_terms: {
        due_date: dados.vencimento,
        fine: Number(ctx.config.multa_pct) ? { rate: Number(ctx.config.multa_pct) } : undefined,
        interest: Number(ctx.config.juros_mes_pct) ? { rate: Number(ctx.config.juros_mes_pct) } : undefined,
      },
      payment_forms: ctx.config.pix === false ? ['BANK_SLIP'] : ['BANK_SLIP', 'PIX'],
    };
    const r = await ctx.http({
      method: 'POST', url: `${ctx.base(URLS)}/v2/invoices/`, bearer: await token(ctx), json: corpo,
      headers: { 'Idempotency-Key': crypto.createHash('sha256').update(`agroterra:${ctx.empresa.id}:${dados.codigo}:${dados.vencimento}:${dados.valor}`).digest('hex').slice(0, 36) },
      ...tls(ctx),
    });
    ctx.ultimoStatus = r.status;
    if (r.status >= 300) throw erroApi(r, 'Cora (emitir boleto)');
    return lerResposta(r.json);
  },

  /** Situação atual: OPEN, LATE, PAID, CANCELLED... (simulação: pagoSimulado decide). */
  async consultar(ctx, id, { pagoSimulado, valor } = {}) {
    if (ctx.simulacao) return { id, status: pagoSimulado ? 'PAID' : 'OPEN', pago_em: pagoSimulado ? new Date().toISOString() : null, valor_pago: pagoSimulado ? valor : null };
    const r = await ctx.http({ url: `${ctx.base(URLS)}/v2/invoices/${encodeURIComponent(id)}`, bearer: await token(ctx), ...tls(ctx) });
    ctx.ultimoStatus = r.status;
    if (r.status >= 300) throw erroApi(r, 'Cora (consultar boleto)');
    return lerResposta(r.json);
  },

  async cancelar(ctx, id) {
    if (ctx.simulacao) return { id, status: 'CANCELLED' };
    const r = await ctx.http({ method: 'DELETE', url: `${ctx.base(URLS)}/v2/invoices/${encodeURIComponent(id)}`, bearer: await token(ctx), ...tls(ctx) });
    ctx.ultimoStatus = r.status;
    if (r.status >= 300 && r.status !== 404) throw erroApi(r, 'Cora (cancelar boleto)');
    return { id, status: 'CANCELLED' };
  },
};
