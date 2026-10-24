// Compras: solicitação (qualquer setor) → cotação com fornecedores → pedido de compra → aprovação →
// recebimento (entrada no estoque com lote e custo) → contas a pagar. Sugestão de reposição pelo estoque mínimo.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const CFG = require('../config');
const sse = require('../sse');
const { responderLista } = require('../lista');
const { SALDOS_SQL } = require('./estoque');
const { lancarContas } = require('./pagar');

const r = express.Router();
const { ErroNegocio } = S;
r.use(A.exige('compras'));

const URGENCIAS = ['baixa', 'normal', 'alta', 'urgente'];
const UNIDADES = ['UN', 'CX', 'PCT', 'KG', 'TON', 'SC', 'L', 'M', 'M²', 'PAR', 'ROLO', 'SERV'];
// Mesmas categorias das contas a pagar, para a conta gerada no recebimento já sair classificada.
const CATEGORIAS = ['Matéria-prima', 'Embalagem', 'Material de consumo', 'Frete', 'Manutenção', 'Serviços', 'Energia', 'Outros'];
const ABERTAS = ['rascunho', 'aprovacao', 'aprovada', 'enviada', 'parcial'];
const pode = (req, p) => A.can(req.user, p);
const exigir = (req, p, msg) => { if (!pode(req, p)) throw new ErroNegocio(msg || 'Sem permissão para esta ação.', 403); };

/** Itens vindos do formulário: produto do estoque (embalagem) ou item avulso com descrição, categoria e unidade da lista. */
async function normalizarItens(itens, { comPreco = false } = {}) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroNegocio('Inclua ao menos um item.');
  if (itens.length > 100) throw new ErroNegocio('Máximo de 100 itens.');
  const out = [];
  for (const [i, it] of itens.entries()) {
    const n = i + 1;
    const quantidade = S.r2(it.quantidade);
    if (!(quantidade > 0)) throw new ErroNegocio(`Item ${n}: informe a quantidade.`);
    const preco = comPreco ? S.r2(it.preco_unitario) : 0;
    if (comPreco && !(preco >= 0)) throw new ErroNegocio(`Item ${n}: preço inválido.`);
    if (it.embalagem_id) {
      const e = await db.get(
        `SELECT e.id, e.produto_id, e.descricao, e.unidade, p.nome FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id WHERE e.id = ?`, Number(it.embalagem_id),
      );
      if (!e) throw new ErroNegocio(`Item ${n}: produto não encontrado.`);
      out.push({ produto_id: e.produto_id, embalagem_id: e.id, descricao: `${e.nome} · ${e.descricao}`, unidade: e.unidade || 'UN', categoria: 'Matéria-prima', quantidade, preco_unitario: preco });
    } else {
      const descricao = String(it.descricao || '').trim();
      if (!descricao) throw new ErroNegocio(`Item ${n}: escolha o produto ou descreva o item.`);
      if (!CATEGORIAS.includes(it.categoria)) throw new ErroNegocio(`Item ${n}: escolha a categoria.`);
      if (!UNIDADES.includes(it.unidade)) throw new ErroNegocio(`Item ${n}: escolha a unidade.`);
      out.push({ produto_id: null, embalagem_id: null, descricao: descricao.slice(0, 200), unidade: it.unidade, categoria: it.categoria, quantidade, preco_unitario: preco });
    }
  }
  return out;
}

async function usuariosCom(perm) {
  return (await db.all('SELECT id, perfil, permissoes FROM usuarios WHERE ativo = 1')).filter((u) => A.can(u, perm)).map((u) => u.id);
}
const avisar = async (perm, dados) => sse.enviar('compras', dados, { usuarios: await usuariosCom(perm) });

// ---------- Resumo e contadores ----------
r.get('/resumo', async (req, res) => {
  const t = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM compra_solicitacoes WHERE empresa_id = :e AND status IN ('aberta','cotacao')) AS solicitacoes,
       (SELECT COUNT(*) FROM compra_solicitacoes WHERE empresa_id = :e AND status IN ('aberta','cotacao') AND urgencia IN ('alta','urgente')) AS urgentes,
       (SELECT COUNT(*) FROM compras WHERE empresa_id = :e AND status = 'aprovacao') AS aprovacao,
       (SELECT COALESCE(SUM(valor_total),0) FROM compras WHERE empresa_id = :e AND status = 'aprovacao') AS valor_aprovacao,
       (SELECT COUNT(*) FROM compras WHERE empresa_id = :e AND status IN ('aprovada','enviada','parcial')) AS a_receber,
       (SELECT COUNT(*) FROM compras WHERE empresa_id = :e AND status IN ('aprovada','enviada','parcial') AND previsao_entrega < date('now','localtime')) AS atrasadas,
       (SELECT COALESCE(SUM(r.valor),0) FROM compra_recebimentos r JOIN compras c ON c.id = r.compra_id
          WHERE c.empresa_id = :e AND substr(r.data,1,7) = substr(date('now','localtime'),1,7)) AS recebido_mes`,
    { e: req.empresaId },
  );
  const rep = await reposicao(req.empresaId);
  res.json({ ...t, reposicao: rep.length });
});

/** Contadores do menu: o que está esperando por mim. */
r.get('/contagem', async (req, res) => {
  const e = req.empresaId;
  const n = async (sql, ...p) => (await db.get(sql, ...p)).n;
  res.json({
    solicitacoes: pode(req, 'compras.comprar') ? await n(`SELECT COUNT(*) AS n FROM compra_solicitacoes WHERE empresa_id = ? AND status IN ('aberta','cotacao')`, e) : 0,
    aprovacao: pode(req, 'compras.aprovar') ? await n(`SELECT COUNT(*) AS n FROM compras WHERE empresa_id = ? AND status = 'aprovacao'`, e) : 0,
    receber: pode(req, 'compras.receber') ? await n(`SELECT COUNT(*) AS n FROM compras WHERE empresa_id = ? AND status IN ('aprovada','enviada','parcial')`, e) : 0,
  });
});

r.get('/opcoes', async (req, res) => res.json({
  urgencias: URGENCIAS, unidades: UNIDADES, categorias: CATEGORIAS,
  limite_aprovacao: await CFG.obter('compras.aprovacao_acima'),
  fornecedores: await db.all('SELECT id, razao_social AS nome, categoria, prazo_pagamento_dias FROM fornecedores WHERE ativo = 1 ORDER BY razao_social'),
}));

r.get('/config', A.exige('compras.aprovar'), async (req, res) => res.json(await CFG.todas('compras.')));
r.put('/config', A.exige('compras.aprovar'), async (req, res) => {
  await CFG.definir('compras.aprovacao_acima', req.body?.['compras.aprovacao_acima'], req.user.id);
  res.json(await CFG.todas('compras.'));
});

// ---------- Solicitações ----------
const SOLIC_SQL = `
  SELECT s.id, s.numero, s.created_at, u.nome AS solicitante, s.solicitante_id, s.departamento, s.urgencia, s.necessidade_em, s.origem, s.status,
    (SELECT COUNT(*) FROM compra_solicitacao_itens i WHERE i.solicitacao_id = s.id) AS itens,
    (SELECT string_agg(i.descricao || ' (' || replace(i.quantidade::text, '.', ',') || ' ' || COALESCE(i.unidade,'') || ')', '; ' ORDER BY i.id)
       FROM compra_solicitacao_itens i WHERE i.solicitacao_id = s.id) AS resumo,
    (SELECT COUNT(*) FROM compra_cotacoes q WHERE q.solicitacao_id = s.id) AS cotacoes,
    c.numero AS compra, s.compra_id, s.justificativa, s.motivo
  FROM compra_solicitacoes s LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN compras c ON c.id = s.compra_id
  WHERE s.empresa_id = ?`;

r.get('/solicitacoes', async (req, res) => {
  // Quem só solicita vê as próprias; comprador e aprovador veem todas.
  const todas = pode(req, 'compras.comprar') || pode(req, 'compras.aprovar');
  await responderLista(req, res, {
    sql: SOLIC_SQL + (todas ? '' : ' AND s.solicitante_id = ?') + (req.query.abertas === '1' ? ` AND s.status IN ('aberta','cotacao')` : ''),
    params: todas ? [req.empresaId] : [req.empresaId, req.user.id], sort: 'numero', exact: ['status', 'urgencia', 'origem'],
  });
});

async function carregarSolicitacao(req, id) {
  const s = await db.get('SELECT * FROM compra_solicitacoes WHERE id = ? AND empresa_id = ?', Number(id), req.empresaId);
  if (!s) throw new ErroNegocio('Solicitação não encontrada.', 404);
  if (s.solicitante_id !== req.user.id && !pode(req, 'compras.comprar') && !pode(req, 'compras.aprovar')) throw new ErroNegocio('Solicitação não encontrada.', 404);
  return s;
}

r.get('/solicitacoes/:id', async (req, res) => {
  const s = await carregarSolicitacao(req, req.params.id);
  const itens = await db.all('SELECT * FROM compra_solicitacao_itens WHERE solicitacao_id = ? ORDER BY id', s.id);
  const cotacoes = await db.all(
    `SELECT q.*, f.razao_social AS fornecedor, u.nome AS usuario FROM compra_cotacoes q JOIN fornecedores f ON f.id = q.fornecedor_id
       LEFT JOIN usuarios u ON u.id = q.usuario_id WHERE q.solicitacao_id = ? ORDER BY q.total`, s.id,
  );
  const precos = await db.all(
    `SELECT qi.cotacao_id, qi.item_id, qi.preco_unitario FROM compra_cotacao_itens qi JOIN compra_cotacoes q ON q.id = qi.cotacao_id WHERE q.solicitacao_id = ?`, s.id,
  );
  for (const q of cotacoes) q.precos = Object.fromEntries(precos.filter((p) => p.cotacao_id === q.id).map((p) => [p.item_id, p.preco_unitario]));
  res.json({
    ...s, itens, cotacoes,
    solicitante: (await db.get('SELECT nome FROM usuarios WHERE id = ?', s.solicitante_id))?.nome,
    compra: s.compra_id ? await db.get('SELECT id, numero, status, valor_total FROM compras WHERE id = ?', s.compra_id) : null,
  });
});

async function criarSolicitacao(req, b, origem = 'manual') {
  if (!URGENCIAS.includes(b.urgencia || 'normal')) throw new ErroNegocio('Urgência inválida.');
  if (b.necessidade_em && !/^\d{4}-\d{2}-\d{2}$/.test(b.necessidade_em)) throw new ErroNegocio('Data de necessidade inválida.');
  const departamento = await require('../listas').exigir('departamento', b.departamento, { rotulo: 'Departamento' });
  if (!departamento) throw new ErroNegocio('Escolha o departamento.');
  const itens = await normalizarItens(b.itens);
  return db.tx(async () => {
    const numero = await db.nextSeq('compra_solicitacao', 1);
    const id = await db.insert('compra_solicitacoes', {
      numero, empresa_id: req.empresaId, solicitante_id: req.user.id, departamento, urgencia: b.urgencia || 'normal',
      necessidade_em: b.necessidade_em || null, justificativa: b.justificativa ? String(b.justificativa).slice(0, 2000) : null, origem,
    });
    for (const it of itens) {
      await db.insert('compra_solicitacao_itens', { solicitacao_id: id, produto_id: it.produto_id, embalagem_id: it.embalagem_id, descricao: it.descricao, categoria: it.categoria, unidade: it.unidade, quantidade: it.quantidade });
    }
    return id;
  });
}

r.post('/solicitacoes', A.exige('compras.solicitar'), async (req, res) => {
  const id = await criarSolicitacao(req, req.body || {});
  const s = await db.get('SELECT numero, urgencia FROM compra_solicitacoes WHERE id = ?', id);
  await avisar('compras.comprar', { tipo: 'solicitacao', id, numero: s.numero, urgencia: s.urgencia, por: req.user.nome });
  res.status(201).json({ id, numero: s.numero });
});

r.post('/solicitacoes/:id/cancelar', async (req, res) => {
  const s = await carregarSolicitacao(req, req.params.id);
  if (!['aberta', 'cotacao'].includes(s.status)) throw new ErroNegocio('Só é possível cancelar solicitações em aberto.');
  const recusa = s.solicitante_id !== req.user.id;
  if (recusa) exigir(req, 'compras.comprar');
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo.');
  await db.update('compra_solicitacoes', s.id, { status: recusa ? 'recusada' : 'cancelada', motivo });
  if (recusa) sse.enviar('compras', { tipo: 'solicitacao_recusada', numero: s.numero, motivo }, { usuarios: [s.solicitante_id] });
  res.json({ ok: true });
});

// ---------- Cotações ----------
r.post('/solicitacoes/:id/cotacoes', A.exige('compras.comprar'), async (req, res) => {
  const s = await carregarSolicitacao(req, req.params.id);
  if (!['aberta', 'cotacao'].includes(s.status)) throw new ErroNegocio('Solicitação não está em aberto.');
  const b = req.body || {};
  const forn = await db.get('SELECT id FROM fornecedores WHERE id = ? AND ativo = 1', Number(b.fornecedor_id));
  if (!forn) throw new ErroNegocio('Escolha o fornecedor.');
  if (await db.get('SELECT id FROM compra_cotacoes WHERE solicitacao_id = ? AND fornecedor_id = ?', s.id, forn.id)) throw new ErroNegocio('Este fornecedor já tem cotação nesta solicitação. Exclua a anterior para lançar de novo.');
  const itens = await db.all('SELECT id, quantidade FROM compra_solicitacao_itens WHERE solicitacao_id = ?', s.id);
  const precos = b.precos || {};
  let total = 0;
  for (const it of itens) {
    const p = Number(precos[it.id]);
    if (!(p >= 0) || precos[it.id] === '' || precos[it.id] == null) throw new ErroNegocio('Informe o preço de todos os itens.');
    total += p * it.quantidade;
  }
  const frete = S.r2(b.frete || 0);
  const parcelas = Math.min(Math.max(parseInt(b.parcelas, 10) || 1, 1), 24);
  const id = await db.tx(async () => {
    const q = await db.insert('compra_cotacoes', {
      solicitacao_id: s.id, fornecedor_id: forn.id, frete, prazo_entrega_dias: Number(b.prazo_entrega_dias) || null, parcelas,
      prazo_pagamento_dias: Number.isFinite(Number(b.prazo_pagamento_dias)) && b.prazo_pagamento_dias !== '' ? Number(b.prazo_pagamento_dias) : null,
      validade: b.validade || null, observacao: b.observacao || null, total: S.r2(total + frete), usuario_id: req.user.id,
    });
    for (const it of itens) await db.insert('compra_cotacao_itens', { cotacao_id: q, item_id: it.id, preco_unitario: S.r2(precos[it.id]) }, null, { auditoria: false });
    if (s.status === 'aberta') await db.update('compra_solicitacoes', s.id, { status: 'cotacao' });
    return q;
  });
  res.status(201).json({ id });
});

r.delete('/cotacoes/:id', A.exige('compras.comprar'), async (req, res) => {
  const q = await db.get(
    `SELECT q.*, s.status FROM compra_cotacoes q JOIN compra_solicitacoes s ON s.id = q.solicitacao_id WHERE q.id = ? AND s.empresa_id = ?`, Number(req.params.id), req.empresaId,
  );
  if (!q) throw new ErroNegocio('Cotação não encontrada.', 404);
  if (q.status !== 'cotacao' && q.status !== 'aberta') throw new ErroNegocio('A solicitação já virou pedido de compra.');
  await db.remove('compra_cotacoes', q.id);
  res.json({ ok: true });
});

// ---------- Sugestão de reposição (estoque abaixo do mínimo) ----------
async function reposicao(empresaId) {
  const saldos = await db.all(`SELECT * FROM (${SALDOS_SQL}) t WHERE minimo > 0`, empresaId, empresaId);
  const pedidas = Object.fromEntries((await db.all(
    `SELECT i.embalagem_id, SUM(i.quantidade - i.quantidade_recebida) AS q FROM compra_itens i JOIN compras c ON c.id = i.compra_id
      WHERE c.empresa_id = ? AND c.status IN ('${ABERTAS.join("','")}') AND i.embalagem_id IS NOT NULL GROUP BY i.embalagem_id`, empresaId,
  )).map((x) => [x.embalagem_id, x.q]));
  const solicitadas = Object.fromEntries((await db.all(
    `SELECT i.embalagem_id, SUM(i.quantidade) AS q FROM compra_solicitacao_itens i JOIN compra_solicitacoes s ON s.id = i.solicitacao_id
      WHERE s.empresa_id = ? AND s.status IN ('aberta','cotacao') AND i.embalagem_id IS NOT NULL GROUP BY i.embalagem_id`, empresaId,
  )).map((x) => [x.embalagem_id, x.q]));
  const ultimas = Object.fromEntries((await db.all(
    `SELECT DISTINCT ON (m.embalagem_id) m.embalagem_id, m.custo_unitario, f.razao_social AS fornecedor, m.fornecedor_id
       FROM estoque_movimentos m LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      WHERE m.empresa_id = ? AND m.origem = 'compra' ORDER BY m.embalagem_id, m.id DESC`, empresaId,
  )).map((x) => [x.embalagem_id, x]));
  const out = [];
  for (const s of saldos) {
    const disponivel = S.r2(s.saldo - s.reservado);
    const caminho = S.r2((pedidas[s.embalagem_id] || 0) + (solicitadas[s.embalagem_id] || 0));
    if (disponivel + caminho >= s.minimo) continue;
    // Repõe até o dobro do mínimo, descontando o que já está pedido ou solicitado.
    const sugerido = Math.ceil(2 * s.minimo - disponivel - caminho);
    const u = ultimas[s.embalagem_id] || {};
    out.push({
      embalagem_id: s.embalagem_id, produto: s.produto, embalagem: s.embalagem, unidade: s.unidade, grupo: s.grupo, saldo: s.saldo, reservado: s.reservado,
      disponivel, minimo: s.minimo, em_compra: caminho, sugerido, situacao: s.situacao, ultimo_custo: u.custo_unitario ?? s.custo_medio ?? null,
      ultimo_fornecedor: u.fornecedor || null, valor_estimado: u.custo_unitario ? S.r2(u.custo_unitario * sugerido) : null,
    });
  }
  return out.sort((a, b) => a.disponivel / (a.minimo || 1) - b.disponivel / (b.minimo || 1));
}

r.get('/reposicao', async (req, res) => res.json(await reposicao(req.empresaId)));

r.post('/reposicao/solicitar', A.exige('compras.solicitar'), async (req, res) => {
  const itens = (req.body?.itens || []).filter((x) => Number(x.quantidade) > 0).map((x) => ({ embalagem_id: x.embalagem_id, quantidade: x.quantidade }));
  if (!itens.length) throw new ErroNegocio('Escolha os itens para repor.');
  const dep = req.body?.departamento || 'Produção';
  const rep = await reposicao(req.empresaId);
  const zerado = itens.some((i) => rep.find((x) => x.embalagem_id === Number(i.embalagem_id))?.disponivel <= 0);
  const id = await criarSolicitacao(req, {
    departamento: dep, urgencia: zerado ? 'urgente' : 'alta', itens,
    justificativa: req.body?.justificativa || 'Reposição de estoque: itens abaixo do estoque mínimo.',
  }, 'reposicao');
  const s = await db.get('SELECT numero, urgencia FROM compra_solicitacoes WHERE id = ?', id);
  await avisar('compras.comprar', { tipo: 'solicitacao', id, numero: s.numero, urgencia: s.urgencia, por: req.user.nome });
  res.status(201).json({ id, numero: s.numero });
});

// ---------- Pedidos de compra ----------
const COMPRA_SQL = `
  SELECT c.id, c.numero, c.created_at, f.razao_social AS fornecedor, c.fornecedor_id, c.status, c.valor_total, c.previsao_entrega,
    u.nome AS comprador, ap.nome AS aprovador, c.aprovado_em, s.numero AS solicitacao, c.categoria, c.parcelas, c.prazo_pagamento_dias,
    CASE WHEN c.status IN ('aprovada','enviada','parcial') AND c.previsao_entrega < date('now','localtime') THEN 1 ELSE 0 END AS atrasada,
    (SELECT ROUND((100 * SUM(LEAST(i.quantidade_recebida, i.quantidade)) / NULLIF(SUM(i.quantidade), 0))::numeric, 0)::float8 FROM compra_itens i WHERE i.compra_id = c.id) AS recebido_pct
  FROM compras c JOIN fornecedores f ON f.id = c.fornecedor_id LEFT JOIN usuarios u ON u.id = c.comprador_id LEFT JOIN usuarios ap ON ap.id = c.aprovador_id
  LEFT JOIN compra_solicitacoes s ON s.id = c.solicitacao_id
  WHERE c.empresa_id = ?`;

const verPedidos = A.exige('compras.comprar', 'compras.aprovar', 'compras.receber');
r.get('/', verPedidos, async (req, res) => {
  const filtro = { aprovacao: ` AND c.status = 'aprovacao'`, receber: ` AND c.status IN ('aprovada','enviada','parcial')`, abertas: ` AND c.status IN ('${ABERTAS.join("','")}')` }[req.query.situacao] || '';
  await responderLista(req, res, { sql: COMPRA_SQL + filtro, params: [req.empresaId], sort: 'numero', exact: ['status', 'fornecedor_id', 'atrasada'] });
});

async function carregarCompra(req, id) {
  const c = /^\d+$/.test(String(id)) && await db.get('SELECT * FROM compras WHERE id = ? AND empresa_id = ?', Number(id), req.empresaId);
  if (!c) throw new ErroNegocio('Pedido de compra não encontrado.', 404);
  return c;
}

r.get('/:id', verPedidos, async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  const recebimentos = await db.all('SELECT r.*, u.nome AS usuario FROM compra_recebimentos r LEFT JOIN usuarios u ON u.id = r.usuario_id WHERE r.compra_id = ? ORDER BY r.id', c.id);
  const ritens = await db.all(
    `SELECT ri.*, i.descricao, i.unidade FROM compra_recebimento_itens ri JOIN compra_itens i ON i.id = ri.item_id JOIN compra_recebimentos r ON r.id = ri.recebimento_id WHERE r.compra_id = ?`, c.id,
  );
  for (const x of recebimentos) x.itens = ritens.filter((i) => i.recebimento_id === x.id);
  res.json({
    ...c,
    fornecedor: await db.get('SELECT id, razao_social, nome_fantasia, documento, email, telefone, contato, cidade, uf, prazo_pagamento_dias FROM fornecedores WHERE id = ?', c.fornecedor_id),
    comprador: (await db.get('SELECT nome FROM usuarios WHERE id = ?', c.comprador_id))?.nome,
    aprovador: c.aprovador_id ? (await db.get('SELECT nome FROM usuarios WHERE id = ?', c.aprovador_id))?.nome : null,
    solicitacao: c.solicitacao_id ? await db.get('SELECT id, numero, departamento, urgencia, justificativa FROM compra_solicitacoes WHERE id = ?', c.solicitacao_id) : null,
    itens: await db.all('SELECT * FROM compra_itens WHERE compra_id = ? ORDER BY id', c.id),
    recebimentos,
    contas: await db.all(`SELECT id, descricao, vencimento, valor, status, valor_pago FROM contas_pagar WHERE compra_id = ? ORDER BY vencimento`, c.id),
    limite_aprovacao: await CFG.obter('compras.aprovacao_acima'),
  });
});

function dadosCompra(b) {
  const parcelas = Math.min(Math.max(parseInt(b.parcelas, 10) || 1, 1), 24);
  const prazo = b.prazo_pagamento_dias === '' || b.prazo_pagamento_dias == null ? 30 : Number(b.prazo_pagamento_dias);
  if (!(Number.isInteger(prazo) && prazo >= 0 && prazo <= 365)) throw new ErroNegocio('Prazo de pagamento deve ser de 0 a 365 dias.');
  if (b.categoria && !CATEGORIAS.includes(b.categoria)) throw new ErroNegocio('Categoria inválida.');
  if (b.previsao_entrega && !/^\d{4}-\d{2}-\d{2}$/.test(b.previsao_entrega)) throw new ErroNegocio('Previsão de entrega inválida.');
  const frete = S.r2(b.frete || 0);
  const desconto = S.r2(b.desconto || 0);
  if (frete < 0 || desconto < 0) throw new ErroNegocio('Frete e desconto não podem ser negativos.');
  return {
    parcelas, prazo_pagamento_dias: prazo, frete, desconto, categoria: b.categoria || null, previsao_entrega: b.previsao_entrega || null,
    forma_pagamento: b.forma_pagamento || null, observacao: b.observacao ? String(b.observacao).slice(0, 2000) : null,
  };
}

async function gravarItens(compraId, itens, d) {
  await db.run('DELETE FROM compra_itens WHERE compra_id = ?', compraId);
  let total = 0;
  for (const it of itens) {
    total += it.quantidade * it.preco_unitario;
    await db.insert('compra_itens', { compra_id: compraId, produto_id: it.produto_id, embalagem_id: it.embalagem_id, descricao: it.descricao, unidade: it.unidade, quantidade: it.quantidade, preco_unitario: it.preco_unitario }, null, { auditoria: false });
  }
  const valorItens = S.r2(total);
  const valorTotal = S.r2(valorItens + d.frete - d.desconto);
  if (valorTotal <= 0) throw new ErroNegocio('O valor do pedido de compra deve ser maior que zero.');
  await db.run(`UPDATE compras SET valor_itens = ?, valor_total = ?, updated_at = datetime('now','localtime') WHERE id = ?`, valorItens, valorTotal, compraId);
}

async function fornecedorAtivo(id) {
  const f = await db.get('SELECT id, prazo_pagamento_dias FROM fornecedores WHERE id = ? AND ativo = 1', Number(id));
  if (!f) throw new ErroNegocio('Escolha o fornecedor.');
  return f;
}

async function novaCompra(req, base, itens) {
  return db.tx(async () => {
    const numero = await db.nextSeq('compra', 1);
    const id = await db.insert('compras', { ...base, numero, empresa_id: req.empresaId, comprador_id: req.user.id, status: 'rascunho' });
    await gravarItens(id, itens, base);
    return id;
  });
}

/** Pedido de compra direto (sem solicitação). */
r.post('/', A.exige('compras.comprar'), async (req, res) => {
  const b = req.body || {};
  const f = await fornecedorAtivo(b.fornecedor_id);
  const d = dadosCompra({ ...b, prazo_pagamento_dias: b.prazo_pagamento_dias ?? f.prazo_pagamento_dias });
  const itens = await normalizarItens(b.itens, { comPreco: true });
  if (!d.categoria) d.categoria = itens[0].categoria;
  const id = await novaCompra(req, { ...d, fornecedor_id: f.id }, itens);
  res.status(201).json({ id, numero: (await db.get('SELECT numero FROM compras WHERE id = ?', id)).numero });
});

/** Gera o pedido de compra a partir da solicitação, com a cotação vencedora (ou um fornecedor e preços informados). */
r.post('/solicitacoes/:id/gerar-compra', A.exige('compras.comprar'), async (req, res) => {
  const s = await carregarSolicitacao(req, req.params.id);
  if (!['aberta', 'cotacao'].includes(s.status)) throw new ErroNegocio('Solicitação não está em aberto.');
  const b = req.body || {};
  const sItens = await db.all('SELECT * FROM compra_solicitacao_itens WHERE solicitacao_id = ? ORDER BY id', s.id);
  let cot = null;
  let fornecedorId = b.fornecedor_id;
  let precos = b.precos || {};
  if (b.cotacao_id) {
    cot = await db.get('SELECT * FROM compra_cotacoes WHERE id = ? AND solicitacao_id = ?', Number(b.cotacao_id), s.id);
    if (!cot) throw new ErroNegocio('Cotação não encontrada.');
    fornecedorId = cot.fornecedor_id;
    precos = Object.fromEntries((await db.all('SELECT item_id, preco_unitario FROM compra_cotacao_itens WHERE cotacao_id = ?', cot.id)).map((x) => [x.item_id, x.preco_unitario]));
  }
  const f = await fornecedorAtivo(fornecedorId);
  const itens = sItens.map((i) => ({ ...i, preco_unitario: S.r2(precos[i.id]) }));
  if (itens.some((i) => !(i.preco_unitario >= 0) || precos[i.id] == null || precos[i.id] === '')) throw new ErroNegocio('Informe o preço de todos os itens ou escolha uma cotação.');
  const d = dadosCompra({
    ...b, frete: cot ? cot.frete : b.frete, parcelas: cot ? cot.parcelas : b.parcelas,
    prazo_pagamento_dias: cot?.prazo_pagamento_dias ?? b.prazo_pagamento_dias ?? f.prazo_pagamento_dias,
    previsao_entrega: b.previsao_entrega || (cot?.prazo_entrega_dias ? S.addDias(S.hoje(), cot.prazo_entrega_dias) : null),
    categoria: b.categoria || sItens[0]?.categoria,
  });
  const id = await db.tx(async () => {
    const cid = await novaCompra(req, { ...d, fornecedor_id: f.id, solicitacao_id: s.id, cotacao_id: cot?.id || null }, itens);
    if (cot) await db.run('UPDATE compra_cotacoes SET vencedora = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE solicitacao_id = ?', cot.id, s.id);
    await db.update('compra_solicitacoes', s.id, { status: 'atendida', compra_id: cid });
    return cid;
  });
  const numero = (await db.get('SELECT numero FROM compras WHERE id = ?', id)).numero;
  if (s.solicitante_id !== req.user.id) sse.enviar('compras', { tipo: 'solicitacao_atendida', numero: s.numero, compra: numero }, { usuarios: [s.solicitante_id] });
  res.status(201).json({ id, numero });
});

r.put('/:id', A.exige('compras.comprar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (c.status !== 'rascunho') throw new ErroNegocio('Só é possível alterar pedidos de compra em rascunho.');
  const b = req.body || {};
  const f = await fornecedorAtivo(b.fornecedor_id || c.fornecedor_id);
  const d = dadosCompra({ ...c, ...b });
  const itens = b.itens ? await normalizarItens(b.itens, { comPreco: true }) : null;
  await db.tx(async () => {
    await db.update('compras', c.id, { ...d, fornecedor_id: f.id, motivo: null });
    if (itens) await gravarItens(c.id, itens, d);
    else await gravarItens(c.id, (await db.all('SELECT * FROM compra_itens WHERE compra_id = ?', c.id)), d);
  });
  res.json({ ok: true });
});

/** Envia para aprovação. Abaixo do limite configurado o pedido já fica aprovado. */
r.post('/:id/enviar-aprovacao', A.exige('compras.comprar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (c.status !== 'rascunho') throw new ErroNegocio('Pedido de compra não está em rascunho.');
  const limite = Number(await CFG.obter('compras.aprovacao_acima')) || 0;
  const precisa = limite === 0 || c.valor_total > limite;
  if (precisa) {
    await db.update('compras', c.id, { status: 'aprovacao' });
    await avisar('compras.aprovar', { tipo: 'aprovacao', id: c.id, numero: c.numero, valor: c.valor_total, por: req.user.nome });
  } else {
    await db.update('compras', c.id, { status: 'aprovada', aprovado_em: S.agora(), motivo: `Aprovado automaticamente (até ${limite.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` });
    await avisar('compras.receber', { tipo: 'a_receber', id: c.id, numero: c.numero });
  }
  res.json({ ok: true, status: precisa ? 'aprovacao' : 'aprovada' });
});

r.post('/:id/aprovar', A.exige('compras.aprovar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (c.status !== 'aprovacao') throw new ErroNegocio('Pedido de compra não está aguardando aprovação.');
  await db.update('compras', c.id, { status: 'aprovada', aprovador_id: req.user.id, aprovado_em: S.agora(), motivo: req.body?.observacao || null });
  sse.enviar('compras', { tipo: 'aprovada', numero: c.numero }, { usuarios: [c.comprador_id] });
  await avisar('compras.receber', { tipo: 'a_receber', id: c.id, numero: c.numero });
  res.json({ ok: true });
});

r.post('/:id/reprovar', A.exige('compras.aprovar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (c.status !== 'aprovacao') throw new ErroNegocio('Pedido de compra não está aguardando aprovação.');
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo para o comprador corrigir.');
  await db.update('compras', c.id, { status: 'rascunho', motivo: `Devolvido: ${motivo}` });
  sse.enviar('compras', { tipo: 'reprovada', numero: c.numero, motivo }, { usuarios: [c.comprador_id] });
  res.json({ ok: true });
});

r.post('/:id/enviar', A.exige('compras.comprar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (c.status !== 'aprovada') throw new ErroNegocio('Só pedidos aprovados podem ser enviados ao fornecedor.');
  await db.update('compras', c.id, { status: 'enviada', enviada_em: S.agora() });
  res.json({ ok: true });
});

r.post('/:id/cancelar', A.exige('compras.comprar'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (!['rascunho', 'aprovacao', 'aprovada', 'enviada'].includes(c.status)) throw new ErroNegocio('Pedido com recebimento não pode ser cancelado.');
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo do cancelamento.');
  await db.tx(async () => {
    await db.update('compras', c.id, { status: 'cancelada', motivo });
    // A solicitação volta para a fila do comprador.
    if (c.solicitacao_id) await db.run(`UPDATE compra_solicitacoes SET status = 'cotacao', compra_id = NULL WHERE id = ? AND compra_id = ?`, c.solicitacao_id, c.id);
  });
  res.json({ ok: true });
});

/**
 * Recebimento (total ou parcial) com a NF do fornecedor: produtos de estoque entram com lote, validade e custo
 * (preço + frete − desconto rateados pelo valor), e a conta a pagar é lançada nas parcelas do pedido.
 */
r.post('/:id/receber', A.exige('compras.receber'), async (req, res) => {
  const c = await carregarCompra(req, req.params.id);
  if (!['aprovada', 'enviada', 'parcial'].includes(c.status)) throw new ErroNegocio('O pedido de compra precisa estar aprovado para receber.');
  const b = req.body || {};
  const nf = String(b.nota_fiscal || '').trim();
  if (!nf) throw new ErroNegocio('Informe o número da nota fiscal do fornecedor.');
  const data = b.data || S.hoje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroNegocio('Data de recebimento inválida.');
  const itens = await db.all('SELECT * FROM compra_itens WHERE compra_id = ?', c.id);
  const porId = new Map(itens.map((i) => [i.id, i]));
  const recebidos = (Array.isArray(b.itens) ? b.itens : []).filter((x) => Number(x.quantidade) > 0);
  if (!recebidos.length) throw new ErroNegocio('Informe a quantidade recebida de ao menos um item.');
  for (const x of recebidos) {
    const it = porId.get(Number(x.item_id));
    if (!it) throw new ErroNegocio('Item não pertence a este pedido de compra.');
    const pend = S.r2(it.quantidade - it.quantidade_recebida);
    if (Number(x.quantidade) > pend + 0.0001) throw new ErroNegocio(`${it.descricao}: pendente ${pend}, informado ${x.quantidade}.`);
    if (x.validade && !/^\d{4}-\d{2}-\d{2}$/.test(x.validade)) throw new ErroNegocio(`${it.descricao}: validade inválida.`);
  }
  // Frete e desconto são rateados pelo valor dos itens (custo de entrada e valor da conta).
  const fator = c.valor_itens > 0 ? (c.valor_itens + (c.frete || 0) - (c.desconto || 0)) / c.valor_itens : 1;
  const resultado = await db.tx(async () => {
    let valor = 0;
    for (const x of recebidos) valor += Number(x.quantidade) * porId.get(Number(x.item_id)).preco_unitario;
    valor = S.r2(valor * fator);
    const recId = await db.insert('compra_recebimentos', { compra_id: c.id, nota_fiscal: nf.slice(0, 60), data, valor, observacao: b.observacao || null, usuario_id: req.user.id });
    for (const x of recebidos) {
      const it = porId.get(Number(x.item_id));
      const q = S.r2(x.quantidade);
      await db.insert('compra_recebimento_itens', { recebimento_id: recId, item_id: it.id, quantidade: q, lote: x.lote || null, validade: x.validade || null }, null, { auditoria: false });
      await db.run('UPDATE compra_itens SET quantidade_recebida = quantidade_recebida + ? WHERE id = ?', q, it.id);
      if (it.embalagem_id) {
        const mov = await S.movimentarEstoque({
          empresa_id: c.empresa_id, produto_id: it.produto_id, embalagem_id: it.embalagem_id, tipo: 'entrada', origem: 'compra', quantidade: q,
          lote: x.lote || null, validade: x.validade || null, custo_unitario: S.r2(it.preco_unitario * fator), fornecedor_id: c.fornecedor_id,
          documento: `NF ${nf} · Compra ${c.numero}`, usuario_id: req.user.id,
        });
        await db.run('UPDATE estoque_movimentos SET compra_id = ? WHERE id = ?', c.id, mov);
      }
    }
    const contas = await lancarContas({
      fornecedor_id: c.fornecedor_id, descricao: `Compra ${c.numero} · NF ${nf}`, categoria: c.categoria || 'Outros', documento: nf, emissao: data,
      vencimento: S.addDias(data, c.prazo_pagamento_dias ?? 30), valor, parcelas: c.parcelas || 1, forma_pagamento: c.forma_pagamento,
      compra_id: c.id, recebimento_id: recId,
    }, { empresaId: c.empresa_id, usuarioId: req.user.id });
    const falta = (await db.get('SELECT COUNT(*) AS n FROM compra_itens WHERE compra_id = ? AND quantidade_recebida < quantidade - 0.0001', c.id)).n;
    const status = falta ? 'parcial' : 'recebida';
    await db.update('compras', c.id, { status });
    return { recebimento_id: recId, valor, contas, status };
  });
  await avisar('financeiro.pagar', { tipo: 'conta_compra', numero: c.numero, valor: resultado.valor });
  res.status(201).json(resultado);
});

module.exports = r;
module.exports.CATEGORIAS = CATEGORIAS;
