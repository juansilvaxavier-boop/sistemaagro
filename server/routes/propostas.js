// Propostas comerciais (orçamentos): montagem com preços de tabela, envio, aceite e conversão em pedido.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const W = require('../workflow');
const { responderLista } = require('../lista');
const E = require('../escopo');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('propostas'));

const STATUS_SQL = `CASE WHEN p.status IN ('rascunho','enviada') AND p.validade < date('now','localtime') THEN 'expirada' ELSE p.status END`;

/** Propostas visíveis: empresa da sessão e abrangência do usuário (próprias, da equipe ou todas). */
function escopo(req, alias = 'p') {
  return { sql: `${alias}.empresa_id = ? AND ${E.vendas(req.user, alias, { semSupervisor: true })}`, params: [req.empresaId] };
}

const LISTA_SQL = `
  SELECT p.id, p.numero, p.created_at AS data, c.nome AS cliente, c.id AS cliente_id, c.documento, v.nome AS vendedor,
    f.nome AS forma, cp.descricao AS condicao, p.valor_total AS valor, p.validade, ${STATUS_SQL} AS status,
    pe.numero AS pedido, p.pedido_id, p.enviada_em, p.respondida_em,
    (SELECT COUNT(*) FROM proposta_itens i WHERE i.proposta_id = p.id) AS itens
  FROM propostas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios v ON v.id = p.vendedor_id
  LEFT JOIN formas_pagamento f ON f.id = p.forma_id LEFT JOIN condicoes_pagamento cp ON cp.id = p.condicao_id
  LEFT JOIN pedidos pe ON pe.id = p.pedido_id`;

r.get('/', async (req, res) => {
  const e = escopo(req);
  await responderLista(req, res, { sql: `${LISTA_SQL} WHERE ${e.sql}`, params: e.params, sort: 'numero', dir: 'desc', exact: ['status', 'cliente_id'] });
});

r.get('/resumo', async (req, res) => {
  const e = escopo(req);
  res.json(await db.get(
    `SELECT COUNT(*) FILTER (WHERE s = 'enviada') AS enviadas, COALESCE(SUM(valor_total) FILTER (WHERE s = 'enviada'), 0) AS valor_enviadas,
            COUNT(*) FILTER (WHERE s IN ('aceita','convertida')) AS ganhas, COUNT(*) FILTER (WHERE s = 'recusada') AS recusadas,
            COUNT(*) FILTER (WHERE s = 'expirada') AS expiradas,
            COUNT(*) FILTER (WHERE s = 'enviada' AND validade <= date('now','localtime','+3 days')) AS vencendo
       FROM (SELECT p.*, ${STATUS_SQL} AS s FROM propostas p WHERE ${e.sql}) t`, ...e.params,
  ));
});

async function carregar(req, id = Number(req.params.id)) {
  const e = escopo(req);
  const p = await db.get(`SELECT p.*, ${STATUS_SQL} AS status_atual FROM propostas p WHERE p.id = ? AND ${e.sql}`, id, ...e.params);
  if (!p) throw new ErroNegocio('Proposta não encontrada', 404);
  return p;
}

r.get('/:id', async (req, res) => {
  const p = await carregar(req);
  const cliente = await db.get('SELECT id, nome, nome_fantasia, documento, tipo_pessoa, email FROM clientes WHERE id = ?', p.cliente_id);
  res.json({
    proposta: {
      ...p,
      vendedor: (await db.get('SELECT nome, email FROM usuarios WHERE id = ?', p.vendedor_id)),
      forma: await db.get('SELECT * FROM formas_pagamento WHERE id = ?', p.forma_id),
      condicao: await db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', p.condicao_id),
      empresa: await db.get('SELECT * FROM empresas WHERE id = ?', p.empresa_id),
      pedido_numero: p.pedido_id ? (await db.get('SELECT numero FROM pedidos WHERE id = ?', p.pedido_id))?.numero : null,
    },
    cliente: require('../lgpd').mascararObjeto(req.user, cliente),
    endereco: await db.get('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', p.cliente_id),
    itens: await db.all(
      `SELECT i.*, pr.nome AS produto, pr.codigo, pr.grupo_id, e.descricao AS embalagem FROM proposta_itens i JOIN produtos pr ON pr.id = i.produto_id
         LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE i.proposta_id = ? ORDER BY i.id`, p.id,
    ),
  });
});

const CAMPOS = ['cliente_id', 'vendedor_id', 'oportunidade_id', 'forma_id', 'condicao_id', 'validade', 'prazo_entrega', 'tipo_entrega',
  'frete_valor', 'condicoes_comerciais', 'observacao'];

async function precoTabela(produtoId, embalagemId, formaId) {
  return (await db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND COALESCE(embalagem_id,0) = ? AND forma_id = ?', produtoId, embalagemId || 0, formaId || 0))?.valor
    ?? (await db.get('SELECT valor FROM produto_precos WHERE produto_id = ? AND COALESCE(embalagem_id,0) = ? AND forma_id IS NULL', produtoId, embalagemId || 0))?.valor ?? 0;
}

async function salvarItens(propostaId, itens, formaId) {
  await db.run('DELETE FROM proposta_itens WHERE proposta_id = ?', propostaId);
  for (const it of itens) {
    const prod = await db.get('SELECT * FROM produtos WHERE id = ? AND ativo = 1', it.produto_id);
    if (!prod) throw new ErroNegocio('Produto inválido na proposta.');
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new ErroNegocio(`Quantidade inválida para ${prod.nome}.`);
    const emb = it.embalagem_id ? await db.get('SELECT * FROM produto_embalagens WHERE id = ? AND produto_id = ?', it.embalagem_id, prod.id) : null;
    const tabela = await precoTabela(prod.id, emb?.id, formaId);
    const brinde = it.brinde ? 1 : 0;
    const unit = brinde ? 0 : S.r2(it.valor_unitario ?? tabela);
    await db.insert('proposta_itens', {
      proposta_id: propostaId, produto_id: prod.id, embalagem_id: emb?.id, quantidade: qtd, unidade: emb?.unidade || prod.unidade,
      valor_tabela: tabela, custo_embalagem: emb?.custo || 0, valor_unitario: unit, valor_total: S.r2(qtd * unit), brinde,
    }, null, { auditoria: false });
  }
}

async function recalcular(id) {
  const p = await db.get('SELECT * FROM propostas WHERE id = ?', id);
  const soma = (await db.get('SELECT COALESCE(SUM(valor_total),0) AS v FROM proposta_itens WHERE proposta_id = ? AND brinde = 0', id)).v;
  const cond = p.condicao_id ? await db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', p.condicao_id) : null;
  const desconto = S.r2(soma * ((cond?.desconto_pct || 0) / 100));
  await db.run(`UPDATE propostas SET valor_produtos = ?, valor_desconto = ?, valor_total = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    S.r2(soma), desconto, S.r2(soma - desconto + (Number(p.frete_valor) || 0)), id);
}

async function validar(req, b) {
  if (!b.cliente_id) throw new ErroNegocio('Informe o cliente.');
  const { escopoClientes } = require('./clientes');
  const ec = escopoClientes(req.user);
  if (!await db.get(`SELECT id FROM clientes c WHERE c.id = ? AND ${ec.sql}`, b.cliente_id, ...ec.params)) {
    throw new ErroNegocio('Cliente não encontrado ou fora da sua carteira.');
  }
  if (b.condicao_id && b.forma_id && !await db.get('SELECT id FROM condicoes_pagamento WHERE id = ? AND forma_id = ?', b.condicao_id, b.forma_id)) {
    throw new ErroNegocio('Condição não pertence à forma de pagamento.');
  }
  if (b.validade && !/^\d{4}-\d{2}-\d{2}$/.test(b.validade)) throw new ErroNegocio('Validade inválida.');
}

r.post('/', async (req, res) => {
  const b = { ...req.body };
  if (E.abrangencia(req.user) === 'proprio' || !b.vendedor_id) b.vendedor_id = req.user.id;
  const vs = E.vendedoresSql(req.user);
  if (vs && !(await db.get(`SELECT 1 AS ok WHERE ? IN (${vs})`, Number(b.vendedor_id)))) throw new ErroNegocio('Vendedor fora da sua equipe.', 403);
  b.validade = b.validade || S.addDias(S.hoje(), 15);
  await validar(req, b);
  const id = await db.tx(async () => {
    const numero = await db.nextSeq('proposta', 5001);
    const pid = await db.insert('propostas', { ...Object.fromEntries(CAMPOS.map((k) => [k, b[k]])), numero, empresa_id: req.empresaId, status: 'rascunho' });
    await salvarItens(pid, b.itens || [], b.forma_id);
    await recalcular(pid);
    return pid;
  });
  res.status(201).json({ id, numero: (await db.get('SELECT numero FROM propostas WHERE id = ?', id)).numero });
});

r.put('/:id', async (req, res) => {
  const p = await carregar(req);
  if (!['rascunho', 'enviada'].includes(p.status)) throw new ErroNegocio('Proposta aceita, recusada ou convertida não pode ser alterada. Duplique-a.');
  const b = { ...req.body, cliente_id: req.body?.cliente_id || p.cliente_id };
  if (E.abrangencia(req.user) === 'proprio') delete b.vendedor_id;
  const vs = E.vendedoresSql(req.user);
  if (b.vendedor_id && vs && !(await db.get(`SELECT 1 AS ok WHERE ? IN (${vs})`, Number(b.vendedor_id)))) throw new ErroNegocio('Vendedor fora da sua equipe.', 403);
  await validar(req, b);
  await db.tx(async () => {
    await db.update('propostas', p.id, b, CAMPOS);
    if (Array.isArray(b.itens)) await salvarItens(p.id, b.itens, b.forma_id ?? p.forma_id);
    await recalcular(p.id);
  });
  res.json({ ok: true });
});

r.post('/:id/status', async (req, res) => {
  const p = await carregar(req);
  const novo = req.body?.status;
  const permitido = { rascunho: ['enviada'], enviada: ['aceita', 'recusada', 'rascunho'], aceita: ['enviada'], recusada: ['rascunho'] };
  if (!(permitido[p.status] || []).includes(novo)) throw new ErroNegocio('Mudança de status não permitida.');
  if (novo === 'enviada' && !(await db.get('SELECT 1 AS x FROM proposta_itens WHERE proposta_id = ?', p.id))) throw new ErroNegocio('Inclua ao menos um item.');
  if (novo === 'aceita' && p.status_atual === 'expirada') throw new ErroNegocio('Proposta expirada. Atualize a validade e reenvie.');
  const motivo = String(req.body?.motivo || '').trim();
  if (novo === 'recusada' && !motivo) throw new ErroNegocio('Informe o motivo da recusa.');
  const campos = { status: novo };
  if (novo === 'enviada') campos.enviada_em = S.hoje();
  if (['aceita', 'recusada'].includes(novo)) campos.respondida_em = S.hoje();
  if (novo === 'recusada') campos.motivo_recusa = motivo;
  await db.tx(async () => {
    await db.update('propostas', p.id, campos);
    if (p.oportunidade_id) {
      if (novo === 'enviada') await db.run(`UPDATE crm_oportunidades SET estagio = 'proposta' WHERE id = ? AND estagio IN ('prospeccao','qualificacao')`, p.oportunidade_id);
      if (novo === 'recusada') await db.run(`UPDATE crm_oportunidades SET estagio = 'perdida', motivo_perda = ? WHERE id = ?`, motivo, p.oportunidade_id);
    }
  });
  res.json({ ok: true });
});

/** Converte a proposta aceita (ou enviada) em pedido na etapa Vendedor, com os mesmos itens e preços. */
r.post('/:id/converter', A.exige('pedido.criar'), async (req, res) => {
  const p = await carregar(req);
  if (p.pedido_id) throw new ErroNegocio('Proposta já convertida em pedido.');
  if (!['aceita', 'enviada'].includes(p.status)) throw new ErroNegocio('Só propostas enviadas ou aceitas viram pedido.');
  if (p.status_atual === 'expirada') throw new ErroNegocio('Proposta expirada. Atualize a validade antes de converter.');
  await S.exigirClienteLiberado(p.cliente_id);
  const pedido = await db.tx(async () => {
    const vend = await db.get('SELECT u.id, e.supervisor_id FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?', p.vendedor_id);
    const end = await db.get('SELECT id FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', p.cliente_id);
    const numero = await db.nextSeq('pedido', 100001);
    const obs = [p.observacao, `Proposta ${p.numero}`, p.condicoes_comerciais].filter(Boolean).join(' | ');
    const pid = await db.insert('pedidos', {
      numero, empresa_id: p.empresa_id, cliente_id: p.cliente_id, vendedor_id: p.vendedor_id, supervisor_id: vend?.supervisor_id,
      forma_id: p.forma_id, condicao_id: p.condicao_id, tipo_entrega: p.tipo_entrega || 'transportadora', endereco_entrega_id: end?.id,
      observacao: obs, etapa: 'venda', proposta_id: p.id,
    });
    for (const i of await db.all('SELECT * FROM proposta_itens WHERE proposta_id = ?', p.id)) {
      await db.insert('pedido_itens', {
        pedido_id: pid, produto_id: i.produto_id, embalagem_id: i.embalagem_id, quantidade: i.quantidade, unidade: i.unidade, valor_tabela: i.valor_tabela,
        custo_embalagem: i.custo_embalagem, valor_unitario: i.valor_unitario, valor_total: i.valor_total, brinde: i.brinde,
      }, null, { auditoria: false });
    }
    await S.recalcularPedido(pid);
    await S.registrarHistorico(pid, { origem: null, destino: 'venda', acao: `Pedido criado a partir da proposta ${p.numero}`, usuarioId: req.user.id });
    await db.update('propostas', p.id, { status: 'convertida', pedido_id: pid, respondida_em: p.respondida_em || S.hoje() });
    if (p.oportunidade_id) await db.run(`UPDATE crm_oportunidades SET estagio = 'ganha', pedido_id = ? WHERE id = ?`, pid, p.oportunidade_id);
    if (req.body?.enviar) await W.executar(pid, 'enviar', req.user);
    return { id: pid, numero };
  });
  res.status(201).json(pedido);
});

r.post('/:id/duplicar', async (req, res) => {
  const p = await carregar(req);
  const id = await db.tx(async () => {
    const numero = await db.nextSeq('proposta', 5001);
    const novo = await db.insert('propostas', {
      ...Object.fromEntries(CAMPOS.map((k) => [k, p[k]])), vendedor_id: E.abrangencia(req.user) === 'proprio' ? req.user.id : p.vendedor_id,
      numero, empresa_id: p.empresa_id, status: 'rascunho', validade: S.addDias(S.hoje(), 15),
    });
    await salvarItens(novo, await db.all('SELECT * FROM proposta_itens WHERE proposta_id = ?', p.id), p.forma_id);
    await recalcular(novo);
    return novo;
  });
  res.status(201).json({ id, numero: (await db.get('SELECT numero FROM propostas WHERE id = ?', id)).numero });
});

r.delete('/:id', async (req, res) => {
  const p = await carregar(req);
  if (p.status !== 'rascunho') throw new ErroNegocio('Só rascunhos podem ser excluídos.');
  await db.remove('propostas', p.id);
  res.json({ ok: true });
});

module.exports = r;
