// Automações do CRM (tarefas automáticas) e módulo de Compras (solicitação → cotação → pedido → aprovação → recebimento).
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

test('automações do CRM: padrões, simulação, execução sem duplicar, permissões e conclusão com interação', async () => {
  const dir = await sessao('diretoria');
  const ana = await sessao('ana');
  const gerente = await sessao('gerente');
  assert.equal((await ana.req('GET', '/api/crm/automacoes')).status, 403, 'vendedor não configura automações');

  const { regras, gatilhos } = await gerente.get('/api/crm/automacoes');
  assert.ok(gatilhos.length >= 9 && regras.length >= 9, 'regras padrão criadas');
  assert.equal(regras.find((r) => r.gatilho === 'parcela_vencida').ativa, 0, 'parcela vencida começa desligada');

  // Cliente da Ana sem compra há 400 dias.
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  const cli = await db.get('SELECT id, nome FROM clientes WHERE vendedor_id = ? ORDER BY id LIMIT 1', anaId);
  await db.run(`UPDATE pedidos SET created_at = '2025-01-10 10:00:00' WHERE cliente_id = ?`, cli.id);
  const regra = await dir.post('/api/crm/automacoes', {
    nome: 'Teste reativação', gatilho: 'sem_compra', dias: 365, titulo: 'Ligar para {cliente} ({dias_reais} dias)', prazo_dias: 2, prioridade: 'alta', responsavel: 'vendedor', limite: 500,
  });
  assert.equal((await dir.req('POST', '/api/crm/automacoes', { nome: 'x', gatilho: 'nada', dias: 1, titulo: 't' })).status, 400);
  assert.equal((await dir.req('POST', '/api/crm/automacoes', { nome: 'x', gatilho: 'sem_compra', dias: -1, titulo: 't' })).status, 400);

  const sim = await dir.post(`/api/crm/automacoes/${regra.id}/simular`);
  assert.ok(sim.encontrados >= 1 && sim.geradas === 0, 'simular não cria tarefas');
  assert.ok(sim.exemplos.some((e) => e.titulo.startsWith(`Ligar para ${cli.nome}`)), 'título com variáveis');

  const [exec] = await dir.post('/api/crm/automacoes/executar', { id: regra.id });
  assert.ok(exec.geradas >= 1);
  const tarefa = await db.get('SELECT * FROM crm_tarefas WHERE automacao_id = ? AND cliente_id = ?', regra.id, cli.id);
  assert.equal(tarefa.responsavel_id, anaId, 'vai para o vendedor do cliente');
  assert.equal(tarefa.prioridade, 'alta');
  const [denovo] = await dir.post('/api/crm/automacoes/executar', { id: regra.id });
  assert.equal(denovo.geradas, 0, 'não duplica a mesma situação');

  // A vendedora vê a tarefa automática e conclui registrando a interação.
  const minhas = await ana.get('/api/crm/tarefas');
  const t = minhas.find((x) => x.id === tarefa.id);
  assert.equal(t.automacao, 'Teste reativação');
  const cont = await ana.get('/api/crm/contagem');
  assert.ok(cont.abertas >= 1);
  await ana.put(`/api/crm/tarefas/${tarefa.id}`, { concluida: 1, interacao: { tipo: 'ligacao', descricao: 'Cliente vai comprar na safra' } });
  const int = await db.get('SELECT * FROM crm_interacoes WHERE cliente_id = ? ORDER BY id DESC LIMIT 1', cli.id);
  assert.equal(int.assunto, tarefa.titulo);
  assert.ok((await db.get('SELECT concluida_em FROM crm_tarefas WHERE id = ?', tarefa.id)).concluida_em);

  // Responsável fixo, filtro por equipe e valor mínimo.
  const fixo = await dir.post('/api/crm/automacoes', {
    nome: 'Fixo', gatilho: 'sem_compra', dias: 365, titulo: '{cliente}', responsavel: 'usuario', responsavel_id: (await db.get(`SELECT id FROM usuarios WHERE login = 'carlos'`)).id,
    valor_minimo: 999999999, limite: 10,
  });
  assert.equal((await dir.post(`/api/crm/automacoes/${fixo.id}/simular`)).encontrados, 0, 'valor mínimo filtra');
  await dir.put(`/api/crm/automacoes/${fixo.id}`, { valor_minimo: null });
  assert.ok((await dir.post(`/api/crm/automacoes/${fixo.id}/simular`)).encontrados >= 1);

  // Oportunidade parada e proposta sem retorno usam o responsável / vendedor.
  const op = await db.get(`SELECT id FROM crm_oportunidades WHERE estagio NOT IN ('ganha','perdida') LIMIT 1`);
  await db.run(`UPDATE crm_oportunidades SET updated_at = '2025-01-01 10:00:00' WHERE id = ?`, op.id);
  const parada = (await gerente.get('/api/crm/automacoes')).regras.find((r) => r.gatilho === 'oportunidade_parada');
  const r2 = await dir.post(`/api/crm/automacoes/${parada.id}/simular`);
  assert.ok(r2.encontrados >= 1);
  await dir.del(`/api/crm/automacoes/${fixo.id}`);
  assert.equal((await dir.req('PUT', `/api/crm/automacoes/${fixo.id}`, { nome: 'x' })).status, 404);

  // Execução automática diária (reserva do agendador) roda uma vez por dia.
  await db.run(`UPDATE crm_automacoes SET ultima_execucao = '2020-01-01 00:00:00'`);
  await ana.get('/api/crm/tarefas');
  const ult = await db.get(`SELECT MIN(ultima_execucao) AS u FROM crm_automacoes WHERE ativa = 1`);
  assert.ok(ult.u > '2020-01-02', 'rodou na primeira consulta do dia');
});

test('compras: solicitação, cotação, pedido, aprovação, recebimento com estoque e contas a pagar', async () => {
  const prod = await sessao('producao');
  const comp = await sessao('compras');
  const dir = await sessao('diretoria');
  const ana = await sessao('ana');
  const fin = await sessao('financeiro');
  assert.equal((await ana.req('GET', '/api/compras/solicitacoes')).status, 403, 'vendedor não acessa compras');

  const emb = await db.get('SELECT e.id, e.produto_id FROM produto_embalagens e ORDER BY id LIMIT 1');
  assert.equal((await prod.req('POST', '/api/compras/solicitacoes', { departamento: 'Produção', itens: [{ descricao: 'Luva', quantidade: 2 }] })).status, 400, 'item avulso exige categoria e unidade');
  assert.equal((await prod.req('POST', '/api/compras/solicitacoes', { departamento: 'Inventado', itens: [{ embalagem_id: emb.id, quantidade: 2 }] })).status, 400, 'departamento da lista');
  const sol = await prod.post('/api/compras/solicitacoes', {
    departamento: 'Produção', urgencia: 'alta', justificativa: 'Produção da semana',
    itens: [{ embalagem_id: emb.id, quantidade: 100 }, { descricao: 'Luva nitrílica', categoria: 'Material de consumo', unidade: 'PAR', quantidade: 20 }],
  });
  // Quem só solicita vê as próprias solicitações; o comprador vê todas.
  const prodId = (await db.get(`SELECT id FROM usuarios WHERE login = 'producao'`)).id;
  const minhas = await prod.get('/api/compras/solicitacoes?all=1');
  assert.ok(minhas.rows.length && minhas.rows.every((s) => s.solicitante_id === prodId));
  assert.ok((await comp.get('/api/compras/solicitacoes?all=1')).rows.some((s) => s.id === sol.id));
  assert.equal((await prod.req('POST', `/api/compras/solicitacoes/${sol.id}/cotacoes`, {})).status, 403, 'produção não cota');

  const det = await comp.get(`/api/compras/solicitacoes/${sol.id}`);
  const [i1, i2] = det.itens;
  const forns = (await comp.get('/api/compras/opcoes')).fornecedores;
  const q1 = await comp.post(`/api/compras/solicitacoes/${sol.id}/cotacoes`, { fornecedor_id: forns[0].id, frete: 100, prazo_entrega_dias: 5, parcelas: 2, prazo_pagamento_dias: 30, precos: { [i1.id]: 50, [i2.id]: 10 } });
  await comp.post(`/api/compras/solicitacoes/${sol.id}/cotacoes`, { fornecedor_id: forns[1].id, frete: 0, parcelas: 1, precos: { [i1.id]: 55, [i2.id]: 9 } });
  assert.equal((await comp.req('POST', `/api/compras/solicitacoes/${sol.id}/cotacoes`, { fornecedor_id: forns[0].id, precos: { [i1.id]: 1, [i2.id]: 1 } })).status, 400, 'uma cotação por fornecedor');
  const comCot = await comp.get(`/api/compras/solicitacoes/${sol.id}`);
  assert.equal(comCot.status, 'cotacao');
  assert.equal(comCot.cotacoes.length, 2);

  // Pedido de compra com a cotação vencedora: 100×50 + 20×10 + frete 100 = 5.300.
  const pc = await comp.post(`/api/compras/solicitacoes/${sol.id}/gerar-compra`, { cotacao_id: q1.id });
  const compra = await comp.get(`/api/compras/${pc.id}`);
  assert.equal(compra.valor_total, 5300);
  assert.equal(compra.parcelas, 2);
  assert.equal((await comp.get(`/api/compras/solicitacoes/${sol.id}`)).status, 'atendida');
  assert.equal((await db.get('SELECT vencedora FROM compra_cotacoes WHERE id = ?', q1.id)).vencedora, 1);

  // Limite de aprovação: acima de R$ 5.000 vai para a diretoria.
  assert.equal((await comp.req('PUT', '/api/compras/config', { 'compras.aprovacao_acima': 1000 })).status, 403, 'comprador não muda o limite');
  await dir.put('/api/compras/config', { 'compras.aprovacao_acima': 5000 });
  const env = await comp.post(`/api/compras/${pc.id}/enviar-aprovacao`);
  assert.equal(env.status, 'aprovacao');
  assert.equal((await comp.req('POST', `/api/compras/${pc.id}/aprovar`)).status, 403, 'comprador não aprova');
  assert.equal((await fin.req('POST', `/api/compras/${pc.id}/receber`, { nota_fiscal: '1', itens: [] })).status, 403, 'financeiro não recebe mercadoria');
  await dir.post(`/api/compras/${pc.id}/reprovar`, { motivo: 'Negociar frete' });
  assert.equal((await comp.get(`/api/compras/${pc.id}`)).status, 'rascunho');
  await comp.put(`/api/compras/${pc.id}`, { frete: 0 });
  assert.equal((await comp.get(`/api/compras/${pc.id}`)).valor_total, 5200);
  await comp.post(`/api/compras/${pc.id}/enviar-aprovacao`);
  await dir.post(`/api/compras/${pc.id}/aprovar`);
  await comp.post(`/api/compras/${pc.id}/enviar`);

  // Recebimento parcial: entra no estoque com custo e lote e gera as contas a pagar (2 parcelas).
  const saldo = async () => (await db.get('SELECT COALESCE(SUM(quantidade),0) AS s FROM estoque_movimentos WHERE empresa_id = 1 AND embalagem_id = ?', emb.id)).s;
  const antes = await saldo();
  const itens = (await comp.get(`/api/compras/${pc.id}`)).itens;
  const it1 = itens.find((i) => i.embalagem_id === emb.id);
  const it2 = itens.find((i) => !i.embalagem_id);
  assert.equal((await prod.req('POST', `/api/compras/${pc.id}/receber`, { nota_fiscal: '9001', itens: [{ item_id: it1.id, quantidade: 101 }] })).status, 400, 'não recebe mais que o pedido');
  const rec = await prod.post(`/api/compras/${pc.id}/receber`, { nota_fiscal: '9001', itens: [{ item_id: it1.id, quantidade: 60, lote: 'L-COMPRA', validade: '2028-05-01' }] });
  assert.equal(rec.status, 'parcial');
  assert.equal(rec.valor, 3000);
  assert.equal(rec.contas.length, 2);
  assert.equal(await saldo(), antes + 60);
  const mov = await db.get(`SELECT * FROM estoque_movimentos WHERE compra_id = ? ORDER BY id DESC LIMIT 1`, pc.id);
  assert.equal(mov.lote, 'L-COMPRA');
  assert.equal(mov.custo_unitario, 50);
  assert.equal(mov.origem, 'compra');
  const contas = await fin.get('/api/pagar?all=1');
  assert.ok(contas.rows.some((c) => c.descricao.startsWith(`Compra ${pc.numero} · NF 9001`)), 'financeiro vê a conta da compra');
  const cp = await db.all('SELECT * FROM contas_pagar WHERE compra_id = ? ORDER BY vencimento', pc.id);
  assert.equal(cp.length, 2);
  assert.equal(cp.reduce((a, c) => a + c.valor, 0), 3000);
  assert.equal(cp[0].categoria, 'Matéria-prima');
  assert.equal((await comp.req('POST', `/api/compras/${pc.id}/cancelar`, { motivo: 'x' })).status, 400, 'com recebimento não cancela');

  const fim = await prod.post(`/api/compras/${pc.id}/receber`, { nota_fiscal: '9002', itens: [{ item_id: it1.id, quantidade: 40 }, { item_id: it2.id, quantidade: 20 }] });
  assert.equal(fim.status, 'recebida');
  const comp2 = await comp.get(`/api/compras/${pc.id}`);
  assert.equal(comp2.recebimentos.length, 2);
  assert.equal(comp2.contas.length, 4);

  // Compra direta (sem solicitação) abaixo do limite é aprovada sozinha.
  const direta = await comp.post('/api/compras', { fornecedor_id: forns[0].id, itens: [{ descricao: 'Graxa', categoria: 'Manutenção', unidade: 'KG', quantidade: 5, preco_unitario: 30 }] });
  assert.equal((await comp.post(`/api/compras/${direta.id}/enviar-aprovacao`)).status, 'aprovada');
  await comp.post(`/api/compras/${direta.id}/cancelar`, { motivo: 'Comprado em outra loja' });
  assert.equal((await comp.get(`/api/compras/${direta.id}`)).status, 'cancelada');

  // Reposição: item abaixo do mínimo vira sugestão e solicitação.
  await db.run('UPDATE produto_embalagens SET estoque_minimo = 999999 WHERE id = ?', emb.id);
  const rep = await comp.get('/api/compras/reposicao');
  const sug = rep.find((x) => x.embalagem_id === emb.id);
  assert.ok(sug && sug.sugerido > 0 && sug.ultimo_custo === 50 && sug.ultimo_fornecedor);
  const sr = await prod.post('/api/compras/reposicao/solicitar', { itens: [{ embalagem_id: emb.id, quantidade: sug.sugerido }] });
  const nova = await comp.get(`/api/compras/solicitacoes/${sr.id}`);
  assert.equal(nova.origem, 'reposicao');
  assert.ok(['alta', 'urgente'].includes(nova.urgencia));
  assert.ok(!(await comp.get('/api/compras/reposicao')).some((x) => x.embalagem_id === emb.id), 'o que já foi solicitado não é sugerido de novo');
  await db.run('UPDATE produto_embalagens SET estoque_minimo = 0 WHERE id = ?', emb.id);

  const resumo = await comp.get('/api/compras/resumo');
  assert.ok(resumo.recebido_mes >= 5200);
  const cont = await dir.get('/api/compras/contagem');
  assert.ok('aprovacao' in cont);
  const painel = await comp.get('/api/dashboard');
  assert.equal(painel.perfil, 'compras');
  assert.ok(painel.cards.some((c) => c.label === 'Aguardando aprovação'));
});
