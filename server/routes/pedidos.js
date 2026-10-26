const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const W = require('../workflow');
const { responderLista } = require('../lista');
const { mascararObjeto, mascararLinhas } = require('../lgpd');
const E = require('../escopo');

const r = express.Router();
const { ErroNegocio } = S;

/** Pedidos visíveis: empresa da sessão e abrangência do usuário (próprios, da equipe ou todos). */
function escopo(req, alias = 'p') {
  return { sql: `${alias}.empresa_id = ? AND ${E.vendas(req.user, alias)}`, params: [req.empresaId] };
}

const etapaLabelSql = `CASE p.etapa ${Object.entries(W.ETAPAS).map(([k, v]) => `WHEN '${k}' THEN '${v.label}'`).join(' ')} END`;

const LISTA_SQL = `
  SELECT p.id, p.numero, p.created_at AS data, c.documento, c.nome AS cliente, c.id AS cliente_id, (SELECT nome FROM empresas em WHERE em.id = p.empresa_id) AS empresa,
    f.nome AS forma, cp.descricao AS condicao, p.valor_total AS valor,
    v.nome AS vendedor, s.nome AS supervisor, a.nome AS analista, eq.nome AS equipe,
    en.uf, en.cidade, p.etapa, ${etapaLabelSql} AS etapa_label, p.etapa_desde,
    CAST(julianday('now','localtime') - julianday(p.etapa_desde) AS INTEGER) AS dias_etapa,
    p.prazo_producao, p.data_chegada_producao, p.data_embarque, p.data_entrega_prevista, p.data_entrega,
    t.nome AS transportadora, nf.numero AS nota, p.tipo_entrega, p.volumes, p.codigo_rastreio, p.codigo_origem,
    p.vendedor_id, p.supervisor_id, p.analista_id, v.equipe_id, p.forma_id, p.transportadora_id, f.tipo AS forma_tipo,
    nf.data_emissao AS data_nota, p.dentro_politica, p.cultura, p.area_ha, p.origem_venda,
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

// Colunas de identificação filtradas pelo valor exato (não por "contém").
const FILTROS_EXATOS = ['vendedor_id', 'supervisor_id', 'analista_id', 'equipe_id', 'forma_id', 'transportadora_id', 'forma_tipo', 'tipo_entrega', 'uf', 'blacklist', 'cultura', 'origem_venda', 'dentro_politica'];

// Fila de uma etapa
r.get('/fila/:etapa', async (req, res) => {
  const etapa = W.ETAPAS[req.params.etapa];
  if (!etapa) throw new ErroNegocio('Etapa inválida', 404);
  if (!A.can(req.user, etapa.fila || 'x')) throw new ErroNegocio('Sem acesso a esta fila.', 403);
  const e = escopo(req);
  const etapas = req.params.etapa === 'transito' && req.query.aba === 'entregues' ? ['entregue'] : [req.params.etapa];
  await responderLista(req, res, {
    sql: `${LISTA_SQL} WHERE ${e.sql} AND p.etapa IN (${etapas.map(() => '?').join(',')})`,
    params: [...e.params, ...etapas], sort: 'etapa_desde', dir: 'asc', exact: FILTROS_EXATOS,
  });
});

// Progressão dos pedidos (histórico geral)
r.get('/progressao', A.exige('fila'), async (req, res) => {
  const e = escopo(req);
  await responderLista(req, res, { sql: `${LISTA_SQL} WHERE ${e.sql}`, params: e.params, sort: 'numero', exact: ['etapa', ...FILTROS_EXATOS] });
});

// Contagem por etapa (badges do menu)
r.get('/contagem', async (req, res) => {
  const e = escopo(req);
  const rows = await db.all(`SELECT etapa, COUNT(*) AS n FROM pedidos p WHERE ${e.sql} GROUP BY etapa`, ...e.params);
  res.json(Object.fromEntries(rows.map((x) => [x.etapa, x.n])));
});

async function carregar(req, id) {
  const e = escopo(req);
  const p = await db.get(`SELECT p.* FROM pedidos p WHERE p.id = ? AND ${e.sql}`, id, ...e.params);
  if (!p) throw new ErroNegocio('Pedido não encontrado', 404);
  return p;
}

r.get('/:id', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  const id = p.id;
  const dados = {
    pedido: {
      ...p,
      etapa_label: W.ETAPAS[p.etapa]?.label,
      vendedor: (await db.get('SELECT nome FROM usuarios WHERE id = ?', p.vendedor_id))?.nome,
      supervisor: p.supervisor_id ? (await db.get('SELECT nome FROM usuarios WHERE id = ?', p.supervisor_id))?.nome : null,
      analista: p.analista_id ? (await db.get('SELECT nome FROM usuarios WHERE id = ?', p.analista_id))?.nome : null,
      forma: await db.get('SELECT * FROM formas_pagamento WHERE id = ?', p.forma_id),
      condicao: await db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', p.condicao_id),
      transportadora: p.transportadora_id ? (await db.get('SELECT * FROM transportadoras WHERE id = ?', p.transportadora_id))?.nome : null,
      empresa: await db.get('SELECT * FROM empresas WHERE id = ?', p.empresa_id),
    },
    cliente: await db.get('SELECT * FROM clientes WHERE id = ?', p.cliente_id),
    enderecos: await db.all('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC', p.cliente_id),
    telefones: await db.all('SELECT * FROM cliente_telefones WHERE cliente_id = ?', p.cliente_id),
    ref_comerciais: await db.all('SELECT * FROM cliente_ref_comerciais WHERE cliente_id = ?', p.cliente_id),
    ref_bancarias: await db.all('SELECT * FROM cliente_ref_bancarias WHERE cliente_id = ?', p.cliente_id),
    itens: await db.all(
      `SELECT i.*, pr.nome AS produto, pr.codigo, g.nome AS grupo, g.id AS grupo_id, e.descricao AS embalagem
         FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN grupos_produto g ON g.id = pr.grupo_id
         LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE i.pedido_id = ? ORDER BY i.id`, id,
    ),
    historico: await db.all(
      'SELECT h.*, u.nome AS usuario FROM pedido_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE pedido_id = ? ORDER BY h.id', id,
    ),
    comentarios: await db.all(
      'SELECT c.*, u.nome AS usuario FROM pedido_comentarios c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE pedido_id = ? ORDER BY c.id DESC', id,
    ),
    comissoes: await db.all(
      'SELECT c.*, u.nome AS usuario FROM pedido_comissoes c JOIN usuarios u ON u.id = c.usuario_id WHERE pedido_id = ? ORDER BY c.id', id,
    ),
    links: await db.all('SELECT * FROM pedido_links_pagamento WHERE pedido_id = ? ORDER BY id DESC', id),
    serasa: await db.all(
      'SELECT s.*, u.nome AS usuario FROM consultas_serasa s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE cliente_id = ? ORDER BY s.id DESC LIMIT 10',
      p.cliente_id,
    ),
    notas: await db.all('SELECT * FROM notas_fiscais WHERE pedido_id = ? ORDER BY id DESC', id),
    parcelas: await db.all(
      `SELECT p.*, ${S.STATUS_PARCELA_SQL} AS status_atual, ${S.SALDO_PARCELA_SQL} AS saldo FROM parcelas p WHERE pedido_id = ? ORDER BY numero`, id,
    ),
    blacklist: await S.situacaoBlacklist(p.cliente_id),
    historico_cliente: await db.get(
      `SELECT COUNT(*) AS pedidos, IFNULL(SUM(valor_total),0) AS total, MAX(created_at) AS ultimo
         FROM pedidos WHERE cliente_id = ? AND id <> ? AND etapa <> 'cancelado'`, p.cliente_id, id,
    ),
    acoes: W.acoesDisponiveis(p, req.user),
    rastreio: await require('../rastreio').eventos(id),
    comissoes_padrao: await S.comissoesPadrao(p),
    comissoes_definidas: p.comissoes_definidas_em
      ? { em: p.comissoes_definidas_em, por: (await db.get('SELECT nome FROM usuarios WHERE id = ?', p.comissoes_definidas_por))?.nome }
      : null,
  };
  // Situação de crédito do cliente: para quem decide crédito e aprovação.
  if (['fila.analise', 'fila.diretoria', 'financeiro.parcelas'].some((x) => A.can(req.user, x))) {
    const CR = require('../credito');
    const andamento = (await db.get(`SELECT 1 AS x FROM pedidos WHERE id = ? AND etapa IN ${CR.EM_ANDAMENTO}`, id)) ? 0 : p.valor_total;
    const sc = await CR.doCliente(p.cliente_id, andamento);
    const forma = p.forma_id ? await db.get('SELECT tipo FROM formas_pagamento WHERE id = ?', p.forma_id) : null;
    dados.credito_situacao = sc && {
      limite: sc.limite, exposicao: sc.exposicao, disponivel: sc.disponivel, status: sc.status, bloqueios: forma?.tipo === 'a_vista' ? [] : sc.bloqueios,
      sugerido: sc.sugerido, a_vista: forma?.tipo === 'a_vista',
      liberado: p.credito_liberado_em ? { em: p.credito_liberado_em, justificativa: p.credito_justificativa, por: (await db.get('SELECT nome FROM usuarios WHERE id = ?', p.credito_liberado_por))?.nome } : null,
      pode_liberar: A.can(req.user, 'credito.liberar') && ['venda', 'supervisao', 'analise'].includes(p.etapa),
    };
    dados.credito = await db.get(
      `SELECT c.limite_credito,
          IFNULL((SELECT SUM(${S.SALDO_PARCELA_SQL}) FROM parcelas p WHERE p.cliente_id = c.id AND ${S.ABERTA_SQL}), 0) AS em_aberto,
          IFNULL((SELECT SUM(${S.SALDO_PARCELA_SQL}) FROM parcelas p WHERE p.cliente_id = c.id AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime')), 0) AS vencido,
          IFNULL((SELECT MAX(CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER)) FROM parcelas p
                   WHERE p.cliente_id = c.id AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime')), 0) AS maior_atraso,
          IFNULL((SELECT SUM(valor_total) FROM pedidos x WHERE x.cliente_id = c.id AND x.id <> ?
                   AND x.etapa IN ('supervisao','analise','diretoria','cobranca','producao','faturamento')), 0) AS outros_em_andamento
         FROM clientes c WHERE c.id = ?`, id, p.cliente_id,
    );
  }
  mascararObjeto(req.user, dados.cliente);
  mascararLinhas(req.user, dados.telefones.map((t) => Object.assign(t, { telefone: t.numero }))).forEach((t) => { t.numero = t.telefone; delete t.telefone; });
  res.json(dados);
});

// ---------- Criação e edição (etapa Vendedor) ----------
const camposCabecalho = ['cliente_id', 'forma_id', 'condicao_id', 'observacao', 'endereco_entrega_id', 'tipo_entrega', 'vendedor_id', 'cultura', 'area_ha', 'origem_venda'];

async function salvarItens(pedidoId, itens, formaId) {
  await db.run('DELETE FROM pedido_itens WHERE pedido_id = ?', pedidoId);
  // Preço de tabela pela tabela regional vigente para a UF de entrega.
  const ped = await db.get('SELECT cliente_id, endereco_entrega_id FROM pedidos WHERE id = ?', pedidoId);
  const P = require('../precos');
  const t = await P.tabelaVigente(await P.ufDe(ped.cliente_id, ped.endereco_entrega_id));
  for (const it of itens) {
    const prod = await db.get('SELECT * FROM produtos WHERE id = ? AND ativo = 1', it.produto_id);
    if (!prod) throw new ErroNegocio('Produto inválido no pedido.');
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new ErroNegocio(`Quantidade inválida para ${prod.nome}.`);
    const emb = it.embalagem_id ? await db.get('SELECT * FROM produto_embalagens WHERE id = ? AND produto_id = ?', it.embalagem_id, prod.id) : null;
    const tabela = (await P.preco({ produtoId: prod.id, embalagemId: emb?.id, formaId, tabela: t })).valor;
    const brinde = it.brinde ? 1 : 0;
    const unit = brinde ? 0 : S.r2(it.valor_unitario ?? tabela);
    await db.insert('pedido_itens', {
      pedido_id: pedidoId, produto_id: prod.id, embalagem_id: emb?.id, quantidade: qtd, unidade: emb?.unidade || prod.unidade,
      valor_tabela: tabela, custo_embalagem: emb?.custo || 0, valor_unitario: unit, valor_total: S.r2(qtd * unit), brinde, tabela_preco_id: t?.id || null,
    });
  }
}

/** Só dá para lançar pedido em nome de vendedor que está na abrangência do usuário. */
async function validarVendedor(req, vendedorId) {
  const v = E.vendedoresSql(req.user);
  if (v && !(await db.get(`SELECT 1 AS ok WHERE ? IN (${v})`, Number(vendedorId)))) throw new ErroNegocio('Vendedor fora da sua equipe.', 403);
}

async function validarCabecalho(b, atual = {}) {
  const L = require('../listas');
  if (b.cultura !== undefined) b.cultura = await L.exigir('cultura', b.cultura || null, { atual: atual.cultura, rotulo: 'Cultura' });
  if (b.origem_venda !== undefined) b.origem_venda = await L.exigir('origem_venda', b.origem_venda || null, { atual: atual.origem_venda, rotulo: 'Origem da venda' });
  if (b.area_ha !== undefined && b.area_ha !== null && b.area_ha !== '') {
    b.area_ha = Number(String(b.area_ha).replace(',', '.'));
    if (!(b.area_ha > 0 && b.area_ha <= 1000000)) throw new ErroNegocio('Área em hectares inválida.');
  } else if (b.area_ha === '') b.area_ha = null;
  if (b.cliente_id && !await db.get('SELECT id FROM clientes WHERE id = ?', b.cliente_id)) throw new ErroNegocio('Cliente não encontrado.');
  if (b.condicao_id && b.forma_id && !await db.get('SELECT id FROM condicoes_pagamento WHERE id = ? AND forma_id = ?', b.condicao_id, b.forma_id)) {
    throw new ErroNegocio('Condição não pertence à forma de pagamento.');
  }
  if (b.endereco_entrega_id && b.cliente_id && !await db.get('SELECT id FROM cliente_enderecos WHERE id = ? AND cliente_id = ?', b.endereco_entrega_id, b.cliente_id)) {
    throw new ErroNegocio('Endereço não pertence ao cliente.');
  }
}

r.post('/', A.exige('pedido.criar'), async (req, res) => {
  const b = { ...req.body };
  if (!b.cliente_id) throw new ErroNegocio('Informe o cliente.');
  await S.exigirClienteLiberado(b.cliente_id);
  if (E.abrangencia(req.user) === 'proprio' || !b.vendedor_id) b.vendedor_id = req.user.id;
  await validarVendedor(req, b.vendedor_id);
  await require('./clientes').exigirAcessoCliente(req.user, b.cliente_id);
  await validarCabecalho(b);
  const id = await db.tx(async () => {
    const vend = await db.get('SELECT u.id, e.supervisor_id FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?', b.vendedor_id);
    if (!b.endereco_entrega_id) b.endereco_entrega_id = (await db.get('SELECT id FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', b.cliente_id))?.id;
    const numero = await db.nextSeq('pedido', 100001);
    const pid = await db.insert('pedidos', { ...pick(b, camposCabecalho), numero, empresa_id: req.empresaId, supervisor_id: vend?.supervisor_id, etapa: 'venda' });
    await salvarItens(pid, b.itens || [], b.forma_id);
    await S.recalcularPedido(pid);
    await aprenderDoPedido(pid);
    await S.registrarHistorico(pid, { origem: null, destino: 'venda', acao: 'Pedido criado', usuarioId: req.user.id });
    if (b.enviar) await W.executar(pid, 'enviar', req.user);
    return pid;
  });
  res.status(201).json({ id, numero: (await db.get('SELECT numero FROM pedidos WHERE id = ?', id)).numero });
});

r.put('/:id', A.exige('pedido.criar'), async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  if (p.etapa !== 'venda') throw new ErroNegocio('Só é possível alterar o pedido na etapa Vendedor.');
  const b = { ...req.body, cliente_id: req.body.cliente_id || p.cliente_id };
  if (E.abrangencia(req.user) === 'proprio') delete b.vendedor_id;
  if (b.vendedor_id) await validarVendedor(req, b.vendedor_id);
  await validarCabecalho(b, p);
  await db.tx(async () => {
    await db.update('pedidos', p.id, pick(b, camposCabecalho), camposCabecalho);
    await aprenderDoPedido(p.id);
    if (Array.isArray(b.itens)) await salvarItens(p.id, b.itens, b.forma_id ?? p.forma_id);
    await S.recalcularPedido(p.id);
    if (b.enviar) await W.executar(p.id, 'enviar', req.user);
  });
  res.json({ ok: true });
});

/** O pedido alimenta o cadastro do cliente: origem do lead e área da cultura, quando ainda não existem. */
async function aprenderDoPedido(pedidoId) {
  const p = await db.get('SELECT cliente_id, cultura, area_ha, origem_venda FROM pedidos WHERE id = ?', pedidoId);
  if (!p) return;
  if (p.origem_venda) await db.run(`UPDATE clientes SET origem_lead = ? WHERE id = ? AND (origem_lead IS NULL OR origem_lead = '')`, p.origem_venda, p.cliente_id);
  if (p.cultura && p.area_ha && !(await db.get('SELECT id FROM cliente_areas WHERE cliente_id = ? AND tipo_cultivo = ?', p.cliente_id, p.cultura))) {
    await db.insert('cliente_areas', { cliente_id: p.cliente_id, tipo_cultivo: p.cultura, area: p.area_ha, medida: 'ha' });
  }
}

function pick(o, campos) {
  return Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

// ---------- Ações de fluxo ----------
r.post('/:id/acao', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  res.json(await W.executar(p.id, req.body?.acao, req.user, req.body?.observacao));
});

/** Exige que o pedido esteja na etapa e que o perfil atue nela. */
async function naEtapa(req, etapas) {
  const p = await carregar(req, Number(req.params.id));
  const lista = [].concat(etapas);
  if (!lista.includes(p.etapa)) throw new ErroNegocio(`Disponível apenas na etapa ${lista.map((e) => W.ETAPAS[e].label).join('/')}.`);
  if (!A.can(req.user, W.ETAPAS[p.etapa].fila)) throw new ErroNegocio('Seu perfil não atua nesta etapa.', 403);
  return p;
}

r.put('/:id/supervisao', async (req, res) => {
  const p = await naEtapa(req, 'supervisao');
  await db.run(`UPDATE pedidos SET observacao_supervisor = ?, updated_at = datetime('now','localtime') WHERE id = ?`, req.body?.observacao_supervisor || null, p.id);
  res.json({ ok: true });
});

r.put('/:id/frete', async (req, res) => {
  const p = await naEtapa(req, ['analise', 'diretoria']);
  const b = req.body || {};
  const tipos = ['transportadora', 'posta_restante', 'veiculo_proprio', 'retirada'];
  if (b.tipo_entrega && !tipos.includes(b.tipo_entrega)) throw new ErroNegocio('Tipo de entrega inválido.');
  if (b.frete_ignorado && !String(b.frete_motivo_ignorar || '').trim()) throw new ErroNegocio('Informe o motivo para ignorar a cotação.');
  await db.update('pedidos', p.id, { ...b, frete_ignorado: b.frete_ignorado ? 1 : 0 },
    ['tipo_entrega', 'transportadora_id', 'frete_codigo_cotacao', 'frete_prazo_dias', 'frete_valor', 'frete_ignorado', 'frete_motivo_ignorar']);
  await S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: b.frete_ignorado ? 'Cotação de frete ignorada' : 'Cotação de frete registrada', observacao: b.frete_motivo_ignorar, usuarioId: req.user.id });
  res.json({ ok: true });
});

// Diretoria define as comissões do pedido (% ou valor em R$). Lista vazia = pedido sem comissão.
r.put('/:id/comissoes', async (req, res) => {
  const p = await naEtapa(req, 'diretoria');
  const lista = Array.isArray(req.body?.comissoes) ? req.body.comissoes : [];
  const total = Number(p.valor_total) || 0;
  const antes = await db.all('SELECT c.*, u.nome FROM pedido_comissoes c JOIN usuarios u ON u.id = c.usuario_id WHERE pedido_id = ? ORDER BY c.id', p.id);
  const novas = [];
  for (const c of lista) {
    const uid = Number(c.usuario_id);
    const u = uid && await db.get('SELECT id, nome, comissao_pct FROM usuarios WHERE id = ? AND ativo = 1', uid);
    if (!u) throw new ErroNegocio('Colaborador inválido na comissão.');
    const papel = ['vendedor', 'supervisor', 'gerente', 'indicacao', 'outro'].includes(c.papel) ? c.papel : 'outro';
    if (novas.some((x) => x.usuario_id === uid && x.papel === papel)) throw new ErroNegocio(`${u.nome} aparece duas vezes como ${papel}.`);
    let pct;
    if (c.valor != null && c.valor !== '' && (c.percentual == null || c.percentual === '')) {
      const v = Number(c.valor);
      if (!(v >= 0) || v > total) throw new ErroNegocio(`Valor de comissão inválido para ${u.nome}.`);
      pct = total ? Math.round((v / total) * 100 * 10000) / 10000 : 0;
    } else {
      pct = c.percentual == null || c.percentual === '' ? Number(u.comissao_pct) || 0 : Number(c.percentual);
    }
    if (!(pct >= 0) || pct > 100) throw new ErroNegocio(`Percentual de comissão inválido para ${u.nome}.`);
    novas.push({ usuario_id: uid, nome: u.nome, papel, percentual: pct, valor: S.r2((total * pct) / 100) });
  }
  const somaPct = novas.reduce((a, c) => a + c.percentual, 0);
  if (somaPct > 100) throw new ErroNegocio('A soma das comissões passa de 100% do pedido.');
  const fmtPct = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  const descr = (l) => (l.length ? l.map((c) => `${c.nome} (${c.papel}) ${fmtPct(c.percentual)}`).join('; ') : 'sem comissão');
  await db.tx(async () => {
    await db.run('DELETE FROM pedido_comissoes WHERE pedido_id = ?', p.id);
    for (const c of novas) {
      await db.insert('pedido_comissoes', { pedido_id: p.id, usuario_id: c.usuario_id, papel: c.papel, percentual: c.percentual, valor: c.valor });
    }
    await db.run(`UPDATE pedidos SET comissoes_definidas_em = datetime('now','localtime'), comissoes_definidas_por = ?, updated_at = datetime('now','localtime') WHERE id = ?`, req.user.id, p.id);
    await S.registrarHistorico(p.id, {
      origem: p.etapa, destino: p.etapa, acao: 'Comissão alterada pela Diretoria',
      observacao: `Antes: ${descr(antes)}. Agora: ${descr(novas)}.${req.body?.motivo ? ` Motivo: ${String(req.body.motivo).slice(0, 300)}` : ''}`,
      usuarioId: req.user.id,
    });
  });
  res.json({ ok: true, comissoes: novas, total: S.r2(novas.reduce((a, c) => a + c.valor, 0)) });
});

r.put('/:id/producao', async (req, res) => {
  const p = await naEtapa(req, 'producao');
  const b = req.body || {};
  await db.tx(async () => {
    for (const it of b.itens || []) {
      await db.run('UPDATE pedido_itens SET lote = ?, fabricacao = ?, validade = ? WHERE id = ? AND pedido_id = ?',
        it.lote || null, it.fabricacao || null, it.validade || null, it.id, p.id);
    }
    if (b.prazo_producao) await db.run('UPDATE pedidos SET prazo_producao = ? WHERE id = ?', b.prazo_producao, p.id);
  });
  res.json({ ok: true });
});

r.put('/:id/endereco', async (req, res) => {
  const p = await naEtapa(req, ['faturamento', 'analise']);
  const end = await db.get('SELECT id FROM cliente_enderecos WHERE id = ? AND cliente_id = ?', req.body?.endereco_entrega_id, p.cliente_id);
  if (!end) throw new ErroNegocio('Endereço inválido.');
  await db.run('UPDATE pedidos SET endereco_entrega_id = ? WHERE id = ?', end.id, p.id);
  await S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: 'Endereço de entrega ajustado', usuarioId: req.user.id });
  res.json({ ok: true });
});

r.put('/:id/expedicao', async (req, res) => {
  const p = await naEtapa(req, ['expedicao', 'transito']);
  const b = req.body || {};
  const campos = p.etapa === 'expedicao' ? ['data_embarque', 'data_entrega_prevista', 'transportadora_id'] : ['transportadora_id', 'data_embarque', 'data_entrega'];
  await db.update('pedidos', p.id, b, campos);
  res.json({ ok: true });
});

// ---------- Rastreio ----------
r.post('/rastreio/atualizar', A.exige('fila.transito', 'fila.expedicao'), async (req, res) => {
  res.json(await require('../rastreio').atualizarTodos(req.empresaId, { usuarioId: req.user.id }));
});
r.post('/:id/rastreio', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  res.json(await require('../rastreio').rastrearPedido(p.id, { usuarioId: req.user.id }));
});

// ---------- Etiqueta de envio (Correios e transportadora) ----------
async function dadosEnvio(p) {
  const itens = await db.all(
    `SELECT i.quantidade, i.unidade, pr.nome AS produto, e.descricao AS embalagem, e.quantidade AS conteudo, e.unidade AS unidade_emb, e.peso_kg
       FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id
      WHERE i.pedido_id = ? ORDER BY i.id`, p.id,
  );
  // Peso estimado: peso cadastrado da embalagem ou, sem ele, o conteúdo quando a unidade é KG.
  const pesoItem = (i) => i.quantidade * (i.peso_kg || (String(i.unidade_emb || i.unidade).toUpperCase() === 'KG' ? i.conteudo || 1 : 0));
  const pesoEstimado = S.r2(itens.reduce((s, i) => s + pesoItem(i), 0));
  // Embalagem acima de 100 kg (big bag, granel) conta como um volume por item; as menores, uma por unidade.
  const volumesEstimados = Math.max(1, Math.min(99, Math.round(itens.reduce((s, i) => s + ((i.peso_kg || i.conteudo || 0) > 100 ? 1 : i.quantidade), 0))));
  return { itens, peso_estimado: pesoEstimado, volumes_estimados: volumesEstimados };
}

r.get('/:id/etiqueta', A.exige('etiquetas'), async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  const empresa = await db.get('SELECT * FROM empresas WHERE id = ?', p.empresa_id);
  const cliente = await db.get('SELECT id, nome, nome_fantasia, documento, tipo_pessoa FROM clientes WHERE id = ?', p.cliente_id);
  const end = p.endereco_entrega_id
    ? await db.get('SELECT * FROM cliente_enderecos WHERE id = ?', p.endereco_entrega_id)
    : await db.get('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', p.cliente_id);
  // O telefone vai completo: a transportadora precisa dele para a entrega (finalidade legítima).
  const tel = await db.get('SELECT numero, contato FROM cliente_telefones WHERE cliente_id = ? ORDER BY whatsapp DESC, id LIMIT 1', p.cliente_id);
  const nota = await db.get(`SELECT numero, serie, chave, data_emissao, valor FROM notas_fiscais WHERE pedido_id = ? AND status <> 'cancelada' ORDER BY id DESC LIMIT 1`, p.id);
  const transp = p.transportadora_id ? await db.get('SELECT nome, cnpj, telefone FROM transportadoras WHERE id = ?', p.transportadora_id) : null;
  const envio = await dadosEnvio(p);
  await require('../auditoria').registrar('etiqueta', 'pedidos', p.id, null, { volumes: p.volumes || envio.volumes_estimados });
  res.json({
    pedido: {
      id: p.id, numero: p.numero, etapa: p.etapa, etapa_label: W.ETAPAS[p.etapa]?.label, tipo_entrega: p.tipo_entrega, valor_total: p.valor_total,
      volumes: p.volumes, peso_kg: p.peso_kg, codigo_rastreio: p.codigo_rastreio, data_embarque: p.data_embarque, data_entrega_prevista: p.data_entrega_prevista,
      frete_codigo_cotacao: p.frete_codigo_cotacao, observacao: p.observacao,
    },
    remetente: empresa,
    destinatario: { ...mascararObjeto(req.user, cliente), endereco: end, telefone: tel?.numero, contato: tel?.contato },
    nota, transportadora: transp, ...envio,
  });
});

r.put('/:id/envio', A.exige('etiquetas'), async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  const b = req.body || {};
  const volumes = b.volumes == null || b.volumes === '' ? null : parseInt(b.volumes, 10);
  if (volumes != null && !(volumes >= 1 && volumes <= 999)) throw new ErroNegocio('Volumes deve ficar entre 1 e 999.');
  const peso = b.peso_kg == null || b.peso_kg === '' ? null : Number(b.peso_kg);
  if (peso != null && !(peso >= 0)) throw new ErroNegocio('Peso inválido.');
  const rastreio = b.codigo_rastreio ? String(b.codigo_rastreio).trim().toUpperCase().slice(0, 40) : null;
  await db.update('pedidos', p.id, { volumes, peso_kg: peso, codigo_rastreio: rastreio });
  if (rastreio && rastreio !== p.codigo_rastreio) {
    await S.registrarHistorico(p.id, { origem: p.etapa, destino: p.etapa, acao: 'Código de rastreio informado', observacao: rastreio, usuarioId: req.user.id });
  }
  res.json({ ok: true });
});

// ---------- Comentários e links de pagamento ----------
r.post('/:id/comentarios', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new ErroNegocio('Escreva o comentário.');
  res.status(201).json({ id: await db.insert('pedido_comentarios', { pedido_id: p.id, usuario_id: req.user.id, etapa: p.etapa, texto }) });
});

r.post('/:id/links', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  if (!A.can(req.user, 'pedido.criar') && !A.can(req.user, 'fila.cobranca')) throw new ErroNegocio('Sem permissão.', 403);
  const valor = S.r2(req.body?.valor || p.valor_total);
  const codigo = crypto.randomBytes(6).toString('hex').toUpperCase();
  const id = await db.insert('pedido_links_pagamento', { pedido_id: p.id, codigo, valor, meio: req.body?.meio || 'PIX' });
  res.status(201).json(await db.get('SELECT * FROM pedido_links_pagamento WHERE id = ?', id));
});

r.post('/:id/links/:linkId/pago', async (req, res) => {
  const p = await carregar(req, Number(req.params.id));
  if (!A.can(req.user, 'fila.cobranca')) throw new ErroNegocio('Sem permissão.', 403);
  await db.run(`UPDATE pedido_links_pagamento SET status = 'pago' WHERE id = ? AND pedido_id = ?`, req.params.linkId, p.id);
  res.json({ ok: true });
});

module.exports = r;
module.exports.salvarItens = salvarItens;
