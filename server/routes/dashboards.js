// Painel com os indicadores de cada perfil de usuário.
const express = require('express');
const db = require('../db');
const S = require('../services');
const W = require('../workflow');
const { PERFIS, can } = require('../auth');
const E = require('../escopo');

const r = express.Router();

// Filtro do painel: período (de/ate) e recortes por vendedor, equipe, forma de pagamento e UF de entrega.
// Indicadores de movimento (vendas, faturamento, recebimentos, decisões) seguem o período;
// filas e saldos mostram a situação atual, mas respeitam os recortes.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ids = (v) => [...new Set(String(v || '').split(',').map((x) => parseInt(x, 10)).filter((n) => n > 0))].slice(0, 200);

function contexto(req) {
  const q = req.query;
  const hoje = S.hoje();
  let de = ISO.test(q.de || '') ? q.de : hoje.slice(0, 7) + '-01';
  let ate = ISO.test(q.ate || '') ? q.ate : hoje;
  if (de > ate) [de, ate] = [ate, de];
  const filtros = {
    vendedores: ids(q.vendedores), equipes: ids(q.equipes), formas: ids(q.formas),
    ufs: String(q.ufs || '').toUpperCase().split(',').filter((u) => /^[A-Z]{2}$/.test(u)).slice(0, 27),
  };
  const ativo = Object.values(filtros).some((l) => l.length);
  const mesCorrente = de === hoje.slice(0, 7) + '-01' && ate === hoje;
  /** Condição extra para pedidos com o alias informado (valores já validados, inseridos direto no SQL). */
  const fx = (a = 'p') => {
    const c = [];
    if (filtros.vendedores.length) c.push(`${a}.vendedor_id IN (${filtros.vendedores.join(',')})`);
    if (filtros.equipes.length) c.push(`EXISTS (SELECT 1 FROM usuarios fv WHERE fv.id = ${a}.vendedor_id AND fv.equipe_id IN (${filtros.equipes.join(',')}))`);
    if (filtros.formas.length) c.push(`${a}.forma_id IN (${filtros.formas.join(',')})`);
    if (filtros.ufs.length) c.push(`EXISTS (SELECT 1 FROM cliente_enderecos fe WHERE fe.id = ${a}.endereco_entrega_id AND fe.uf IN (${filtros.ufs.map((u) => `'${u}'`).join(',')}))`);
    return c.length ? c.join(' AND ') : 'TRUE';
  };
  /** Para tabelas ligadas a um pedido (notas, parcelas, comissões): só aplica quando há recorte. */
  const fxPedido = (col) => (ativo ? `${col} IN (SELECT fxp.id FROM pedidos fxp WHERE ${fx('fxp')})` : 'TRUE');
  return {
    uid: req.user.id, emp: req.empresaId, de, ate, ateFim: S.addDias(ate, 1), filtros, ativo, fx, fxPedido,
    rot: mesCorrente ? 'no mês' : 'no período',
  };
}
/** "col dentro do período": col >= de AND col < dia seguinte ao fim. */
const noPeriodo = (ctx, col) => ({ sql: `${col} >= ? AND ${col} < ?`, params: [ctx.de, ctx.ateFim] });

const card = (label, valor, extra = {}) => ({ label, valor, tipo: 'numero', ...extra });
const money = (label, valor, extra = {}) => card(label, S.r2(valor), { tipo: 'moeda', ...extra });

/** Meses terminando no mês final do período. */
function ultimosMeses(n, ate) {
  const out = [];
  const [ano, mes] = ate.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(ano, mes - 1 - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
/** Série mensal: a SQL recebe os params e, por último, o início e o fim (exclusivo) da janela. */
async function serieMensal(ctx, sql, params, n = 6) {
  const meses = ultimosMeses(n, ctx.ate);
  const [a, m] = meses.at(-1).split('-').map(Number);
  const fim = `${a + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const rows = await db.all(sql, ...params, meses[0] + '-01', fim);
  const mapa = Object.fromEntries(rows.map((x) => [x.mes, x.v]));
  return { labels: meses.map((m) => m.split('-').reverse().join('/')), dados: meses.map((m) => S.r2(mapa[m] || 0)) };
}

/** Pedidos visíveis no painel: empresa, abrangência do perfil e recortes do filtro. */
function filtroPedidos(ctx, perfil) {
  const extra = ctx.fx('p');
  if (perfil === 'vendedor' || perfil === 'supervisor') {
    return { sql: `p.empresa_id = ? AND ${E.vendas({ id: ctx.uid, perfil }, 'p')} AND ${extra}`, params: [ctx.emp] };
  }
  return { sql: `p.empresa_id = ? AND ${extra}`, params: [ctx.emp] };
}

async function porEtapa(f) {
  const rows = await db.all(`SELECT etapa, COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('entregue','cancelado') GROUP BY etapa`, ...f.params);
  const ordem = Object.keys(W.ETAPAS).filter((e) => !['entregue', 'cancelado'].includes(e));
  const mapa = Object.fromEntries(rows.map((x) => [x.etapa, x.n]));
  return { titulo: 'Pedidos em andamento por etapa', tipo: 'bar', labels: ordem.map((e) => W.ETAPAS[e].label), series: [{ nome: 'Pedidos', dados: ordem.map((e) => mapa[e] || 0) }] };
}

async function vendasPeriodo(ctx, f) {
  const per = noPeriodo(ctx, 'p.created_at');
  return await db.get(
    `SELECT COUNT(*) AS n, IFNULL(SUM(valor_total),0) AS v FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('venda','cancelado') AND ${per.sql}`,
    ...f.params, ...per.params,
  );
}

async function fila(etapa, ctx, f) {
  const filtro = f || filtroPedidos(ctx, 'todos');
  return await db.get(
    `SELECT COUNT(*) AS n, IFNULL(SUM(valor_total),0) AS v, IFNULL(MAX(julianday('now','localtime') - julianday(etapa_desde)),0) AS mais_antigo
       FROM pedidos p WHERE ${filtro.sql} AND etapa = ?`, ...filtro.params, etapa,
  );
}

async function inadimplencia(ctx, where, params) {
  const x = await db.get(
    `SELECT IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} THEN ${S.SALDO_PARCELA_SQL} END),0) AS aberto,
            IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} END),0) AS vencido
       FROM parcelas p LEFT JOIN pedidos pe ON pe.id = p.pedido_id WHERE ${where} AND ${ctx.fxPedido('p.pedido_id')}`, ...params,
  );
  return { ...x, pct: x.aberto ? S.r2((x.vencido / x.aberto) * 100) : 0 };
}

const PAINEIS = {
  async vendedor(ctx) {
    const f = filtroPedidos(ctx, 'vendedor');
    const vm = await vendasPeriodo(ctx, f);
    const devolvidos = (await db.get(
      `SELECT COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa = 'venda'
         AND EXISTS (SELECT 1 FROM pedido_historico h WHERE h.pedido_id = p.id AND h.etapa_destino = 'venda' AND h.etapa_origem IS NOT NULL)`, ...f.params,
    )).n;
    const com = (await db.get(
      `SELECT IFNULL(SUM(valor),0) AS v FROM comissoes WHERE usuario_id = ? AND periodo BETWEEN ? AND ? AND ${ctx.fxPedido('pedido_id')}`,
      ctx.uid, ctx.de.slice(0, 7), ctx.ate.slice(0, 7),
    )).v;
    const inad = await inadimplencia(ctx, `p.empresa_id = ? AND ${E.financeiro({ id: ctx.uid, perfil: 'vendedor' }, 'p')}`, [ctx.emp]);
    const per = noPeriodo(ctx, 'p.created_at');
    return {
      cards: [
        money(`Vendas ${ctx.rot}`, vm.v, { icone: 'bi-graph-up-arrow', cor: 'success', sub: `${vm.n} pedidos` }),
        card('Em digitação', (await fila('venda', ctx, f)).n, { icone: 'bi-pencil-square', cor: 'primary', link: '#/fila/venda' }),
        card('Devolvidos para correção', devolvidos, { icone: 'bi-arrow-counterclockwise', cor: 'warning', link: '#/fila/venda' }),
        money(`Comissão prevista ${ctx.rot}`, com, { icone: 'bi-piggy-bank', cor: 'info' }),
        money('Carteira vencida', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do em aberto` }),
      ],
      graficos: [
        { titulo: 'Minhas vendas (6 meses)', tipo: 'line', ...serieComoGrafico(await serieMensal(ctx,
          `SELECT substr(created_at,1,7) AS mes, SUM(valor_total) AS v FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('venda','cancelado') AND created_at >= ? AND created_at < ? GROUP BY mes`, f.params), 'Vendas (R$)') },
        await porEtapa(f),
      ],
      tabelas: [
        tabela(`Maiores clientes ${ctx.rot}`, ['Cliente', 'Pedidos', 'Total (R$)'], (await db.all(
          `SELECT c.nome, COUNT(*) AS n, ROUND(SUM(p.valor_total),2) AS v FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE ${f.sql} AND etapa NOT IN ('venda','cancelado') AND ${per.sql} GROUP BY c.id ORDER BY v DESC LIMIT 8`, ...f.params, ...per.params,
        )).map((x) => [x.nome, x.n, x.v]), [null, null, 'moeda']),
        tabela('Minhas tarefas de CRM', ['Tarefa', 'Cliente', 'Vencimento'], (await db.all(
          `SELECT t.titulo, c.nome, t.vencimento FROM crm_tarefas t LEFT JOIN clientes c ON c.id = t.cliente_id WHERE t.responsavel_id = ? AND t.concluida = 0 ORDER BY t.vencimento LIMIT 8`, ctx.uid,
        )).map((x) => [x.titulo, x.nome, x.vencimento]), [null, null, 'date']),
      ],
    };
  },

  async supervisor(ctx) {
    const f = filtroPedidos(ctx, 'supervisor');
    const vm = await vendasPeriodo(ctx, f);
    const fs = await fila('supervisao', ctx, f);
    const inad = await inadimplencia(ctx, `p.empresa_id = ? AND ${E.financeiro({ id: ctx.uid, perfil: 'supervisor' }, 'p')}`, [ctx.emp]);
    const ranking = await db.all(
      `SELECT v.nome, IFNULL(SUM(p.valor_total),0) AS total FROM usuarios v
         JOIN equipes e ON e.id = v.equipe_id AND e.supervisor_id = ?
         LEFT JOIN pedidos p ON p.vendedor_id = v.id AND p.empresa_id = ? AND p.etapa NOT IN ('venda','cancelado') AND p.created_at >= ? AND p.created_at < ? AND ${ctx.fx('p')}
        WHERE v.perfil = 'vendedor' ${ctx.filtros.vendedores.length ? `AND v.id IN (${ctx.filtros.vendedores.join(',')})` : ''} GROUP BY v.id ORDER BY total DESC`,
      ctx.uid, ctx.emp, ctx.de, ctx.ateFim,
    );
    return {
      cards: [
        money(`Vendas da equipe ${ctx.rot}`, vm.v, { icone: 'bi-people', cor: 'success', sub: `${vm.n} pedidos` }),
        card('Aguardando minha supervisão', fs.n, { icone: 'bi-person-check', cor: 'primary', link: '#/fila/supervisao', sub: fs.n ? `mais antigo há ${Math.floor(fs.mais_antigo)} dias` : '' }),
        money('Valor na fila de supervisão', fs.v, { icone: 'bi-hourglass-split', cor: 'secondary' }),
        money('Inadimplência da equipe', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do em aberto` }),
      ],
      graficos: [
        { titulo: `Vendas por vendedor ${ctx.rot}`, tipo: 'bar', labels: ranking.map((x) => x.nome), series: [{ nome: 'R$', dados: ranking.map((x) => S.r2(x.total)) }] },
        await porEtapa(f),
      ],
      tabelas: [],
    };
  },

  async analista(ctx) {
    const f = filtroPedidos(ctx, 'analista');
    const fa = await fila('analise', ctx, f);
    const per = noPeriodo(ctx, 'h.created_at');
    const dec = await db.get(
      `SELECT SUM(CASE WHEN h.etapa_origem = 'analise' AND h.etapa_destino NOT IN ('cancelado','venda','analise') THEN 1 ELSE 0 END) AS aprovados,
              SUM(CASE WHEN h.etapa_origem = 'analise' AND h.etapa_destino = 'cancelado' THEN 1 ELSE 0 END) AS reprovados,
              SUM(CASE WHEN h.etapa_origem = 'analise' AND h.etapa_destino = 'venda' THEN 1 ELSE 0 END) AS devolvidos
         FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id WHERE ${f.sql} AND ${per.sql}`, ...f.params, ...per.params,
    );
    const perS = noPeriodo(ctx, 's.created_at');
    const tempo = (await db.get(
      `SELECT AVG(julianday(s.created_at) - julianday(e.created_at)) * 24 AS horas FROM pedido_historico s
         JOIN pedido_historico e ON e.pedido_id = s.pedido_id AND e.etapa_destino = 'analise' AND e.id < s.id
         JOIN pedidos p ON p.id = s.pedido_id
        WHERE s.etapa_origem = 'analise' AND ${f.sql} AND ${perS.sql}`, ...f.params, ...perS.params,
    )).horas;
    const alertas = (await db.get(
      `SELECT COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND p.etapa = 'analise' AND EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = p.cliente_id AND b.ativo = 1)`, ...f.params,
    )).n;
    return {
      cards: [
        card('Na fila de análise', fa.n, { icone: 'bi-search', cor: 'primary', link: '#/fila/analise' }),
        money('Valor em análise', fa.v, { icone: 'bi-cash-stack', cor: 'secondary' }),
        card('Com alerta/blacklist', alertas, { icone: 'bi-shield-exclamation', cor: 'danger' }),
        card(`Aprovados ${ctx.rot}`, dec.aprovados || 0, { icone: 'bi-check-circle', cor: 'success', sub: `${dec.reprovados || 0} reprovados · ${dec.devolvidos || 0} devolvidos` }),
        card('Tempo médio de análise', tempo ? `${S.r2(tempo)} h` : '-', { tipo: 'texto', icone: 'bi-stopwatch', cor: 'info' }),
      ],
      graficos: [
        { titulo: `Decisões da análise ${ctx.rot}`, tipo: 'doughnut', labels: ['Aprovados', 'Reprovados', 'Devolvidos'], series: [{ nome: 'Pedidos', dados: [dec.aprovados || 0, dec.reprovados || 0, dec.devolvidos || 0] }] },
        { titulo: `Score Serasa das consultas ${ctx.rot}`, tipo: 'bar', ...(await faixasScore(ctx)) },
      ],
      tabelas: [],
    };
  },

  async diretoria(ctx) {
    const f = filtroPedidos(ctx, 'diretoria');
    const vm = await vendasPeriodo(ctx, f);
    const perN = noPeriodo(ctx, 'data_emissao');
    const fat = await db.get(
      `SELECT COUNT(*) AS n, IFNULL(SUM(valor),0) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND ${perN.sql} AND ${ctx.fxPedido('pedido_id')}`,
      ctx.emp, ...perN.params,
    );
    const inad = await inadimplencia(ctx, 'p.empresa_id = ?', [ctx.emp]);
    const fd = await fila('diretoria', ctx, f);
    const per = noPeriodo(ctx, 'p.created_at');
    const equipes = await db.all(
      `SELECT IFNULL(e.nome,'Sem equipe') AS nome, IFNULL(SUM(p.valor_total),0) AS v FROM pedidos p JOIN usuarios v ON v.id = p.vendedor_id
         LEFT JOIN equipes e ON e.id = v.equipe_id WHERE ${f.sql} AND p.etapa NOT IN ('venda','cancelado') AND ${per.sql} GROUP BY e.id ORDER BY v DESC`,
      ...f.params, ...per.params,
    );
    return {
      cards: [
        money(`Faturamento ${ctx.rot}`, fat.v, { icone: 'bi-receipt', cor: 'success', sub: `${fat.n} notas` }),
        money(`Vendas ${ctx.rot}`, vm.v, { icone: 'bi-graph-up-arrow', cor: 'primary', sub: `${vm.n} pedidos · ticket ${vm.n ? (vm.v / vm.n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}` }),
        card('Aguardando aprovação final', fd.n, { icone: 'bi-award', cor: 'warning', link: '#/fila/diretoria' }),
        money('Contas a receber', inad.aberto, { icone: 'bi-wallet2', cor: 'info' }),
        money('Inadimplência', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do a receber` }),
      ],
      graficos: [
        { titulo: 'Faturamento (12 meses)', tipo: 'line', ...serieComoGrafico(await serieMensal(ctx,
          `SELECT substr(data_emissao,1,7) AS mes, SUM(valor) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND ${ctx.fxPedido('pedido_id')}
             AND data_emissao >= ? AND data_emissao < ? GROUP BY mes`, [ctx.emp], 12), 'Faturamento (R$)') },
        await porEtapa(f),
        { titulo: `Vendas por equipe ${ctx.rot}`, tipo: 'doughnut', labels: equipes.map((x) => x.nome), series: [{ nome: 'R$', dados: equipes.map((x) => S.r2(x.v)) }] },
      ],
      tabelas: [
        tabela(`Produtos mais vendidos ${ctx.rot}`, ['Produto', 'Quantidade', 'Valor (R$)'], (await db.all(
          `SELECT pr.nome, SUM(i.quantidade) AS q, i.unidade, ROUND(SUM(i.valor_total),2) AS v FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
             JOIN produtos pr ON pr.id = i.produto_id WHERE ${f.sql} AND p.etapa NOT IN ('venda','cancelado') AND ${per.sql}
            GROUP BY pr.id, i.unidade ORDER BY v DESC LIMIT 10`, ...f.params, ...per.params,
        )).map((x) => [x.nome, `${x.q.toLocaleString('pt-BR')} ${x.unidade || ''}`, x.v]), [null, null, 'moeda']),
      ],
    };
  },

  async producao(ctx) {
    const f = filtroPedidos(ctx, 'producao');
    const fp = await fila('producao', ctx, f);
    const atrasados = (await db.get(`SELECT COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa = 'producao' AND prazo_producao < date('now','localtime')`, ...f.params)).n;
    const per = noPeriodo(ctx, 'h.created_at');
    const concluidos = (await db.get(`SELECT COUNT(*) AS n FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id WHERE ${f.sql} AND h.etapa_origem = 'producao' AND h.etapa_destino = 'faturamento' AND ${per.sql}`, ...f.params, ...per.params)).n;
    const semLote = (await db.get(`SELECT COUNT(*) AS n FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE ${f.sql} AND p.etapa = 'producao' AND (i.lote IS NULL OR i.lote = '')`, ...f.params)).n;
    const aProduzir = await db.all(
      `SELECT pr.nome, SUM(i.quantidade * IFNULL(e.quantidade,1)) AS q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id
         LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE ${f.sql} AND p.etapa = 'producao' GROUP BY pr.id ORDER BY q DESC LIMIT 10`, ...f.params,
    );
    return {
      cards: [
        card('Pedidos em produção', fp.n, { icone: 'bi-gear', cor: 'primary', link: '#/fila/producao' }),
        card('Com prazo vencido', atrasados, { icone: 'bi-alarm', cor: 'danger' }),
        card('Itens sem lote', semLote, { icone: 'bi-upc-scan', cor: 'warning' }),
        card(`Concluídos ${ctx.rot}`, concluidos, { icone: 'bi-check2-all', cor: 'success' }),
      ],
      graficos: [{ titulo: 'Volume a produzir por produto (kg/L)', tipo: 'bar', labels: aProduzir.map((x) => x.nome), series: [{ nome: 'Quantidade', dados: aProduzir.map((x) => S.r2(x.q)) }] }],
      tabelas: [
        tabela('Próximos prazos', ['Pedido', 'Cliente', 'Chegou em', 'Prazo'], (await db.all(
          `SELECT p.numero, c.nome, p.data_chegada_producao, p.prazo_producao FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE ${f.sql} AND p.etapa = 'producao' ORDER BY p.prazo_producao LIMIT 10`, ...f.params,
        )).map((x) => [x.numero, x.nome, x.data_chegada_producao, x.prazo_producao]), [null, null, 'datetime', 'date']),
      ],
    };
  },

  async faturamento(ctx) {
    const f = filtroPedidos(ctx, 'faturamento');
    const ff = await fila('faturamento', ctx, f);
    const perN = noPeriodo(ctx, 'data_emissao');
    const nf = await db.get(
      `SELECT SUM(CASE WHEN status <> 'cancelada' THEN 1 ELSE 0 END) AS emitidas, IFNULL(SUM(CASE WHEN status <> 'cancelada' THEN valor END),0) AS valor,
              SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) AS canceladas
         FROM notas_fiscais WHERE empresa_id = ? AND ${perN.sql} AND ${ctx.fxPedido('pedido_id')}`, ctx.emp, ...perN.params,
    );
    const perC = noPeriodo(ctx, 'cc.created_at');
    const cce = (await db.get(`SELECT COUNT(*) AS n FROM cartas_correcao cc JOIN notas_fiscais n ON n.id = cc.nota_id WHERE n.empresa_id = ? AND ${perC.sql} AND ${ctx.fxPedido('n.pedido_id')}`, ctx.emp, ...perC.params)).n;
    // Até ~2 meses mostra por dia; períodos maiores, por mês.
    const porDia = S.diasEntre(ctx.de, ctx.ate) <= 62;
    const tam = porDia ? 10 : 7;
    const serie = await db.all(
      `SELECT substr(data_emissao,1,${tam}) AS d, SUM(valor) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND ${perN.sql} AND ${ctx.fxPedido('pedido_id')} GROUP BY d ORDER BY d`,
      ctx.emp, ...perN.params,
    );
    return {
      cards: [
        card('Aguardando faturamento', ff.n, { icone: 'bi-receipt', cor: 'primary', link: '#/fila/faturamento' }),
        money('Valor a faturar', ff.v, { icone: 'bi-cash', cor: 'secondary' }),
        money(`Faturado ${ctx.rot}`, nf.valor, { icone: 'bi-check-circle', cor: 'success', sub: `${nf.emitidas || 0} notas` }),
        card(`Notas canceladas ${ctx.rot}`, nf.canceladas || 0, { icone: 'bi-x-octagon', cor: 'danger' }),
        card(`Cartas de correção ${ctx.rot}`, cce, { icone: 'bi-pencil', cor: 'warning' }),
      ],
      graficos: [{
        titulo: `Faturamento ${porDia ? 'diário' : 'mensal'} ${ctx.rot}`, tipo: 'bar',
        labels: serie.map((x) => (porDia ? `${x.d.slice(8, 10)}/${x.d.slice(5, 7)}` : `${x.d.slice(5, 7)}/${x.d.slice(0, 4)}`)),
        series: [{ nome: 'R$', dados: serie.map((x) => S.r2(x.v)) }],
      }],
      tabelas: [],
    };
  },

  async expedicao(ctx) {
    const f = filtroPedidos(ctx, 'expedicao');
    const fe = await fila('expedicao', ctx, f);
    const ft = await fila('transito', ctx, f);
    const atrasadas = (await db.get(`SELECT COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa = 'transito' AND data_entrega_prevista < date('now','localtime')`, ...f.params)).n;
    const per = noPeriodo(ctx, 'data_entrega');
    const entregues = await db.get(`SELECT COUNT(*) AS n, AVG(julianday(data_entrega) - julianday(data_embarque)) AS dias FROM pedidos p WHERE ${f.sql} AND etapa = 'entregue' AND ${per.sql}`, ...f.params, ...per.params);
    const porTransp = await db.all(
      `SELECT IFNULL(t.nome, CASE p.tipo_entrega WHEN 'retirada' THEN 'Retirada' WHEN 'veiculo_proprio' THEN 'Veículo próprio' ELSE 'Sem transportadora' END) AS nome, COUNT(*) AS n
         FROM pedidos p LEFT JOIN transportadoras t ON t.id = p.transportadora_id WHERE ${f.sql} AND p.etapa IN ('expedicao','transito') GROUP BY 1 ORDER BY n DESC`, ...f.params,
    );
    return {
      cards: [
        card('Aguardando embarque', fe.n, { icone: 'bi-box-seam', cor: 'primary', link: '#/fila/expedicao' }),
        card('Em trânsito', ft.n, { icone: 'bi-truck', cor: 'info', link: '#/fila/transito' }),
        card('Entregas atrasadas', atrasadas, { icone: 'bi-alarm', cor: 'danger' }),
        card(`Entregues ${ctx.rot}`, entregues.n, { icone: 'bi-check2-circle', cor: 'success', sub: entregues.dias ? `média de ${S.r2(entregues.dias)} dias em trânsito` : '' }),
      ],
      graficos: [{ titulo: 'Pedidos por transportadora (expedição + trânsito)', tipo: 'doughnut', labels: porTransp.map((x) => x.nome), series: [{ nome: 'Pedidos', dados: porTransp.map((x) => x.n) }] }],
      tabelas: [
        tabela('Entregas previstas', ['Pedido', 'Cliente', 'Embarque', 'Previsão'], (await db.all(
          `SELECT p.numero, c.nome, p.data_embarque, p.data_entrega_prevista FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE ${f.sql} AND p.etapa = 'transito' ORDER BY p.data_entrega_prevista LIMIT 10`, ...f.params,
        )).map((x) => [x.numero, x.nome, x.data_embarque, x.data_entrega_prevista]), [null, null, 'date', 'date']),
      ],
    };
  },

  async financeiro(ctx) {
    const f = filtroPedidos(ctx, 'financeiro');
    const inad = await inadimplencia(ctx, 'p.empresa_id = ?', [ctx.emp]);
    const fxp = ctx.fxPedido('p.pedido_id');
    const per = noPeriodo(ctx, 'p.data_pagamento');
    const recebido = (await db.get(`SELECT IFNULL(SUM(valor_pago),0) AS v FROM parcelas p WHERE p.empresa_id = ? AND ${per.sql} AND ${fxp}`, ctx.emp, ...per.params)).v;
    const venceHoje = await db.get(`SELECT COUNT(*) AS n, IFNULL(SUM(valor),0) AS v FROM parcelas p WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND vencimento = date('now','localtime') AND ${fxp}`, ctx.emp);
    const neg = (await db.get(`SELECT COUNT(*) AS n FROM negativacoes WHERE status IN ('inclusao_solicitada','inclusao_aceita','baixa_solicitada')`)).n;
    const fc = await fila('cobranca', ctx, f);
    const aging = await db.all(
      `SELECT CASE WHEN p.vencimento >= date('now','localtime') THEN 'A vencer'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 30 THEN '1-30'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 60 THEN '31-60'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 90 THEN '61-90' ELSE '90+' END AS f,
              SUM(${S.SALDO_PARCELA_SQL}) AS v
         FROM parcelas p WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND ${fxp} GROUP BY f`, ctx.emp,
    );
    const ordem = ['A vencer', '1-30', '31-60', '61-90', '90+'];
    const am = Object.fromEntries(aging.map((x) => [x.f, x.v]));
    return {
      cards: [
        money('Contas a receber', inad.aberto, { icone: 'bi-wallet2', cor: 'primary' }),
        money('Vencido', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do a receber`, link: '#/cobranca' }),
        money(`Recebido ${ctx.rot}`, recebido, { icone: 'bi-cash-coin', cor: 'success' }),
        money('Vence hoje', venceHoje.v, { icone: 'bi-calendar-event', cor: 'warning', sub: `${venceHoje.n} parcelas` }),
        card('À vista aguardando pagamento', fc.n, { icone: 'bi-hourglass', cor: 'info', link: '#/fila/cobranca' }),
        card('Negativações ativas', neg, { icone: 'bi-shield-x', cor: 'secondary', link: '#/financeiro/negativados' }),
      ],
      graficos: [
        { titulo: 'Saldo por faixa de atraso', tipo: 'bar', labels: ordem, series: [{ nome: 'R$', dados: ordem.map((k) => S.r2(am[k] || 0)) }] },
        { titulo: 'Recebimentos (6 meses)', tipo: 'line', ...serieComoGrafico(await serieMensal(ctx,
          `SELECT substr(data_pagamento,1,7) AS mes, SUM(valor_pago) AS v FROM parcelas p WHERE p.empresa_id = ? AND ${fxp} AND data_pagamento >= ? AND data_pagamento < ? GROUP BY mes`, [ctx.emp]), 'Recebido (R$)') },
      ],
      tabelas: [
        tabela('Maiores devedores', ['Cliente', 'Vencido (R$)', 'Maior atraso (dias)'], (await db.all(
          `SELECT c.nome, ROUND(SUM(${S.SALDO_PARCELA_SQL}),2) AS v, MAX(CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER)) AS d
             FROM parcelas p JOIN clientes c ON c.id = p.cliente_id WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') AND ${fxp}
            GROUP BY c.id ORDER BY v DESC LIMIT 10`, ctx.emp,
        )).map((x) => [x.nome, x.v, x.d]), [null, 'moeda', null]),
      ],
    };
  },
};
PAINEIS.rh = async (ctx) => {
  const hoje = S.hoje();
  const ativos = `COALESCE(c.empresa_id, ${Number(ctx.emp)}) = ${Number(ctx.emp)} AND c.ativo = 1 AND c.data_desligamento IS NULL`;
  const t = await db.get(`SELECT (SELECT COUNT(*) FROM colaboradores c WHERE ${ativos}) AS ativos,
      (SELECT COUNT(*) FROM rh_solicitacoes s JOIN colaboradores c ON c.id = s.colaborador_id WHERE s.status = 'aberta' AND ${ativos}) AS solicitacoes,
      (SELECT COUNT(*) FROM rh_ferias f JOIN colaboradores c ON c.id = f.colaborador_id WHERE f.status = 'solicitada' AND ${ativos}) AS ferias_pendentes,
      (SELECT COUNT(*) FROM rh_ferias f JOIN colaboradores c ON c.id = f.colaborador_id WHERE f.status = 'aprovada' AND ? BETWEEN f.inicio AND f.fim AND ${ativos}) AS em_ferias,
      (SELECT COUNT(*) FROM rh_ocorrencias o JOIN colaboradores c ON c.id = o.colaborador_id WHERE o.data >= ? AND o.data < ? AND o.tipo IN ('falta','atestado') AND ${ativos}) AS faltas,
      (SELECT COUNT(*) FROM colaboradores c WHERE COALESCE(c.empresa_id, ${Number(ctx.emp)}) = ${Number(ctx.emp)} AND c.data_admissao >= ? AND c.data_admissao < ?) AS admitidos`,
    hoje, ctx.de, ctx.ateFim, ctx.de, ctx.ateFim);
  const admissoes = await serieMensal(ctx, `SELECT substr(data_admissao,1,7) AS mes, COUNT(*) AS v FROM colaboradores WHERE COALESCE(empresa_id, ?) = ? AND data_admissao >= ? AND data_admissao < ? GROUP BY mes`, [ctx.emp, ctx.emp], 12);
  const deptos = await db.all(`SELECT COALESCE(c.departamento, c.setor, 'Sem departamento') AS nome, COUNT(*) AS n FROM colaboradores c WHERE ${ativos} GROUP BY 1 ORDER BY 2 DESC`);
  return {
    cards: [
      card('Colaboradores ativos', t.ativos, { icone: 'bi-people', cor: 'primary', link: '#/rh/colaboradores', sub: `${t.admitidos} admitidos ${ctx.rot}` }),
      card('Solicitações abertas', t.solicitacoes, { icone: 'bi-inbox', cor: t.solicitacoes ? 'warning' : 'success', link: '#/rh/solicitacoes' }),
      card('Férias para aprovar', t.ferias_pendentes, { icone: 'bi-sun', cor: t.ferias_pendentes ? 'warning' : 'secondary', link: '#/rh/ferias' }),
      card('Em férias hoje', t.em_ferias, { icone: 'bi-umbrella', cor: 'info' }),
      card(`Faltas e atestados ${ctx.rot}`, t.faltas, { icone: 'bi-calendar-x', cor: 'danger', link: '#/rh/ocorrencias' }),
    ],
    graficos: [
      { titulo: 'Admissões (12 meses)', tipo: 'bar', ...serieComoGrafico(admissoes, 'Admissões') },
      { titulo: 'Colaboradores por departamento', tipo: 'doughnut', labels: deptos.map((x) => x.nome), series: [{ nome: 'Pessoas', dados: deptos.map((x) => x.n) }] },
    ],
    tabelas: [],
  };
};
PAINEIS.admin = PAINEIS.diretoria;
PAINEIS.gerente = PAINEIS.diretoria;

function serieComoGrafico(s, nome) {
  return { labels: s.labels, series: [{ nome, dados: s.dados }] };
}
function tabela(titulo, colunas, linhas, tipos = []) {
  return { titulo, colunas, linhas, tipos };
}
async function faixasScore(ctx) {
  const per = noPeriodo(ctx, 'created_at');
  const rows = await db.all(
    `SELECT CASE WHEN score < 400 THEN '< 400' WHEN score < 550 THEN '400-549' WHEN score < 700 THEN '550-699' ELSE '700+' END AS f, COUNT(*) AS n
       FROM consultas_serasa WHERE ${per.sql} GROUP BY f`, ...per.params,
  );
  const ordem = ['< 400', '400-549', '550-699', '700+'];
  const m = Object.fromEntries(rows.map((x) => [x.f, x.n]));
  return { labels: ordem, series: [{ nome: 'Consultas', dados: ordem.map((k) => m[k] || 0) }] };
}

/** Indicadores dos módulos de estoque, contas a pagar, propostas e chamados, conforme o painel. */
async function cardsModulos(perfil, ctx, user) {
  const out = [];
  const geral = ['diretoria', 'admin'].includes(perfil);
  if (geral || ['producao', 'expedicao', 'faturamento'].includes(perfil)) {
    const e = await db.get(
      `SELECT COUNT(*) FILTER (WHERE s < m AND m > 0) AS baixo, COUNT(*) FILTER (WHERE s <= 0) AS zerado FROM (
         SELECT COALESCE(e.estoque_minimo,0) AS m, COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos x WHERE x.embalagem_id = e.id AND x.empresa_id = ?),0) AS s
           FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id WHERE p.ativo = 1) t`, ctx.emp,
    );
    out.push(card('Estoque abaixo do mínimo', e.baixo, { icone: 'bi-box2', cor: e.baixo ? 'warning' : 'success', sub: `${e.zerado} sem saldo`, link: '#/estoque' }));
  }
  if (geral || perfil === 'financeiro') {
    const p = await db.get(
      `SELECT COALESCE(SUM(valor - COALESCE(valor_pago,0)) FILTER (WHERE vencimento < date('now','localtime')), 0) AS vencido,
              COUNT(*) FILTER (WHERE vencimento < date('now','localtime')) AS qv,
              COALESCE(SUM(valor - COALESCE(valor_pago,0)) FILTER (WHERE vencimento = date('now','localtime')), 0) AS hoje,
              COUNT(*) FILTER (WHERE vencimento = date('now','localtime')) AS qh
         FROM contas_pagar WHERE empresa_id = ? AND status = 'a_pagar'`, ctx.emp,
    );
    out.push(money('A pagar vencido', p.vencido, { icone: 'bi-credit-card-2-back', cor: 'danger', sub: `${p.qv} contas`, link: '#/pagar' }));
    out.push(money('A pagar hoje', p.hoje, { icone: 'bi-calendar2-check', cor: 'warning', sub: `${p.qh} contas`, link: '#/pagar' }));
  }
  if (['vendedor', 'supervisor'].includes(perfil) || geral) {
    const f = ['vendedor', 'supervisor'].includes(perfil)
      ? { sql: `p.empresa_id = ? AND ${E.vendas({ id: ctx.uid, perfil }, 'p', { semSupervisor: true })}`, params: [ctx.emp] }
      : { sql: 'p.empresa_id = ?', params: [ctx.emp] };
    const fxProp = [
      ctx.filtros.vendedores.length ? `p.vendedor_id IN (${ctx.filtros.vendedores.join(',')})` : '',
      ctx.filtros.equipes.length ? `EXISTS (SELECT 1 FROM usuarios fv WHERE fv.id = p.vendedor_id AND fv.equipe_id IN (${ctx.filtros.equipes.join(',')}))` : '',
      ctx.filtros.formas.length ? `p.forma_id IN (${ctx.filtros.formas.join(',')})` : '',
    ].filter(Boolean);
    if (fxProp.length) f.sql += ` AND ${fxProp.join(' AND ')}`;
    const pr = await db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(valor_total),0) AS v FROM propostas p WHERE ${f.sql} AND status = 'enviada' AND validade >= date('now','localtime')`, ...f.params,
    );
    out.push(money('Propostas em aberto', pr.v, { icone: 'bi-file-earmark-text', cor: 'info', sub: `${pr.n} aguardando o cliente`, link: '#/propostas' }));
  }
  if (can(user, 'chamados')) {
    const c = await db.get(
      `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE prazo < date('now','localtime')) AS atrasados FROM chamados
        WHERE status NOT IN ('resolvido','fechado') AND (empresa_id IS NULL OR empresa_id = ?) AND (setor_destino = ? OR responsavel_id = ?)`,
      ctx.emp, perfil, ctx.uid,
    );
    out.push(card('Chamados para atender', c.n, { icone: 'bi-headset', cor: c.atrasados ? 'danger' : 'secondary', sub: `${c.atrasados} fora do prazo`, link: '#/chamados' }));
  }
  return out;
}

// ---------- Mapa de vendas por estado e cidade ----------
// Mesmo período e recortes do painel; respeita a abrangência de quem vê (vendedor: as próprias vendas).
r.get('/mapa', async (req, res) => {
  const G = require('../geo');
  const ctx = contexto(req);
  const per = noPeriodo(ctx, 'p.created_at');
  const metrica = req.query.metrica === 'pedidos' ? 'pedidos' : 'valor';
  const rows = await db.all(
    `SELECT COALESCE(en.uf, ep.uf) AS uf, COALESCE(en.cidade, ep.cidade) AS cidade,
            COUNT(*) AS pedidos, COUNT(DISTINCT p.cliente_id) AS clientes, IFNULL(SUM(p.valor_total),0) AS valor
       FROM pedidos p
       LEFT JOIN cliente_enderecos en ON en.id = p.endereco_entrega_id
       LEFT JOIN cliente_enderecos ep ON ep.id = (SELECT x.id FROM cliente_enderecos x WHERE x.cliente_id = p.cliente_id ORDER BY x.principal DESC, x.id LIMIT 1)
      WHERE p.empresa_id = ? AND ${E.vendas(req.user, 'p')} AND ${ctx.fx('p')} AND p.etapa NOT IN ('venda','cancelado') AND ${per.sql}
      GROUP BY 1, 2`, ctx.emp, ...per.params,
  );
  const porUf = {};
  const cidades = new Map();
  let semLocal = { pedidos: 0, valor: 0 };
  for (const x of rows) {
    const uf = String(x.uf || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) { semLocal.pedidos += x.pedidos; semLocal.valor += x.valor; continue; }
    const u = (porUf[uf] ||= { uf, pedidos: 0, clientes: 0, valor: 0 });
    u.pedidos += x.pedidos; u.clientes += x.clientes; u.valor += x.valor;
    const m = G.municipio(x.cidade, uf);
    const chave = m ? `${m.ibge}` : `${G.normalizar(x.cidade)}|${uf}`;
    const c = cidades.get(chave) || { cidade: m?.nome || x.cidade || '(sem cidade)', uf, lat: m?.lat ?? null, lng: m?.lng ?? null, pedidos: 0, clientes: 0, valor: 0 };
    c.pedidos += x.pedidos; c.clientes += x.clientes; c.valor += x.valor;
    cidades.set(chave, c);
  }
  const r2 = (o) => ({ ...o, valor: S.r2(o.valor) });
  const lista = [...cidades.values()].map(r2).sort((a, b) => b[metrica] - a[metrica]);
  res.json({
    filtro: { de: ctx.de, ate: ctx.ate }, metrica,
    total: r2(Object.values(porUf).reduce((a, u) => ({ pedidos: a.pedidos + u.pedidos, clientes: a.clientes + u.clientes, valor: a.valor + u.valor }), { pedidos: 0, clientes: 0, valor: 0 })),
    estados: Object.values(porUf).map(r2).sort((a, b) => b[metrica] - a[metrica]),
    cidades: lista.slice(0, 400),
    sem_localizacao: r2(semLocal),
  });
});

// Painéis sem relação com pedidos só usam o período.
const SO_PERIODO = ['rh'];

r.get('/', async (req, res) => {
  const proprio = req.user.perfil;
  // Cada usuário vê o painel do próprio setor (vendedor: as próprias vendas; supervisor: a equipe).
  // Só quem tem a permissão "dashboard.todos" pode abrir o painel de outro setor.
  const todos = can(req.user, 'dashboard.todos');
  const pedido = req.query.perfil && todos && PAINEIS[req.query.perfil] ? req.query.perfil : proprio;
  const painel = PAINEIS[pedido] || PAINEIS.diretoria;
  const ctx = contexto(req);
  const dados = await painel(ctx);
  dados.cards.push(...await cardsModulos(pedido, ctx, req.user));
  res.json({
    perfil: pedido, titulo: `Painel ${PERFIS[pedido] || ''}`.trim(),
    perfis_disponiveis: todos ? Object.keys(PAINEIS).filter((p) => p !== 'admin') : [proprio],
    filtro: { de: ctx.de, ate: ctx.ate, ...ctx.filtros, recortes: !SO_PERIODO.includes(pedido) },
    ...dados,
  });
});

module.exports = r;
