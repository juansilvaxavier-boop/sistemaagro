// Assistente de IA: modo manual sem chave, ferramentas respeitando a abrangência e queda para o manual em erro.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');
const AS = require('../server/assistente');

test.after(() => { AS._restaurar(); return parar(); });
delete process.env.ANTHROPIC_API_KEY;

test('sem chave da API responde pelo manual', async () => {
  const ana = await sessao('ana');
  assert.deepEqual(await ana.get('/api/assistente/status'), { ia: false });
  const r = await ana.post('/api/assistente', { mensagens: [{ role: 'user', content: 'Como peço férias?' }] });
  assert.equal(r.modo, 'manual');
  assert.match(r.resposta, /Meu RH/);
  assert.equal((await ana.req('POST', '/api/assistente', { mensagens: [] })).status, 400);
});

test('ferramentas só enxergam os dados da abrangência do usuário', async () => {
  const deOutro = await db.get(`SELECT p.numero FROM pedidos p JOIN usuarios u ON u.id = p.vendedor_id WHERE u.login = 'elisa' AND p.empresa_id = 1 LIMIT 1`);
  const chamadas = [];
  const resultados = [];
  AS._definirCliente(() => ({
    beta: {
      messages: {
        async create(params) {
          chamadas.push({ ...params, messages: [...params.messages] });
          const ultima = params.messages.at(-1);
          if (Array.isArray(ultima.content) && ultima.content[0]?.type === 'tool_result') {
            resultados.push(...ultima.content.map((c) => JSON.parse(c.content)));
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Veja a [Fila do Vendedor](#/fila/venda).' }], usage: { input_tokens: 10, output_tokens: 5 } };
          }
          return {
            stop_reason: 'tool_use',
            content: [
              { type: 'tool_use', id: 't1', name: 'buscar_pedidos', input: { limite: 20 } },
              { type: 'tool_use', id: 't2', name: 'detalhar_pedido', input: { numero: deOutro.numero } },
              { type: 'tool_use', id: 't3', name: 'minhas_pendencias', input: {} },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    },
  }));
  const ana = await sessao('ana');
  const r = await ana.post('/api/assistente', { mensagens: [{ role: 'user', content: 'Meus pedidos?' }], telas: ['Comercial › Vendedor (#/fila/venda)'] });
  assert.equal(r.modo, 'ia');
  assert.match(r.resposta, /Fila do Vendedor/);

  const p = chamadas[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.match(p.system[1].text, /Ana Souza/);
  assert.equal(p.thinking, undefined);
  assert.equal(chamadas[1].messages.length, 3, 'pergunta, chamada das ferramentas e resultados');

  const [lista, detalhe, pend] = resultados;
  assert.ok(lista.pedidos.length > 0 && lista.pedidos.every((x) => x.vendedor === 'Ana Souza'));
  assert.match(detalhe.erro, /não encontrado/);
  assert.ok(Array.isArray(pend.filas));

  const uso = await db.get(`SELECT * FROM assistente_uso u JOIN usuarios x ON x.id = u.usuario_id WHERE x.login = 'ana' AND modo = 'ia' ORDER BY u.id DESC LIMIT 1`);
  assert.equal(uso.ferramentas, 'buscar_pedidos,detalhar_pedido,minhas_pendencias');
});

test('se a API falhar, cai para o manual', async () => {
  AS._definirCliente(() => ({ beta: { messages: { async create() { throw new Error('fora do ar'); } } } }));
  const ana = await sessao('ana');
  const r = await ana.post('/api/assistente', { mensagens: [{ role: 'user', content: 'Como cancelo um pedido?' }] });
  assert.equal(r.modo, 'manual');
  assert.match(r.resposta, /indisponível/);
});

test('todas as ferramentas rodam para cada perfil', async () => {
  const A = require('../server/auth');
  const usuarios = await db.all(`SELECT DISTINCT ON (perfil) id, nome, login, perfil, equipe_id, colaborador_id, abrangencia, permissoes FROM usuarios WHERE ativo = 1 ORDER BY perfil, id`);
  const entradas = { buscar_pedidos: { cliente: 'a' }, detalhar_pedido: { numero: 1 }, buscar_clientes: { termo: 'a' } };
  for (const u of usuarios) {
    const req = { user: { ...u, permissoesEfetivas: A.permissoesDe(u) }, empresaId: 1 };
    for (const [nome, f] of Object.entries(AS.FERRAMENTAS)) {
      await assert.doesNotReject(() => f.executar(req, entradas[nome] || {}), `${nome} para ${u.perfil}`);
    }
  }
});
