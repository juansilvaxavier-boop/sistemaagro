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

test('horário por colaborador, atraso e lembretes (regras puras)', () => {
  assert.equal(P.validarHorario(null), null);
  const h = P.validarHorario({ 1: { e: '08:00', si: '12:00', vi: '13:00', s: '17:00' }, 6: { e: '08:00', s: '12:00' }, 0: {} });
  assert.deepEqual(Object.keys(h), ['1', '6']);
  assert.throws(() => P.validarHorario({ 2: { e: '18:00', s: '08:00' } }), /fora de ordem/);
  assert.throws(() => P.validarHorario({ 2: { e: '08:00', si: '12:00', s: '17:00' } }), /intervalo/i);
  const c = { horario: JSON.stringify(h), carga_horaria: 44 };
  assert.equal(P.previstoDia(c, '2026-10-26'), 480, 'segunda pelo horário');
  assert.equal(P.previstoDia(c, '2026-10-31'), 240, 'sábado meio período');
  assert.equal(P.previstoDia(c, '2026-10-27'), 0, 'terça sem horário = folga');
  const rg = P.REGRAS_PADRAO;
  const d = h[1];
  assert.equal(P.avisoDevido(d, 0, 8 * 60 + 10, rg), null, 'dentro dos 15 min');
  assert.equal(P.avisoDevido(d, 0, 8 * 60 + 20, rg), 'entrada');
  assert.equal(P.avisoDevido(d, 1, 13 * 60 + 20, rg), 'intervalo');
  assert.equal(P.avisoDevido(d, 3, 17 * 60 + 40, rg), 'saida');
  assert.equal(P.avisoDevido(d, 4, 17 * 60 + 40, rg), null);
  assert.ok(Math.abs(P.distancia(-16.6869, -49.2648, -16.70, -49.2648) - 1457) < 5);
});

test('cercas, foto, horário pelo RH e avisos de esquecimento', async () => {
  const rh = await sessao('rh');
  const bruno = await sessao('bruno');
  const ana = await sessao('ana');
  const { id: cid } = await rh.post('/api/rh/colaboradores', {
    nome: 'Cerca de Teste', cpf: '390.533.447-05', cargo: 'Operador de produção', departamento: 'Produção', tipo_contrato: 'clt', data_admissao: '2020-01-02',
  });
  await db.run(`UPDATE usuarios SET colaborador_id = ? WHERE login = 'bruno'`, cid);
  const outro = (await db.get(`SELECT id FROM colaboradores WHERE id <> ? AND ativo = 1 ORDER BY id LIMIT 1`, cid)).id;

  // Horário de segunda a domingo (para o teste valer em qualquer dia), copiado para outro colaborador.
  const todos = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [i, { e: '08:00', si: '12:00', vi: '13:00', s: '17:00' }]));
  assert.equal((await bruno.req('PUT', `/api/ponto/colaborador/${cid}/horario`, { horario: todos })).status, 403);
  assert.equal((await rh.req('PUT', `/api/ponto/colaborador/${cid}/horario`, { horario: { 1: { e: '09:00', s: '08:00' } } })).status, 400);
  const salvo = await rh.put(`/api/ponto/colaborador/${cid}/horario`, { horario: todos, aplicar_a: [outro] });
  assert.equal(salvo.atualizados, 2);
  assert.ok((await db.get('SELECT horario FROM colaboradores WHERE id = ?', outro)).horario);
  const esp = await rh.get(`/api/ponto/colaborador/${cid}`);
  assert.equal(esp.colaborador.horario[3].s, '17:00');

  // Cerca: dentro do raio, fora (sinalizado) e recusado quando a regra manda.
  await rh.post('/api/ponto/locais', { nome: 'Matriz', latitude: -16.6869, longitude: -49.2648, raio: 200 });
  assert.equal((await rh.req('POST', '/api/ponto/locais', { nome: 'X', latitude: 0, longitude: 0 })).status, 400);
  const limpar = () => db.run('DELETE FROM rh_ponto WHERE colaborador_id = ?', cid);
  let m = await bruno.post('/api/ponto/bater', { latitude: -16.6872, longitude: -49.2650, precisao: 20 });
  assert.equal(m.fora_cerca, false);
  assert.equal(m.local, 'Matriz');
  await limpar();
  m = await bruno.post('/api/ponto/bater', { latitude: -16.70, longitude: -49.2648, precisao: 20 });
  assert.equal(m.fora_cerca, true);
  assert.ok(m.distancia > 1400);
  await limpar();
  await rh.put('/api/ponto/regras', { bloquear_fora_cerca: 1, exigir_foto: 1, avisos: 1, aviso_entrada: 15, aviso_saida: 30, tolerancia_atraso: 5 });
  let r = await bruno.req('POST', '/api/ponto/bater', { latitude: -16.70, longitude: -49.2648 });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /Matriz/);
  assert.equal((await bruno.req('POST', '/api/ponto/bater', {})).status, 400, 'sem localização com cerca obrigatória');
  r = await bruno.req('POST', '/api/ponto/bater', { latitude: -16.6869, longitude: -49.2648 });
  assert.match(r.dados.erro, /foto/i, 'foto obrigatória');
  const foto = `data:image/jpeg;base64,${Buffer.from('foto-teste').toString('base64')}`;
  m = await bruno.post('/api/ponto/bater', { latitude: -16.6869, longitude: -49.2648, foto });
  assert.equal((await bruno.req('GET', `/api/ponto/${m.id}/foto`)).status, 200, 'o próprio colaborador vê a foto');
  assert.equal((await rh.req('GET', `/api/ponto/${m.id}/foto`)).status, 200);
  assert.equal((await ana.req('GET', `/api/ponto/${m.id}/foto`)).status, 403, 'outro colaborador não vê');
  assert.equal(Buffer.from((await rh.req('GET', `/api/ponto/${m.id}/foto`)).dados).toString(), 'foto-teste');
  // Trabalho externo marca fora da cerca mesmo com bloqueio.
  await limpar();
  await rh.put(`/api/ponto/colaborador/${cid}/horario`, { horario: todos, ponto_externo: 1 });
  m = await bruno.post('/api/ponto/bater', { latitude: -15.6, longitude: -47.9, foto });
  assert.equal(m.fora_cerca, false);
  await rh.put('/api/ponto/regras', { avisos: 1 });
  await limpar();

  // Avisos: sem marcação às 09:00 → aviso de entrada, uma vez só; com a entrada às 17:40 → aviso de saída.
  const hoje = S.hoje();
  await db.run('DELETE FROM rh_ponto_avisos');
  let v = await P.verificarAvisos(`${hoje} 09:00:00`);
  assert.ok(v.enviados.some((x) => x.colaborador_id === cid && x.tipo === 'entrada'));
  v = await P.verificarAvisos(`${hoje} 09:05:00`);
  assert.ok(!v.enviados.some((x) => x.colaborador_id === cid), 'não repete o aviso');
  await db.insert('rh_ponto', { colaborador_id: cid, empresa_id: 1, data: hoje, hora: '08:10:00', origem: 'web' });
  v = await P.verificarAvisos(`${hoje} 17:40:00`);
  assert.ok(v.enviados.some((x) => x.colaborador_id === cid && x.tipo === 'saida'));
  const meu = await bruno.get('/api/ponto/meu');
  assert.ok(meu.push_chave && meu.push_chave.length > 40, 'chave pública para os lembretes');
  assert.equal((await bruno.req('POST', '/api/ponto/push', { inscricao: { endpoint: 'http://x' } })).status, 400);
  await bruno.post('/api/ponto/push', { inscricao: { endpoint: 'https://push.exemplo/abc', keys: { p256dh: 'p', auth: 'a' } } });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_inscricoes')).n, 1);
  await bruno.post('/api/ponto/push/remover', { endpoint: 'https://push.exemplo/abc' });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_inscricoes')).n, 0);

  // Atraso no espelho: entrada 08:10 contra 08:00 com tolerância de 5 min.
  const ontem = S.addDias(hoje, -1);
  for (const h of ['08:20:00', '12:00:00', '13:00:00', '17:00:00']) await db.insert('rh_ponto', { colaborador_id: cid, empresa_id: 1, data: ontem, hora: h, origem: 'web' });
  const dia = (await rh.get(`/api/ponto/colaborador/${cid}?mes=${ontem.slice(0, 7)}`)).espelho.dias.find((x) => x.data === ontem);
  assert.equal(dia.atraso, 20);
  assert.equal(dia.previsto, 480);
});

test('conversão da cobrança: pagamento depois da ação e promessa cumprida', async () => {
  const admin = await sessao('admin');
  const fin = await sessao('financeiro');
  const hoje = S.hoje();
  const p = await db.get(`SELECT id, cliente_id, valor FROM parcelas WHERE empresa_id = 1 AND status = 'a_pagar' AND vencimento < ? ORDER BY id LIMIT 1`, hoje);
  assert.ok(p, 'há parcela vencida no seed');
  const idFin = (await db.get(`SELECT id FROM usuarios WHERE login = 'financeiro'`)).id;
  const url = `/api/produtividade?de=${hoje}&ate=${hoje}&usuario_id=${idFin}`;
  const antes = (await admin.get(url)).colaboradores.find((x) => x.usuario_id === idFin);
  await fin.post('/api/cobranca/acoes', { cliente_id: p.cliente_id, tipo: 'ligacao', resultado: 'promessa', data_promessa: S.addDias(hoje, 2), valor_promessa: p.valor });
  await db.run(`UPDATE parcelas SET valor_pago = valor, data_pagamento = ?, status = 'liquidada' WHERE id = ?`, hoje, p.id);
  const d = await admin.get(url);
  const x = d.colaboradores.find((c) => c.usuario_id === idFin);
  assert.ok(x.recuperado >= (antes?.recuperado || 0) + p.valor - 0.01, 'valor recuperado inclui o pagamento');
  assert.ok(x.clientes_pagaram >= 1 && x.conversao > 0);
  assert.ok(x.promessas_cumpridas >= 1);
  assert.equal(x.cumprimento, x.promessas_cumpridas + x.promessas_quebradas ? Math.round((x.promessas_cumpridas / (x.promessas_cumpridas + x.promessas_quebradas)) * 10000) / 100 : null);
  assert.ok(d.resumo.recuperado >= x.recuperado);
});
