// Abrangência dos dados: vendedor vê só o que gerou, supervisor só a equipe, setores e diretoria veem tudo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');

test.after(parar);

const idDe = async (login) => (await db.get('SELECT id FROM usuarios WHERE login = ?', login)).id;

test('vendedor só vê os próprios pedidos, clientes, propostas, mensagens e relatórios', async () => {
  const ana = await sessao('ana');
  const idAna = await idDe('ana');
  const pedidoOutro = await db.get(`SELECT p.id, p.numero, p.cliente_id FROM pedidos p JOIN usuarios u ON u.id = p.vendedor_id WHERE u.login = 'elisa' AND p.empresa_id = 1 LIMIT 1`);
  const clienteOutro = await db.get(`SELECT c.id, c.documento FROM clientes c JOIN usuarios u ON u.id = c.vendedor_id WHERE u.login = 'elisa'
    AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.vendedor_id = ?) LIMIT 1`, idAna);

  const lista = await ana.get('/api/pedidos/progressao?all=1');
  assert.ok(lista.rows.length > 0);
  assert.ok(lista.rows.every((p) => p.vendedor === 'Ana Souza'), 'progressão só com os pedidos dela');
  assert.equal((await ana.req('GET', `/api/pedidos/${pedidoOutro.id}`)).status, 404);
  assert.equal((await ana.req('POST', `/api/pedidos/${pedidoOutro.id}/comentarios`, { texto: 'x' })).status, 404);
  assert.equal((await ana.req('GET', `/api/clientes/${clienteOutro.id}`)).status, 404);
  assert.equal((await ana.req('GET', `/api/crm/cliente/${clienteOutro.id}`)).status, 404);
  const clientes = await ana.get('/api/clientes?all=1');
  assert.ok(!clientes.rows.some((c) => c.id === clienteOutro.id));
  assert.ok(!(await ana.get(`/api/clientes/busca?q=${clienteOutro.documento.slice(0, 6)}`)).some((c) => c.id === clienteOutro.id));
  const hist = await ana.get(`/api/clientes/historico/compras?documento=${clienteOutro.documento}`);
  assert.equal(hist.pedidos.length, 0, 'histórico de compra não mostra vendas de outros');

  // Mensagens de pedido de outro vendedor não aparecem nem pelo filtro do pedido.
  const elisa = await sessao('elisa');
  await elisa.post('/api/mensagens', { pedido_id: pedidoOutro.id, setor_destino: 'vendedor', texto: 'Mensagem sobre pedido da Elisa' });
  assert.equal((await ana.get(`/api/mensagens?pedido_id=${pedidoOutro.id}`)).length, 0);
  assert.ok(!(await ana.get('/api/mensagens')).some((m) => m.pedido_id === pedidoOutro.id));
  assert.equal((await ana.req('POST', '/api/mensagens', { pedido_numero: pedidoOutro.numero, texto: 'oi' })).status, 400);

  const rel = await ana.get('/api/relatorios/vendas?cad_de=2020-01-01&cad_ate=2030-12-31');
  assert.ok(rel.linhas.length > 0 && rel.linhas.every((l) => l.vendedor === 'Ana Souza'));
  const props = await ana.get('/api/propostas?all=1');
  assert.ok(props.rows.every((p) => p.vendedor === 'Ana Souza'));
  // Não consegue lançar pedido em nome de outro vendedor nem para cliente de outra carteira.
  const op = await ana.get('/api/cadastros/opcoes');
  assert.deepEqual(op.vendedores.map((v) => v.id), [idAna], 'só ela na lista de vendedores');
  assert.equal((await ana.req('POST', '/api/pedidos', { cliente_id: clienteOutro.id, itens: [] })).status, 404);
});

test('supervisor vê a equipe inteira e nada de outras equipes', async () => {
  const carlos = await sessao('carlos');
  const equipe = new Set(['Ana Souza', 'Bruno Rocha', 'Diego Martins', 'Carlos Mendes']);
  const lista = await carlos.get('/api/pedidos/progressao?all=1');
  const vendedores = new Set(lista.rows.map((p) => p.vendedor));
  assert.ok([...vendedores].every((v) => equipe.has(v)), [...vendedores].join(','));
  assert.ok(vendedores.size >= 2, 'vê mais de um vendedor da equipe');
  const pedidoOutraEquipe = await db.get(`SELECT p.id FROM pedidos p JOIN usuarios u ON u.id = p.vendedor_id WHERE u.login = 'gabriel' LIMIT 1`);
  assert.equal((await carlos.req('GET', `/api/pedidos/${pedidoOutraEquipe.id}`)).status, 404);
  const rel = await carlos.get('/api/relatorios/contas-receber');
  assert.ok(rel.linhas.every((l) => !l.vendedor || equipe.has(l.vendedor)), 'contas a receber só da equipe');
  const op = await carlos.get('/api/cadastros/opcoes');
  assert.ok(op.vendedores.every((v) => equipe.has(v.nome)));
  // Não lança pedido para vendedor de outra equipe.
  const cli = await db.get(`SELECT c.id FROM clientes c JOIN usuarios u ON u.id = c.vendedor_id WHERE u.login = 'ana' LIMIT 1`);
  assert.equal((await carlos.req('POST', '/api/pedidos', { cliente_id: cli.id, vendedor_id: await idDe('gabriel'), itens: [] })).status, 403);
  const painel = await carlos.get('/api/dashboard');
  assert.equal(painel.perfil, 'supervisor');
});

test('setores e diretoria veem tudo; o administrador pode mudar a abrangência de cada usuário', async () => {
  const fin = await sessao('financeiro');
  const total = (await db.get('SELECT COUNT(*) AS n FROM parcelas WHERE empresa_id = 1')).n;
  assert.equal((await fin.get('/api/financeiro/parcelas?pageSize=1')).total, total);
  const dir = await sessao('diretoria');
  const totalPed = (await db.get('SELECT COUNT(*) AS n FROM pedidos WHERE empresa_id = 1')).n;
  assert.equal((await dir.get('/api/pedidos/progressao?pageSize=1')).total, totalPed);

  // Bruno passa a ver todos os dados da empresa.
  const bruno = await idDe('bruno');
  const antes = (await (await sessao('bruno')).get('/api/pedidos/progressao?pageSize=1')).total;
  assert.ok(antes < totalPed);
  await dir.put(`/api/cadastros/usuarios/${bruno}`, { abrangencia: 'todos' });
  assert.equal((await dir.get(`/api/cadastros/usuarios/${bruno}`)).abrangencia, 'todos');
  assert.equal((await (await sessao('bruno')).get('/api/pedidos/progressao?pageSize=1')).total, totalPed);
  await dir.put(`/api/cadastros/usuarios/${bruno}`, { abrangencia: '' });
  assert.equal((await (await sessao('bruno')).get('/api/pedidos/progressao?pageSize=1')).total, antes, 'volta ao padrão do perfil');
  assert.equal((await dir.req('PUT', `/api/cadastros/usuarios/${bruno}`, { abrangencia: 'galaxia' })).status, 400);
  const perm = await dir.get('/api/cadastros/permissoes');
  assert.equal(perm.abrangencia.vendedor, 'proprio');
  assert.equal(perm.abrangencia.supervisor, 'equipe');
  assert.equal(perm.abrangencia.financeiro, 'todos');
});
