// Estoque, etiqueta de envio, contas a pagar, fornecedores, chamados internos e propostas comerciais.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

test('estoque: entrada, saída por lote, inventário e baixa no faturamento', async () => {
  const exp = await sessao('expedicao');
  const fat = await sessao('faturamento');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/estoque/saldos')).status, 403, 'vendedor não vê estoque');
  assert.equal((await fat.req('POST', '/api/estoque/movimentos', {})).status, 403, 'faturamento só consulta');

  const emb = await db.get('SELECT e.id, e.produto_id FROM produto_embalagens e ORDER BY id LIMIT 1');
  const saldo = async () => (await exp.get(`/api/estoque/saldos?f_embalagem_id=${emb.id}&all=1`)).rows.find((x) => x.embalagem_id === emb.id).saldo;
  const inicial = await saldo();
  const ent = await exp.post('/api/estoque/movimentos', { embalagem_id: emb.id, tipo: 'entrada', origem: 'compra', quantidade: 100, lote: 'TESTE-1', validade: '2028-01-01', custo_unitario: 50 });
  assert.equal(ent.saldo, inicial + 100);
  assert.equal((await exp.req('POST', '/api/estoque/movimentos', { embalagem_id: emb.id, tipo: 'saida', origem: 'perda', quantidade: 150, lote: 'TESTE-1' })).status, 400, 'lote sem saldo');
  await exp.post('/api/estoque/movimentos', { embalagem_id: emb.id, tipo: 'saida', origem: 'perda', quantidade: 10, lote: 'TESTE-1' });
  assert.equal(await saldo(), inicial + 90);
  const lotes = await exp.get(`/api/estoque/lotes/${emb.id}`);
  assert.equal(lotes.find((l) => l.lote === 'TESTE-1').saldo, 90);

  const inv = await exp.post('/api/estoque/inventario', { itens: [{ embalagem_id: emb.id, lote: 'TESTE-1', contado: 85 }] });
  assert.equal(inv.ajustes[0].diferenca, -5);
  assert.equal(await saldo(), inicial + 85);
  await exp.put(`/api/estoque/minimo/${emb.id}`, { estoque_minimo: 999999 });
  assert.equal((await exp.get(`/api/estoque/saldos?f_embalagem_id=${emb.id}&all=1`)).rows[0].situacao, 'baixo');
  const resumo = await exp.get('/api/estoque/resumo');
  assert.ok(resumo.baixos >= 1 && resumo.valor > 0);

  // Faturar um pedido gera a saída de cada item; cancelar a NF devolve ao estoque.
  const ped = await db.get(`SELECT p.id FROM pedidos p WHERE p.etapa = 'faturamento' AND p.empresa_id = 1 LIMIT 1`);
  const itens = await db.all('SELECT embalagem_id, SUM(quantidade) AS q FROM pedido_itens WHERE pedido_id = ? GROUP BY embalagem_id', ped.id);
  const antes = await db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE empresa_id = 1 AND embalagem_id = ?', itens[0].embalagem_id);
  await fat.post(`/api/pedidos/${ped.id}/acao`, { acao: 'faturar' });
  const depois = await db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE empresa_id = 1 AND embalagem_id = ?', itens[0].embalagem_id);
  assert.equal(Math.round(depois.s - antes.s), -Math.round(itens[0].q));
  const nf = await db.get(`SELECT id FROM notas_fiscais WHERE pedido_id = ? AND status <> 'cancelada'`, ped.id);
  await fat.post(`/api/financeiro/notas/${nf.id}/cancelar`, { motivo: 'Teste de estorno de estoque' });
  const estorno = await db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE empresa_id = 1 AND embalagem_id = ?', itens[0].embalagem_id);
  assert.equal(Math.round(estorno.s), Math.round(antes.s));
  const movs = await exp.get(`/api/estoque/movimentos?f_origem=cancelamento&all=1`);
  assert.ok(movs.rows.length > 0);
});

test('etiqueta de envio: remetente, destinatário, volumes, peso e rastreio', async () => {
  const exp = await sessao('expedicao');
  const ana = await sessao('ana');
  const ped = await db.get(`SELECT id, numero FROM pedidos WHERE etapa = 'transito' AND empresa_id = 1 LIMIT 1`);
  assert.equal((await ana.req('GET', `/api/pedidos/${ped.id}/etiqueta`)).status, 403);
  const et = await exp.get(`/api/pedidos/${ped.id}/etiqueta`);
  assert.equal(et.pedido.numero, ped.numero);
  assert.ok(et.remetente.cidade && et.remetente.cep, 'endereço da empresa');
  assert.ok(et.destinatario.nome && et.destinatario.endereco?.cidade, 'destino');
  assert.ok(et.nota?.numero, 'pedido em trânsito tem NF');
  assert.ok(et.peso_estimado > 0 && et.volumes_estimados >= 1);
  assert.ok(et.destinatario.documento.includes('***'), 'expedição não vê o documento completo');
  assert.equal((await exp.req('PUT', `/api/pedidos/${ped.id}/envio`, { volumes: 0 })).status, 400);
  await exp.put(`/api/pedidos/${ped.id}/envio`, { volumes: 3, peso_kg: 151.5, codigo_rastreio: 'aa123456789br' });
  const et2 = await exp.get(`/api/pedidos/${ped.id}/etiqueta`);
  assert.equal(et2.pedido.volumes, 3);
  assert.equal(et2.pedido.codigo_rastreio, 'AA123456789BR');
});

test('fornecedores e contas a pagar: parcelado, recorrente, baixa parcial, estorno e cancelamento', async () => {
  const fin = await sessao('financeiro');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/pagar')).status, 403);
  assert.equal((await fin.req('POST', '/api/cadastros/fornecedores', { razao_social: 'X', documento: '11111111111111' })).status, 400, 'CNPJ inválido');
  const { id: forn } = await fin.post('/api/cadastros/fornecedores', { razao_social: 'Fornecedor Teste Ltda', documento: '11.222.333/0001-81', categoria: 'Serviços', uf: 'mg' });
  assert.equal((await fin.get(`/api/cadastros/fornecedores/${forn}`)).uf, 'MG');

  const parc = await fin.post('/api/pagar', { fornecedor_id: forn, descricao: 'Compra parcelada', categoria: 'Serviços', vencimento: '2026-11-30', valor: 1000, parcelas: 3 });
  assert.equal(parc.ids.length, 3);
  const linhas = await db.all('SELECT valor, vencimento FROM contas_pagar WHERE id = ANY(?::int[]) ORDER BY parcela', `{${parc.ids.join(',')}}`);
  assert.equal(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2), '1000.00', 'soma das parcelas fecha o total');
  assert.deepEqual(linhas.map((l) => l.vencimento), ['2026-11-30', '2026-12-30', '2027-01-30']);
  const rec = await fin.post('/api/pagar', { descricao: 'Aluguel', categoria: 'Aluguel', vencimento: '2026-01-31', valor: 2000, parcelas: 2, recorrente: true });
  assert.deepEqual((await db.all('SELECT valor, vencimento FROM contas_pagar WHERE id = ANY(?::int[]) ORDER BY parcela', `{${rec.ids.join(',')}}`)).map((l) => [l.valor, l.vencimento]),
    [[2000, '2026-01-31'], [2000, '2026-02-28']], 'recorrente no fim do mês');
  assert.equal((await fin.get(`/api/pagar/${rec.ids[0]}`)).status_atual, 'vencida');

  const id = parc.ids[0];
  assert.equal((await fin.req('POST', `/api/pagar/${id}/pagar`, { valor_pago: 5000 })).status, 400, 'acima do saldo');
  assert.equal((await fin.post(`/api/pagar/${id}/pagar`, { valor_pago: 100 })).quitou, false);
  assert.equal((await fin.req('POST', `/api/pagar/${id}/cancelar`, { motivo: 'x' })).status, 400, 'tem pagamento parcial');
  assert.equal((await fin.post(`/api/pagar/${id}/pagar`, {})).quitou, true);
  await fin.post(`/api/pagar/${id}/estornar`);
  assert.equal((await fin.get(`/api/pagar/${id}`)).status, 'a_pagar');
  const canc = await fin.post(`/api/pagar/${parc.ids[1]}/cancelar`, { motivo: 'Pedido de compra cancelado', todas: true });
  assert.equal(canc.canceladas, 2, 'cancela esta e as seguintes do grupo');

  const resumo = await fin.get('/api/pagar/resumo');
  assert.ok(resumo.vencido >= 2000);
  const lista = await fin.get(`/api/pagar?f_fornecedor_id=${forn}&all=1`);
  assert.equal(lista.rows.length, 3);
  const rel = await fin.get('/api/relatorios/contas-pagar?situacao=abertas');
  assert.ok(rel.linhas.length > 0 && rel.totais.saldo > 0);
  const fluxo = await fin.get('/api/relatorios/fluxo-caixa');
  assert.ok(Array.isArray(fluxo.linhas));
  assert.equal((await fin.req('DELETE', `/api/cadastros/fornecedores/${forn}`)).status, 400, 'fornecedor em uso');
});

test('chamados internos: abertura, atendimento do setor, comentários, resolução e avaliação', async () => {
  const ana = await sessao('ana');
  const prod = await sessao('producao');
  const fin = await sessao('financeiro');
  assert.equal((await ana.req('POST', '/api/chamados', { titulo: 'X', descricao: 'Y' })).status, 400, 'setor obrigatório');
  const { id, numero } = await ana.post('/api/chamados', { titulo: 'Dúvida sobre lote', descricao: 'Qual o lote do pedido?', setor_destino: 'producao', prioridade: 'urgente', categoria: 'Produção' });
  assert.ok(numero > 1000);
  const c = await prod.get(`/api/chamados/${id}`);
  assert.equal(c.prazo.length, 10);
  assert.ok(c.pode_atender);
  assert.equal((await fin.req('GET', `/api/chamados/${id}`)).status, 404, 'outro setor não vê');
  assert.equal((await ana.req('POST', `/api/chamados/${id}/status`, { status: 'em_andamento' })).status, 403, 'solicitante não atende');

  await prod.post(`/api/chamados/${id}/status`, { status: 'em_andamento' });
  assert.equal((await prod.get(`/api/chamados/${id}`)).responsavel_id, (await db.get(`SELECT id FROM usuarios WHERE login = 'producao'`)).id, 'quem assume vira responsável');
  await prod.post(`/api/chamados/${id}/status`, { status: 'aguardando', observacao: 'Informe o número do pedido' });
  await ana.post(`/api/chamados/${id}/comentar`, { texto: 'Pedido 100010' });
  assert.equal((await prod.get(`/api/chamados/${id}`)).status, 'em_andamento', 'resposta do solicitante retoma o atendimento');
  assert.equal((await prod.req('POST', `/api/chamados/${id}/status`, { status: 'resolvido' })).status, 400, 'solução obrigatória');
  await prod.post(`/api/chamados/${id}/status`, { status: 'resolvido', observacao: 'Lote L2610-001' });
  assert.equal((await ana.get('/api/chamados/contagem')).avaliar, 1);
  await ana.post(`/api/chamados/${id}/avaliar`, { avaliacao: 5 });
  const fim = await ana.get(`/api/chamados/${id}`);
  assert.equal(fim.status, 'fechado');
  assert.equal(fim.avaliacao, 5);
  assert.ok(fim.interacoes.length >= 5);

  const meus = await ana.get('/api/chamados?escopo=meus&all=1');
  assert.ok(meus.rows.some((x) => x.id === id));
  const setor = await prod.get('/api/chamados?escopo=setor&abertos=1&all=1');
  assert.ok(!setor.rows.some((x) => x.id === id), 'fechado sai dos abertos');
});

test('proposta comercial: montagem, envio, aceite e conversão em pedido', async () => {
  const ana = await sessao('ana');
  const bruno = await sessao('bruno');
  const op = await ana.get('/api/cadastros/opcoes');
  const cli = await db.get(`SELECT c.id FROM clientes c JOIN usuarios u ON u.id = c.vendedor_id WHERE u.login = 'ana'
    AND NOT EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1) LIMIT 1`);
  const outro = await db.get(`SELECT c.id FROM clientes c JOIN usuarios u ON u.id = c.vendedor_id WHERE u.login = 'elisa' LIMIT 1`);
  const prod = await db.get(`SELECT p.id, e.id AS emb FROM produtos p JOIN produto_embalagens e ON e.produto_id = p.id JOIN produto_precos pp ON pp.embalagem_id = e.id LIMIT 1`);
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id);
  assert.equal((await ana.req('POST', '/api/propostas', { cliente_id: outro.id, itens: [] })).status, 400, 'fora da carteira');

  const { id, numero } = await ana.post('/api/propostas', {
    cliente_id: cli.id, forma_id: forma.id, condicao_id: cond.id, frete_valor: 150, condicoes_comerciais: 'Frete CIF',
    itens: [{ produto_id: prod.id, embalagem_id: prod.emb, quantidade: 10 }, { produto_id: prod.id, embalagem_id: prod.emb, quantidade: 2, valor_unitario: 99.9 }],
  });
  assert.ok(numero > 5000);
  let p = await ana.get(`/api/propostas/${id}`);
  assert.ok(p.itens[0].valor_tabela > 0, 'preço de tabela');
  assert.equal(p.proposta.valor_total, Math.round((p.itens[0].valor_total + 199.8 + 150) * 100) / 100);
  assert.equal(p.proposta.status, 'rascunho');
  assert.equal((await bruno.req('GET', `/api/propostas/${id}`)).status, 404, 'outro vendedor não vê');

  assert.equal((await ana.req('POST', `/api/propostas/${id}/status`, { status: 'aceita' })).status, 400, 'precisa enviar antes');
  await ana.post(`/api/propostas/${id}/status`, { status: 'enviada' });
  await ana.post(`/api/propostas/${id}/status`, { status: 'aceita' });
  const ped = await ana.post(`/api/propostas/${id}/converter`);
  assert.ok(ped.numero > 100000);
  p = await ana.get(`/api/propostas/${id}`);
  assert.equal(p.proposta.status, 'convertida');
  assert.equal(p.proposta.pedido_numero, ped.numero);
  const pedido = await ana.get(`/api/pedidos/${ped.id}`);
  assert.equal(pedido.pedido.etapa, 'venda');
  assert.equal(pedido.itens.length, 2);
  assert.equal(pedido.itens[1].valor_unitario, 99.9, 'mantém o preço negociado');
  assert.equal((await ana.req('POST', `/api/propostas/${id}/converter`)).status, 400, 'não converte duas vezes');
  assert.equal((await ana.req('PUT', `/api/propostas/${id}`, { observacao: 'x' })).status, 400, 'convertida não edita');

  const dup = await ana.post(`/api/propostas/${id}/duplicar`);
  const copia = await ana.get(`/api/propostas/${dup.id}`);
  assert.equal(copia.proposta.status, 'rascunho');
  assert.equal(copia.itens.length, 2);
  await ana.post(`/api/propostas/${dup.id}/status`, { status: 'enviada' });
  assert.equal((await ana.req('POST', `/api/propostas/${dup.id}/status`, { status: 'recusada' })).status, 400, 'motivo da recusa');
  await ana.post(`/api/propostas/${dup.id}/status`, { status: 'recusada', motivo: 'Preço' });
  const resumo = await ana.get('/api/propostas/resumo');
  assert.ok(resumo.recusadas >= 1 && resumo.ganhas >= 1);

  const painel = await ana.get('/api/dashboard');
  assert.ok(painel.cards.some((c) => c.label === 'Propostas em aberto'));
  assert.ok(painel.cards.some((c) => c.label === 'Chamados para atender'));
});
