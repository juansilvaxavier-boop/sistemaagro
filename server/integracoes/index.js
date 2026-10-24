// Integrações externas: catálogo, configuração por empresa (credenciais no cofre), registro das chamadas
// e o "contexto" entregue a cada adaptador (modo, configuração, segredos e cliente HTTP).
//
// Modos: desligada (o sistema segue como antes), simulacao (respostas de exemplo, sem chamar ninguém),
// homologacao (ambiente de testes do provedor) e producao.
const db = require('../db');
const { ErroNegocio } = require('../services');
const cofre = require('./cofre');
const http = require('./http');

const MODOS = { desligada: 'Desligada', simulacao: 'Simulação (sem chamar a API)', homologacao: 'Homologação (testes do provedor)', producao: 'Produção' };

const DIMENSOES = [
  { k: 'altura_cm', l: 'Altura do volume (cm)', tipo: 'numero', padrao: 12 },
  { k: 'largura_cm', l: 'Largura do volume (cm)', tipo: 'numero', padrao: 40 },
  { k: 'comprimento_cm', l: 'Comprimento do volume (cm)', tipo: 'numero', padrao: 60 },
];
const TRANSPORTADORA = { k: 'transportadora_id', l: 'Transportadora no cadastro', tipo: 'transportadora', ajuda: 'A cotação escolhida preenche esta transportadora no pedido.' };

/** Campos de cada provedor. segredo: true → vai criptografado e nunca volta para a tela. */
const CATALOGO = {
  correios: {
    nome: 'Correios', categoria: 'frete', icone: 'bi-envelope-paper',
    descricao: 'Cotação de preço e prazo (SEDEX, PAC) pela API dos Correios (CWS), com o contrato da empresa.',
    docs: 'https://cws.correios.com.br',
    campos: [
      { k: 'usuario', l: 'Usuário do Meu Correios', tipo: 'texto', obrigatorio: true },
      { k: 'codigo_acesso', l: 'Código de acesso à API', tipo: 'senha', segredo: true, obrigatorio: true, ajuda: 'Gerado no portal CWS (cws.correios.com.br) → Gestão de acesso a API.' },
      { k: 'cartao_postagem', l: 'Cartão de postagem', tipo: 'texto', obrigatorio: true },
      { k: 'servicos', l: 'Serviços para cotar', tipo: 'multi', obrigatorio: true, padrao: ['03220', '03298'], opcoes: [
        ['03220', 'SEDEX contrato (03220)'], ['03298', 'PAC contrato (03298)'], ['04162', 'SEDEX contrato (04162)'], ['04669', 'PAC contrato (04669)'],
        ['04014', 'SEDEX à vista (04014)'], ['04510', 'PAC à vista (04510)'], ['03158', 'SEDEX 10 contrato (03158)'],
      ] },
      ...DIMENSOES, TRANSPORTADORA,
    ],
  },
  rodonaves: {
    nome: 'Rodonaves', categoria: 'frete', icone: 'bi-truck',
    descricao: 'Simulação de cotação de frete rodoviário na API da Rodonaves (RTE).',
    docs: 'https://www.rodonaves.com.br',
    campos: [
      { k: 'usuario', l: 'Usuário da API', tipo: 'texto', obrigatorio: true },
      { k: 'senha', l: 'Senha da API', tipo: 'senha', segredo: true, obrigatorio: true },
      { k: 'cnpj_pagador', l: 'CNPJ do pagador do frete', tipo: 'cnpj', ajuda: 'Em branco, usa o CNPJ da empresa.' },
      { k: 'base_url', l: 'Endereço da API', tipo: 'url', padrao: 'https://01wapi.rte.com.br', avancado: true, ajuda: 'Confirme com a Rodonaves o endereço do seu contrato.' },
      ...DIMENSOES, TRANSPORTADORA,
    ],
  },
  braspress: {
    nome: 'Braspress', categoria: 'frete', icone: 'bi-truck-front',
    descricao: 'Cotação de frete na API da Braspress (rodoviário ou aéreo).',
    docs: 'https://api.braspress.com/home',
    campos: [
      { k: 'usuario', l: 'Usuário da API', tipo: 'texto', obrigatorio: true },
      { k: 'senha', l: 'Senha da API', tipo: 'senha', segredo: true, obrigatorio: true },
      { k: 'cnpj_remetente', l: 'CNPJ do remetente', tipo: 'cnpj', ajuda: 'Em branco, usa o CNPJ da empresa.' },
      { k: 'modal', l: 'Modal', tipo: 'select', padrao: 'R', opcoes: [['R', 'Rodoviário'], ['A', 'Aéreo']] },
      { k: 'tipo_frete', l: 'Tipo de frete', tipo: 'select', padrao: '1', opcoes: [['1', 'CIF (remetente paga)'], ['2', 'FOB (destinatário paga)']] },
      { k: 'base_url', l: 'Endereço da API', tipo: 'url', avancado: true, ajuda: 'Em branco: hml-api.braspress.com (homologação) ou api.braspress.com (produção).' },
      ...DIMENSOES, TRANSPORTADORA,
    ],
  },
  cora: {
    nome: 'Banco Cora', categoria: 'boleto', icone: 'bi-bank',
    descricao: 'Emissão de boleto registrado com PIX nas parcelas, consulta de pagamento com baixa automática e cancelamento (Integração Direta, plano Cora Pro).',
    docs: 'https://developers.cora.com.br',
    campos: [
      { k: 'client_id', l: 'Client ID', tipo: 'texto', obrigatorio: true, ajuda: 'App Cora → Conta → Integrações via APIs → Integração Direta.' },
      { k: 'certificado', l: 'Certificado (.pem)', tipo: 'arquivo', segredo: true, obrigatorio: true, aceita: '.pem,.crt,.cer' },
      { k: 'chave_privada', l: 'Chave privada (.key)', tipo: 'arquivo', segredo: true, obrigatorio: true, aceita: '.key,.pem' },
      { k: 'multa_pct', l: 'Multa por atraso (%)', tipo: 'numero', padrao: 2 },
      { k: 'juros_mes_pct', l: 'Juros ao mês (%)', tipo: 'numero', padrao: 1 },
      { k: 'pix', l: 'Incluir PIX no boleto', tipo: 'bool', padrao: true },
      { k: 'emitir_ao_faturar', l: 'Emitir os boletos sozinho ao faturar o pedido', tipo: 'bool', padrao: false, ajuda: 'Só para parcelas com baixa por boleto.' },
      { k: 'base_url', l: 'Endereço da API', tipo: 'url', avancado: true, ajuda: 'Em branco: matls-clients.api.stage.cora.com.br (homologação) ou matls-clients.api.cora.com.br (produção).' },
    ],
  },
  invoicy: {
    nome: 'Migrate Invoicy (emissão de NF-e)', categoria: 'nfe', icone: 'bi-receipt-cutoff',
    descricao: 'Transmite a NF-e do faturamento pela Invoicy e guarda chave, protocolo e DANFE. O cancelamento da nota também é enviado.',
    docs: 'https://migrate.info/invoicy/',
    campos: [
      { k: 'chave_acesso', l: 'Chave de acesso (token da empresa)', tipo: 'senha', segredo: true, obrigatorio: true },
      { k: 'chave_parceiro', l: 'Chave do parceiro', tipo: 'senha', segredo: true },
      { k: 'serie', l: 'Série da NF-e', tipo: 'numero', padrao: 1 },
      { k: 'natureza', l: 'Natureza da operação', tipo: 'select', padrao: 'Venda de produção do estabelecimento', opcoes: [
        ['Venda de produção do estabelecimento', 'Venda de produção do estabelecimento'], ['Venda de mercadoria adquirida de terceiros', 'Venda de mercadoria de terceiros'],
      ] },
      { k: 'cfop_dentro', l: 'CFOP padrão dentro do estado', tipo: 'select', padrao: '5101', opcoes: [['5101', '5101 - Venda de produção'], ['5102', '5102 - Venda de mercadoria de terceiros']] },
      { k: 'cfop_fora', l: 'CFOP padrão para outro estado', tipo: 'select', padrao: '6101', opcoes: [['6101', '6101 - Venda de produção'], ['6102', '6102 - Venda de mercadoria de terceiros']] },
      { k: 'crt', l: 'Regime tributário', tipo: 'select', padrao: '3', opcoes: [['1', 'Simples Nacional'], ['2', 'Simples Nacional - excesso de sublimite'], ['3', 'Regime normal']] },
      { k: 'info_complementar', l: 'Informações complementares', tipo: 'texto', ajuda: 'Ex.: isenção de ICMS de insumos agropecuários (Convênio ICMS 100/97).' },
      { k: 'base_url', l: 'Endereço da API', tipo: 'url', avancado: true, obrigatorio: true, ajuda: 'Informado pela Migrate ao liberar o acesso (homologação e produção têm endereços diferentes).' },
      { k: 'caminho_emissao', l: 'Caminho da emissão', tipo: 'texto', avancado: true, padrao: '/api/nfe/emissao' },
      { k: 'caminho_cancelamento', l: 'Caminho do cancelamento', tipo: 'texto', avancado: true, padrao: '/api/nfe/cancelamento' },
      { k: 'cabecalho_auth', l: 'Cabeçalho da chave de acesso', tipo: 'texto', avancado: true, padrao: 'Authorization' },
    ],
  },
  nfe_entrada: {
    nome: 'NF-e recebidas (contra o CNPJ)', categoria: 'nfe_entrada', icone: 'bi-inboxes',
    descricao: 'Busca todas as NF-e emitidas por fornecedores para o CNPJ da empresa: fornecedor, itens, duplicatas e XML. Daí vincula ao pedido de compra e lança o contas a pagar.',
    docs: 'https://docs.arquivei.com.br',
    campos: [
      { k: 'fonte', l: 'Serviço de captura', tipo: 'select', padrao: 'qive', opcoes: [['qive', 'Qive (antiga Arquivei)'], ['invoicy', 'Migrate Invoicy']] },
      { k: 'api_id', l: 'API ID', tipo: 'texto', obrigatorio: true },
      { k: 'api_key', l: 'API Key', tipo: 'senha', segredo: true, obrigatorio: true },
      { k: 'base_url', l: 'Endereço da API', tipo: 'url', avancado: true, ajuda: 'Em branco (Qive): sandbox-api.arquivei.com.br (homologação) ou api.arquivei.com.br (produção). Para a Invoicy, informe o endereço da Migrate.' },
      { k: 'caminho', l: 'Caminho da consulta', tipo: 'texto', avancado: true, ajuda: 'Em branco (Qive): /v1/nfe/received.' },
    ],
  },
};

const ADAPTADORES = {
  correios: () => require('./frete').correios,
  rodonaves: () => require('./frete').rodonaves,
  braspress: () => require('./frete').braspress,
  cora: () => require('./cora'),
  invoicy: () => require('./invoicy'),
  nfe_entrada: () => require('./nfe-entrada'),
};

const parse = (t) => { try { return t ? JSON.parse(t) : {}; } catch { return {}; } };

async function linha(provedor, empresaId) {
  return db.get('SELECT * FROM integracoes WHERE provedor = ? AND empresa_id = ?', provedor, empresaId);
}

/** Configuração completa (com segredos) para uso interno. */
async function carregar(provedor, empresaId) {
  const def = CATALOGO[provedor];
  if (!def) throw new ErroNegocio('Integração desconhecida.', 404);
  const l = await linha(provedor, empresaId);
  const padrao = Object.fromEntries(def.campos.filter((c) => c.padrao !== undefined && !c.segredo).map((c) => [c.k, c.padrao]));
  return {
    provedor, empresaId, def, modo: l?.modo || 'desligada', config: { ...padrao, ...parse(l?.config) }, segredos: cofre.decifrar(l?.segredos),
    estado: parse(l?.estado), linha: l,
  };
}

/** Visão para a tela: segredos só como "definido / não definido". */
async function publico(provedor, empresaId) {
  const c = await carregar(provedor, empresaId);
  const segredos = Object.fromEntries(c.def.campos.filter((x) => x.segredo).map((x) => [x.k, !!c.segredos[x.k]]));
  return {
    provedor, ...c.def, modo: c.modo, config: c.config, segredos, ilegivel: !!c.segredos._ilegivel,
    ultimo_teste_em: c.linha?.ultimo_teste_em || null, ultimo_teste_ok: c.linha?.ultimo_teste_ok ?? null, ultimo_teste_msg: c.linha?.ultimo_teste_msg || null,
    updated_at: c.linha?.updated_at || null, estado: { ultima_captura: c.estado.ultima_captura || null },
  };
}

/** Salva modo, configuração e segredos (segredo vazio mantém o atual; "limpar" apaga). */
async function salvar(provedor, empresaId, body, usuarioId) {
  const atual = await carregar(provedor, empresaId);
  const { def } = atual;
  const modo = body.modo || atual.modo;
  if (!MODOS[modo]) throw new ErroNegocio('Modo inválido.');
  const config = { ...atual.config };
  const segredos = atual.segredos._ilegivel ? {} : { ...atual.segredos };
  for (const c of def.campos) {
    const v = body.config?.[c.k];
    if (c.segredo) {
      const s = body.segredos?.[c.k];
      if (s === null) delete segredos[c.k];
      else if (typeof s === 'string' && s.trim()) {
        if (c.tipo === 'arquivo' && !/-----BEGIN [A-Z ]+-----/.test(s)) throw new ErroNegocio(`${c.l}: envie o arquivo em formato PEM (texto começando com -----BEGIN).`);
        segredos[c.k] = s.trim();
      }
      continue;
    }
    if (v === undefined) continue;
    if (c.tipo === 'numero') {
      const n = v === '' || v === null ? null : Number(String(v).replace(',', '.'));
      if (n !== null && !Number.isFinite(n)) throw new ErroNegocio(`${c.l}: número inválido.`);
      config[c.k] = n;
    } else if (c.tipo === 'bool') config[c.k] = !!v && v !== '0';
    else if (c.tipo === 'multi') config[c.k] = (Array.isArray(v) ? v : []).filter((x) => c.opcoes.some(([o]) => o === x));
    else if (c.tipo === 'select') {
      if (v && !c.opcoes.some(([o]) => o === String(v))) throw new ErroNegocio(`${c.l}: opção inválida.`);
      config[c.k] = v || c.padrao || null;
    } else if (c.tipo === 'url') {
      const u = String(v || '').trim().replace(/\/+$/, '');
      if (u && !/^https:\/\/[^\s/]+/.test(u)) throw new ErroNegocio(`${c.l}: use um endereço https://.`);
      config[c.k] = u || null;
    } else if (c.tipo === 'cnpj') {
      const d = String(v || '').replace(/\D/g, '');
      if (d && d.length !== 14) throw new ErroNegocio(`${c.l}: CNPJ deve ter 14 dígitos.`);
      config[c.k] = d || null;
    } else if (c.tipo === 'transportadora') config[c.k] = Number(v) || null;
    else config[c.k] = v === '' || v == null ? null : String(v).trim().slice(0, 500);
  }
  if (['homologacao', 'producao'].includes(modo)) {
    const faltam = def.campos.filter((c) => c.obrigatorio && (c.segredo ? !segredos[c.k] : (Array.isArray(config[c.k]) ? !config[c.k].length : config[c.k] == null || config[c.k] === '')));
    if (faltam.length) throw new ErroNegocio(`Para usar em ${MODOS[modo].toLowerCase()}, preencha: ${faltam.map((c) => c.l).join(', ')}.`);
  }
  await db.run(
    `INSERT INTO integracoes (provedor, empresa_id, modo, config, segredos, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), ?)
       ON CONFLICT (provedor, empresa_id) DO UPDATE SET modo = EXCLUDED.modo, config = EXCLUDED.config, segredos = EXCLUDED.segredos,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    provedor, empresaId, modo, JSON.stringify(config), cofre.cifrar(segredos), usuarioId || null,
  );
  // A auditoria registra o que mudou, nunca os segredos.
  await require('../auditoria').registrar('configurar_integracao', 'integracoes', null, { provedor, modo: atual.modo }, {
    provedor, empresa_id: empresaId, modo, segredos_alterados: Object.keys(body.segredos || {}).filter((k) => body.segredos[k] !== undefined && body.segredos[k] !== ''),
  });
  return publico(provedor, empresaId);
}

async function salvarEstado(provedor, empresaId, estado) {
  await db.run('UPDATE integracoes SET estado = ? WHERE provedor = ? AND empresa_id = ?', JSON.stringify(estado), provedor, empresaId);
}

async function registrarLog(x) {
  await db.run(
    `INSERT INTO integracao_log (provedor, empresa_id, operacao, modo, ok, status_http, duracao_ms, referencia, mensagem, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    x.provedor, x.empresaId || null, x.operacao, x.modo || null, x.ok ? 1 : 0, x.status || null, x.duracao || null, x.referencia || null,
    String(x.mensagem || '').slice(0, 1000), x.usuarioId || null,
  );
  // Guarda só as últimas 5.000 chamadas.
  if (Math.random() < 0.02) await db.run('DELETE FROM integracao_log WHERE id < (SELECT MAX(id) - 5000 FROM integracao_log)');
}

/** URL base conforme o modo, com a substituição informada na configuração. */
const baseUrl = (ctx, urls) => (ctx.config.base_url || (ctx.modo === 'producao' ? urls.producao : urls.homologacao) || '').replace(/\/+$/, '');

/**
 * Executa uma operação do adaptador com registro no log. Erros de API viram ErroNegocio com mensagem clara.
 * fn(ctx) recebe { modo, config, segredos, estado, empresa, http, simulacao, salvarEstado }.
 */
async function executar(provedor, empresaId, operacao, fn, { referencia, usuarioId, exigirAtiva = true } = {}) {
  const c = await carregar(provedor, empresaId);
  if (exigirAtiva && c.modo === 'desligada') throw new ErroNegocio(`A integração ${c.def.nome} está desligada. Ligue em Administração → Integrações.`);
  if (c.segredos._ilegivel) throw new ErroNegocio(`As credenciais de ${c.def.nome} não puderam ser lidas (a chave do cofre mudou). Informe-as de novo.`);
  const empresa = await db.get('SELECT * FROM empresas WHERE id = ?', empresaId);
  const ctx = {
    provedor, modo: c.modo, config: c.config, segredos: c.segredos, estado: c.estado, empresa, simulacao: c.modo === 'simulacao',
    http: http.requisicao, base: (urls) => baseUrl(c, urls), salvarEstado: (e) => salvarEstado(provedor, empresaId, e),
    ultimoStatus: null,
  };
  const ini = Date.now();
  try {
    const r = await fn(ctx);
    await registrarLog({ provedor, empresaId, operacao, modo: c.modo, ok: true, status: ctx.ultimoStatus, duracao: Date.now() - ini, referencia, mensagem: r?._resumo || 'OK', usuarioId });
    return r;
  } catch (e) {
    await registrarLog({ provedor, empresaId, operacao, modo: c.modo, ok: false, status: e.statusHttp || ctx.ultimoStatus, duracao: Date.now() - ini, referencia, mensagem: e.message, usuarioId }).catch(() => {});
    if (e instanceof ErroNegocio) throw e;
    throw new ErroNegocio(`${c.def.nome}: ${e.message}`, 502);
  }
}

/** Erro de API com o status HTTP e a mensagem que o provedor devolveu. */
function erroApi(r, contexto) {
  const msg = r.json?.message || r.json?.mensagem || r.json?.error_description || r.json?.error?.message || r.json?.msgs?.[0] || r.json?.erro
    || (Array.isArray(r.json?.errors) ? r.json.errors.map((x) => x.message || x.msg || x).join('; ') : '') || r.texto?.slice(0, 200) || 'sem detalhes';
  const e = new ErroNegocio(`${contexto}: HTTP ${r.status} - ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, 502);
  e.statusHttp = r.status;
  return e;
}

async function testar(provedor, empresaId, usuarioId) {
  let ok = false;
  let mensagem;
  try {
    const r = await executar(provedor, empresaId, 'testar', (ctx) => ADAPTADORES[provedor]().testar(ctx), { usuarioId });
    ok = true;
    mensagem = r?.mensagem || 'Conexão OK.';
  } catch (e) { mensagem = e.message; }
  await db.run(`UPDATE integracoes SET ultimo_teste_em = datetime('now','localtime'), ultimo_teste_ok = ?, ultimo_teste_msg = ? WHERE provedor = ? AND empresa_id = ?`,
    ok ? 1 : 0, mensagem, provedor, empresaId);
  return { ok, mensagem };
}

async function ativas(categoria, empresaId) {
  const ids = Object.entries(CATALOGO).filter(([, d]) => d.categoria === categoria).map(([k]) => k);
  const rows = await db.all(`SELECT provedor FROM integracoes WHERE empresa_id = ? AND modo <> 'desligada'`, empresaId);
  return rows.map((x) => x.provedor).filter((p) => ids.includes(p));
}

async function modo(provedor, empresaId) {
  return (await linha(provedor, empresaId))?.modo || 'desligada';
}

module.exports = { MODOS, CATALOGO, ADAPTADORES, carregar, publico, salvar, executar, testar, ativas, modo, erroApi, registrarLog };
