// Filtros das filas: período, faixa de valor, listas de seleção e combinação com a abrangência.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar } = require('./helpers');

test.after(parar);

test('filtros por período, faixa e lista nas filas e na progressão', async () => {
  const dir = await sessao('diretoria');
  const todos = (await dir.get('/api/pedidos/progressao?all=1')).rows;
  assert.ok(todos.length > 10);

  // Período pela data do pedido (dia inteiro, inclusive nas pontas)
  const datas = todos.map((p) => p.data.slice(0, 10)).sort();
  const meio = datas[Math.floor(datas.length / 2)];
  const desde = (await dir.get(`/api/pedidos/progressao?all=1&de_data=${meio}`)).rows;
  assert.ok(desde.length > 0 && desde.every((p) => p.data.slice(0, 10) >= meio));
  const ate = (await dir.get(`/api/pedidos/progressao?all=1&ate_data=${meio}`)).rows;
  assert.equal(desde.length + ate.length - todos.filter((p) => p.data.startsWith(meio)).length, todos.length);

  // Faixa de valor
  const faixa = (await dir.get('/api/pedidos/progressao?all=1&de_valor=10000&ate_valor=30000')).rows;
  assert.ok(faixa.every((p) => p.valor >= 10000 && p.valor <= 30000));
  assert.equal(faixa.length, todos.filter((p) => p.valor >= 10000 && p.valor <= 30000).length);

  // Lista de vendedores e de etapas
  const [v1, v2] = [...new Set(todos.map((p) => p.vendedor_id))];
  const dois = (await dir.get(`/api/pedidos/progressao?all=1&em_vendedor_id=${v1},${v2}`)).rows;
  assert.equal(dois.length, todos.filter((p) => [v1, v2].includes(p.vendedor_id)).length);
  const etapas = (await dir.get('/api/pedidos/progressao?all=1&em_etapa=producao,faturamento')).rows;
  assert.ok(etapas.length && etapas.every((p) => ['producao', 'faturamento'].includes(p.etapa)));

  // Fila de uma etapa com filtro de UF; coluna desconhecida é ignorada
  const fila = (await dir.get('/api/pedidos/fila/producao?all=1')).rows;
  const uf = fila[0].uf;
  const porUf = (await dir.get(`/api/pedidos/fila/producao?all=1&em_uf=${uf}&de_inexistente=1`)).rows;
  assert.equal(porUf.length, fila.filter((p) => p.uf === uf).length);
});

test('filtro não fura a abrangência do vendedor', async () => {
  const ana = await sessao('ana');
  const dir = await sessao('diretoria');
  const outro = (await dir.get('/api/pedidos/progressao?all=1')).rows.find((p) => p.vendedor !== 'Ana Souza');
  const r = (await ana.get(`/api/pedidos/progressao?all=1&em_vendedor_id=${outro.vendedor_id}`)).rows;
  assert.equal(r.length, 0);
});

test('painéis respeitam período e recortes', async () => {
  const dir = await sessao('diretoria');
  const valor = (d, inicio) => d.cards.find((c) => c.label.startsWith(inicio))?.valor;
  const mes = await dir.get('/api/dashboard');
  assert.ok(mes.filtro.de.endsWith('-01') && mes.filtro.recortes);
  assert.ok(mes.cards.some((c) => c.label === 'Vendas no mês'));

  // Período longo soma mais que o mês; rótulo muda para "no período"
  const ano = await dir.get('/api/dashboard?de=2020-01-01&ate=2030-12-31');
  assert.ok(valor(ano, 'Vendas no período') >= valor(mes, 'Vendas no mês'));
  assert.equal(ano.filtro.de, '2020-01-01');
  // Datas invertidas são corrigidas; inválidas caem no padrão
  assert.equal((await dir.get('/api/dashboard?de=2030-12-31&ate=2020-01-01')).filtro.de, '2020-01-01');
  assert.equal((await dir.get('/api/dashboard?de=xx')).filtro.de, mes.filtro.de);

  // Recorte por vendedor bate com a soma dos pedidos dele no período
  const todos = (await dir.get('/api/pedidos/progressao?all=1')).rows;
  const vid = todos.find((p) => p.vendedor === 'Ana Souza').vendedor_id;
  const soAna = await dir.get(`/api/dashboard?de=2020-01-01&ate=2030-12-31&vendedores=${vid}`);
  const esperado = todos.filter((p) => p.vendedor_id === vid && !['venda', 'cancelado'].includes(p.etapa)).reduce((a, p) => a + p.valor, 0);
  assert.equal(valor(soAna, 'Vendas no período'), Math.round(esperado * 100) / 100);
  assert.ok(valor(soAna, 'Contas a receber') <= valor(ano, 'Contas a receber'));

  // Todos os painéis aceitam o filtro
  for (const perfil of mes.perfis_disponiveis) {
    const d = await dir.get(`/api/dashboard?perfil=${perfil}&de=2026-01-01&ate=2026-06-30&vendedores=${vid}&formas=1&ufs=MG&equipes=1`);
    assert.equal(d.perfil, perfil);
  }
  assert.equal((await dir.get('/api/dashboard?perfil=rh')).filtro.recortes, false);
});
