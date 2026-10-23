// Cobrança completa: carteira de inadimplência por cliente, ações de cobrança, promessas e acordos.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;

const ATRASO_SQL = `CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER)`;

r.get('/carteira', A.exige('cobranca'), (req, res) =>
  responderLista(req, res, {
    sql: `
      SELECT c.id, c.documento, c.nome AS cliente, v.nome AS vendedor,
        (SELECT numero FROM cliente_telefones t WHERE t.cliente_id = c.id LIMIT 1) AS telefone,
        COUNT(*) AS parcelas_abertas,
        SUM(CASE WHEN p.vencimento < date('now','localtime') THEN 1 ELSE 0 END) AS parcelas_vencidas,
        ROUND(SUM(${S.SALDO_PARCELA_SQL}), 2) AS saldo_aberto,
        ROUND(SUM(CASE WHEN p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} ELSE 0 END), 2) AS saldo_vencido,
        MAX(CASE WHEN p.vencimento < date('now','localtime') THEN ${ATRASO_SQL} ELSE 0 END) AS maior_atraso,
        MIN(p.vencimento) AS vencimento_mais_antigo,
        CASE
          WHEN MAX(${ATRASO_SQL}) > 90 THEN '90+'
          WHEN MAX(${ATRASO_SQL}) > 60 THEN '61-90'
          WHEN MAX(${ATRASO_SQL}) > 30 THEN '31-60'
          WHEN MAX(${ATRASO_SQL}) > 0 THEN '1-30'
          ELSE 'A vencer' END AS faixa,
        (SELECT MAX(created_at) FROM cobranca_acoes a WHERE a.cliente_id = c.id) AS ultima_acao,
        (SELECT tipo || ': ' || IFNULL(resultado,'') FROM cobranca_acoes a WHERE a.cliente_id = c.id ORDER BY a.id DESC LIMIT 1) AS ultima_acao_desc,
        (SELECT MIN(data_promessa) FROM cobranca_acoes a WHERE a.cliente_id = c.id AND a.data_promessa >= date('now','localtime')) AS promessa,
        (SELECT MIN(proxima_acao) FROM cobranca_acoes a WHERE a.cliente_id = c.id AND a.proxima_acao >= date('now','localtime','-30 days')) AS proxima_acao,
        (SELECT status FROM negativacoes n WHERE n.cliente_id = c.id ORDER BY n.id DESC LIMIT 1) AS serasa,
        (SELECT tipo FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 LIMIT 1) AS blacklist
      FROM parcelas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios v ON v.id = c.vendedor_id
      WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND (? = 1 OR p.vencimento < date('now','localtime'))
      GROUP BY c.id`,
    params: [req.empresaId, req.query.incluir_a_vencer === '1' ? 1 : 0], sort: 'saldo_vencido', dir: 'desc', exact: ['faixa'],
  }),
);

r.get('/resumo', A.exige('cobranca'), (req, res) => {
  const base = `FROM parcelas p WHERE p.empresa_id = ? AND ${S.ABERTA_SQL}`;
  const faixas = db.all(
    `SELECT CASE WHEN p.vencimento >= date('now','localtime') THEN 'A vencer'
                 WHEN ${ATRASO_SQL} <= 30 THEN '1-30' WHEN ${ATRASO_SQL} <= 60 THEN '31-60'
                 WHEN ${ATRASO_SQL} <= 90 THEN '61-90' ELSE '90+' END AS faixa,
            COUNT(*) AS parcelas, COUNT(DISTINCT p.cliente_id) AS clientes, ROUND(SUM(${S.SALDO_PARCELA_SQL}),2) AS valor
     ${base} GROUP BY faixa`, req.empresaId,
  );
  const ordem = ['A vencer', '1-30', '31-60', '61-90', '90+'];
  faixas.sort((a, b) => ordem.indexOf(a.faixa) - ordem.indexOf(b.faixa));
  const hoje = S.hoje();
  res.json({
    faixas,
    promessas_hoje: db.get(`SELECT COUNT(*) AS n, IFNULL(SUM(valor_promessa),0) AS v FROM cobranca_acoes WHERE data_promessa = ?`, hoje),
    promessas_vencidas: db.get(
      `SELECT COUNT(*) AS n FROM cobranca_acoes a WHERE a.data_promessa < ? AND a.data_promessa >= date(?, '-30 days')
         AND EXISTS (SELECT 1 FROM parcelas p WHERE p.cliente_id = a.cliente_id AND ${S.ABERTA_SQL} AND p.vencimento < ?)`, hoje, hoje, hoje,
    ).n,
    acoes_hoje: db.get(`SELECT COUNT(*) AS n FROM cobranca_acoes WHERE date(created_at) = ?`, hoje).n,
    recuperado_mes: db.get(
      `SELECT IFNULL(SUM(valor_pago),0) AS v FROM parcelas p WHERE p.empresa_id = ? AND p.status = 'liquidada'
         AND p.data_pagamento >= ? AND p.data_pagamento > p.vencimento_original`, req.empresaId, hoje.slice(0, 7) + '-01',
    ).v,
  });
});

r.get('/agenda', A.exige('cobranca'), (req, res) => {
  res.json(db.all(
    `SELECT a.*, c.nome AS cliente, c.documento, u.nome AS usuario,
       (SELECT ROUND(SUM(${S.SALDO_PARCELA_SQL}),2) FROM parcelas p WHERE p.cliente_id = a.cliente_id AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime')) AS saldo_vencido
     FROM cobranca_acoes a JOIN clientes c ON c.id = a.cliente_id LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE (a.proxima_acao BETWEEN date('now','localtime','-7 days') AND date('now','localtime','+7 days'))
        OR (a.data_promessa BETWEEN date('now','localtime','-7 days') AND date('now','localtime','+7 days'))
     ORDER BY COALESCE(a.data_promessa, a.proxima_acao)`,
  ));
});

r.get('/cliente/:id', A.exige('cobranca'), (req, res) => {
  const id = Number(req.params.id);
  const cliente = db.get('SELECT c.*, v.nome AS vendedor FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id WHERE c.id = ?', id);
  if (!cliente) throw new ErroNegocio('Cliente não encontrado', 404);
  res.json({
    cliente,
    telefones: db.all('SELECT * FROM cliente_telefones WHERE cliente_id = ?', id),
    parcelas: db.all(
      `SELECT p.*, pe.numero AS pedido, nf.numero AS nota, ${S.STATUS_PARCELA_SQL} AS status_atual, ${S.SALDO_PARCELA_SQL} AS saldo,
         CASE WHEN p.vencimento < date('now','localtime') THEN ${ATRASO_SQL} ELSE 0 END AS dias_atraso
       FROM parcelas p LEFT JOIN pedidos pe ON pe.id = p.pedido_id LEFT JOIN notas_fiscais nf ON nf.id = p.nota_id
       WHERE p.cliente_id = ? AND p.empresa_id = ? AND ${S.ABERTA_SQL} ORDER BY p.vencimento`, id, req.empresaId,
    ),
    acoes: db.all(
      'SELECT a.*, u.nome AS usuario FROM cobranca_acoes a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.cliente_id = ? ORDER BY a.id DESC', id,
    ),
    acordos: db.all('SELECT a.*, u.nome AS usuario FROM acordos a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE cliente_id = ? ORDER BY id DESC', id),
    blacklist: S.situacaoBlacklist(id),
  });
});

const TIPOS_ACAO = ['ligacao', 'whatsapp', 'email', 'sms', 'visita', 'carta', 'promessa', 'acordo'];
r.get('/acoes', A.exige('cobranca'), (req, res) =>
  responderLista(req, res, {
    sql: `SELECT a.id, a.cliente_id, c.nome AS cliente, a.tipo, a.resultado, a.descricao, a.data_promessa, a.valor_promessa, a.proxima_acao,
            u.nome AS usuario, a.created_at
          FROM cobranca_acoes a JOIN clientes c ON c.id = a.cliente_id LEFT JOIN usuarios u ON u.id = a.usuario_id`,
    sort: 'created_at', exact: ['tipo', 'cliente_id'],
  }),
);
r.post('/acoes', A.exige('cobranca'), (req, res) => {
  const b = req.body || {};
  if (!TIPOS_ACAO.includes(b.tipo)) throw new ErroNegocio('Tipo de ação inválido.');
  if (!b.cliente_id) throw new ErroNegocio('Informe o cliente.');
  if (b.resultado === 'promessa' && !b.data_promessa) throw new ErroNegocio('Informe a data da promessa de pagamento.');
  const id = db.insert('cobranca_acoes', { ...b, usuario_id: req.user.id },
    ['cliente_id', 'parcela_id', 'tipo', 'resultado', 'descricao', 'data_promessa', 'valor_promessa', 'proxima_acao', 'usuario_id']);
  // A ação também entra no histórico de relacionamento do CRM.
  db.insert('crm_interacoes', {
    cliente_id: b.cliente_id, tipo: b.tipo === 'promessa' || b.tipo === 'acordo' ? 'ligacao' : b.tipo,
    assunto: `Cobrança: ${b.resultado || b.tipo}`, descricao: b.descricao, usuario_id: req.user.id,
  });
  if (b.parcela_id) S.eventoParcela(b.parcela_id, 'cobranca', `${b.tipo}: ${b.resultado || ''} ${b.descricao || ''}`.trim(), req.user.id);
  res.status(201).json({ id });
});

/** Acordo: substitui as parcelas selecionadas por um novo parcelamento. */
r.post('/acordos', A.exige('cobranca'), (req, res) => {
  const b = req.body || {};
  const ids = (b.parcelas || []).map(Number);
  if (!ids.length) throw new ErroNegocio('Selecione as parcelas do acordo.');
  const n = Math.max(parseInt(b.num_parcelas, 10) || 1, 1);
  if (!b.primeiro_vencimento) throw new ErroNegocio('Informe o primeiro vencimento.');
  const resultado = db.tx(() => {
    const parcelas = db.all(
      `SELECT p.*, ${S.SALDO_PARCELA_SQL} AS saldo FROM parcelas p WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.cliente_id = ? AND ${S.ABERTA_SQL}`,
      ...ids, b.cliente_id,
    );
    if (parcelas.length !== ids.length) throw new ErroNegocio('Há parcelas inválidas ou que não estão em aberto.');
    const original = S.r2(parcelas.reduce((a, p) => a + p.saldo, 0) + (Number(b.juros) || 0));
    const desconto = S.r2(b.desconto);
    const valorAcordo = S.r2(original - desconto);
    if (valorAcordo <= 0) throw new ErroNegocio('Valor do acordo inválido.');
    const acordoId = db.insert('acordos', {
      cliente_id: b.cliente_id, valor_original: original, desconto, valor_acordo: valorAcordo, parcelas: n,
      primeiro_vencimento: b.primeiro_vencimento, judicial: b.judicial ? 1 : 0, observacao: b.observacao, usuario_id: req.user.id,
    });
    for (const p of parcelas) {
      db.run(`UPDATE parcelas SET status = 'negociada', observacao = ? WHERE id = ?`, `Acordo #${acordoId}`, p.id);
      S.eventoParcela(p.id, 'acordo', `Incluída no acordo #${acordoId}`, req.user.id);
    }
    const ref = parcelas[0];
    const vp = Math.floor((valorAcordo / n) * 100) / 100;
    for (let i = 0; i < n; i++) {
      const venc = S.addDias(b.primeiro_vencimento, i * (parseInt(b.intervalo_dias, 10) || 30));
      db.insert('parcelas', {
        pedido_id: ref.pedido_id, nota_id: ref.nota_id, cliente_id: ref.cliente_id, empresa_id: ref.empresa_id, numero: i + 1, total_parcelas: n,
        vencimento: venc, vencimento_original: venc, valor: i === n - 1 ? S.r2(valorAcordo - vp * (n - 1)) : vp,
        status: b.judicial ? 'acordo_judicial' : 'a_pagar', tipo_baixa: b.tipo_baixa || 'boleto', observacao: `Acordo #${acordoId}`,
        nosso_numero: String(db.nextSeq('nosso_numero', 100000)),
      });
    }
    db.insert('cobranca_acoes', {
      cliente_id: b.cliente_id, tipo: 'acordo', resultado: 'acordo', descricao: `Acordo #${acordoId}: ${n}x, total R$ ${valorAcordo.toFixed(2)}`, usuario_id: req.user.id,
    });
    return { id: acordoId, valor_acordo: valorAcordo };
  });
  res.status(201).json(resultado);
});

module.exports = r;
