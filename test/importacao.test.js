// Importação da planilha do sistema anterior (planilha sintética no mesmo formato dos relatórios).
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

/** Monta uma planilha com título, instrução e cabeçalho na linha 3, como a exportada pelo sistema anterior. */
async function planilha() {
  const wb = new ExcelJS.Workbook();
  const aba = (nome, cab, linhas) => {
    const ws = wb.addWorksheet(nome);
    ws.addRow([`RELATÓRIO ${nome.toUpperCase()}`]);
    ws.addRow(['NOVO MÊS: cole as linhas do relatório na primeira linha vazia.']);
    ws.addRow(cab);
    linhas.forEach((l) => ws.addRow(l));
  };
  const V = ['Nº Pedido', 'NFE', 'Data Pedido', 'Cliente', 'Forma Pagamento', 'Vendedor', 'Supervisor', 'Status', 'Vlr. Líquido', 'Vendedor padrão', 'Tem nota fiscal?', 'Dia da semana', 'Mês', 'Repetições'];
  aba('Vendas', V, [
    ['050820260930001111', 9001, '2026-08-05', 'PRODUTOR TESTE UM', 'BOLETO', 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 'Expedição (Entregue)', 3000, 'VENDEDOR TESTE A', 'Sim', 4, '2026-08-01', 1],
    ['100820261015002222', 9002, '2026-08-10', 'AGRO TESTE LTDA', 'DINHEIRO', 'VENDEDOR TESTE B', 'SUPERVISOR TESTE X', 'Expedição (Entregue)', 1200, 'VENDEDOR TESTE B', 'Sim', 2, '2026-08-01', 1],
    ['150820261100003333', '---', '2026-08-15', 'SEM DOCUMENTO TESTE', 'BOLETO', 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 'Vendedor', 500, 'VENDEDOR TESTE A', 'Não', 7, '2026-08-01', 1],
    ['200920261400004444', '---', '2026-09-20', 'PRODUTOR TESTE UM', 'BOLETO', 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 'Vendedor', 800, 'VENDEDOR TESTE A', 'Não', 1, '2026-09-01', 1],
  ]);
  const F = ['Nota', 'Natureza Operação', 'Data Emissão', 'Cliente', 'CPF/CNPJ', 'Valor', 'Grupo', 'Tipo cliente', 'Chave', 'Repetições', 'Valor sem repetição', 'Vendedor padrão', 'Supervisor', 'Forma Pagamento', 'Mês'];
  const linhaNF = ['9001', 'Venda de produção do estabelecimento', '2026-08-06', 'PRODUTOR TESTE UM', '529.982.247-25', 3000, 'Venda', 'Pessoa física', '', 1, 3000, 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 'BOLETO', '2026-08-01'];
  aba('Faturamento', F, [
    linhaNF.map((x, i) => (i === 0 ? 9001 : x)), linhaNF.map((x, i) => (i === 0 ? 9001 : x)), // linha colada duas vezes
    [9002, 'Venda de mercadoria adquirida ou recebida de terceiros', '2026-08-11', 'AGRO TESTE LTDA', '11.222.333/0001-81', 1200, 'Venda', 'Pessoa jurídica', '', 1, 1200, 'VENDEDOR TESTE B', 'SUPERVISOR TESTE X', 'DINHEIRO', '2026-08-01'],
    [9003, 'Devolução', '2026-08-20', 'AGRO TESTE LTDA', '11.222.333/0001-81', 100, 'Devolução', 'Pessoa jurídica', '', 1, 100, 'VENDEDOR TESTE B', 'SUPERVISOR TESTE X', 'DINHEIRO', '2026-08-01'],
  ]);
  aba('Contas a Receber', ['Pedido', 'Vencimento', 'Cliente', 'Forma Pagamento', 'Vendedor', 'Parcela', 'Valor Título', 'Vendedor padrão', 'Supervisor', 'Parcelas do pedido', 'Última parcela?', 'Mês'], [
    ['050820260930001111', '2026-09-05', 'PRODUTOR TESTE UM', 'BOLETO', 'VENDEDOR TESTE A', '2 / 2', 1500, 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 2, 'Sim', '2026-09-01'],
  ]);
  const R = ['Nº Pedido', 'Data Baixa', 'Cliente', 'CPF/CNPJ', 'Vencimento', 'Vendedor', 'Forma Pagamento', 'Vlr. Título', 'Vlr. Recebido', 'Quitação', 'Vendedor padrão', 'Supervisor', 'Dias de atraso', 'Pontualidade', 'Saldo do título', 'Mês', 'Mês de vencimento', 'Repetições'];
  aba('Contas Recebidas', R, [
    ['050820260930001111', '2026-08-07', 'PRODUTOR TESTE UM', '52998224725', '2026-08-05', 'VENDEDOR TESTE A', 'BOLETO', 1500, 1520, 'TOTAL', 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 2, '1 a 7 dias', 0, '2026-08-01', '2026-08-01', 1],
  ]);
  aba('Parcelas Vencidas', ['Cliente', 'Nota', 'Parcela', 'Documento', 'Cidade/UF', 'Telefone', 'Vendedor', 'Vencimento', 'Vlr. Título', 'Vendedor padrão', 'Supervisor', 'UF', 'Mês', 'Repetições'], [
    ['PRODUTOR TESTE UM', 9001, 2, '529.982.247-25', 'PATROCÍNIO/MG', '(34) 999990000', 'VENDEDOR TESTE A', '2026-09-05', 1500, 'VENDEDOR TESTE A', 'SUPERVISOR TESTE X', 'MG', '2026-09-01', 1],
  ]);
  aba('Parcelas Liquidadas', ['Nº Nota', 'Data Baixa', 'Cliente', 'CPF/CNPJ', 'Vencimento', 'Vendedor', 'Forma Pagamento', 'Vlr. Título', 'Vlr. Recebido', 'Quitação', 'Mês'], [
    [9001, '2026-08-07', 'PRODUTOR TESTE UM', '529.982.247-25', '2026-08-05', 'VENDEDOR TESTE A', 'BOLETO', 1500, 1520, 'TOTAL', '2026-08-01'],
  ]);
  const cad = wb.addWorksheet('Cadastros');
  cad.getCell('B6').value = 'Nome no relatório'; cad.getCell('C6').value = 'Nome padrão';
  cad.getCell('B7').value = 'VENDEDOR TESTE A'; cad.getCell('C7').value = 'VENDEDOR TESTE A';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('importa a planilha do sistema anterior sem duplicar e permite desfazer', async () => {
  const admin = await sessao('admin');
  const arquivo = await planilha();
  const form = (aplicar) => {
    const fd = new FormData();
    fd.append('arquivo', new Blob([arquivo]), 'Base_de_Dados.xlsx');
    if (aplicar) fd.append('aplicar', '1');
    return fd;
  };
  assert.equal((await (await sessao('ana')).req('POST', '/api/admin/importacao', form(false))).status, 403, 'só quem tem a permissão importa');

  const previa = await admin.post('/api/admin/importacao', form(false));
  assert.equal(previa.totais.pedidos, 4);
  assert.equal(previa.totais.notas, 2, 'linha repetida e nota de entrada ficam de fora');
  assert.equal(previa.totais.clientes, 3);
  assert.equal(previa.totais.clientes_sem_documento, 1);
  assert.equal(previa.totais.pedidos_por_etapa.cancelado, 1, 'pedido antigo sem nota parado no vendedor');
  assert.equal(previa.totais.pedidos_por_etapa.venda, 1, 'pedido do último mês fica na fila');
  assert.ok(previa.avisos.some((a) => a.texto.includes('notas de entrada')));
  assert.equal(await db.get(`SELECT COUNT(*) AS n FROM clientes WHERE origem LIKE 'planilha2026:%'`).then((r) => r.n), 0, 'a prévia não grava');

  const r1 = await admin.post('/api/admin/importacao', form(true));
  assert.ok(r1.conferencia.every((c) => c.ok), JSON.stringify(r1.conferencia));
  assert.ok(r1.backup_id);
  const ped = await db.get(`SELECT p.*, c.documento, u.nome AS vendedor, s.nome AS supervisor FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
    JOIN usuarios u ON u.id = p.vendedor_id LEFT JOIN usuarios s ON s.id = p.supervisor_id WHERE p.codigo_origem = '050820260930001111'`);
  assert.equal(ped.etapa, 'entregue');
  assert.equal(ped.documento, '52998224725');
  assert.equal(ped.vendedor, 'Vendedor Teste A');
  assert.equal(ped.supervisor, 'Supervisor Teste X');
  assert.equal(ped.created_at, '2026-08-05 09:30:00', 'data e hora vêm do código do pedido');
  const parcelas = await db.all('SELECT numero, total_parcelas, status, valor, valor_pago, juros FROM parcelas WHERE pedido_id = ? ORDER BY numero', ped.id);
  assert.deepEqual(parcelas.map((p) => [p.numero, p.total_parcelas, p.status]), [[1, 2, 'liquidada'], [2, 2, 'a_pagar']]);
  assert.equal(parcelas[0].juros, 20, 'recebido acima do título vira juros');
  const vend = await db.get(`SELECT ativo, perfil, equipe_id FROM usuarios WHERE nome = 'Vendedor Teste A'`);
  assert.equal(vend.ativo, 0, 'vendedor importado entra sem acesso');
  assert.ok(vend.equipe_id);
  const cli = await db.get(`SELECT c.id, e.cidade, e.uf, t.numero FROM clientes c JOIN cliente_enderecos e ON e.cliente_id = c.id JOIN cliente_telefones t ON t.cliente_id = c.id WHERE c.documento = '52998224725'`);
  assert.deepEqual([cli.cidade, cli.uf, cli.numero], ['PATROCÍNIO', 'MG', '34999990000']);
  assert.equal((await db.get(`SELECT valor FROM sequencias WHERE nome = 'nfe_1'`)).valor >= 9002, true, 'NF-e continua depois da maior nota');

  const r2 = await admin.post('/api/admin/importacao', form(true));
  assert.ok(r2.conferencia.every((c) => c.ok), 'reimportar não duplica');
  assert.equal((await admin.get('/api/admin/importacao')).importado.pedidos, 4);

  assert.equal((await admin.req('POST', '/api/admin/importacao/desfazer', { confirmacao: 'sim' })).status, 400);
  const d = await admin.post('/api/admin/importacao/desfazer', { confirmacao: 'DESFAZER' });
  assert.equal(d.importado.pedidos, 0);
  assert.equal(d.importado.clientes, 0);
  assert.equal(await db.get(`SELECT COUNT(*) AS n FROM usuarios WHERE origem LIKE 'planilha2026:%'`).then((r) => r.n), 0);
});
