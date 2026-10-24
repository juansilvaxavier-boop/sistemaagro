// Cotação de frete: Correios (API CWS), Rodonaves e Braspress.
// Entrada comum (envio): { cep_origem, cep_destino, peso_kg, volumes, valor, cnpj_remetente, doc_destinatario }.
// Saída: [{ servico, valor, prazo_dias, codigo }].
const { erroApi } = require('./index');

const dig = (v) => String(v || '').replace(/\D/g, '');
const numBR = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));
const r2 = (v) => Math.round(v * 100) / 100;
const dims = (c) => ({ altura: Number(c.altura_cm) || 12, largura: Number(c.largura_cm) || 40, comprimento: Number(c.comprimento_cm) || 60 });

/** Frete de exemplo, estável para o mesmo envio: cresce com o peso e com a "distância" entre os CEPs. */
function simulado(envio, fator, prazoBase, servico) {
  const dist = Math.abs(Number(dig(envio.cep_origem).slice(0, 3)) - Number(dig(envio.cep_destino).slice(0, 3))) / 100;
  const valor = r2((18 + envio.peso_kg * 0.42 + envio.valor * 0.004) * fator * (1 + dist * 0.35));
  return { servico, valor, prazo_dias: prazoBase + Math.round(dist * 2), codigo: `SIM-${dig(envio.cep_destino).slice(0, 5)}-${Math.round(valor)}` };
}

function exigirEnvio(envio) {
  if (dig(envio.cep_origem).length !== 8) throw new Error('CEP de origem da empresa não cadastrado (Cadastros → Empresas).');
  if (dig(envio.cep_destino).length !== 8) throw new Error('CEP de entrega do cliente inválido ou não cadastrado.');
  if (!(envio.peso_kg > 0)) throw new Error('Peso do pedido desconhecido: informe o peso por embalagem no estoque.');
}

// ---------- Correios ----------
const CORREIOS = { homologacao: 'https://apihom.correios.com.br', producao: 'https://api.correios.com.br' };
const NOMES_CORREIOS = { '03220': 'SEDEX', '03298': 'PAC', '04162': 'SEDEX', '04669': 'PAC', '04014': 'SEDEX', '04510': 'PAC', '03158': 'SEDEX 10' };
const tokensCorreios = new Map();

async function tokenCorreios(ctx) {
  const chave = `${ctx.empresa.id}:${ctx.config.usuario}:${ctx.config.cartao_postagem}:${ctx.modo}`;
  const t = tokensCorreios.get(chave);
  if (t && t.expira > Date.now() + 60e3) return t.token;
  const r = await ctx.http({
    method: 'POST', url: `${ctx.base(CORREIOS)}/token/v1/autentica/cartaopostagem`,
    basic: [ctx.config.usuario, ctx.segredos.codigo_acesso], json: { numero: dig(ctx.config.cartao_postagem) },
  });
  ctx.ultimoStatus = r.status;
  if (r.status >= 300 || !r.json?.token) throw erroApi(r, 'Correios (autenticação)');
  tokensCorreios.set(chave, { token: r.json.token, expira: r.json.expiraEm ? Date.parse(r.json.expiraEm) : Date.now() + 3600e3 });
  return r.json.token;
}

const correios = {
  async testar(ctx) {
    if (ctx.simulacao) return { mensagem: 'Simulação ativa: as cotações usam valores de exemplo.' };
    await tokenCorreios(ctx);
    return { mensagem: 'Autenticado nos Correios com o cartão de postagem.' };
  },
  async cotar(ctx, envio) {
    exigirEnvio(envio);
    const servicos = ctx.config.servicos?.length ? ctx.config.servicos : ['03220', '03298'];
    const volumes = Math.max(1, envio.volumes || 1);
    const pesoVol = envio.peso_kg / volumes;
    if (pesoVol > 30) throw new Error(`Cada volume teria ${r2(pesoVol)} kg; os Correios aceitam até 30 kg por objeto. Use transportadora.`);
    if (ctx.simulacao) return servicos.map((s, i) => simulado(envio, i % 2 ? 0.8 : 1.35, i % 2 ? 7 : 2, `${NOMES_CORREIOS[s] || s} (${s})`));
    const token = await tokenCorreios(ctx);
    const d = dims(ctx.config);
    const out = [];
    for (const s of servicos) {
      const q = new URLSearchParams({
        cepOrigem: dig(envio.cep_origem), cepDestino: dig(envio.cep_destino), psObjeto: String(Math.ceil(pesoVol * 1000)), tpObjeto: '2',
        comprimento: String(d.comprimento), largura: String(d.largura), altura: String(d.altura),
        ...(envio.valor ? { vlDeclarado: String(r2(envio.valor / volumes)), servicosAdicionais: '019' } : {}),
      });
      const preco = await ctx.http({ url: `${ctx.base(CORREIOS)}/preco/v1/nacional/${s}?${q}`, bearer: token });
      ctx.ultimoStatus = preco.status;
      if (preco.status >= 300) throw erroApi(preco, `Correios (preço ${s})`);
      const prazo = await ctx.http({ url: `${ctx.base(CORREIOS)}/prazo/v1/nacional/${s}?${new URLSearchParams({ cepOrigem: dig(envio.cep_origem), cepDestino: dig(envio.cep_destino) })}`, bearer: token });
      const valor = r2(numBR(preco.json?.pcFinal ?? preco.json?.pcBase ?? 0) * volumes);
      out.push({ servico: `${NOMES_CORREIOS[s] || s} (${s})`, valor, prazo_dias: Number(prazo.json?.prazoEntrega) || null, codigo: `${s}-${dig(envio.cep_destino)}` });
    }
    return out;
  },
};

// ---------- Rodonaves ----------
const RODONAVES = { homologacao: 'https://01wapi.rte.com.br', producao: 'https://01wapi.rte.com.br' };
async function tokenRodonaves(ctx) {
  const r = await ctx.http({
    method: 'POST', url: `${ctx.base(RODONAVES)}/token`,
    form: { grant_type: 'password', username: ctx.config.usuario, password: ctx.segredos.senha },
  });
  ctx.ultimoStatus = r.status;
  if (r.status >= 300 || !r.json?.access_token) throw erroApi(r, 'Rodonaves (autenticação)');
  return r.json.access_token;
}
async function cidadeRodonaves(ctx, token, cep) {
  const r = await ctx.http({ url: `${ctx.base(RODONAVES)}/api/v1/busca-por-cep?zipCode=${dig(cep)}`, bearer: token });
  ctx.ultimoStatus = r.status;
  if (r.status >= 300) throw erroApi(r, `Rodonaves (cidade do CEP ${cep})`);
  return r.json?.CityId ?? r.json?.cityId ?? r.json?.Id;
}

const rodonaves = {
  async testar(ctx) {
    if (ctx.simulacao) return { mensagem: 'Simulação ativa: as cotações usam valores de exemplo.' };
    await tokenRodonaves(ctx);
    return { mensagem: 'Autenticado na Rodonaves.' };
  },
  async cotar(ctx, envio) {
    exigirEnvio(envio);
    if (ctx.simulacao) return [simulado(envio, 0.62, 4, 'Rodoviário')];
    const token = await tokenRodonaves(ctx);
    const [origem, destino] = [await cidadeRodonaves(ctx, token, envio.cep_origem), await cidadeRodonaves(ctx, token, envio.cep_destino)];
    const d = dims(ctx.config);
    const volumes = Math.max(1, envio.volumes || 1);
    const r = await ctx.http({
      method: 'POST', url: `${ctx.base(RODONAVES)}/api/v1/simula-cotacao`, bearer: token,
      json: {
        OriginZipCode: dig(envio.cep_origem), OriginCityId: origem, DestinationZipCode: dig(envio.cep_destino), DestinationCityId: destino,
        TotalWeight: r2(envio.peso_kg), EletronicInvoiceValue: r2(envio.valor), CustomerTaxIdRegistration: dig(ctx.config.cnpj_pagador || envio.cnpj_remetente),
        ReceiverCpfcnp: dig(envio.doc_destinatario),
        Packs: [{ AmountPackages: volumes, Weight: r2(envio.peso_kg / volumes), Length: d.comprimento, Height: d.altura, Width: d.largura }],
      },
    });
    ctx.ultimoStatus = r.status;
    if (r.status >= 300) throw erroApi(r, 'Rodonaves (cotação)');
    return [{ servico: 'Rodoviário', valor: r2(numBR(r.json?.Value ?? r.json?.value ?? 0)), prazo_dias: Number(r.json?.DeliveryTime ?? r.json?.deliveryTime) || null, codigo: String(r.json?.ProtocolNumber ?? r.json?.protocolNumber ?? '') }];
  },
};

// ---------- Braspress ----------
const BRASPRESS = { homologacao: 'https://hml-api.braspress.com', producao: 'https://api.braspress.com' };
const braspress = {
  async testar(ctx) {
    if (ctx.simulacao) return { mensagem: 'Simulação ativa: as cotações usam valores de exemplo.' };
    // A Braspress não tem rota de teste: faz uma cotação mínima entre a empresa e ela mesma.
    const cep = dig(ctx.empresa?.cep);
    if (cep.length !== 8) throw new Error('Cadastre o CEP da empresa para testar.');
    const [c] = await braspress.cotar(ctx, { cep_origem: cep, cep_destino: cep, peso_kg: 10, volumes: 1, valor: 100, cnpj_remetente: ctx.empresa.cnpj, doc_destinatario: ctx.empresa.cnpj });
    return { mensagem: `Cotação de teste respondida: R$ ${c.valor.toFixed(2)}.` };
  },
  async cotar(ctx, envio) {
    exigirEnvio(envio);
    const modal = ctx.config.modal === 'A' ? 'Aéreo' : 'Rodoviário';
    if (ctx.simulacao) return [simulado(envio, ctx.config.modal === 'A' ? 1.9 : 0.7, ctx.config.modal === 'A' ? 2 : 5, modal)];
    const d = dims(ctx.config);
    const volumes = Math.max(1, envio.volumes || 1);
    const r = await ctx.http({
      method: 'POST', url: `${ctx.base(BRASPRESS)}/v1/cotacao/calcular/json`, basic: [ctx.config.usuario, ctx.segredos.senha],
      json: {
        cnpjRemetente: Number(dig(ctx.config.cnpj_remetente || envio.cnpj_remetente)), cnpjDestinatario: Number(dig(envio.doc_destinatario)),
        modal: ctx.config.modal || 'R', tipoFrete: String(ctx.config.tipo_frete || '1'), cepOrigem: Number(dig(envio.cep_origem)), cepDestino: Number(dig(envio.cep_destino)),
        vlrMercadoria: r2(envio.valor), peso: r2(envio.peso_kg), volumes,
        cubagem: [{ altura: d.altura / 100, largura: d.largura / 100, comprimento: d.comprimento / 100, volumes }],
      },
    });
    ctx.ultimoStatus = r.status;
    if (r.status >= 300) throw erroApi(r, 'Braspress (cotação)');
    return [{ servico: modal, valor: r2(numBR(r.json?.totalFrete ?? 0)), prazo_dias: Number(r.json?.prazo) || null, codigo: String(r.json?.id ?? '') }];
  },
};

module.exports = { correios, rodonaves, braspress, _numBR: numBR };
