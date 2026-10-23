// Diretoria: visão completa do pedido e alteração da comissão antes da aprovação final.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

/** Leva um pedido novo da Ana até a fila da Diretoria. */
async function pedidoNaDiretoria() {
  const ana = await sessao('ana');
  const op = await ana.get('/api/cadastros/opcoes');
  const cliente = (await ana.get('/api/clientes?pageSize=50')).rows.find((c) => !c.blacklist);
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id && c.parcelas === 3);
  const precos = await ana.get(`/api/cadastros/produtos/${op.produtos[0].id}/precos`);
  const { id } = await ana.post('/api/pedidos', {
    cliente_id: cliente.id, forma_id: forma.id, condicao_id: cond.id, tipo_entrega: 'transportadora', cultura: 'Café', area_ha: 50, origem_venda: 'Indicação de cliente',
    itens: [{ produto_id: op.produtos[0].id, embalagem_id: precos.embalagens[0].id, quantidade: 100 }],
  });
  await ana.post(`/api/pedidos/${id}/acao`, { acao: 'enviar' });
  await (await sessao('carlos')).post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  const analise = await sessao('analise');
  await analise.post(`/api/clientes/${cliente.id}/serasa`, { pedido_id: id, justificativa: 'teste' });
  await analise.put(`/api/pedidos/${id}/frete`, { tipo_entrega: 'transportadora', transportadora_id: op.transportadoras[0].id, frete_codigo_cotacao: 'C1', frete_prazo_dias: 3, frete_valor: 100 });
  assert.equal((await analise.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' })).destino, 'diretoria');
  return { id, ana };
}

test('diretoria vê o pedido completo e altera a comissão por % ou valor', async () => {
  const { id, ana } = await pedidoNaDiretoria();
  const dir = await sessao('diretoria');
  const d = await dir.get(`/api/pedidos/${id}`);
  assert.ok(d.credito && 'limite_credito' in d.credito && 'vencido' in d.credito, 'situação de crédito do cliente');
  assert.deepEqual(d.comissoes_padrao.map((c) => [c.papel, c.percentual]), [['vendedor', 25], ['supervisor', 3], ['gerente', 3]], 'regra: vendedor 25%, supervisor 3%, gerente 3%');
  assert.equal(d.comissoes_definidas, null);
  assert.equal(d.credito.limite_credito >= 0, true);
  assert.equal((await ana.get(`/api/pedidos/${id}`)).credito, undefined, 'vendedor não recebe a análise de crédito');

  const total = d.pedido.valor_total;
  const [v, s] = d.comissoes_padrao;
  // Vendedor por %, supervisor por valor em R$.
  const r = await dir.put(`/api/pedidos/${id}/comissoes`, {
    comissoes: [{ usuario_id: v.usuario_id, papel: 'vendedor', percentual: 2.5 }, { usuario_id: s.usuario_id, papel: 'supervisor', valor: 100 }],
    motivo: 'Negociação especial',
  });
  assert.equal(r.comissoes[0].valor, Math.round(total * 2.5) / 100);
  assert.equal(r.comissoes[1].valor, 100);
  const d2 = await dir.get(`/api/pedidos/${id}`);
  assert.ok(d2.comissoes_definidas?.por);
  const h = d2.historico.find((x) => x.acao === 'Comissão alterada pela Diretoria');
  assert.match(h.observacao, /Antes: .*Agora: .*2,5%.*Motivo: Negociação especial/);

  // Validações e permissão
  assert.equal((await dir.req('PUT', `/api/pedidos/${id}/comissoes`, { comissoes: [{ usuario_id: v.usuario_id, papel: 'vendedor', percentual: 120 }] })).status, 400);
  assert.equal((await dir.req('PUT', `/api/pedidos/${id}/comissoes`, { comissoes: [{ usuario_id: v.usuario_id, papel: 'vendedor', percentual: 1 }, { usuario_id: v.usuario_id, papel: 'vendedor', percentual: 1 }] })).status, 400);
  assert.equal((await ana.req('PUT', `/api/pedidos/${id}/comissoes`, { comissoes: [] })).status, 403, 'vendedor não muda a comissão');

  // A aprovação mantém o que a diretoria definiu.
  await dir.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  const finais = await db.all(`SELECT papel, percentual, valor FROM pedido_comissoes WHERE pedido_id = ? AND papel IN ('vendedor','supervisor') ORDER BY papel DESC`, id);
  assert.deepEqual(finais.map((c) => c.percentual), [2.5, Math.round((100 / total) * 100 * 10000) / 10000]);
});

test('diretoria pode deixar o pedido sem comissão e a aprovação respeita', async () => {
  const { id } = await pedidoNaDiretoria();
  const dir = await sessao('diretoria');
  await dir.put(`/api/pedidos/${id}/comissoes`, { comissoes: [] });
  await dir.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM pedido_comissoes WHERE pedido_id = ?', id)).n, 0);
});
