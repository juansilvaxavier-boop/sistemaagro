// Metas e campanhas, tabelas de preço regionais, limite de crédito, tesouraria, calendário da safra,
// rastreio automático e análises (ABC, recompra, demanda).
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');
const S = require('../server/services');

test.after(parar);

const mes = () => S.hoje().slice(0, 7);

test('metas: definir, realizado, projeção, copiar, ranking e campanhas', async () => {
  const gerente = await sessao('gerente');
  const ana = await sessao('ana');
  const carlos = await sessao('carlos');
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  assert.equal((await ana.req('PUT', '/api/metas', { periodo: mes(), metas: [] })).status, 403, 'vendedor não define meta');
  await gerente.put('/api/metas', { periodo: mes(), metas: [
    { escopo: 'vendedor', alvo_id: anaId, indicador: 'valor', meta: 100000 }, { escopo: 'empresa', indicador: 'valor', meta: 2000000 },
    { escopo: 'vendedor', alvo_id: anaId, indicador: 'pedidos', meta: 10 },
  ] });
  const minhas = await ana.get(`/api/metas?periodo=${mes()}`);
  assert.ok(minhas.linhas.every((l) => l.escopo !== 'empresa'), 'vendedor não vê a meta da empresa');
  const eu = minhas.linhas.find((l) => l.escopo === 'vendedor' && l.alvo_id === anaId);
  assert.equal(eu.meta.valor, 100000);
  const real = await db.get(`SELECT COALESCE(SUM(valor_total),0) AS v FROM pedidos WHERE vendedor_id = ? AND empresa_id = 1 AND etapa NOT IN ('venda','cancelado') AND created_at >= ?`, anaId, `${mes()}-01`);
  assert.equal(Math.round(eu.realizado.valor), Math.round(real.v));
  assert.ok(minhas.linhas.every((l) => l.escopo !== 'vendedor' || l.alvo_id === anaId), 'vendedor só vê a própria linha');
  const sup = await carlos.get(`/api/metas?periodo=${mes()}`);
  assert.ok(sup.linhas.some((l) => l.escopo === 'equipe') && sup.linhas.some((l) => l.alvo_id === anaId));
  const tudo = await gerente.get(`/api/metas?periodo=${mes()}`);
  assert.equal(tudo.linhas.find((l) => l.escopo === 'empresa').meta.valor, 2000000);

  const prox = S.addDias(`${mes()}-28`, 5).slice(0, 7);
  assert.equal((await gerente.post('/api/metas/copiar', { de: mes(), para: prox, reajuste_pct: 10 })).copiadas, 3);
  const copiada = await db.get(`SELECT meta FROM metas WHERE periodo = ? AND escopo = 'vendedor' AND alvo_id = ? AND indicador = 'valor'`, prox, anaId);
  assert.equal(copiada.meta, 110000);
  await gerente.put('/api/metas', { periodo: prox, metas: [{ escopo: 'vendedor', alvo_id: anaId, indicador: 'pedidos', meta: '' }] });
  assert.equal((await db.get(`SELECT COUNT(*) AS n FROM metas WHERE periodo = ? AND indicador = 'pedidos'`, prox)).n, 0, 'meta vazia apaga');

  const ranking = await ana.get(`/api/metas/ranking?periodo=${mes()}`);
  const minha = ranking.find((x) => x.eu);
  assert.ok(minha && minha.pct != null);
  assert.ok(ranking.filter((x) => !x.eu).every((x) => x.valor === null), 'valores dos colegas ficam ocultos');

  const prod = await db.get('SELECT id FROM produtos ORDER BY id LIMIT 1');
  const c = await gerente.post('/api/metas/campanhas', { nome: 'Campanha teste', inicio: `${mes()}-01`, fim: `${mes()}-28`, indicador: 'valor', produto_id: prod.id, meta_individual: 1000, premio: 'Viagem' });
  assert.equal((await gerente.req('POST', '/api/metas/campanhas', { nome: 'x', inicio: '2026-05-10', fim: '2026-05-01' })).status, 400);
  const lista = await ana.get('/api/metas/campanhas');
  const camp = lista.find((x) => x.id === c.id);
  assert.ok(camp.placar.length > 0 && camp.placar.some((p) => p.eu));
  await gerente.del(`/api/metas/campanhas/${c.id}`);
});

test('tabela de preço regional: preço por UF no pedido e na proposta, reajuste e cópia', async () => {
  const dir = await sessao('diretoria');
  const ana = await sessao('ana');
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  const cli = await db.get(
    `SELECT c.id, e.uf FROM clientes c JOIN cliente_enderecos e ON e.cliente_id = c.id
      WHERE c.vendedor_id = ? AND e.uf IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1) ORDER BY c.id LIMIT 1`, anaId,
  );
  const emb = await db.get(`SELECT e.id, e.produto_id, pp.valor FROM produto_embalagens e JOIN produto_precos pp ON pp.embalagem_id = e.id AND pp.forma_id IS NULL ORDER BY e.id LIMIT 1`);
  const outra = await db.get(`SELECT e.id, e.produto_id, pp.valor FROM produto_embalagens e JOIN produto_precos pp ON pp.embalagem_id = e.id AND pp.forma_id IS NULL WHERE e.id <> ? ORDER BY e.id LIMIT 1`, emb.id);
  assert.equal((await ana.req('POST', '/api/precos/tabelas', {})).status, 403, 'vendedor não cadastra tabela');
  assert.equal((await dir.req('POST', '/api/precos/tabelas', { nome: 'X', vigencia_inicio: '2026-01-01', ufs: ['ZZ'] })).status, 400);
  const t = await dir.post('/api/precos/tabelas', {
    nome: 'Tabela regional teste', safra: '26/27', ufs: [cli.uf], vigencia_inicio: S.addDias(S.hoje(), -1), ajuste_pct: 10, prioridade: 5,
    itens: [{ embalagem_id: emb.id, valor: 999.9 }],
  });
  const grade = await dir.get(`/api/precos/tabelas/${t.id}`);
  assert.equal(grade.grade.find((g) => g.embalagem_id === emb.id).final, 999.9, 'preço próprio');
  assert.equal(grade.grade.find((g) => g.embalagem_id === outra.id).final, S.r2(outra.valor * 1.1), 'ajuste geral');

  const precos = await ana.get(`/api/cadastros/produtos/${emb.produto_id}/precos?cliente_id=${cli.id}`);
  assert.equal(precos.tabela.id, t.id);
  assert.equal(precos.precos.find((p) => p.embalagem_id === emb.id && !p.forma_id).valor, 999.9);
  const outraUf = cli.uf === 'SP' ? 'RS' : 'SP';
  assert.notEqual((await ana.get(`/api/cadastros/produtos/${emb.produto_id}/precos?uf=${outraUf}`)).tabela?.id, t.id, 'outra UF não usa a tabela');

  const op = await ana.get('/api/cadastros/opcoes');
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id);
  const sem = await db.get('SELECT COUNT(*) AS n FROM produto_precos WHERE embalagem_id = ? AND forma_id = ?', emb.id, forma.id);
  const ped = await ana.post('/api/pedidos', {
    cliente_id: cli.id, forma_id: sem.n ? null : forma.id, condicao_id: sem.n ? null : cond.id, tipo_entrega: 'transportadora', cultura: 'Café', area_ha: 10, origem_venda: 'Indicação de cliente',
    itens: [{ produto_id: emb.produto_id, embalagem_id: emb.id, quantidade: 2 }],
  });
  const item = await db.get('SELECT valor_tabela, valor_unitario, tabela_preco_id FROM pedido_itens WHERE pedido_id = ?', ped.id);
  assert.equal(item.valor_tabela, 999.9, 'pedido usa a tabela da UF de entrega');
  assert.equal(item.tabela_preco_id, t.id);

  await dir.post(`/api/precos/tabelas/${t.id}/reajustar`, { pct: 10 });
  const depois = await dir.get(`/api/precos/tabelas/${t.id}`);
  assert.equal(depois.grade.find((g) => g.embalagem_id === emb.id).proprio, S.r2(999.9 * 1.1));
  assert.equal(depois.ajuste_pct, 21, 'ajuste composto: 1,1 × 1,1');
  const copia = await dir.post(`/api/precos/tabelas/${t.id}/copiar`, { nome: 'Safra seguinte', safra: '27/28', vigencia_inicio: S.addDias(S.hoje(), 200) });
  assert.ok((await dir.get(`/api/precos/tabelas/${copia.id}`)).grade.find((g) => g.embalagem_id === emb.id).proprio > 0);
  const vig = await dir.get(`/api/precos/vigente?uf=${cli.uf}`);
  assert.equal(vig.id, t.id, 'a cópia ainda não está vigente');
  const del = await dir.del(`/api/precos/tabelas/${t.id}`);
  assert.equal(del.desativada, true, 'tabela usada em pedido é só desativada');
});

test('crédito: exposição, bloqueio na análise, liberação, sugerido e limite automático', async () => {
  const analise = await sessao('analise');
  const dir = await sessao('diretoria');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/credito/clientes')).status, 403);
  const p = await db.get(`SELECT p.* FROM pedidos p JOIN formas_pagamento f ON f.id = p.forma_id WHERE p.etapa = 'analise' AND f.tipo <> 'a_vista' AND p.empresa_id = 1 ORDER BY p.id LIMIT 1`);
  assert.ok(p, 'pedido a prazo na análise');
  await db.run(`UPDATE pedidos SET frete_ignorado = 1, frete_motivo_ignorar = 'teste' WHERE id = ?`, p.id);
  await db.run(`INSERT INTO consultas_serasa (cliente_id, score, resultado) VALUES (?, 800, 'Aprovado')`, p.cliente_id);
  await db.run('UPDATE clientes SET limite_credito = 1 WHERE id = ?', p.cliente_id);
  const sit = await analise.get(`/api/credito/clientes/${p.cliente_id}`);
  assert.ok(['excedido', 'atraso'].includes(sit.status));
  assert.ok(sit.bloqueios.some((b) => /passa do limite/.test(b)));
  const det = await analise.get(`/api/pedidos/${p.id}`);
  assert.ok(det.credito_situacao.bloqueios.length > 0);
  assert.equal(det.credito_situacao.pode_liberar, false, 'analista não libera');
  const r = await analise.req('POST', `/api/pedidos/${p.id}/acao`, { acao: 'aprovar' });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /Crédito bloqueado/);
  assert.equal((await analise.req('POST', `/api/credito/pedidos/${p.id}/liberar`, { justificativa: 'Cliente antigo e bom pagador' })).status, 403);
  assert.equal((await dir.req('POST', `/api/credito/pedidos/${p.id}/liberar`, { justificativa: 'curta' })).status, 400);
  await dir.post(`/api/credito/pedidos/${p.id}/liberar`, { justificativa: 'Cliente antigo e bom pagador, garantia em safra' });
  assert.ok((await analise.post(`/api/pedidos/${p.id}/acao`, { acao: 'aprovar' })).destino);
  assert.ok((await db.get(`SELECT 1 AS x FROM pedido_historico WHERE pedido_id = ? AND acao = 'Crédito liberado'`, p.id)));

  // Limite manual, sugerido em lote e automático.
  const lista = await analise.get('/api/credito/clientes?all=1&ativos=1');
  assert.ok(lista.rows.length > 0 && lista.rows.every((x) => 'sugerido' in x));
  const comCompra = lista.rows.find((x) => x.compras_12m > 0 && x.sugerido > 0);
  assert.ok(comCompra, 'algum cliente com sugerido');
  await analise.put(`/api/credito/clientes/${comCompra.id}`, { automatico: 1 });
  const c1 = await db.get('SELECT limite_credito, limite_automatico FROM clientes WHERE id = ?', comCompra.id);
  assert.equal(c1.limite_automatico, 1);
  assert.equal(c1.limite_credito, comCompra.sugerido);
  await db.run('UPDATE clientes SET limite_credito = 1 WHERE id = ?', comCompra.id);
  const auto = await require('../server/credito').atualizarAutomaticos();
  assert.ok(auto.alterados >= 1, 'rotina diária recalcula os automáticos');
  await analise.put('/api/credito/regras', { 'credito.dias_atraso_bloqueio': 30, 'credito.sem_limite': 'liberar' });
  assert.equal((await analise.req('PUT', '/api/credito/regras', { 'credito.sem_limite': 'talvez' })).status, 400);
  const ap = await analise.post('/api/credito/aplicar-sugerido', { ids: [comCompra.id] });
  assert.equal(ap.atualizados, 1);
});

test('tesouraria: OFX, conciliação automática e manual, conta de tarifa, fluxo e resultado', async () => {
  const fin = await sessao('financeiro');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/tesouraria/fluxo')).status, 403);
  const parc = await db.get(`SELECT p.id, ${S.SALDO_PARCELA_SQL} AS saldo, p.vencimento FROM parcelas p WHERE p.empresa_id = 1 AND p.status = 'a_pagar' AND p.vencimento >= date('now','localtime') ORDER BY p.vencimento LIMIT 1`);
  const conta = await db.get(`SELECT c.id, c.valor - COALESCE(c.valor_pago,0) AS saldo, c.vencimento FROM contas_pagar c WHERE c.empresa_id = 1 AND c.status = 'a_pagar' AND c.vencimento >= date('now','localtime') ORDER BY c.vencimento LIMIT 1`);
  const d = (iso) => iso.replace(/-/g, '');
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>756<ACCTID>12345</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${d(S.addDias(S.hoje(), -5))}<DTEND>${d(S.hoje())}
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${d(parc.vencimento)}120000<TRNAMT>${parc.saldo.toFixed(2)}<FITID>T1<MEMO>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d(conta.vencimento)}<TRNAMT>-${conta.saldo.toFixed(2)}<FITID>T2<MEMO>PAGTO BOLETO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d(S.hoje())}<TRNAMT>-37.45<FITID>T3<MEMO>TARIFA PACOTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${d(S.hoje())}<TRNAMT>12345.67<FITID>T4<MEMO>TED SEM IDENTIFICACAO</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>150000.00<DTASOF>${d(S.hoje())}</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const fd = new FormData();
  fd.append('arquivo', new Blob([ofx], { type: 'application/x-ofx' }), 'extrato.ofx');
  const imp = await fin.post('/api/tesouraria/extratos', fd);
  assert.equal(imp.lancamentos, 4);
  assert.equal(imp.automatico.conciliados, 2, 'crédito e débito com par único conciliam sozinhos');
  assert.equal((await db.get('SELECT status FROM parcelas WHERE id = ?', parc.id)).status, 'liquidada');
  assert.equal((await db.get('SELECT status FROM contas_pagar WHERE id = ?', conta.id)).status, 'pago');
  const fd2 = new FormData();
  fd2.append('arquivo', new Blob([ofx]), 'extrato.ofx');
  assert.equal((await fin.post('/api/tesouraria/extratos', fd2)).novos, 0, 'reimportar não duplica');

  const pend = await fin.get('/api/tesouraria/lancamentos?f_status=pendente&all=1');
  const tarifa = pend.rows.find((x) => x.valor === -37.45);
  await fin.post(`/api/tesouraria/lancamentos/${tarifa.id}/criar-conta`, { categoria: 'Outros', descricao: 'Tarifa bancária' });
  assert.equal((await db.get('SELECT status FROM extrato_lancamentos WHERE id = ?', tarifa.id)).status, 'conciliado');
  const ted = pend.rows.find((x) => x.valor === 12345.67);
  assert.equal((await fin.req('POST', `/api/tesouraria/lancamentos/${ted.id}/ignorar`, {})).status, 400, 'ignorar exige motivo');
  await fin.post(`/api/tesouraria/lancamentos/${ted.id}/ignorar`, { motivo: 'Transferência entre contas' });

  const fluxo = await fin.get('/api/tesouraria/fluxo?agrupar=semana');
  assert.equal(fluxo.saldo_inicial.origem, 'extrato');
  assert.equal(fluxo.saldo_inicial.valor, 150000);
  assert.ok(fluxo.linhas.length > 0 && 'saldo' in fluxo.linhas[0]);
  await fin.put('/api/tesouraria/saldo', { valor: 1000, data: S.hoje() });
  assert.equal((await fin.get('/api/tesouraria/fluxo')).saldo_inicial.origem, 'informado');

  const dre = await fin.get(`/api/tesouraria/resultado?ano=${S.hoje().slice(0, 4)}`);
  const rec = dre.linhas.find((l) => l.rotulo.startsWith('Receita bruta'));
  assert.ok(rec.total_ano > 0);
  assert.ok(dre.linhas.some((l) => l.final));
  await fin.put('/api/tesouraria/resultado/impostos', { pct: 5 });
  const dre2 = await fin.get(`/api/tesouraria/resultado?ano=${S.hoje().slice(0, 4)}`);
  assert.ok(Math.abs(dre2.linhas.find((l) => l.rotulo.startsWith('(−) Impostos')).total_ano - -rec.total_ano * 0.05) < 0.1, 'impostos = 5% da receita');
});

test('calendário da safra: janelas por cliente e tarefa automática no CRM', async () => {
  const gerente = await sessao('gerente');
  const ana = await sessao('ana');
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  const cal = await gerente.get('/api/crm/safra/calendario');
  assert.ok(cal.length >= 10 && cal.some((c) => c.cultura === 'Soja'));
  // Janela que começa daqui a 20 dias para uma cultura do cliente da Ana.
  const ini = S.addDias(S.hoje(), 20);
  const m = Number(ini.slice(5, 7));
  const linha = await gerente.post('/api/crm/safra/calendario', { cultura: 'Café', atividade: 'Teste de janela', mes_inicio: m, mes_fim: m, antecedencia_dias: 60 });
  assert.equal((await gerente.req('POST', '/api/crm/safra/calendario', { cultura: 'Inventada', atividade: 'x', mes_inicio: 1, mes_fim: 2 })).status, 400);
  const cli = await db.get(`SELECT id FROM clientes WHERE vendedor_id = ? ORDER BY id DESC LIMIT 1`, anaId);
  await db.run(`INSERT INTO cliente_areas (cliente_id, tipo_cultivo, area, medida) VALUES (?, 'Café', 80, 'ha')`, cli.id);
  await db.run(`UPDATE pedidos SET created_at = '2024-01-01 10:00:00' WHERE cliente_id = ?`, cli.id);
  const jan = await ana.get('/api/crm/safra/janelas?dias=120&all=1');
  const j = jan.rows.find((x) => x.cliente_id === cli.id && x.atividade === 'Teste de janela');
  assert.ok(j, 'janela aparece para o vendedor');
  assert.equal(j.situacao, 'oferecer');
  const regra = (await gerente.get('/api/crm/automacoes')).regras.find((x) => x.gatilho === 'calendario_safra');
  assert.ok(regra && regra.ativa);
  const [r] = await gerente.post('/api/crm/automacoes/executar', { id: regra.id });
  assert.ok(r.geradas >= 1);
  const t = await db.get(`SELECT titulo, responsavel_id FROM crm_tarefas WHERE automacao_id = ? AND cliente_id = ?`, regra.id, cli.id);
  assert.match(t.titulo, /Café/);
  assert.equal(t.responsavel_id, anaId);
  await gerente.del(`/api/crm/safra/calendario/${linha.id}`);
});

test('rastreio automático: eventos dos Correios (simulação) concluem a entrega', async () => {
  const exp = await sessao('expedicao');
  const p = await db.get(`SELECT id, numero FROM pedidos WHERE etapa = 'transito' AND empresa_id = 1 ORDER BY id LIMIT 1`);
  await db.run(`UPDATE pedidos SET codigo_rastreio = 'AB123456789BR', data_embarque = ?, data_entrega_prevista = ? WHERE id = ?`, S.addDias(S.hoje(), -6), S.addDias(S.hoje(), -2), p.id);
  const sem = await exp.req('POST', `/api/pedidos/${p.id}/rastreio`);
  assert.equal(sem.status, 400, 'sem integração dos Correios ligada');
  await db.run(`INSERT INTO integracao_contas (provedor, empresa_id, modo, config) VALUES ('correios', 1, 'simulacao', '{}') ON CONFLICT (provedor, empresa_id) DO UPDATE SET modo = 'simulacao'`);
  const r = await exp.post(`/api/pedidos/${p.id}/rastreio`);
  assert.equal(r.entregue, true);
  assert.equal(r.concluido, true);
  const ped = await db.get('SELECT etapa, data_entrega, rastreio_status FROM pedidos WHERE id = ?', p.id);
  assert.equal(ped.etapa, 'entregue');
  assert.equal(ped.data_entrega, S.addDias(S.hoje(), -2));
  const det = await exp.get(`/api/pedidos/${p.id}`);
  assert.ok(det.rastreio.length >= 3 && det.rastreio[0].entregue);
  const log = await db.get(`SELECT * FROM integracao_log WHERE provedor = 'correios' AND operacao = 'rastrear' ORDER BY id DESC LIMIT 1`);
  assert.equal(log.ok, 1);
  const todos = await exp.post('/api/pedidos/rastreio/atualizar');
  assert.ok('consultados' in todos);
});

test('análises: curva ABC, recompra atrasada e previsão de demanda', async () => {
  const ger = await sessao('gerente');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/analises/abc')).status, 403);
  const abc = await ger.get('/api/analises/abc?tipo=clientes&all=1');
  assert.ok(abc.rows.length > 0);
  assert.equal(abc.rows[0].classe, 'A');
  assert.ok(abc.rows.at(-1).acumulado >= 99.9);
  const resumo = await ger.get('/api/analises/abc?tipo=produtos&resumo=1&metrica=margem');
  assert.ok(resumo.resumo.A.itens >= 1);
  const rec = await ger.get('/api/analises/recompra?all=1');
  assert.ok(Array.isArray(rec.rows));
  rec.rows.forEach((x) => assert.ok(x.dias_sem_comprar > x.intervalo_medio));
  const dem = await ger.get('/api/analises/demanda?horizonte=3');
  assert.equal(dem.meses.length, 3);
  assert.ok(dem.linhas.length > 0 && dem.linhas[0].previsao.length === 3);
  const sup = await sessao('carlos');
  const abcSup = await sup.get('/api/analises/abc?tipo=clientes&all=1');
  assert.ok(abcSup.rows.length <= abc.rows.length, 'supervisor vê só a equipe');
});
