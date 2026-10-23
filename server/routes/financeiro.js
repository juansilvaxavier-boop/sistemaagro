const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;

// ---------- Gestão de Parcelas ----------
const PARCELAS_SQL = `
  SELECT p.id, p.pedido_id, pe.numero AS pedido, nf.numero AS nota, p.cliente_id, c.documento, c.nome AS cliente,
    p.numero AS parcela, p.total_parcelas, p.vencimento, p.vencimento_original, p.valor, p.juros, p.desconto, p.valor_pago,
    ${S.SALDO_PARCELA_SQL} AS saldo, p.data_pagamento, ${S.STATUS_PARCELA_SQL} AS status,
    CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER) ELSE 0 END AS dias_atraso,
    p.tipo_baixa, b.nome AS banco, p.nosso_numero, p.prorrogacoes, v.nome AS vendedor, s.nome AS supervisor, f.nome AS forma,
    (SELECT status FROM negativacoes n WHERE n.parcela_id = p.id ORDER BY n.id DESC LIMIT 1) AS serasa,
    (SELECT tipo FROM blacklist bl WHERE bl.cliente_id = c.id AND bl.ativo = 1 LIMIT 1) AS blacklist
  FROM parcelas p JOIN clientes c ON c.id = p.cliente_id
  LEFT JOIN pedidos pe ON pe.id = p.pedido_id
  LEFT JOIN notas_fiscais nf ON nf.id = p.nota_id
  LEFT JOIN bancos b ON b.id = p.banco_id
  LEFT JOIN usuarios v ON v.id = pe.vendedor_id
  LEFT JOIN usuarios s ON s.id = pe.supervisor_id
  LEFT JOIN formas_pagamento f ON f.id = pe.forma_id
  WHERE p.empresa_id = ?`;

r.get('/parcelas', A.exige('financeiro.parcelas', 'cobranca'), async (req, res) =>
  await responderLista(req, res, { sql: PARCELAS_SQL, params: [req.empresaId], sort: 'vencimento', dir: 'asc', exact: ['status', 'cliente_id', 'pedido_id'] }),
);

r.get('/parcelas/:id', A.exige('financeiro.parcelas', 'cobranca'), async (req, res) => {
  const p = await db.get(`SELECT * FROM (${PARCELAS_SQL}) t WHERE id = ?`, req.empresaId, req.params.id);
  if (!p) throw new ErroNegocio('Parcela não encontrada', 404);
  p.eventos = await db.all('SELECT e.*, u.nome AS usuario FROM parcela_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE parcela_id = ? ORDER BY e.id DESC', p.id);
  p.negativacoes = await db.all('SELECT * FROM negativacoes WHERE parcela_id = ? ORDER BY id DESC', p.id);
  res.json(p);
});

r.post('/parcelas/:id/baixa', A.exige('financeiro.parcelas'), async (req, res) => res.json(await db.tx(async () => await S.baixarParcela(Number(req.params.id), req.body || {}, req.user.id))));
r.post('/parcelas/:id/prorrogar', A.exige('financeiro.parcelas', 'cobranca'), async (req, res) => {
  await db.tx(async () => await S.prorrogarParcela(Number(req.params.id), req.body || {}, req.user.id));
  res.json({ ok: true });
});
r.post('/parcelas/:id/status', A.exige('financeiro.parcelas'), async (req, res) => {
  const status = req.body?.status;
  if (!['a_pagar', 'negociada', 'acordo_judicial', 'cancelada'].includes(status)) throw new ErroNegocio('Status inválido.');
  await db.tx(async () => {
    await db.run('UPDATE parcelas SET status = ? WHERE id = ?', status, req.params.id);
    await S.eventoParcela(Number(req.params.id), 'status', `Status alterado para ${status}. ${req.body?.motivo || ''}`.trim(), req.user.id);
  });
  res.json({ ok: true });
});
r.post('/parcelas/:id/serasa', A.exige('financeiro.negativados'), async (req, res) => {
  const p = await db.get(`SELECT p.*, ${S.SALDO_PARCELA_SQL} AS saldo FROM parcelas p WHERE p.id = ? AND p.empresa_id = ?`, req.params.id, req.empresaId);
  if (!p) throw new ErroNegocio('Parcela não encontrada', 404);
  if (!['a_pagar', 'acordo_judicial'].includes(p.status) || p.vencimento >= S.hoje()) throw new ErroNegocio('Só parcelas vencidas podem ser enviadas ao Serasa.');
  if (await db.get(`SELECT id FROM negativacoes WHERE parcela_id = ? AND status IN ('inclusao_solicitada','inclusao_aceita','baixa_solicitada','baixa_rejeitada')`, p.id)) {
    throw new ErroNegocio('Parcela já está em processo de negativação.');
  }
  const id = await db.insert('negativacoes', { parcela_id: p.id, cliente_id: p.cliente_id, valor: p.saldo, usuario_id: req.user.id });
  await S.eventoParcela(p.id, 'serasa', 'Pedido de inclusão no Serasa', req.user.id);
  res.status(201).json({ id });
});
r.post('/parcelas/:id/blacklist', A.exige('blacklist.editar'), async (req, res) => {
  const p = await db.get('SELECT * FROM parcelas WHERE id = ?', req.params.id);
  if (!p) throw new ErroNegocio('Parcela não encontrada', 404);
  const motivo = req.body?.motivo || `Inadimplência na parcela ${p.numero} (venc. ${p.vencimento})`;
  const id = await db.insert('blacklist', { cliente_id: p.cliente_id, tipo: req.body?.tipo || 'bloqueio', motivo, usuario_id: req.user.id });
  await S.eventoParcela(p.id, 'blacklist', 'Cliente enviado à blacklist', req.user.id);
  res.status(201).json({ id });
});

// ---------- Clientes negativados ----------
const FLUXO_NEGATIVACAO = {
  inclusao_solicitada: ['inclusao_aceita', 'inclusao_rejeitada'],
  inclusao_aceita: ['baixa_solicitada'],
  baixa_solicitada: ['baixa_aceita', 'baixa_rejeitada'],
  baixa_rejeitada: ['baixa_solicitada'],
  inclusao_rejeitada: ['inclusao_solicitada'],
  baixa_aceita: [],
};
r.get('/negativacoes', A.exige('financeiro.negativados'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT n.id, n.parcela_id, c.documento, c.nome AS cliente, pe.numero AS pedido, p.numero AS parcela, p.vencimento,
            n.valor, ${S.STATUS_PARCELA_SQL} AS status_parcela, n.status, n.protocolo, n.motivo_rejeicao, u.nome AS usuario, n.created_at, n.updated_at
          FROM negativacoes n JOIN parcelas p ON p.id = n.parcela_id JOIN clientes c ON c.id = n.cliente_id
          LEFT JOIN pedidos pe ON pe.id = p.pedido_id LEFT JOIN usuarios u ON u.id = n.usuario_id WHERE p.empresa_id = ?`,
    params: [req.empresaId], sort: 'updated_at', exact: ['status'],
  }),
);
r.post('/negativacoes/:id/status', A.exige('financeiro.negativados'), async (req, res) => {
  const n = await db.get('SELECT * FROM negativacoes WHERE id = ?', req.params.id);
  if (!n) throw new ErroNegocio('Registro não encontrado', 404);
  const novo = req.body?.status;
  if (!(FLUXO_NEGATIVACAO[n.status] || []).includes(novo)) throw new ErroNegocio(`Transição inválida: ${n.status} → ${novo}`);
  if (novo.endsWith('rejeitada') && !req.body?.motivo) throw new ErroNegocio('Informe o motivo da rejeição.');
  await db.run(
    `UPDATE negativacoes SET status = ?, motivo_rejeicao = ?, protocolo = COALESCE(?, protocolo), updated_at = datetime('now','localtime') WHERE id = ?`,
    novo, req.body?.motivo || null, novo === 'inclusao_aceita' ? 'SER' + crypto.randomBytes(4).toString('hex').toUpperCase() : null, n.id,
  );
  await S.eventoParcela(n.parcela_id, 'serasa', `Serasa: ${novo.replace('_', ' ')}`, req.user.id);
  res.json({ ok: true, fluxo: FLUXO_NEGATIVACAO });
});
r.get('/negativacoes-fluxo', async (req, res) => res.json(FLUXO_NEGATIVACAO));

// ---------- Lançar descontos/créditos ----------
r.get('/lancamentos', A.exige('financeiro.lancamentos'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT l.id, l.vendedor_id, v.nome AS vendedor, l.periodo, l.tipo_ocorrencia, l.valor, l.descricao, pe.numero AS pedido,
            u.nome AS usuario, l.created_at
          FROM lancamentos_vendedor l JOIN usuarios v ON v.id = l.vendedor_id LEFT JOIN usuarios u ON u.id = l.usuario_id
          LEFT JOIN pedidos pe ON pe.id = l.pedido_id`,
    sort: 'created_at', exact: ['tipo_ocorrencia'],
  }),
);
r.post('/lancamentos', A.exige('financeiro.lancamentos'), async (req, res) => {
  const b = req.body || {};
  if (!b.vendedor_id || !/^\d{4}-\d{2}$/.test(b.periodo || '')) throw new ErroNegocio('Informe vendedor e período (AAAA-MM).');
  if (!['desconto', 'credito', 'desconto_brinde', 'desconto_devolucao'].includes(b.tipo_ocorrencia)) throw new ErroNegocio('Tipo de ocorrência inválido.');
  if (!(Number(b.valor) > 0)) throw new ErroNegocio('Informe o valor.');
  res.status(201).json({ id: await db.insert('lancamentos_vendedor', { ...b, usuario_id: req.user.id }, ['vendedor_id', 'periodo', 'tipo_ocorrencia', 'valor', 'descricao', 'pedido_id', 'usuario_id']) });
});
r.delete('/lancamentos/:id', A.exige('financeiro.lancamentos'), async (req, res) => {
  await db.run('DELETE FROM lancamentos_vendedor WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------- Revisar comissões ----------
r.get('/comissoes', A.exige('financeiro.comissoes'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT c.id, c.usuario_id, u.nome AS colaborador, c.periodo, c.perfil, c.tipo_comissao, e.nome AS empresa_recibo,
            pe.numero AS pedido, c.valor_base, c.percentual, c.perda_pct, c.valor, c.status, c.observacao
          FROM comissoes c JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN empresas e ON e.id = c.empresa_id
          LEFT JOIN pedidos pe ON pe.id = c.pedido_id`,
    sort: 'periodo', exact: ['status', 'perfil', 'tipo_comissao'],
  }),
);
r.get('/comissoes/resumo', A.exige('financeiro.comissoes'), async (req, res) => {
  const periodo = req.query.periodo || S.hoje().slice(0, 7);
  res.json((await db.all(
    `SELECT u.id, u.nome, u.perfil, ? AS periodo,
       IFNULL((SELECT SUM(valor) FROM comissoes c WHERE c.usuario_id = u.id AND c.periodo = ?),0) AS comissoes,
       IFNULL((SELECT SUM(valor) FROM lancamentos_vendedor l WHERE l.vendedor_id = u.id AND l.periodo = ? AND l.tipo_ocorrencia = 'credito'),0) AS creditos,
       IFNULL((SELECT SUM(valor) FROM lancamentos_vendedor l WHERE l.vendedor_id = u.id AND l.periodo = ? AND l.tipo_ocorrencia <> 'credito'),0) AS descontos
     FROM usuarios u WHERE u.perfil IN ('vendedor','supervisor') ORDER BY u.nome`,
    periodo, periodo, periodo, periodo,
  )).map((x) => ({ ...x, liquido: S.r2(x.comissoes + x.creditos - x.descontos) })));
});
r.put('/comissoes/:id', A.exige('financeiro.comissoes'), async (req, res) => {
  const b = req.body || {};
  if (b.status && !['aberta', 'revisada', 'paga'].includes(b.status)) throw new ErroNegocio('Status inválido.');
  await db.update('comissoes', req.params.id, b, ['status', 'valor', 'percentual', 'observacao', 'empresa_id']);
  res.json({ ok: true });
});
r.post('/comissoes/lote', A.exige('financeiro.comissoes'), async (req, res) => {
  const { ids, status } = req.body || {};
  if (!['revisada', 'paga'].includes(status) || !Array.isArray(ids)) throw new ErroNegocio('Dados inválidos.');
  await db.tx(async () => {
    for (const id of ids) await db.run('UPDATE comissoes SET status = ? WHERE id = ?', status, id);
  });
  res.json({ ok: true, n: ids.length });
});

// ---------- Desconto de devolução ----------
r.get('/devolucoes', A.exige('financeiro.devolucoes', 'financeiro.notas'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT d.id, nf.numero AS nota, pe.numero AS pedido, c.nome AS cliente, d.motivo, d.tipo, d.valor, d.frete, d.total,
            d.baixa_parcelas, u.nome AS usuario, d.created_at
          FROM devolucoes d JOIN notas_fiscais nf ON nf.id = d.nota_id JOIN clientes c ON c.id = nf.cliente_id
          LEFT JOIN pedidos pe ON pe.id = d.pedido_id LEFT JOIN usuarios u ON u.id = d.usuario_id WHERE nf.empresa_id = ?`,
    params: [req.empresaId], sort: 'created_at',
  }),
);
r.post('/devolucoes', A.exige('financeiro.devolucoes', 'financeiro.notas'), async (req, res) => {
  const b = { ...req.body };
  if (!b.nota_id && b.nota_numero) b.nota_id = (await db.get('SELECT id FROM notas_fiscais WHERE numero = ? AND empresa_id = ?', b.nota_numero, req.empresaId))?.id;
  const dev = await db.tx(async () => {
    const d = await S.registrarDevolucao(b, req.user.id);
    const ped = d.pedido_id ? await db.get('SELECT vendedor_id FROM pedidos WHERE id = ?', d.pedido_id) : null;
    if (ped && b.desconto_vendedor) {
      await db.insert('lancamentos_vendedor', {
        vendedor_id: ped.vendedor_id, periodo: S.hoje().slice(0, 7), tipo_ocorrencia: 'desconto_devolucao', valor: S.r2(b.desconto_vendedor),
        descricao: `Devolução #${d.id}: ${d.motivo}`, pedido_id: d.pedido_id, usuario_id: req.user.id,
      });
    }
    return d;
  });
  res.status(201).json(dev);
});

// ---------- Nota fiscal de saída ----------
r.get('/notas', A.exige('financeiro.notas'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT nf.id, nf.numero, nf.serie, nf.data_emissao, pe.numero AS pedido, c.documento, c.nome AS cliente, nf.valor, nf.status, nf.chave,
            (SELECT COUNT(*) FROM cartas_correcao cc WHERE cc.nota_id = nf.id) AS cartas_correcao,
            (SELECT IFNULL(SUM(valor),0) FROM devolucoes d WHERE d.nota_id = nf.id) AS devolvido
          FROM notas_fiscais nf JOIN clientes c ON c.id = nf.cliente_id LEFT JOIN pedidos pe ON pe.id = nf.pedido_id WHERE nf.empresa_id = ?`,
    params: [req.empresaId], sort: 'numero', exact: ['status'],
  }),
);
r.get('/notas/:id', A.exige('financeiro.notas'), async (req, res) => {
  const n = await db.get('SELECT nf.*, c.nome AS cliente, c.documento, pe.numero AS pedido FROM notas_fiscais nf JOIN clientes c ON c.id = nf.cliente_id LEFT JOIN pedidos pe ON pe.id = nf.pedido_id WHERE nf.id = ? AND nf.empresa_id = ?', req.params.id, req.empresaId);
  if (!n) throw new ErroNegocio('Nota não encontrada', 404);
  n.cartas = await db.all('SELECT cc.*, u.nome AS usuario FROM cartas_correcao cc LEFT JOIN usuarios u ON u.id = cc.usuario_id WHERE nota_id = ? ORDER BY sequencia', n.id);
  n.devolucoes = await db.all('SELECT * FROM devolucoes WHERE nota_id = ?', n.id);
  n.parcelas = await db.all(`SELECT p.*, ${S.STATUS_PARCELA_SQL} AS status_atual FROM parcelas p WHERE nota_id = ? ORDER BY numero`, n.id);
  n.itens = n.pedido_id ? await db.all('SELECT i.*, pr.nome AS produto, pr.ncm FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id WHERE pedido_id = ?', n.pedido_id) : [];
  res.json(n);
});
r.post('/notas/:id/cancelar', A.exige('financeiro.notas'), async (req, res) => {
  const n = await db.get('SELECT * FROM notas_fiscais WHERE id = ? AND empresa_id = ?', req.params.id, req.empresaId);
  if (!n) throw new ErroNegocio('Nota não encontrada', 404);
  if (n.status !== 'autorizada') throw new ErroNegocio('Só notas autorizadas podem ser canceladas.');
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 15) throw new ErroNegocio('A justificativa do cancelamento deve ter ao menos 15 caracteres.');
  const horas = (Date.now() - Date.parse(n.data_emissao.replace(' ', 'T'))) / 3600e3;
  if (horas > 24 && !req.body?.extemporaneo) throw new ErroNegocio('Prazo de 24h para cancelamento excedido. Marque como cancelamento extemporâneo.');
  await db.tx(async () => {
    if (await db.get('SELECT id FROM parcelas WHERE nota_id = ? AND valor_pago > 0', n.id)) throw new ErroNegocio('Nota com parcelas pagas não pode ser cancelada. Registre devolução.');
    await db.run(`UPDATE notas_fiscais SET status = 'cancelada', motivo_cancelamento = ?, data_cancelamento = datetime('now','localtime') WHERE id = ?`, motivo, n.id);
    await db.run(`UPDATE parcelas SET status = 'cancelada' WHERE nota_id = ?`, n.id);
    if (n.pedido_id) {
      await db.run(`DELETE FROM comissoes WHERE pedido_id = ? AND status = 'aberta'`, n.pedido_id);
      await S.estornarEstoquePedido(n.pedido_id, 'cancelamento', req.user.id);
      const ped = await db.get('SELECT etapa FROM pedidos WHERE id = ?', n.pedido_id);
      await db.run(`UPDATE pedidos SET etapa = 'faturamento', etapa_desde = datetime('now','localtime') WHERE id = ?`, n.pedido_id);
      await S.registrarHistorico(n.pedido_id, { origem: ped.etapa, destino: 'faturamento', acao: `NF ${n.numero} cancelada`, observacao: motivo, usuarioId: req.user.id });
    }
  });
  res.json({ ok: true });
});
r.post('/notas/:id/carta-correcao', A.exige('financeiro.notas'), async (req, res) => {
  const n = await db.get('SELECT * FROM notas_fiscais WHERE id = ? AND empresa_id = ?', req.params.id, req.empresaId);
  if (!n) throw new ErroNegocio('Nota não encontrada', 404);
  if (n.status === 'cancelada') throw new ErroNegocio('Nota cancelada não aceita carta de correção.');
  const texto = String(req.body?.texto || '').trim();
  if (texto.length < 15) throw new ErroNegocio('A correção deve ter ao menos 15 caracteres.');
  const seq = (await db.get('SELECT IFNULL(MAX(sequencia),0) + 1 AS s FROM cartas_correcao WHERE nota_id = ?', n.id)).s;
  if (seq > 20) throw new ErroNegocio('Limite de 20 cartas de correção por nota.');
  res.status(201).json({ id: await db.insert('cartas_correcao', { nota_id: n.id, sequencia: seq, texto, usuario_id: req.user.id }), sequencia: seq });
});

module.exports = r;
