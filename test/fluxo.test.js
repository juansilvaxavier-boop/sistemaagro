const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

async function criarPedido(vend, extra = {}) {
  const op = await vend.get('/api/cadastros/opcoes');
  const clientes = await vend.get('/api/clientes?pageSize=50');
  const cliente = clientes.rows.find((c) => !c.blacklist);
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id && c.parcelas === 3);
  const precos = await vend.get(`/api/cadastros/produtos/${op.produtos[0].id}/precos`);
  return vend.post('/api/pedidos', {
    cliente_id: cliente.id, forma_id: forma.id, condicao_id: cond.id, tipo_entrega: 'transportadora', cultura: 'Café', area_ha: 50, origem_venda: 'Indicação de cliente',
    itens: [{ produto_id: op.produtos[0].id, embalagem_id: precos.embalagens[0].id, quantidade: 100 }],
    ...extra,
  });
}

test('pedido percorre todas as etapas até a entrega', async () => {
  const ana = await sessao('ana');
  const carlos = await sessao('carlos');
  const analise = await sessao('analise');
  const diretoria = await sessao('diretoria');
  const producao = await sessao('producao');
  const faturamento = await sessao('faturamento');
  const expedicao = await sessao('expedicao');

  const { id } = await criarPedido(ana);
  let p = (await ana.get(`/api/pedidos/${id}`)).pedido;
  assert.equal(p.etapa, 'venda');
  assert.ok(p.valor_total > 0);
  assert.ok(p.endereco_entrega_id, 'endereço principal é usado por padrão');

  assert.equal((await ana.post(`/api/pedidos/${id}/acao`, { acao: 'enviar' })).destino, 'supervisao');
  assert.equal((await carlos.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' })).destino, 'analise');

  // Análise exige Serasa e frete
  let r = await analise.req('POST', `/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /Serasa/);
  const det = await analise.get(`/api/pedidos/${id}`);
  await analise.post(`/api/clientes/${det.cliente.id}/serasa`, { pedido_id: id, justificativa: 'Nova safra' });
  r = await analise.req('POST', `/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  assert.match(r.dados.erro, /frete/);
  const op = await analise.get('/api/cadastros/opcoes');
  await analise.put(`/api/pedidos/${id}/frete`, { tipo_entrega: 'transportadora', transportadora_id: op.transportadoras[0].id, frete_codigo_cotacao: 'C1', frete_prazo_dias: 3, frete_valor: 500 });
  assert.equal((await analise.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' })).destino, 'diretoria');

  assert.equal((await diretoria.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' })).destino, 'producao');
  const comissoes = await db.all('SELECT * FROM pedido_comissoes WHERE pedido_id = ?', id);
  assert.deepEqual(comissoes.map((c) => c.papel).sort(), ['gerente', 'supervisor', 'vendedor'], 'vendedor, supervisor e gerente recebem pela regra');

  // Produção exige lote
  r = await producao.req('POST', `/api/pedidos/${id}/acao`, { acao: 'concluir' });
  assert.match(r.dados.erro, /lote/);
  const itens = (await producao.get(`/api/pedidos/${id}`)).itens;
  await producao.put(`/api/pedidos/${id}/producao`, { itens: itens.map((i) => ({ id: i.id, lote: 'L-TESTE' })) });
  assert.equal((await producao.post(`/api/pedidos/${id}/acao`, { acao: 'concluir' })).destino, 'faturamento');

  const fat = await faturamento.post(`/api/pedidos/${id}/acao`, { acao: 'faturar' });
  assert.equal(fat.destino, 'expedicao');
  assert.ok(fat.nota.numero);
  assert.equal(fat.nota.chave.length, 44);
  const parcelas = await db.all('SELECT * FROM parcelas WHERE pedido_id = ? ORDER BY numero', id);
  p = await db.get('SELECT * FROM pedidos WHERE id = ?', id);
  assert.equal(parcelas.length, 3);
  assert.equal(Math.round(parcelas.reduce((a, x) => a + x.valor, 0) * 100), Math.round(p.valor_total * 100));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM comissoes WHERE pedido_id = ?', id)).n, 3);

  r = await expedicao.req('POST', `/api/pedidos/${id}/acao`, { acao: 'embarcar' });
  assert.equal(r.status, 400);
  await expedicao.put(`/api/pedidos/${id}/expedicao`, { data_embarque: '2026-10-23', data_entrega_prevista: '2026-10-27' });
  assert.equal((await expedicao.post(`/api/pedidos/${id}/acao`, { acao: 'embarcar' })).destino, 'transito');
  await expedicao.put(`/api/pedidos/${id}/expedicao`, { data_entrega: '2026-10-26' });
  assert.equal((await expedicao.post(`/api/pedidos/${id}/acao`, { acao: 'entregar' })).destino, 'entregue');

  const hist = (await diretoria.get(`/api/pedidos/${id}`)).historico.filter((h) => h.etapa_origem !== h.etapa_destino).map((h) => h.etapa_destino);
  assert.deepEqual(hist, ['venda', 'supervisao', 'analise', 'diretoria', 'producao', 'faturamento', 'expedicao', 'transito', 'entregue']);
});

test('equipe sem supervisor pula supervisão e pagamento à vista passa pela cobrança', async () => {
  const helena = await sessao('helena');
  const op = await helena.get('/api/cadastros/opcoes');
  const forma = op.formas.find((f) => f.tipo === 'a_vista');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id);
  const { id } = await criarPedido(helena, { forma_id: forma.id, condicao_id: cond.id, tipo_entrega: 'retirada' });
  assert.equal((await helena.post(`/api/pedidos/${id}/acao`, { acao: 'enviar' })).destino, 'analise');
  const analise = await sessao('analise');
  const cli = (await db.get('SELECT cliente_id FROM pedidos WHERE id = ?', id)).cliente_id;
  await analise.post(`/api/clientes/${cli}/serasa`, { justificativa: 'teste' });
  await analise.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' });
  const dir = await sessao('diretoria');
  assert.equal((await dir.post(`/api/pedidos/${id}/acao`, { acao: 'aprovar' })).destino, 'cobranca');
  const fin = await sessao('financeiro');
  assert.equal((await fin.post(`/api/pedidos/${id}/acao`, { acao: 'confirmar_pagamento' })).destino, 'producao');
  const p = await db.get('SELECT * FROM pedidos WHERE id = ?', id);
  assert.ok(p.pagamento_confirmado_em);
  assert.ok((await db.get('SELECT valor_desconto > 0 AS d FROM pedidos WHERE id = ?', id)).d, 'desconto da condição à vista aplicado');
});

test('blacklist bloqueia novos pedidos e alerta não bloqueia', async () => {
  const fin = await sessao('financeiro');
  const ana = await sessao('ana');
  const cli = (await ana.get('/api/clientes?pageSize=50')).rows.find((c) => !c.blacklist);
  await fin.post('/api/clientes/blacklist', { cliente_id: cli.id, tipo: 'alerta', motivo: 'Atenção' });
  const op = await ana.get('/api/cadastros/opcoes');
  const ok = await ana.req('POST', '/api/pedidos', { cliente_id: cli.id, itens: [] });
  assert.equal(ok.status, 201);
  const bl = await fin.post('/api/clientes/blacklist', { cliente_id: cli.id, tipo: 'bloqueio', motivo: 'Cheque devolvido' });
  const r = await ana.req('POST', '/api/pedidos', { cliente_id: cli.id, forma_id: op.formas[0].id, itens: [] });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /bloqueado/);
  await fin.post(`/api/clientes/blacklist/${bl.id}/excluir`, { motivo: 'Regularizado' });
  const lista = await fin.get('/api/clientes/blacklist/lista?all=1&f_ativo=0');
  assert.ok(lista.rows.some((x) => x.id === bl.id && x.motivo_exclusao === 'Regularizado' && x.usuario_exclusao));
});

test('vendedor só vê os próprios pedidos e clientes', async () => {
  const ana = await sessao('ana');
  const pedidos = await ana.get('/api/pedidos/progressao?all=1');
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  assert.ok(pedidos.rows.length > 0);
  assert.ok(pedidos.rows.every((p) => p.vendedor === 'Ana Souza'));
  const outro = await db.get('SELECT id FROM pedidos WHERE vendedor_id <> ? LIMIT 1', anaId);
  assert.equal((await ana.req('GET', `/api/pedidos/${outro.id}`)).status, 404);
  const clientes = await ana.get('/api/clientes?all=1');
  assert.ok(clientes.rows.every((c) => c.vendedor_id === anaId));
  assert.equal((await ana.req('GET', '/api/financeiro/parcelas')).status, 403);
});

test('filtro por coluna, paginação e exportação para Excel', async () => {
  const d = await sessao('diretoria');
  const pg = await d.get('/api/pedidos/progressao?pageSize=5&page=2');
  assert.equal(pg.rows.length, 5);
  assert.equal(pg.page, 2);
  const filtrado = await d.get('/api/pedidos/progressao?f_etapa=entregue&pageSize=500');
  assert.ok(filtrado.rows.every((r) => r.etapa === 'entregue'));
  const data = filtrado.rows[0].data.slice(0, 10).split('-').reverse().join('/');
  const porData = await d.get(`/api/pedidos/progressao?f_data=${encodeURIComponent(data)}`);
  assert.ok(porData.total >= 1, 'filtro aceita data no formato dd/mm/aaaa');
  const x = await d.req('GET', `/api/pedidos/progressao?export=xlsx&title=Teste&cols=${encodeURIComponent(JSON.stringify([{ k: 'numero', l: 'Nº' }, { k: 'valor', l: 'Valor', t: 'money' }]))}`);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.equal(x.dados.subarray(0, 2).toString(), 'PK');
  const rel = await d.req('GET', '/api/relatorios/vendas?export=xlsx');
  assert.equal(rel.dados.subarray(0, 2).toString(), 'PK');
});

test('financeiro: baixa com atraso aplica penalidade de comissão e negativação segue o ciclo', async () => {
  const fin = await sessao('financeiro');
  const vencida = await db.get(
    `SELECT p.* FROM parcelas p JOIN pedidos pe ON pe.id = p.pedido_id JOIN formas_pagamento f ON f.id = pe.forma_id
      WHERE p.status = 'a_pagar' AND p.vencimento < date('now','localtime','-20 days') AND f.nome = 'Boleto bancário'
        AND EXISTS (SELECT 1 FROM comissoes c WHERE c.pedido_id = p.pedido_id AND c.status = 'aberta') LIMIT 1`,
  );
  if (vencida) {
    await fin.post(`/api/financeiro/parcelas/${vencida.id}/baixa`, { tipo_baixa: 'PIX' });
    const c = await db.get('SELECT * FROM comissoes WHERE pedido_id = ? LIMIT 1', vencida.pedido_id);
    assert.ok(c.perda_pct >= 25, `perda aplicada: ${c.perda_pct}`);
    assert.equal((await db.get('SELECT status FROM parcelas WHERE id = ?', vencida.id)).status, 'liquidada');
  }
  const outra = await db.get(`SELECT * FROM parcelas WHERE status = 'a_pagar' AND vencimento < date('now','localtime') AND id NOT IN (SELECT parcela_id FROM negativacoes) LIMIT 1`);
  const { id } = await fin.post(`/api/financeiro/parcelas/${outra.id}/serasa`);
  const inval = await fin.req('POST', `/api/financeiro/negativacoes/${id}/status`, { status: 'baixa_aceita' });
  assert.equal(inval.status, 400);
  await fin.post(`/api/financeiro/negativacoes/${id}/status`, { status: 'inclusao_aceita' });
  await fin.post(`/api/financeiro/parcelas/${outra.id}/baixa`, {});
  assert.equal((await db.get('SELECT status FROM negativacoes WHERE id = ?', id)).status, 'baixa_solicitada', 'quitação pede baixa no Serasa');
});

test('cobrança: acordo substitui parcelas e devolução abate saldo', async () => {
  const fin = await sessao('financeiro');
  const carteira = await fin.get('/api/cobranca/carteira?all=1');
  assert.ok(carteira.rows.length > 0);
  const cli = carteira.rows[0];
  const det = await fin.get(`/api/cobranca/cliente/${cli.id}`);
  const ids = det.parcelas.map((p) => p.id);
  const saldo = det.parcelas.reduce((a, p) => a + p.saldo, 0);
  await fin.post('/api/cobranca/acoes', { cliente_id: cli.id, tipo: 'ligacao', resultado: 'promessa', data_promessa: '2026-11-10', valor_promessa: 100 });
  const ac = await fin.post('/api/cobranca/acordos', { cliente_id: cli.id, parcelas: ids, desconto: 10, num_parcelas: 2, primeiro_vencimento: '2026-11-30' });
  assert.equal(Math.round(ac.valor_acordo * 100), Math.round((saldo - 10) * 100));
  const depois = await fin.get(`/api/cobranca/cliente/${cli.id}`);
  assert.equal(depois.parcelas.length, 2);
  for (const i of ids) assert.equal((await db.get('SELECT status FROM parcelas WHERE id = ?', i)).status, 'negociada');
  const crm = (await db.get(`SELECT COUNT(*) AS n FROM crm_interacoes WHERE cliente_id = ? AND assunto LIKE 'Cobrança%'`, cli.id)).n;
  assert.ok(crm >= 1, 'ação de cobrança entra no histórico do CRM');

  const nota = await db.get(`SELECT n.* FROM notas_fiscais n WHERE status = 'autorizada' AND EXISTS (SELECT 1 FROM parcelas p WHERE p.nota_id = n.id AND p.status = 'a_pagar' AND p.valor_pago = 0) LIMIT 1`);
  const antes = (await db.get(`SELECT SUM(valor) AS v FROM parcelas WHERE nota_id = ? AND status = 'a_pagar'`, nota.id)).v;
  await fin.post('/api/financeiro/devolucoes', { nota_id: nota.id, motivo: 'Avaria', valor: 100, baixa_parcelas: true });
  const dep = (await db.get(`SELECT SUM(valor) AS v FROM parcelas WHERE nota_id = ? AND status = 'a_pagar'`, nota.id)).v;
  assert.equal(Math.round((antes - dep) * 100), 10000);
  assert.equal((await db.get('SELECT status FROM notas_fiscais WHERE id = ?', nota.id)).status, 'devolvida_parcial');
});

test('nota fiscal: carta de correção e cancelamento', async () => {
  const fin = await sessao('faturamento');
  const nota = await db.get(`SELECT * FROM notas_fiscais WHERE status = 'autorizada' AND NOT EXISTS (SELECT 1 FROM parcelas p WHERE p.nota_id = notas_fiscais.id AND p.valor_pago > 0) ORDER BY id DESC LIMIT 1`);
  const cce = await fin.post(`/api/financeiro/notas/${nota.id}/carta-correcao`, { texto: 'Correção do endereço de entrega do destinatário' });
  assert.equal(cce.sequencia, 1);
  const curto = await fin.req('POST', `/api/financeiro/notas/${nota.id}/cancelar`, { motivo: 'curto' });
  assert.equal(curto.status, 400);
  await fin.post(`/api/financeiro/notas/${nota.id}/cancelar`, { motivo: 'Erro na emissão da nota fiscal', extemporaneo: true });
  assert.equal((await db.get('SELECT status FROM notas_fiscais WHERE id = ?', nota.id)).status, 'cancelada');
  assert.equal((await db.get('SELECT etapa FROM pedidos WHERE id = ?', nota.pedido_id)).etapa, 'faturamento', 'pedido volta para faturar');
  assert.ok((await db.all('SELECT status FROM parcelas WHERE nota_id = ?', nota.id)).every((p) => p.status === 'cancelada'));
});

test('CRM, mensagens, arquivos e dashboards por perfil', async () => {
  const ana = await sessao('ana');
  const cli = (await ana.get('/api/clientes?pageSize=1')).rows[0];
  await ana.post('/api/crm/interacoes', { cliente_id: cli.id, tipo: 'visita', assunto: 'Visita técnica', proxima_tarefa: 'Enviar proposta', proxima_data: '2026-11-01' });
  const op = await ana.post('/api/crm/oportunidades', { cliente_id: cli.id, titulo: 'Programa foliar', valor_estimado: 50000 });
  assert.equal((await ana.req('PUT', `/api/crm/oportunidades/${op.id}`, { estagio: 'perdida' })).status, 400);
  await ana.put(`/api/crm/oportunidades/${op.id}`, { estagio: 'proposta' });
  const v360 = await ana.get(`/api/crm/cliente/${cli.id}`);
  assert.ok(v360.timeline.some((t) => t.titulo === 'Visita técnica'));
  assert.ok(v360.tarefas.some((t) => t.titulo === 'Enviar proposta'));

  const pedido = await db.get('SELECT p.id, p.numero FROM pedidos p JOIN usuarios u ON u.id = p.vendedor_id WHERE u.login = ? LIMIT 1', 'ana');
  await ana.post('/api/mensagens', { pedido_numero: pedido.numero, setor_destino: 'analista', texto: 'Prioridade, por favor' });
  const analise = await sessao('analise');
  const nl = await analise.get('/api/mensagens/nao-lidas');
  assert.ok(nl.n >= 1);
  const msgs = await analise.get('/api/mensagens');
  const m = msgs.find((x) => x.texto === 'Prioridade, por favor');
  assert.equal(m.pedido_numero, pedido.numero);
  await analise.post(`/api/mensagens/${m.id}/lida`);
  assert.equal((await analise.get('/api/mensagens/nao-lidas')).n, nl.n - 1);

  const fd = new FormData();
  fd.append('arquivos', new Blob(['%PDF-1.4 contrato'], { type: 'application/pdf' }), 'contrato.pdf');
  fd.append('pedido_id', pedido.id);
  fd.append('categoria', 'Contrato');
  const up = await ana.req('POST', '/api/arquivos', fd);
  assert.equal(up.status, 201);
  const lista = await ana.get(`/api/arquivos?pedido_id=${pedido.id}`);
  assert.equal(lista.rows[0].nome_original, 'contrato.pdf');
  const dl = await ana.req('GET', `/api/arquivos/${lista.rows[0].id}/download`);
  assert.equal(dl.dados.toString(), '%PDF-1.4 contrato');
  const ruim = new FormData();
  ruim.append('arquivos', new Blob(['x']), 'virus.exe');
  ruim.append('pedido_id', pedido.id);
  assert.equal((await ana.req('POST', '/api/arquivos', ruim)).status, 400);
  const bruno = await sessao('bruno');
  assert.equal((await bruno.req('GET', `/api/arquivos/${lista.rows[0].id}/download`)).status, 403, 'arquivo de pedido de outro vendedor');

  for (const login of ['ana', 'carlos', 'analise', 'diretoria', 'producao', 'faturamento', 'expedicao', 'financeiro']) {
    const s = await sessao(login);
    const d = await s.get('/api/dashboard');
    assert.ok(d.cards.length >= 4, `painel de ${login}`);
    assert.ok(d.graficos.length >= 1);
  }
});

test('segurança: login inválido, CSRF e permissões', async () => {
  const { iniciar } = require('./helpers');
  const base = await iniciar();
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'agroterra' }, body: JSON.stringify({ login: 'ana', senha: 'errada' }) });
  assert.equal(r.status, 401);
  const semHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'ana', senha: 'agro123' }) });
  assert.equal(semHeader.status, 403);
  assert.equal((await fetch(base + '/api/pedidos/contagem')).status, 401);
  const prod = await sessao('producao');
  assert.equal((await prod.req('GET', '/api/cadastros/usuarios')).status, 403);
  assert.equal((await prod.req('GET', '/api/pedidos/fila/analise')).status, 403);
  const p = await db.get(`SELECT id FROM pedidos WHERE etapa = 'analise' LIMIT 1`);
  assert.equal((await prod.req('POST', `/api/pedidos/${p.id}/acao`, { acao: 'aprovar' })).status, 403);
});
