// RH e DP: ficha, histórico automático, férias pela CLT, ocorrências, folha do mês, Meu RH e permissões.
const test = require('node:test');
const assert = require('node:assert/strict');
// helpers primeiro: ele aponta o banco para o de teste antes de qualquer módulo do servidor abrir conexão.
const { sessao, parar, db } = require('./helpers');
const RH = require('../server/rh');
const S = require('../server/services');

test.after(parar);

test('regras de férias da CLT', async () => {
  assert.deepEqual([0, 5, 6, 14, 15, 23, 24, 32, 33].map(RH.diasDeDireito), [30, 30, 24, 24, 18, 18, 12, 12, 0]);
  assert.equal(RH.addMeses('2026-01-31', 1), '2026-02-28');
});

test('ficha do colaborador, férias, ocorrências, folha e Meu RH', async () => {
  const rh = await sessao('rh');
  const ana = await sessao('ana');
  assert.equal((await ana.req('GET', '/api/rh/colaboradores')).status, 403, 'vendedor não acessa o RH');

  const admissao = S.addDias(S.hoje(), -800);
  const { id } = await rh.post('/api/rh/colaboradores', {
    nome: 'Teste da Silva', cpf: '529.982.247-25', cargo: 'Operador de produção', departamento: 'Produção', tipo_contrato: 'clt', salario: 2200, data_admissao: admissao,
  });
  let f = await rh.get(`/api/rh/colaboradores/${id}`);
  assert.equal(f.historico[0].tipo, 'admissao');
  await rh.put(`/api/rh/colaboradores/${id}`, { salario: 2420, cargo: 'Encarregado de produção' });
  f = await rh.get(`/api/rh/colaboradores/${id}`);
  assert.equal(f.historico[0].tipo, 'mudanca_cargo', 'mudança de cargo e salário vai para o histórico');
  assert.match(f.historico[0].descricao, /2200 → 2420/);
  assert.equal(f.periodos.filter((p) => p.completo).length, 2);
  assert.equal(f.periodos.find((p) => p.completo).direito, 30);

  // Férias: período mais antigo, dividido em 20 dias + 10 de abono; regras de 5 e 14 dias.
  const per = f.periodos.filter((p) => p.completo).at(-1);
  const inicio = S.addDias(S.hoje(), 10);
  assert.equal((await rh.req('POST', '/api/rh/ferias', { colaborador_id: id, aquisitivo_inicio: per.inicio, inicio, dias: 4 })).status, 400, 'mínimo de 5 dias');
  assert.equal((await rh.req('POST', '/api/rh/ferias', { colaborador_id: id, aquisitivo_inicio: per.inicio, inicio, dias: 10, abono_dias: 11 })).status, 400, 'abono de no máximo 1/3');
  assert.equal((await rh.req('POST', '/api/rh/ferias', { colaborador_id: id, aquisitivo_inicio: per.inicio, inicio, dias: 27 })).status, 400, 'sobrariam 3 dias');
  const fer = await rh.post('/api/rh/ferias', { colaborador_id: id, aquisitivo_inicio: per.inicio, inicio, dias: 20, abono_dias: 10 });
  assert.equal(fer.fim, S.addDias(inicio, 19));
  f = await rh.get(`/api/rh/colaboradores/${id}`);
  assert.equal(f.periodos.find((p) => p.inicio === per.inicio).saldo, 0);
  assert.equal((await rh.req('POST', '/api/rh/ferias', { colaborador_id: id, aquisitivo_inicio: per.inicio, inicio: S.addDias(inicio, 60), dias: 5 })).status, 400, 'sem saldo');

  // Ocorrências do mês viram eventos da folha.
  const comp = S.hoje().slice(0, 7);
  const dia = `${comp}-01`;
  await rh.post('/api/rh/ocorrencias', { colaborador_id: id, data: dia, tipo: 'hora_extra_50', horas: 10 });
  await rh.post('/api/rh/ocorrencias', { colaborador_id: id, data: dia, tipo: 'falta', dias: 1 });
  await rh.post('/api/rh/ocorrencias', { colaborador_id: id, data: dia, tipo: 'banco_credito', horas: 3 });
  await rh.post(`/api/rh/colaboradores/${id}/beneficios`, { tipo: 'vale_transporte', valor_empresa: 200, valor_desconto: 132 });
  assert.equal((await rh.get(`/api/rh/colaboradores/${id}`)).banco_horas, 3);
  await rh.post('/api/rh/folha/gerar', { competencia: comp });
  let folha = await rh.get(`/api/rh/folha?competencia=${comp}`);
  const linha = folha.linhas.find((l) => l.id === id);
  const ev = Object.fromEntries(linha.eventos.map((e) => [e.evento, e.valor]));
  assert.equal(ev['Horas extras 50%'], Math.round((2420 / 220) * 1.5 * 10 * 100) / 100);
  assert.equal(ev['Faltas injustificadas'], Math.round((2420 / 30) * 100) / 100);
  assert.equal(ev['Desconto Vale-transporte'], 132);
  await rh.post('/api/rh/folha/eventos', { competencia: comp, colaborador_id: id, tipo: 'provento', evento: 'Prêmio produtividade', valor: 300 });
  await rh.post('/api/rh/folha/gerar', { competencia: comp });
  folha = await rh.get(`/api/rh/folha?competencia=${comp}`);
  assert.ok(folha.linhas.find((l) => l.id === id).eventos.some((e) => e.evento === 'Prêmio produtividade'), 'gerar de novo mantém os manuais');
  const xlsx = await rh.req('GET', `/api/rh/folha/exportar?competencia=${comp}`);
  assert.equal(xlsx.status, 200);
  assert.ok(xlsx.headers.get('content-type').includes('spreadsheet'));
  await rh.post('/api/rh/folha/fechar', { competencia: comp });
  assert.equal((await rh.req('POST', '/api/rh/ocorrencias', { colaborador_id: id, data: dia, tipo: 'falta' })).status, 400, 'mês fechado não aceita lançamento');
  assert.equal((await rh.req('POST', '/api/rh/folha/gerar', { competencia: comp })).status, 400);
  await rh.post('/api/rh/folha/reabrir', { competencia: comp, motivo: 'Correção de horas' });

  // Meu RH: o vendedor vê os próprios dados e pede um documento; o RH responde.
  const meu = await ana.get('/api/rh/meu');
  assert.ok(meu.vinculado);
  assert.equal(meu.colaborador.nome, 'Ana Souza');
  const fd = new FormData();
  fd.append('tipo', 'documento');
  fd.append('descricao', 'Declaração de vínculo');
  const { id: sol } = await ana.post('/api/rh/meu/solicitacoes', fd);
  const lista = await rh.get('/api/rh/solicitacoes?f_status=aberta&all=1');
  assert.ok(lista.rows.some((s) => s.id === sol));
  await rh.post(`/api/rh/solicitacoes/${sol}/responder`, { status: 'concluida', resposta: 'Declaração enviada por e-mail.' });
  assert.equal((await ana.get('/api/rh/meu')).solicitacoes.find((s) => s.id === sol).status, 'concluida');

  // Quem só tem "rh" (sem gerir) não vê salários.
  const dir = await sessao('diretoria');
  const rhUser = await db.get(`SELECT id FROM usuarios WHERE login = 'rh'`);
  await dir.put(`/api/cadastros/usuarios/${rhUser.id}`, { personalizadas: 1, permissoes: ['dashboard', 'rh'] });
  const rh2 = await sessao('rh');
  const ficha = await rh2.get(`/api/rh/colaboradores/${id}`);
  assert.equal(ficha.colaborador.salario, undefined);
  assert.equal((await rh2.get('/api/rh/colaboradores?all=1')).rows.find((x) => x.id === id).salario, null);
  assert.equal((await rh2.req('GET', `/api/rh/folha?competencia=${comp}`)).status, 403);
  assert.equal((await rh2.req('PUT', `/api/rh/colaboradores/${id}`, { salario: 9999 })).status, 403);
  await dir.put(`/api/cadastros/usuarios/${rhUser.id}`, { personalizadas: 0 });

  // Desligamento encerra o acesso do usuário ligado ao colaborador.
  const helena = await db.get(`SELECT colaborador_id FROM usuarios WHERE login = 'helena'`);
  await rh.post(`/api/rh/colaboradores/${helena.colaborador_id}/desligar`, { data: S.hoje(), tipo: 'pedido', motivo: 'Mudou de cidade' });
  assert.equal((await db.get(`SELECT ativo FROM usuarios WHERE login = 'helena'`)).ativo, 0);
  const painel = await rh.get('/api/rh/painel');
  assert.ok(painel.ativos > 0 && Array.isArray(painel.alertas));
  assert.ok(painel.folha_base > 0);
});
