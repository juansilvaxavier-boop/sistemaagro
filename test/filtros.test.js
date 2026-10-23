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
