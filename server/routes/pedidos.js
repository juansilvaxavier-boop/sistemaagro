const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const W = require('../workflow');
const { responderLista } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;

/** Restrição de visibilidade dos pedidos por perfil, sempre dentro da empresa da sessão. */
function escopo(req, alias = 'p') {
  const u = req.user;
  const cond = [`${alias}.empresa_id = ?`];
  const params = [req.empresaId];
  if (u.perfil === 'vendedor') cond.push(`${alias}.vendedor_id = ?`), params.push(u.id);
  if (u.perfil === 'supervisor') cond.push(`(${alias}.supervisor_id = ? OR ${alias}.vendedor_id = ?)`), params.push(u.id, u.id);
  return { sql: cond.join(' AND '), params };
}

const etapaLabelSql = `CASE p.etapa ${Object.entries(W.ETAPAS).map(([k, v]) => `WHEN '${k}' THEN '${v.label}'`).join(' ')} END`;

const LISTA_SQL = `
  SELECT p.id, p.numero, p.created_at AS data, c.documento, c.nome AS cliente, c.id AS cliente_id,
    f.nome AS forma, cp.descricao AS condicao, p.valor_total AS valor,
    v.nome AS vendedor, s.nome AS supervisor, a.nome AS analista, eq.nome AS equipe,
    en.uf, en.cidade, p.etapa, ${etapaLabelSql} AS etapa_label, p.etapa_desde,
    CAST(julianday('now','localtime') - julianday(p.etapa_desde) AS INTEGER) AS dias_etapa,
    p.prazo_producao, p.data_chegada_producao, p.data_embarque, p.data_entrega_prevista, p.data_entrega,
    t.nome AS transportadora, nf.numero AS nota, p.tipo_entrega,
    (SELECT tipo FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 ORDER BY CASE tipo WHEN 'bloqueio' THEN 0 ELSE 1 END LIMIT 1) AS blacklist,
    (SELECT COUNT(*) FROM mensagens m WHERE m.pedido_id = p.id) AS mensagens
  FROM pedidos p
  JOIN clientes c ON c.id = p.cliente_id
  LEFT JOIN formas_pagamento f ON f.id = p.forma_id
  LEFT JOIN condicoes_pagamento cp ON cp.id = p.condicao_id
  LEFT JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN usuarios s ON s.id = p.supervisor_id
  LEFT JOIN usuarios a ON a.id = p.analista_id
  LEFT JOIN equipes eq ON eq.id = v.equipe_id
  LEFT JOIN cliente_enderecos en ON en.id = p.endereco_entrega_id
  LEFT JOIN transportadoras t ON t.id = p.transportadora_id
  LEFT JOIN notas_fiscais nf ON nf.pedido_id = p.id AND nf.status <> 'cancelada'`;

// Fila de uma etapa
r.get('/fila/:etapa', (req, res) => {
  const etapa = W.ETAPAS[req.params.etapa];
  if (!etapa) throw new ErroNegocio('Etapa inválida', 404);
  if (!A.can(req.user.perfil, etapa.fila || 'x')) throw new ErroNegocio('Sem acesso a esta fila.', 403);
  const e = escopo(req);
  const etapas = req.params.etapa === 'transito' && req.query.aba === 'entregues' ? ['entregue'] : [req.params.etapa];
  responderLista(req, res, {
    sql: `${LISTA_SQL} WHERE ${e.sql} AND p.etapa IN (${etapas.map(() => '?').join(',')})`,
    params: [...e.params, ...etapas], sort: 'etapa_desde', dir: 'asc',
  });
});

// Progressão dos pedidos (histórico geral)
r.get('/progressao', A.exige('fila'), (req, res) => {
  const e = escopo(req);
  responderLista(req, res, { sql: `${LISTA_SQL} WHERE ${e.sql}`, params: e.params, sort: 'numero', exact: ['etapa'] });
});

// Contagem por etapa (badges do menu)
r.get('/contagem', (req, res) => {
  const e = escopo(req);
  const rows = db.all(`SELECT etapa, COUNT(*) AS n FROM pedidos p WHERE ${e.sql} GROUP BY etapa`, ...e.params);
  res.json(Object.fromEntries(rows.map((x) => [x.etapa, x.n])));
});

function carregar(req, id) {
  const e = escopo(req);
  const p = db.get(`SELECT p.* FROM pedidos p WHERE p.id = ? AND ${e.sql}`, id, ...e.params);
  if (!p) throw new ErroNegocio('Pedido não encontrado', 404);
  return p;
}

r.get('/:id', (req, res) => {
  const p = carregar(req, Number(req.params.id));
  const id = p.id;
  res.json({
    pedido: {
      ...p,
      etapa_label: W.ETAPAS[p.etapa]?.label,
      vendedor: db.get('SELECT nome FROM usuarios WHERE id = ?', p.vendedor_id)?.nome,
      supervisor: p.supervisor_id ? db.get('SELECT nome FROM usuarios WHERE id = ?', p.supervisor_id)?.nome : null,
      analista: p.analista_id ? db.get('SELECT nome FROM usuarios WHERE id = ?', p.analista_id)?.nome : null,
      forma: db.get('SELECT * FROM formas_pagamento WHERE id = ?', p.forma_id),
      condicao: db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', p.condicao_id),
      transportadora: p.transportadora_id ? db.get('SELECT * FROM transportadoras WHERE id = ?', p.transportadora_id)?.nome : null,
      empresa: db.get('SELECT * FROM empresas WHERE id = ?', p.empresa_id),
    },
    cliente: db.get('SELECT * FROM clientes WHERE id = ?', p.cliente_id),
    enderecos: db.all('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC', p.cliente_id),
    telefones: db.all('SELECT * FROM cliente_telefones WHERE cliente_id = ?', p.cliente_id),
    ref_comerciais: db.all('SELECT * FROM cliente_ref_comerciais WHERE cliente_id = ?', p.cliente_id),
    ref_bancarias: db.all('SELECT * FROM cliente_ref_bancarias WHERE cliente_id = ?', p.cliente_id),
    itens: db.all(
      `SELECT i.*, pr.nome AS produto, pr.codigo, g.nome AS grupo, g.id AS grupo_id, e.descricao AS embalagem
         FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN grupos_produto g ON g.id = pr.grupo_id
         LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE i.pedido_id = ? ORDER BY i.id`, id,
    ),
    historico: db.all(
      'SELECT h.*, u.nome AS usuario FROM pedido_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE pedido_id = ? ORDER BY h.id', id,
    ),
    comentarios: db.all(
      'SELECT c.*, u.nome AS usuario FROM pedido_comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE pedido_id = ? ORDER BY c.id DESC', id,
    ),
    comissoes: db.all(
      'SELECT c.*, u.nome AS usuario FROM pedido_comissoes c JOIN usuarios u ON u.id = c.usuario_id WHERE pedido_id = ?', id,
    ),
    links: db.all('SELECT * FROM pedido_links_pagamento WHERE pedido_id = ? ORDER BY id DESC', id),
    serasa: db.all(
      'SELECT s.*, u.nome AS usuario FROM consultas_serasa s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE cliente_id = ? ORDER BY s.id DESC LIMIT 10',
      p.cliente_id,
    ),
    notas: db.all('SELECT * FROM notas_fiscais WHERE pedido_id = ? ORDER BY id DESC', id),
    parcelas: db.all(
      `SELECT p.*, ${S.STATUS_PARCELA_SQL} AS status_atual, ${S.SALDO_PARCELA_SQL} AS saldo FROM parcelas p WHERE pedido_id = ? ORDER BY numero`, id,
    ),
    blacklist: S.situacaoBlacklist(p.cliente_id),
    historico_cliente: db.get(
      `SELECT COUNT(*) AS pedidos, IFNULL(SUM(valor_total),0) AS total, MAX(created_at) AS ultimo
         FROM pedidos WHERE cliente_id = ? AND id <> ? AND etapa <> 'cancelado'`, p.cliente_id, id,
    ),
    acoes: W.acoesDisponiveis(p, req.user),
  });
});

// ---------- Criação e edição (etapa Vendedor) ----------
const camposCabecalho = ['cliente_id', 'forma_id', 'condicao_id', 'observacao', 'endereco_entrega_id', 'tipo_entrega', 'vendedor_id'];

function salvarItens(pedidoId, itens, formaId) {
  db.run('DELETE FROM pedido_itens WHERE pedido_id = ?', pedidoId);
  for (const it of itens) {
    const prod = db.get('SELECT * FROM produtos WHERE id = ? AND ativo = 1', it.produto_id);
    if (!prod) throw new ErroNegocio('Produto inválido no pedido.');
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new ErroNegocio(`Quantidade inválida para ${prod.nome}.`);
    const emb = it.embalagem_id ? db.get('SELECT * FROM produto_embalagens WHERE id = ? AND produto_id = ?', it.embalagem_id, prod.id) : null;
    const tabela =
      db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND IFNULL(embalagem_id,0) = ? AND forma_id = ?', prod.id, emb?.id || 0, formaId || 0)?.valor ??
      db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND IFNULL(embalagem_id,0) = ? AND forma_id IS NULL', prod.id, emb?.id || 0)?.valor ?? 0;
    const brinde = it.brinde ? 1 : 0;
    const unit = brinde ? 0 : S.r2(it.valor_unitario ?? tabela);
    db.insert('pedido_itens', {
      pedido_id: pedidoId, produto_id: prod.id, embalagem_id: emb?.id, quantidade: qtd, unidade: emb?.unidade || prod.unidade,
      valor_tabela: tabela, custo_embalagem: emb?.custo || 0, valor_unitario: unit, valor_total: S.r2(qtd * unit), brinde,
    });
  }
}

function validarCabecalho(b) {
  if (b.cliente_id && !db.get('SELECT id FROM clientes WHERE id = ?', b.cliente_id)) throw new ErroNegocio('Cliente não encontrado.');
  if (b.condicao_id && b.forma_id && !db.get('SELECT id FROM condicoes_pagamento WHERE id = ? AND forma_id = ?', b.condicao_id, b.forma_id)) {
    throw new ErroNegocio('Condição não pertence à forma de pagamento.');
  }
  if (b.endereco_entrega_id && b.cliente_id && !db.get('SELECT id FROM cliente_enderecos WHERE id = ? AND cliente_id = ?', b.endereco_entrega_id, b.cliente_id)) {
    throw new ErroNegocio('Endereço não pertence ao cliente.');
  }
}

r.post('/', A.exige('pedido.criar'), (req, res) => {
  const b = { ...req.body };
  if (!b.cliente_id) throw new ErroNegocio('Informe o cliente.');
  S.exigirClienteLiberado(b.cliente_id);
  if (req.user.perfil === 'vendedor' || !b.vendedor_id) b.vendedor_id = req.user.id;
  validarCabecalho(b);
  const id = db.tx(() => {
    const vend = db.get('SELECT u.id, e.supervisor_id FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?', b.vendedor_id);
    if (!b.endereco_entrega_id) b.endereco_entrega_id = db.get('SELECT id FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', b.cliente_id)?.id;
    const numero = db.nextSeq('pedido', 100001);
    const pid = db.insert('pedidos', { ...pick(b, camposCabecalho), numero, empresa_id: req.empresaId, supervisor_id: vend?.supervisor_id, etapa: 'venda' });
    salvarItens(pid, b.itens || [], b.forma_id);
    S.recalcularPedido(pid);
    S.registrarHistorico(pid, { origem: null, destino: 'venda', acao: 'Pedido criado', usuarioId: req.user.id });
    if (b.enviar) W.executar(pid, 'enviar', req.user);
    return pid;
  });
  res.status(201).json({ id, numero: db.get('SELECT numero FROM pedidos WHERE id = ?', id).numero });
});

r.put('/:id', A.exige('pedido.criar'), (req, res) => {
  const p = carregar(req, Number(req.params.id));
  if (p.etapa !== 'venda') throw new ErroNegocio('Só é possível alterar o pedido na etapa Vendedor.');
  const b = { ...req.body, cliente_id: req.body.cliente_id || p.cliente_id };
  if (req.user.perfil === 'vendedor') delete b.vendedor_id;
  validarCabecalho(b);
  db.tx(() => {
    db.update('pedidos', p.id, pick(b, camposCabecalho), camposCabecalho);
    if (Array.isArray(b.itens)) salvarItens(p.id, b.itens, b.forma_id ?? p.forma_id);
    S.recalcularPedido(p.id);
    if (b.enviar) W.executar(p.id, 'enviar', req.user);
  });
  res.json({ ok: true });
});

function pick(o, campos) {
  return Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

// ---------- Ações de fluxo ----------
r.post('/:id/acao', (req, res) => {
  const p = carregar(req, Number(req.params.id));
  res.json(W.executar(p.id, req.body?.acao, req.user, req.body?.observacao));
});

/** Exige que o pedido esteja na etapa e que o perfil atue nela. */
function naEtapa(req, etapas) {
  const p = carregar(req, Number(req.params.id));
  const lista = [].concat(etapas);
  if (!lista.includes(p.etapa)) throw new ErroNegocio(`Disponível apenas na etapa ${lista.map((e) => W.ETAPAS[e].label).join('/')}.`);
  if (!A.can(req.user.perfil, W.ETAPAS[p.etapa].fila)) throw new ErroNegocio('Seu perfil não atua nesta etapa.', 403);
  return p;
}

r.put('/:id/supervisao', (req, res) => {
  const p = naEtapa(req, 'supervisao');
  db.run(`UPDATE pedidos SET observacao_supervisor = ?, updated_at = datetime('now','localtime') WHERE id = ?`, req.body?.observacao_supervisor || null, p.id);
  res.json({ ok: true });
});

r.put('/:id/frete', (req, res) => {
  const p = naEtapa(req, ['analise', 'diretoria']);
  const b = req.body || {};
  const tipos = ['transportadora', 'posta_restante', 'veiculo_proprio', 'retirada'];
  if (b.tipo_entrega && !tipos.includes(b.tipo_entrega)) throw new ErroNegocio('Tipo de entrega inválido.');
  if (b.frete_ignorado && !String(b.frete_motivo_ignorar || '').trim()) throw new ErroNegocio('Informe o motivo para ignorar a cotação.');
  db.update('pedidos', p.id, { ...b, frete_ignorado: b.frete_ignorado ? 1 : 0 },
    ['tipo_entrega', 'transportadora_id', 'frete_codigo_cotacao', 'frete_prazo_dias', 'frete_valor', 'frete_ignorado', 'frete_motivo_ignorar']);
  S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: b.frete_ignorado ? 'Cotação de frete ignorada' : 'Cotação de frete registrada', observacao: b.frete_motivo_ignorar, usuarioId: req.user.id });
  res.json({ ok: true });
});

r.put('/:id/comissoes', (req, res) => {
  const p = naEtapa(req, 'diretoria');
  const lista = req.body?.comissoes || [];
  db.tx(() => {
    db.run('DELETE FROM pedido_comissoes WHERE pedido_id = ?', p.id);
    for (const c of lista) {
      // Sem % informado, vale o % do cadastro do colaborador.
      const pct = c.percentual == null || c.percentual === ''
        ? db.get('SELECT comissao_pct FROM usuarios WHERE id = ?', c.usuario_id)?.comissao_pct || 0
        : Number(c.percentual);
      if (!c.usuario_id || !(pct >= 0) || pct > 100) throw new ErroNegocio('Comissão inválida.');
      db.insert('pedido_comissoes', { pedido_id: p.id, usuario_id: c.usuario_id, papel: c.papel, percentual: pct, valor: S.r2((p.valor_total * pct) / 100) });
    }
  });
  res.json({ ok: true });
});

r.put('/:id/producao', (req, res) => {
  const p = naEtapa(req, 'producao');
  const b = req.body || {};
  db.tx(() => {
    for (const it of b.itens || []) {
      db.run('UPDATE pedido_itens SET lote = ?, fabricacao = ?, validade = ? WHERE id = ? AND pedido_id = ?',
        it.lote || null, it.fabricacao || null, it.validade || null, it.id, p.id);
    }
    if (b.prazo_producao) db.run('UPDATE pedidos SET prazo_producao = ? WHERE id = ?', b.prazo_producao, p.id);
  });
  res.json({ ok: true });
});

r.put('/:id/endereco', (req, res) => {
  const p = naEtapa(req, ['faturamento', 'analise']);
  const end = db.get('SELECT id FROM cliente_enderecos WHERE id = ? AND cliente_id = ?', req.body?.endereco_entrega_id, p.cliente_id);
  if (!end) throw new ErroNegocio('Endereço inválido.');
  db.run('UPDATE pedidos SET endereco_entrega_id = ? WHERE id = ?', end.id, p.id);
  S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: 'Endereço de entrega ajustado', usuarioId: req.user.id });
  res.json({ ok: true });
});

r.put('/:id/expedicao', (req, res) => {
  const p = naEtapa(req, ['expedicao', 'transito']);
  const b = req.body || {};
  const campos = p.etapa === 'expedicao' ? ['data_embarque', 'data_entrega_prevista', 'transportadora_id'] : ['transportadora_id', 'data_embarque', 'data_entrega'];
  db.update('pedidos', p.id, b, campos);
  res.json({ ok: true });
});

// ---------- Comentários e links de pagamento ----------
r.post('/:id/comentarios', (req, res) => {
  const p = carregar(req, Number(req.params.id));
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva o comentário.');
  res.status(201).json({ id: db.insert('pedido_comentarios', { pedido_id: p.id, usuario_id: req.user.id, etapa: p.etapa, texto }) });
});

r.post('/:id/links', (req, res) => {
  const p = carregar(req, Number(req.params.id));
  if (!A.can(req.user.perfil, 'pedido.criar') && !A.can(req.user.perfil, 'fila.cobranca')) throw new ErroNegocio('Sem permissão.', 403);
  const valor = S.r2(req.body?.valor || p.valor_total);
  const codigo = crypto.randomBytes(6).toString('hex').toUpperCase();
  const id = db.insert('pedido_links_pagamento', { pedido_id: p.id, codigo, valor, meio: req.body?.meio || 'PIX' });
  res.status(201).json(db.get('SELECT * FROM pedido_links_pagamento WHERE id = ?', id));
});

r.post('/:id/links/:linkId/pago', (req, res) => {
  const p = carregar(req, Number(req.params.id));
  if (!A.can(req.user.perfil, 'fila.cobranca')) throw new ErroNegocio('Sem permissão.', 403);
  db.run(`UPDATE pedido_links_pagamento SET status = 'pago' WHERE id = ? AND pedido_id = ?`, req.params.linkId, p.id);
  res.json({ ok: true });
});

module.exports = r;
