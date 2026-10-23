// Percorre as telas de lista, relatórios e painéis para garantir que todas as consultas rodam no PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

test('todas as listas, relatórios e painéis respondem', async () => {
  const d = await sessao('diretoria');
  const cliente = await db.get('SELECT id, documento FROM clientes LIMIT 1');
  const parcela = await db.get('SELECT id FROM parcelas LIMIT 1');
  const nota = await db.get('SELECT id FROM notas_fiscais WHERE empresa_id = 1 LIMIT 1');
  const rotas = [
    '/api/pedidos/progressao', '/api/pedidos/contagem', '/api/clientes', `/api/clientes/${cliente.id}`, `/api/clientes/${cliente.id}/serasa`,
    `/api/clientes/historico/compras?documento=${cliente.documento}`, '/api/clientes/blacklist/lista', '/api/clientes/busca?q=si',
    '/api/cadastros/usuarios', '/api/cadastros/equipes', '/api/cadastros/produtos', '/api/cadastros/produtos/1', '/api/cadastros/formas-pagamento',
    '/api/cadastros/formas-pagamento/1', '/api/cadastros/transportadoras', '/api/cadastros/empresas', '/api/cadastros/opcoes', '/api/cadastros/bancos',
    '/api/financeiro/parcelas', `/api/financeiro/parcelas/${parcela.id}`, '/api/financeiro/negativacoes', '/api/financeiro/lancamentos',
    '/api/financeiro/comissoes', '/api/financeiro/comissoes/resumo', '/api/financeiro/devolucoes', '/api/financeiro/notas', `/api/financeiro/notas/${nota.id}`,
    '/api/cobranca/carteira', '/api/cobranca/carteira?incluir_a_vencer=1', '/api/cobranca/resumo', '/api/cobranca/agenda', `/api/cobranca/cliente/${cliente.id}`,
    '/api/cobranca/acoes', '/api/crm/interacoes', '/api/crm/oportunidades', '/api/crm/tarefas', '/api/crm/inativos?dias=30', `/api/crm/cliente/${cliente.id}`,
    '/api/arquivos', '/api/arquivos/categorias', '/api/mensagens', '/api/mensagens?caixa=enviadas', '/api/mensagens/nao-lidas', '/api/relatorios',
  ];
  for (const etapa of ['venda', 'supervisao', 'analise', 'diretoria', 'cobranca', 'producao', 'faturamento', 'expedicao', 'transito', 'devolucao']) {
    rotas.push(`/api/pedidos/fila/${etapa}`);
  }
  rotas.push('/api/pedidos/fila/transito?aba=entregues');
  for (const r of ['contas-receber', 'contas-receber?agrupar_vendedor=1', 'contas-recebidas', 'vendas', 'faturamento', 'vencidas', 'vencidas?negativado=sim',
    'historico-vendas', 'venda-produtos', 'venda-produtos?tipo=analitico&por_embalagem=1&sumarizacao=cliente', 'venda-produtos?sumarizacao=mes&prazo_meses=6',
    'vendedores-supervisor']) rotas.push(`/api/relatorios/${r}`);
  for (const p of ['vendedor', 'supervisor', 'analista', 'diretoria', 'producao', 'faturamento', 'expedicao', 'financeiro']) rotas.push(`/api/dashboard?perfil=${p}`);

  const falhas = [];
  for (const r of rotas) {
    const res = await d.req('GET', r);
    if (res.status !== 200) falhas.push(`${r} → ${res.status} ${JSON.stringify(res.dados).slice(0, 200)}`);
  }
  assert.deepEqual(falhas, []);

  // Filtros por coluna e ordenação em cada tipo de coluna
  for (const r of ['/api/financeiro/parcelas?f_status=vencida&sort=saldo&dir=asc', '/api/pedidos/progressao?f_cliente=silva&sort=valor',
    '/api/clientes?f_cidade=MG&sort=cidade', '/api/cobranca/carteira?f_faixa=90%2B']) {
    assert.equal((await d.req('GET', r)).status, 200, r);
  }
});
