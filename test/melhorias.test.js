// CEP/CNPJ automáticos, cadastro do colaborador com listas, regras de comissão, dados agronômicos do pedido,
// anexos no chat e mapa de vendas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');
const consulta = require('../server/routes/consulta');

test.after(parar);

test('consulta de CEP e CNPJ (serviço externo simulado)', async () => {
  consulta._definirBusca(async (url) => {
    const corpo = url.includes('/cep/v2/38740000') ? { cep: '38740000', state: 'MG', city: 'Patrocínio', neighborhood: 'Centro', street: 'Rua Presidente Vargas' }
      : url.includes('/cnpj/v1/11222333000181') ? { razao_social: 'AGRO TESTE LTDA', nome_fantasia: 'Agro Teste', descricao_situacao_cadastral: 'ATIVA', cep: '38740000', municipio: 'PATROCINIO', uf: 'MG', logradouro: 'PRESIDENTE VARGAS', descricao_tipo_de_logradouro: 'RUA', numero: '10', ddd_telefone_1: '3438311000' }
        : null;
    return { ok: !!corpo, status: corpo ? 200 : 404, json: async () => corpo };
  });
  const ana = await sessao('ana');
  const cep = await ana.get('/api/consulta/cep/38740-000');
  assert.equal(cep.cidade, 'Patrocínio');
  assert.equal(cep.logradouro, 'Rua Presidente Vargas');
  assert.equal((await ana.req('GET', '/api/consulta/cep/00000000')).status, 404);
  assert.equal((await ana.req('GET', '/api/consulta/cep/123')).status, 400);
  const cnpj = await ana.get('/api/consulta/cnpj/11.222.333-0001-81');
  assert.equal(cnpj.razao_social, 'AGRO TESTE LTDA');
  assert.equal(cnpj.logradouro, 'RUA PRESIDENTE VARGAS');
  assert.equal((await ana.req('GET', '/api/consulta/cnpj/11222333000180')).status, 400, 'dígito verificador inválido');
  consulta._definirBusca(async () => { throw new Error('rede fora'); });
  assert.equal((await ana.req('GET', '/api/consulta/cep/38740001')).status, 503);
});

test('colaborador: vínculo, cargo da lista, vendedor exige equipe, PJ exige CNPJ e contrato anexado', async () => {
  const rh = await sessao('rh');
  const base = { nome: 'Rafael Prado', cpf: '529.982.247-25', tipo_contrato: 'clt', carga_horaria: 44, escala: '5x2' };
  let r = await rh.req('POST', '/api/cadastros/colaboradores', { ...base, cargo: 'Pescador' });
  assert.equal(r.status, 400); assert.match(r.dados.erro, /Cargo/);
  r = await rh.req('POST', '/api/cadastros/colaboradores', { ...base, cargo: 'Vendedor externo' });
  assert.equal(r.status, 400); assert.match(r.dados.erro, /equipe/);
  r = await rh.req('POST', '/api/cadastros/colaboradores', { ...base, cargo: 'Vendedor externo', carga_horaria: 50, equipe_id: 1 });
  assert.match(r.dados.erro, /Carga horária/);
  const { id } = await rh.post('/api/cadastros/colaboradores', { ...base, cargo: 'Vendedor externo', equipe_id: 1, cep: '38740-000', uf: 'MG' });
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', id);
  assert.equal(c.funcao_comercial, 'vendedor');
  assert.equal(c.departamento, 'Comercial', 'departamento vem do cargo');
  assert.equal(c.bate_ponto, 1);
  assert.equal(c.jornada, '44 h semanais · 5x2 (segunda a sexta)');
  // PJ
  r = await rh.req('PUT', `/api/cadastros/colaboradores/${id}`, { tipo_contrato: 'pj' });
  assert.match(r.dados.erro, /CNPJ/);
  await rh.put(`/api/cadastros/colaboradores/${id}`, { tipo_contrato: 'pj', cnpj: '11.222.333/0001-81', razao_social: 'Prado Representações' });
  // Contrato assinado
  const fd = new FormData();
  fd.append('arquivo', new Blob([Buffer.from('%PDF-1.4 contrato')], { type: 'application/pdf' }), 'contrato.pdf');
  fd.append('categoria', 'Contrato');
  const up = await rh.req('POST', `/api/rh/colaboradores/${id}/documentos`, fd);
  assert.equal(up.status, 201);
  const lista = await rh.get('/api/cadastros/colaboradores?all=1');
  assert.equal(lista.rows.find((x) => x.id === id).contratos, 1);
  // Usuário vendedor herda a equipe do colaborador
  const admin = await sessao('admin');
  const u = await admin.post('/api/cadastros/usuarios', { colaborador_id: id, login: 'rafael.prado', senha: 'Provisoria1', perfil: 'vendedor', empresas: [1] });
  assert.equal((await db.get('SELECT equipe_id FROM usuarios WHERE id = ?', u.id)).equipe_id, 1);
});

test('listas de opções: incluir, renomear em cascata e desativar', async () => {
  const admin = await sessao('admin');
  const { id } = await admin.post('/api/cadastros/listas', { tipo: 'cultura', valor: 'Amendoim' });
  assert.equal((await admin.req('POST', '/api/cadastros/listas', { tipo: 'cultura', valor: 'amendoim' })).status, 400, 'duplicada');
  const ped = await db.get(`SELECT id FROM pedidos LIMIT 1`);
  await db.run(`UPDATE pedidos SET cultura = 'Amendoim' WHERE id = ?`, ped.id);
  await admin.put(`/api/cadastros/listas/${id}`, { valor: 'Amendoim (sequeiro)' });
  assert.equal((await db.get('SELECT cultura FROM pedidos WHERE id = ?', ped.id)).cultura, 'Amendoim (sequeiro)');
  await admin.put(`/api/cadastros/listas/${id}`, { ativo: false });
  const op = await admin.get('/api/cadastros/opcoes');
  assert.ok(!op.listas.cultura.some((x) => x.id === id));
  assert.equal((await (await sessao('ana')).req('POST', '/api/cadastros/listas', { tipo: 'cultura', valor: 'X' })).status, 403);
});

test('comissão: gerente 3%, supervisor 3%, vendedor 25% dentro da política; fora dela a Diretoria decide', async () => {
  const ana = await sessao('ana');
  const op = await ana.get('/api/cadastros/opcoes');
  const cliente = (await ana.get('/api/clientes?pageSize=50')).rows.find((c) => !c.blacklist);
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id);
  const prod = op.produtos[0];
  const precos = await ana.get(`/api/cadastros/produtos/${prod.id}/precos`);
  const novo = (extra) => ana.post('/api/pedidos', {
    cliente_id: cliente.id, forma_id: forma.id, condicao_id: cond.id, tipo_entrega: 'transportadora',
    itens: [{ produto_id: prod.id, embalagem_id: precos.embalagens[0].id, quantidade: 10, ...extra }],
  });
  const dentro = await novo({});
  const dir = await sessao('diretoria');
  let d = await dir.get(`/api/pedidos/${dentro.id}`);
  assert.equal(d.pedido.dentro_politica, 1);
  assert.deepEqual(d.comissoes_padrao.map((c) => [c.papel, c.percentual]), [['vendedor', 25], ['supervisor', 3], ['gerente', 3]]);
  const tabela = (await db.get('SELECT valor_tabela FROM pedido_itens WHERE pedido_id = ?', dentro.id)).valor_tabela;
  const fora = await novo({ valor_unitario: Math.round(tabela * 0.8 * 100) / 100 });
  d = await dir.get(`/api/pedidos/${fora.id}`);
  assert.equal(d.pedido.dentro_politica, 0);
  assert.match(d.pedido.motivo_politica, /abaixo da tabela/);
  assert.equal(d.comissoes_padrao.find((c) => c.papel === 'vendedor').percentual, 0);
  // Regras editáveis
  const admin = await sessao('admin');
  await admin.put('/api/cadastros/config', { 'comissao.vendedor_pct': 20, 'comissao.tolerancia_desconto_pct': 25 });
  d = await dir.get(`/api/pedidos/${fora.id}`);
  assert.equal(d.comissoes_padrao.find((c) => c.papel === 'vendedor').percentual, 20, 'com tolerância de 25% o pedido volta a estar dentro');
  assert.equal((await admin.req('PUT', '/api/cadastros/config', { 'comissao.vendedor_pct': 150 })).status, 400);
  await admin.put('/api/cadastros/config', { 'comissao.vendedor_pct': 25, 'comissao.tolerancia_desconto_pct': 0 });
  assert.equal((await ana.req('GET', '/api/cadastros/config')).status, 403);
});

test('pedido exige cultura, área e origem para enviar e alimenta o cadastro do cliente', async () => {
  const ana = await sessao('ana');
  const op = await ana.get('/api/cadastros/opcoes');
  const cliente = (await ana.get('/api/clientes?pageSize=50')).rows.find((c) => !c.blacklist);
  const forma = op.formas.find((f) => f.nome === 'Boleto bancário');
  const cond = op.condicoes.find((c) => c.forma_id === forma.id);
  const precos = await ana.get(`/api/cadastros/produtos/${op.produtos[0].id}/precos`);
  const corpo = { cliente_id: cliente.id, forma_id: forma.id, condicao_id: cond.id, tipo_entrega: 'transportadora', itens: [{ produto_id: op.produtos[0].id, embalagem_id: precos.embalagens[0].id, quantidade: 5 }] };
  const r = await ana.req('POST', '/api/pedidos', { ...corpo, enviar: true });
  assert.equal(r.status, 400); assert.match(r.dados.erro, /cultura/);
  assert.equal((await ana.req('POST', '/api/pedidos', { ...corpo, cultura: 'Melancia' })).status, 400, 'cultura fora da lista');
  await db.run(`DELETE FROM cliente_areas WHERE cliente_id = ? AND tipo_cultivo = 'Sorgo'`, cliente.id);
  const { id } = await ana.post('/api/pedidos', { ...corpo, cultura: 'Sorgo', area_ha: 120, origem_venda: 'Tráfego pago (Google/Meta)', enviar: true });
  assert.ok(id);
  assert.ok(await db.get(`SELECT id FROM cliente_areas WHERE cliente_id = ? AND tipo_cultivo = 'Sorgo' AND area = 120`, cliente.id), 'área cadastrada no cliente');
  const cli = await ana.get(`/api/clientes/${cliente.id}`);
  assert.equal(cli.ultimo_pedido.cultura, 'Sorgo');
});

test('chat com anexos: imagem e PDF, só quem conversa baixa', async () => {
  const ana = await sessao('ana');
  const idCarlos = (await db.get(`SELECT id FROM usuarios WHERE login = 'carlos'`)).id;
  const fd = new FormData();
  fd.append('arquivos', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAEhgHcfBbtDwAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'print.png');
  fd.append('arquivos', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'boleto.pdf');
  fd.append('texto', 'segue');
  fd.append('medidas', JSON.stringify([{ largura: 1, altura: 1 }, {}]));
  const r = await ana.req('POST', `/api/chat/${idCarlos}/anexos`, fd);
  assert.equal(r.status, 201);
  const msg = r.dados;
  assert.equal(msg.anexos.length, 2);
  const carlos = await sessao('carlos');
  const conversa = await carlos.get(`/api/chat/${(await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id}`);
  assert.equal(conversa.at(-1).anexos.length, 2);
  const img = await carlos.req('GET', `/api/chat/anexos/${msg.anexos[0].id}`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const outro = await sessao('elisa');
  assert.equal((await outro.req('GET', `/api/chat/anexos/${msg.anexos[0].id}`)).status, 404);
  const ruim = new FormData();
  ruim.append('arquivos', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await ana.req('POST', `/api/chat/${idCarlos}/anexos`, ruim)).status, 400);
});

test('mapa de vendas por estado e cidade respeita período e abrangência', async () => {
  const dir = await sessao('diretoria');
  const m = await dir.get('/api/dashboard/mapa?de=2020-01-01&ate=2030-12-31');
  assert.ok(m.estados.length > 0 && m.cidades.length > 0);
  assert.ok(m.cidades.filter((c) => c.lat != null).length / m.cidades.length > 0.8, 'cidades com coordenadas');
  const soma = m.estados.reduce((a, e) => a + e.valor, 0);
  assert.ok(Math.abs(soma - m.total.valor) < 0.05);
  const ana = await sessao('ana');
  const ma = await ana.get('/api/dashboard/mapa?de=2020-01-01&ate=2030-12-31');
  assert.ok(ma.total.valor < m.total.valor, 'vendedor vê só as próprias vendas');
  const vazio = await dir.get('/api/dashboard/mapa?de=1990-01-01&ate=1990-01-31');
  assert.equal(vazio.total.pedidos, 0);
});
