// Portal do cliente, validade de lotes e produto parado, e comissão paga junto com a folha.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db, iniciar } = require('./helpers');
const S = require('../server/services');

test.after(parar);

/** Cliente HTTP do portal (cookie próprio, sem login do sistema). */
async function portal() {
  const base = await iniciar();
  let cookie = '';
  const req = async (metodo, url, body) => {
    const headers = { 'X-Requested-With': 'agroterra', cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, dados: await res.json().catch(() => null) };
  };
  return { req, limpar: () => { cookie = ''; } };
}

test('portal do cliente: convite, senha, bloqueio, isolamento e pedido na fila do vendedor', async () => {
  const ana = await sessao('ana');
  const anaId = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  const cli = await db.get('SELECT id, documento FROM clientes WHERE vendedor_id = ? AND EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = clientes.id) ORDER BY id LIMIT 1', anaId);
  const outro = await db.get('SELECT p.id FROM pedidos p WHERE p.cliente_id <> ? ORDER BY id LIMIT 1', cli.id);

  assert.ok((await ana.get(`/api/portal-acesso/${cli.id}`)).sem_acesso);
  const { link } = await ana.post(`/api/portal-acesso/${cli.id}/convite`);
  const token = link.split('#convite=')[1];
  assert.ok(token && token.length > 20);
  assert.equal((await db.get('SELECT convite_token FROM portal_acessos WHERE cliente_id = ?', cli.id)).convite_token.length, 64, 'guarda só o hash do convite');

  const p = await portal();
  assert.equal((await p.req('GET', '/api/portal/me')).status, 401);
  assert.equal((await p.req('GET', '/api/portal/convite/xyz')).status, 404);
  assert.equal((await p.req('POST', '/api/portal/ativar', { token, senha: 'curta' })).status, 400, 'senha fraca');
  assert.equal((await p.req('POST', '/api/portal/ativar', { token, senha: 'Produtor2026' })).status, 200);
  assert.equal((await p.req('POST', '/api/portal/ativar', { token, senha: 'Produtor2026' })).status, 400, 'convite usado não vale de novo');
  const me = (await p.req('GET', '/api/portal/me')).dados;
  assert.equal(me.documento, cli.documento);
  assert.equal(me.vendedor.nome, 'Ana Souza');

  // Só vê os próprios pedidos.
  const lista = (await p.req('GET', '/api/portal/pedidos')).dados.pedidos;
  const meus = await db.get('SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ?', cli.id);
  assert.equal(lista.length, meus.n);
  assert.equal((await p.req('GET', `/api/portal/pedidos/${outro.id}`)).status, 404, 'pedido de outro cliente');
  const det = (await p.req('GET', `/api/portal/pedidos/${lista[0].id}`)).dados;
  assert.equal(det.passos.length, 6);
  assert.ok(Array.isArray(det.itens) && det.itens.length);
  assert.ok(!('custo_embalagem' in det.itens[0]) && !('comissao' in det), 'não expõe custo nem comissão');
  for (const u of ['resumo', 'parcelas', 'notas', 'extrato']) assert.equal((await p.req('GET', `/api/portal/${u}`)).status, 200, u);
  const ext = (await p.req('GET', '/api/portal/extrato')).dados;
  const ultimo = ext.movimentos.at(-1);
  assert.equal(ext.saldo_final, ultimo ? ultimo.saldo : ext.saldo_anterior);

  // Pedido pelo portal: preço sempre o de tabela, cai na etapa do vendedor.
  const cat = (await p.req('GET', '/api/portal/catalogo')).dados;
  assert.ok(cat.itens.length > 0);
  const item = cat.itens[0];
  const novo = await p.req('POST', '/api/portal/pedidos', { forma_id: cat.forma_id, itens: [{ embalagem_id: item.embalagem_id, quantidade: 4, valor_unitario: 0.01 }] });
  assert.equal(novo.status, 201, JSON.stringify(novo.dados));
  const ped = await db.get('SELECT * FROM pedidos WHERE id = ?', novo.dados.id);
  assert.equal(ped.etapa, 'venda');
  assert.equal(ped.vendedor_id, anaId);
  assert.equal(ped.origem_portal, 1);
  assert.equal(ped.cliente_id, cli.id);
  assert.equal(ped.valor_produtos, S.r2(item.preco * 4), 'ignora preço enviado pelo cliente');
  assert.equal((await p.req('POST', '/api/portal/pedidos', { forma_id: cat.forma_id, itens: [] })).status, 400);
  const fila = await ana.get(`/api/pedidos/${ped.id}`);
  assert.equal(fila.pedido?.id ?? fila.id, ped.id, 'vendedor abre o pedido do portal');

  // Troca de senha e bloqueio por tentativas.
  assert.equal((await p.req('PUT', '/api/portal/senha', { atual: 'errada', nova: 'Nova2026x' })).status, 400);
  assert.equal((await p.req('PUT', '/api/portal/senha', { atual: 'Produtor2026', nova: 'Nova2026x' })).status, 200);
  await p.req('POST', '/api/portal/sair');
  assert.equal((await p.req('GET', '/api/portal/me')).status, 401);
  const doc = cli.documento.replace(/\D/g, '').replace(/^(\d{2})(\d{3})/, '$1.$2');
  for (let i = 0; i < 5; i++) assert.equal((await p.req('POST', '/api/portal/login', { documento: doc, senha: 'errada1' })).status, 401);
  assert.equal((await p.req('POST', '/api/portal/login', { documento: cli.documento, senha: 'Nova2026x' })).status, 423, 'bloqueado após 5 erros');
  await db.run('UPDATE portal_acessos SET bloqueado_ate = NULL WHERE cliente_id = ?', cli.id);
  assert.equal((await p.req('POST', '/api/portal/login', { documento: cli.documento, senha: 'Nova2026x' })).status, 200);

  // Desativar derruba a sessão; usuário sem acesso ao cliente não gera convite.
  await ana.post(`/api/portal-acesso/${cli.id}/desativar`);
  assert.equal((await p.req('GET', '/api/portal/me')).status, 401);
  const elisa = await sessao('elisa');
  assert.ok([403, 404].includes((await elisa.req('POST', `/api/portal-acesso/${cli.id}/convite`)).status), 'cliente de outra carteira');
  const fin = await sessao('financeiro');
  const r = await fin.req('POST', `/api/portal-acesso/${cli.id}/convite`);
  assert.ok([200, 403].includes(r.status));
});

test('validade e produto parado: listas, bloqueio de lote vencido e regras', async () => {
  const prod = await sessao('producao');
  const emb = await db.get('SELECT e.id, e.produto_id FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id WHERE p.ativo = 1 ORDER BY e.id LIMIT 1');
  const ontem = S.addDias(S.hoje(), -1);
  await S.movimentarEstoque({ empresa_id: 1, produto_id: emb.produto_id, embalagem_id: emb.id, tipo: 'entrada', origem: 'compra', quantidade: 12, lote: 'VENC-01', validade: ontem, custo_unitario: 10 });
  await S.movimentarEstoque({ empresa_id: 1, produto_id: emb.produto_id, embalagem_id: emb.id, tipo: 'entrada', origem: 'compra', quantidade: 5, lote: 'PROX-01', validade: S.addDias(S.hoje(), 20), custo_unitario: 10 });
  const val = await prod.get('/api/estoque/validade?all=1');
  const v = val.rows.find((x) => x.lote === 'VENC-01');
  assert.equal(v.situacao, 'vencido');
  assert.equal(v.valor, 120);
  assert.equal(val.rows.find((x) => x.lote === 'PROX-01').situacao, 'vence_30');
  const res = await prod.get('/api/estoque/resumo');
  assert.ok(res.vencidos >= 1 && res.vencendo >= 1);
  const parados = await prod.get('/api/estoque/parados?dias=1&all=1');
  assert.ok(Array.isArray(parados.rows));
  assert.ok(parados.rows.every((x) => x.dias_parado >= 1 && x.saldo > 0));

  // Pedido na produção com o lote vencido não conclui.
  const ped = await db.get(`SELECT id FROM pedidos WHERE etapa = 'producao' AND empresa_id = 1 ORDER BY id LIMIT 1`);
  await db.run(`UPDATE pedido_itens SET lote = 'VENC-01', validade = NULL, embalagem_id = ? WHERE pedido_id = ?`, emb.id, ped.id);
  const r = await prod.req('POST', `/api/pedidos/${ped.id}/acao`, { acao: 'concluir' });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /vencido/i);
  const ger = await sessao('producao');
  await ger.put('/api/estoque/regras', { 'estoque.bloquear_vencido': 'avisar', 'estoque.dias_parado': 200 });
  assert.equal((await ger.get('/api/estoque/regras')).find((c) => c.chave === 'estoque.dias_parado').valor, 200);
  const r2 = await prod.req('POST', `/api/pedidos/${ped.id}/acao`, { acao: 'concluir' });
  assert.ok(r2.status === 200 || !/vencido/i.test(r2.dados.erro || ''), 'com "só avisar" não bloqueia por validade');
  await ger.put('/api/estoque/regras', { 'estoque.bloquear_vencido': 'bloquear' });

  // Baixa como perda zera o lote.
  await prod.post('/api/estoque/movimentos', { tipo: 'saida', origem: 'perda', embalagem_id: emb.id, lote: 'VENC-01', quantidade: 12 });
  assert.ok(!(await prod.get('/api/estoque/validade?all=1')).rows.some((x) => x.lote === 'VENC-01'));
  const vend = await sessao('ana');
  assert.equal((await vend.req('GET', '/api/estoque/validade')).status, 403);
});

test('comissão na folha: CLT vira evento, PJ vira conta a pagar, fechar paga e reabrir desfaz', async () => {
  const rh = await sessao('rh');
  const comp = S.hoje().slice(0, 7);
  await db.run(`UPDATE comissoes SET status = 'revisada' WHERE status = 'aberta' AND periodo <= ?`, comp);
  const ap = await rh.get(`/api/rh/folha/comissoes?competencia=${comp}`);
  assert.ok(ap.linhas.length >= 2, 'há vendedores com comissão revisada');
  const [clt, pj] = ap.linhas;
  await db.run(`UPDATE colaboradores SET tipo_contrato = 'pj' WHERE id = (SELECT colaborador_id FROM usuarios WHERE id = ?)`, pj.usuario_id);
  await db.run(`UPDATE colaboradores SET tipo_contrato = 'clt' WHERE id = (SELECT colaborador_id FROM usuarios WHERE id = ?)`, clt.usuario_id);
  const ap2 = await rh.get(`/api/rh/folha/comissoes?competencia=${comp}`);
  assert.equal(ap2.linhas.find((l) => l.usuario_id === pj.usuario_id).destino, 'contas_pagar');
  const lClt = ap2.linhas.find((l) => l.usuario_id === clt.usuario_id);
  assert.equal(lClt.destino, 'folha');

  await rh.post('/api/rh/folha/gerar', { competencia: comp });
  const folha = await rh.get(`/api/rh/folha?competencia=${comp}`);
  const colClt = (await db.get('SELECT colaborador_id FROM usuarios WHERE id = ?', clt.usuario_id)).colaborador_id;
  const colPj = (await db.get('SELECT colaborador_id FROM usuarios WHERE id = ?', pj.usuario_id)).colaborador_id;
  const evClt = folha.linhas.find((l) => l.id === colClt)?.eventos || [];
  assert.equal(evClt.find((e) => e.evento === 'Comissões sobre vendas')?.valor, lClt.valor);
  assert.ok(!(folha.linhas.find((l) => l.id === colPj)?.eventos || []).some((e) => e.evento === 'Comissões sobre vendas'), 'PJ não entra na folha');

  const f = await rh.post('/api/rh/folha/fechar', { competencia: comp });
  assert.ok(f.comissoes.contas_pagar >= 1);
  const conta = await db.get('SELECT * FROM contas_pagar WHERE comissao_competencia = ? AND comissao_usuario_id = ?', comp, pj.usuario_id);
  assert.equal(conta.categoria, 'Comissões');
  assert.equal(conta.valor, ap2.linhas.find((l) => l.usuario_id === pj.usuario_id).liquido);
  assert.equal((await db.get(`SELECT COUNT(*) AS n FROM comissoes WHERE usuario_id = ? AND folha_competencia = ? AND status = 'paga'`, clt.usuario_id, comp)).n, lClt.comissoes);
  const depois = await rh.get(`/api/rh/folha/comissoes?competencia=${comp}`);
  assert.ok(depois.fechada);
  assert.equal(depois.linhas.length, ap2.linhas.length, 'fechada mostra as pagas nesta competência');
  assert.equal(depois.linhas.find((l) => l.usuario_id === clt.usuario_id).valor, lClt.valor);

  // Conta de comissão já paga impede reabrir; cancelada a baixa, reabre e devolve as comissões.
  await db.run(`UPDATE contas_pagar SET status = 'pago', valor_pago = valor WHERE id = ?`, conta.id);
  assert.equal((await rh.req('POST', '/api/rh/folha/reabrir', { competencia: comp, motivo: 'teste' })).status, 400);
  await db.run(`UPDATE contas_pagar SET status = 'a_pagar', valor_pago = 0 WHERE id = ?`, conta.id);
  await rh.post('/api/rh/folha/reabrir', { competencia: comp, motivo: 'Correção' });
  assert.equal((await db.get('SELECT status FROM contas_pagar WHERE id = ?', conta.id)).status, 'cancelado');
  assert.equal((await db.get(`SELECT COUNT(*) AS n FROM comissoes WHERE folha_competencia = ?`, comp)).n, 0);
  assert.equal((await rh.get(`/api/rh/folha/comissoes?competencia=${comp}`)).linhas.length, ap2.linhas.length);
});

test('cliente novo com linhas em branco (telefone, endereço) é salvo sem elas', async () => {
  const ana = await sessao('ana');
  const { id } = await ana.post('/api/clientes', {
    tipo_pessoa: 'F', documento: '52998224725', nome: 'Cliente Linhas Vazias',
    telefones: [{ tipo: 'Celular', numero: '', contato: '', whatsapp: 1 }], enderecos: [{ tipo: 'Entrega', cep: '', logradouro: '', principal: 1 }],
  });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cliente_telefones WHERE cliente_id = ?', id)).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cliente_enderecos WHERE cliente_id = ?', id)).n, 0);
});
