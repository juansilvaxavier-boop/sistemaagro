// Ponto único para implementar as chamadas reais, quando cada provedor estiver contratado.
// Cada função já recebe as credenciais salvas em Administração → Integrações; falta só montar a
// chamada HTTP do provedor e tratar a resposta.
const { credenciaisAtivas } = require('./integracoes');
const { ErroNegocio } = new Proxy({}, { get: (_, k) => require('./services')[k] });

async function exigirCredenciais(chave, rotulo) {
  const cred = await credenciaisAtivas(chave);
  if (!cred) throw new ErroNegocio(`${rotulo} não está configurado em Administração → Integrações.`);
  return cred;
}

/** Notas fiscais emitidas por fornecedores contra o CNPJ da empresa. */
async function buscarNFeEmitidas(_empresaId) {
  await exigirCredenciais('nfe_consulta', 'A consulta de NF-e');
  throw new ErroNegocio('Integração de consulta de NF-e ainda não implementada.');
}

/** Cotação de frete (prazo e valor) para um pedido. */
async function cotarCorreios(_pedido) {
  await exigirCredenciais('frete_correios', 'A integração com os Correios');
  throw new ErroNegocio('Integração com os Correios ainda não implementada.');
}

async function cotarRodonaves(_pedido) {
  await exigirCredenciais('frete_rodonaves', 'A integração com a Rodonaves');
  throw new ErroNegocio('Integração com a Rodonaves ainda não implementada.');
}

async function cotarBraspress(_pedido) {
  await exigirCredenciais('frete_braspress', 'A integração com a Braspress');
  throw new ErroNegocio('Integração com a Braspress ainda não implementada.');
}

/** Emissão de boleto bancário pelo Banco Cora para uma parcela. */
async function emitirBoletoCora(_parcela) {
  await exigirCredenciais('boleto_cora', 'A integração com o Banco Cora');
  throw new ErroNegocio('Integração com o Banco Cora ainda não implementada.');
}

/** Emissão automática de NF-e de saída (Migrate / Invocy) ao faturar um pedido. */
async function emitirNFeInvocy(_pedido) {
  await exigirCredenciais('nfe_emissao_invocy', 'A emissão automática de NF-e (Invocy)');
  throw new ErroNegocio('Integração de emissão de NF-e (Invocy) ainda não implementada.');
}

module.exports = { buscarNFeEmitidas, cotarCorreios, cotarRodonaves, cotarBraspress, emitirBoletoCora, emitirNFeInvocy };
