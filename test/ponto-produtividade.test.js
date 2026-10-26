// Ponto web (marcação com localização, apuração, ajustes e banco de horas) e painel de produtividade.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessao, parar, db } = require('./helpers');
const S = require('../server/services');
const P = require('../server/ponto');

test.after(parar);

/** Os três últimos dias úteis antes de hoje (entre eles só há fim de semana). */
function ultimosDiasUteis(n) {
  const r = [];
  for (let d = S.addDias(S.hoje(), -1); r.length < n; d = S.addDias(d, -1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow > 0 && dow < 6) r.unshift(d);
  }
  return r;
}

test('previsto por escala e rótulos das marcações', () => {
  const c = { carga_horaria: 40, escala: '5x2' };
  assert.equal(P.previstoDia(c, '2026-10-26'), 480, 'segunda-feira');
  assert.equal(P.previstoDia(c, '2026-10-25'), 0, 'domingo');
  assert.equal(P.previstoDia({ carga_horaria: 44, escala: '6x1' }, '2026-10-24'), 440, 'sábado na 6x1');
  assert.equal(P.previstoDia({ escala: '12x36' }, '2026-10-26'), null);
  assert.deepEqual([0, 1, 2, 3, 4].map(P.rotulo), ['Entrada', 'Saída para intervalo', 'Volta do intervalo', 'Saída', 'Entrada (extra)']);
});

test('ponto web: marcação, apuração, ajuste, anulação e banco de horas', async () => {
  const rh = await sessao('rh');
  const ana = await sessao('ana');
  const { id: cid } = await rh.post('/api/rh/colaboradores', {
    nome: 'Ponto de Teste', cpf: '111.444.777-35', cargo: 'Operador de produção', departamento: 'Produção', tipo_contrato: 'clt', data_admissao: '2020-01-02',
    carga_horaria: 40, escala: '5x2',
  });
  await db.run(`DELETE FROM rh_ocorrencias WHERE colaborador_id = ?`, cid);
  await db.run(`UPDATE usuarios SET colaborador_id = ? WHERE login = 'ana'`, cid);

  // Marcação pelo navegador com localização; a segunda no mesmo minuto é recusada.
  const m = await ana.post('/api/ponto/bater', { latitude: -16.6869, longitude: -49.2648, precisao: 18 });
  assert.equal(m.tipo, 'Entrada');
  assert.equal(m.data, S.hoje());
  const salvo = await db.get('SELECT * FROM rh_ponto WHERE id = ?', m.id);
  assert.equal(salvo.latitude, -16.6869);
  assert.equal(salvo.precisao, 18);
  assert.equal(salvo.origem, 'web');
  assert.equal((await ana.req('POST', '/api/ponto/bater', {})).status, 400, 'intervalo mínimo entre marcações');
  assert.equal((await ana.req('POST', '/api/ponto/bater', { latitude: 200, longitude: 0 })).status, 400, 'coordenada inválida');

  // Três dias úteis: 9 h (saldo +1 h), 7h55 (dentro da tolerância) e só a entrada (incompleto).
  const [d1, d2, d3] = ultimosDiasUteis(3);
  const ins = (data, hora) => db.insert('rh_ponto', { colaborador_id: cid, empresa_id: 1, data, hora, origem: 'web', latitude: -16.6, longitude: -49.2 });
  for (const h of ['08:00:00', '12:00:00', '13:00:00', '18:00:00']) await ins(d1, h);
  for (const h of ['08:00:00', '12:00:00', '13:00:00', '16:55:00']) await ins(d2, h);
  await ins(d3, '08:00:00');
  const esp = async (data) => (await rh.get(`/api/ponto/colaborador/${cid}?mes=${data.slice(0, 7)}`)).espelho.dias.find((x) => x.data === data);
  let dia = await esp(d1);
  assert.equal(dia.trabalhado, 540);
  assert.equal(dia.previsto, 480);
  assert.equal(dia.saldo, 60);
  assert.deepEqual(dia.marcacoes.map((x) => x.tipo), ['Entrada', 'Saída para intervalo', 'Volta do intervalo', 'Saída']);
  assert.equal((await esp(d2)).saldo, 0, 'tolerância de 10 minutos no dia');
  assert.equal((await esp(d3)).situacao, 'incompleto');
  let meu = await ana.get('/api/ponto/meu');
  assert.equal(meu.banco.ponto, 1, 'incompleto e hoje não entram no saldo');
  assert.equal(meu.marcacoes_hoje.length, 1);
  assert.equal(meu.proxima, 'Saída para intervalo');

  // O RH completa o dia esquecido e anula uma marcação errada.
  assert.equal((await ana.req('POST', '/api/ponto/ajuste', { colaborador_id: cid, data: d3, hora: '17:00', justificativa: 'Esqueceu de marcar' })).status, 403);
  assert.equal((await rh.req('POST', '/api/ponto/ajuste', { colaborador_id: cid, data: d3, hora: '17:00' })).status, 400, 'justificativa obrigatória');
  await rh.post('/api/ponto/ajuste', { colaborador_id: cid, data: d3, hora: '17:00', justificativa: 'Esqueceu de marcar a saída' });
  dia = await esp(d3);
  assert.equal(dia.saldo, 60);
  assert.equal(dia.marcacoes[1].origem, 'ajuste');
  assert.equal((await ana.get('/api/ponto/meu')).banco.ponto, 2);
  const errada = (await esp(d1)).marcacoes[3];
  await rh.post(`/api/ponto/${errada.id}/anular`, { motivo: 'Marcação duplicada' });
  dia = await esp(d1);
  assert.equal(dia.situacao, 'incompleto');
  assert.equal(dia.marcacoes.find((x) => x.id === errada.id).tipo, 'Anulada', 'anulada continua visível para o RH');

  // Crédito manual soma com o apurado; o mesmo saldo aparece no Meu RH.
  await rh.post('/api/rh/ocorrencias', { colaborador_id: cid, data: d1, tipo: 'banco_credito', horas: 2, descricao: 'Evento no sábado' });
  meu = await ana.get('/api/ponto/meu');
  assert.deepEqual([meu.banco.ponto, meu.banco.manual, meu.banco.saldo], [1, 2, 3]);
  assert.equal((await ana.get('/api/rh/meu')).banco_horas, 3);

  // Atestado abona o dia (sem débito).
  await rh.post('/api/rh/ocorrencias', { colaborador_id: cid, data: d2, tipo: 'atestado', dias: 1, descricao: 'Consulta' });
  dia = await esp(d2);
  assert.equal(dia.situacao, 'abonado');
  assert.equal(dia.saldo, 0, 'abono não vira crédito');
  meu = await ana.get('/api/ponto/meu');
  assert.equal(meu.banco.saldo, 3);

  // Painel do RH e exportação.
  assert.equal((await ana.req('GET', '/api/ponto')).status, 403);
  const painel = await rh.get('/api/ponto');
  const linha = painel.linhas.find((x) => x.id === cid);
  assert.equal(linha.hoje_situacao, 'trabalhando');
  assert.equal(linha.banco, meu.banco.saldo, 'banco no painel igual ao do colaborador');
  const x = await rh.req('GET', `/api/ponto/exportar?mes=${d1.slice(0, 7)}`);
  assert.equal(x.status, 200);
  assert.ok(x.headers.get('content-type').includes('spreadsheet'));

  // Quem não registra ponto não marca.
  await db.run('UPDATE colaboradores SET bate_ponto = 0 WHERE id = ?', cid);
  await db.run('DELETE FROM rh_ponto WHERE colaborador_id = ? AND data = ?', cid, S.hoje());
  assert.equal((await ana.req('POST', '/api/ponto/bater', {})).status, 400);
});

test('ponto liberado na visão de todas as empresas', async () => {
  const todas = await sessao('admin', undefined, 'todas');
  assert.notEqual((await todas.req('POST', '/api/ponto/bater', {})).status, 409);
});

test('painel de produtividade: setores, cobrança e resultado por colaborador', async () => {
  const admin = await sessao('admin');
  const fin = await sessao('financeiro');
  const ana = await sessao('ana');
  const cliente = (await db.get('SELECT id FROM clientes ORDER BY id LIMIT 1')).id;
  const de = '2000-01-01';
  const ate = S.hoje();
  const antes = await admin.get(`/api/produtividade?de=${de}&ate=${ate}`);
  assert.equal(antes.todos, true);
  await fin.post('/api/cobranca/acoes', { cliente_id: cliente, tipo: 'ligacao', resultado: 'promessa', data_promessa: S.addDias(ate, 5), valor_promessa: 1500 });
  await fin.post('/api/cobranca/acoes', { cliente_id: cliente, tipo: 'whatsapp', resultado: 'sem_contato' });
  const d = await admin.get(`/api/produtividade?de=${de}&ate=${ate}`);
  assert.equal(d.resumo.cobrancas, antes.resumo.cobrancas + 2);
  const idFin = (await db.get(`SELECT id FROM usuarios WHERE login = 'financeiro'`)).id;
  const pf = d.colaboradores.find((x) => x.usuario_id === idFin);
  assert.ok(pf.cobrancas >= 2 && pf.promessas >= 1 && pf.promessas_valor >= 1500);
  assert.ok(pf.por_tipo_cobranca.whatsapp >= 1);
  assert.ok(Array.isArray(d.setores));
  for (const s of d.setores) assert.equal(s.n, s.avancado + s.devolvido + s.reprovado + s.cancelado, `setor ${s.etapa} fecha a conta`);
  const somaSetores = d.setores.reduce((a, s) => a + s.n, 0);
  assert.equal(somaSetores, d.resumo.movimentos, 'movimentos por setor = soma por pessoa');
  if (d.setores.length) assert.ok(d.colaboradores.some((x) => x.por_etapa.length));

  // Sem a permissão, cada um vê só o próprio resultado.
  const so = await ana.get(`/api/produtividade?de=${de}&ate=${ate}&usuario_id=${idFin}`);
  const idAna = (await db.get(`SELECT id FROM usuarios WHERE login = 'ana'`)).id;
  assert.equal(so.todos, false);
  assert.ok(so.colaboradores.every((x) => x.usuario_id === idAna));
  assert.equal((await ana.req('GET', '/api/produtividade/usuarios')).status, 403);
});
