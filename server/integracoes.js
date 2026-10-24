// Cadastro das integrações com APIs externas: cada uma guarda suas credenciais (texto) e pode ser
// ativada/testada depois que a conta no provedor estiver contratada. Nenhuma chamada real é feita
// ainda — os módulos em server/integracoes-apis.js são o ponto de entrada para implementá-las.
const db = require('./db');
const { ErroNegocio } = new Proxy({}, { get: (_, k) => require('./services')[k] });

const CATALOGO = [
  {
    chave: 'nfe_consulta', grupo: 'Notas fiscais', nome: 'Consulta de NF-e emitidas contra o CNPJ',
    descricao: 'Busca automaticamente as notas fiscais emitidas por fornecedores tendo a empresa como destinatária.',
    campos: [
      { nome: 'provedor', rotulo: 'Provedor', tipo: 'texto', placeholder: 'Ex.: PlugNotas, Focus NFe, NFe.io' },
      { nome: 'cnpj', rotulo: 'CNPJ consultado', tipo: 'texto' },
      { nome: 'api_key', rotulo: 'Token / API Key', tipo: 'senha' },
    ],
  },
  {
    chave: 'frete_correios', grupo: 'Cotação de frete', nome: 'Correios',
    descricao: 'Cotação automática de prazo e valor de frete pelos Correios.',
    campos: [
      { nome: 'usuario', rotulo: 'Usuário (contrato)', tipo: 'texto' },
      { nome: 'senha', rotulo: 'Senha / token', tipo: 'senha' },
      { nome: 'numero_contrato', rotulo: 'Número do contrato', tipo: 'texto' },
      { nome: 'numero_cartao_postagem', rotulo: 'Cartão de postagem', tipo: 'texto' },
    ],
  },
  {
    chave: 'frete_rodonaves', grupo: 'Cotação de frete', nome: 'Rodonaves',
    descricao: 'Cotação automática de frete com a transportadora Rodonaves.',
    campos: [
      { nome: 'codigo_cliente', rotulo: 'Código do cliente', tipo: 'texto' },
      { nome: 'api_key', rotulo: 'Token / API Key', tipo: 'senha' },
    ],
  },
  {
    chave: 'frete_braspress', grupo: 'Cotação de frete', nome: 'Braspress',
    descricao: 'Cotação automática de frete com a transportadora Braspress.',
    campos: [
      { nome: 'usuario', rotulo: 'Usuário', tipo: 'texto' },
      { nome: 'senha', rotulo: 'Senha / token', tipo: 'senha' },
      { nome: 'cnpj_remetente', rotulo: 'CNPJ remetente', tipo: 'texto' },
    ],
  },
  {
    chave: 'boleto_cora', grupo: 'Cobrança', nome: 'Banco Cora',
    descricao: 'Emissão automática de boleto bancário pela API do Banco Cora.',
    campos: [
      { nome: 'client_id', rotulo: 'Client ID', tipo: 'texto' },
      { nome: 'certificado', rotulo: 'Certificado (.pem)', tipo: 'texto_longo', placeholder: 'Cole aqui o conteúdo do certificado gerado no Cora' },
      { nome: 'chave_privada', rotulo: 'Chave privada (.key)', tipo: 'texto_longo' },
    ],
  },
  {
    chave: 'nfe_emissao_invocy', grupo: 'Notas fiscais', nome: 'Emissão automática de NF-e (Migrate / Invocy)',
    descricao: 'Emite a nota fiscal de saída automaticamente pela API da Invocy ao faturar o pedido.',
    campos: [
      { nome: 'api_token', rotulo: 'Token da API', tipo: 'senha' },
      { nome: 'empresa_id', rotulo: 'Identificador da empresa na Invocy', tipo: 'texto' },
    ],
  },
];
const PORCHAVE = Object.fromEntries(CATALOGO.map((i) => [i.chave, i]));
const MASCARA = '••••••••';

function mascarar(def, credenciais) {
  const c = credenciais || {};
  return Object.fromEntries(def.campos.map((f) => [f.nome, f.tipo === 'senha' || f.tipo === 'texto_longo' ? (c[f.nome] ? MASCARA : '') : (c[f.nome] || '')]));
}

async function todas() {
  const salvas = Object.fromEntries((await db.all('SELECT * FROM integracoes')).map((r) => [r.chave, r]));
  return CATALOGO.map((def) => {
    const s = salvas[def.chave];
    const credenciais = s?.credenciais ? JSON.parse(s.credenciais) : {};
    return {
      chave: def.chave, grupo: def.grupo, nome: def.nome, descricao: def.descricao, campos: def.campos,
      ativo: !!s?.ativo, ambiente: s?.ambiente || 'homologacao',
      preenchida: def.campos.every((f) => credenciais[f.nome]),
      valores: mascarar(def, credenciais),
      status: s?.status || null, status_mensagem: s?.status_mensagem || null, status_testado_em: s?.status_testado_em || null,
    };
  });
}

async function salvar(chave, { ativo, ambiente, valores } = {}, usuarioId) {
  const def = PORCHAVE[chave];
  if (!def) throw new ErroNegocio('Integração desconhecida.');
  const atual = await db.get('SELECT credenciais FROM integracoes WHERE chave = ?', chave);
  const credenciais = atual?.credenciais ? JSON.parse(atual.credenciais) : {};
  for (const f of def.campos) {
    const v = valores?.[f.nome];
    if (v === undefined || v === MASCARA) continue; // campo não enviado ou deixado mascarado: mantém o valor salvo
    credenciais[f.nome] = String(v).trim() || null;
  }
  await db.run(
    `INSERT INTO integracoes (chave, ativo, ambiente, credenciais, updated_at, updated_by)
       VALUES (?, ?, ?, ?, datetime('now','localtime'), ?)
       ON CONFLICT (chave) DO UPDATE SET ativo = EXCLUDED.ativo, ambiente = EXCLUDED.ambiente, credenciais = EXCLUDED.credenciais,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    chave, ativo ? 1 : 0, ambiente || 'homologacao', JSON.stringify(credenciais), usuarioId || null,
  );
}

/** Credenciais em texto puro de uma integração ativa, para uso pelos módulos em integracoes-apis.js. */
async function credenciaisAtivas(chave) {
  const r = await db.get('SELECT * FROM integracoes WHERE chave = ? AND ativo = 1', chave);
  if (!r) return null;
  return { ambiente: r.ambiente, ...(r.credenciais ? JSON.parse(r.credenciais) : {}) };
}

async function registrarTeste(chave, ok, mensagem) {
  await db.run(
    `UPDATE integracoes SET status = ?, status_mensagem = ?, status_testado_em = datetime('now','localtime') WHERE chave = ?`,
    ok ? 'ok' : 'erro', mensagem, chave,
  );
}

/** Teste de conexão: ainda não há API real conectada, então só confere se as credenciais foram preenchidas. */
async function testar(chave) {
  const def = PORCHAVE[chave];
  if (!def) throw new ErroNegocio('Integração desconhecida.');
  const cred = await credenciaisAtivas(chave);
  if (!cred || def.campos.some((f) => !cred[f.nome])) {
    const msg = 'Preencha e ative as credenciais antes de testar.';
    await registrarTeste(chave, false, msg);
    throw new ErroNegocio(msg);
  }
  const msg = 'Credenciais preenchidas. A chamada real à API ainda não foi implementada — configure o provedor para habilitar o teste de conexão de verdade.';
  await registrarTeste(chave, false, msg);
  return { ok: false, mensagem: msg };
}

module.exports = { CATALOGO, todas, salvar, credenciaisAtivas, testar };
