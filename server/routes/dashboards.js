// Painel com os indicadores de cada perfil de usuário.
const express = require('express');
const db = require('../db');
const S = require('../services');
const W = require('../workflow');
const { PERFIS } = require('../auth');

const r = express.Router();

const mesAtual = () => S.hoje().slice(0, 7);
const inicioMes = () => mesAtual() + '-01';
const card = (label, valor, extra = {}) => ({ label, valor, tipo: 'numero', ...extra });
const money = (label, valor, extra = {}) => card(label, S.r2(valor), { tipo: 'moeda', ...extra });

function ultimosMeses(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function serieMensal(sql, params, n = 6) {
  const meses = ultimosMeses(n);
  const rows = db.all(sql, ...params, meses[0] + '-01');
  const mapa = Object.fromEntries(rows.map((x) => [x.mes, x.v]));
  return { labels: meses.map((m) => m.split('-').reverse().join('/')), dados: meses.map((m) => S.r2(mapa[m] || 0)) };
}

/** Condição de pedidos conforme o perfil (vendedor = próprios, supervisor = equipe). */
function filtroPedidos(perfil, uid, empresaId) {
  if (perfil === 'vendedor') return { sql: 'p.empresa_id = ? AND p.vendedor_id = ?', params: [empresaId, uid] };
  if (perfil === 'supervisor') return { sql: 'p.empresa_id = ? AND (p.supervisor_id = ? OR p.vendedor_id = ?)', params: [empresaId, uid, uid] };
  return { sql: 'p.empresa_id = ?', params: [empresaId] };
}

function porEtapa(f) {
  const rows = db.all(`SELECT etapa, COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('entregue','cancelado') GROUP BY etapa`, ...f.params);
  const ordem = Object.keys(W.ETAPAS).filter((e) => !['entregue', 'cancelado'].includes(e));
  const mapa = Object.fromEntries(rows.map((x) => [x.etapa, x.n]));
  return { titulo: 'Pedidos em andamento por etapa', tipo: 'bar', labels: ordem.map((e) => W.ETAPAS[e].label), series: [{ nome: 'Pedidos', dados: ordem.map((e) => mapa[e] || 0) }] };
}

function vendasMes(f) {
  return db.get(
    `SELECT COUNT(*) AS n, IFNULL(SUM(valor_total),0) AS v FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('venda','cancelado') AND created_at >= ?`,
    ...f.params, inicioMes(),
  );
}

function fila(etapa, empresaId, f) {
  const filtro = f || { sql: 'p.empresa_id = ?', params: [empresaId] };
  return db.get(
    `SELECT COUNT(*) AS n, IFNULL(SUM(valor_total),0) AS v, IFNULL(MAX(julianday('now','localtime') - julianday(etapa_desde)),0) AS mais_antigo
       FROM pedidos p WHERE ${filtro.sql} AND etapa = ?`, ...filtro.params, etapa,
  );
}

function inadimplencia(where, params) {
  const x = db.get(
    `SELECT IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} THEN ${S.SALDO_PARCELA_SQL} END),0) AS aberto,
            IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} END),0) AS vencido
       FROM parcelas p LEFT JOIN pedidos pe ON pe.id = p.pedido_id WHERE ${where}`, ...params,
  );
  return { ...x, pct: x.aberto ? S.r2((x.vencido / x.aberto) * 100) : 0 };
}

const PAINEIS = {
  vendedor(ctx) {
    const f = filtroPedidos('vendedor', ctx.uid, ctx.emp);
    const vm = vendasMes(f);
    const devolvidos = db.get(
      `SELECT COUNT(*) AS n FROM pedidos p WHERE ${f.sql} AND etapa = 'venda'
         AND EXISTS (SELECT 1 FROM pedido_historico h WHERE h.pedido_id = p.id AND h.etapa_destino = 'venda' AND h.etapa_origem IS NOT NULL)`, ...f.params,
    ).n;
    const com = db.get(`SELECT IFNULL(SUM(valor),0) AS v FROM comissoes WHERE usuario_id = ? AND periodo = ?`, ctx.uid, mesAtual()).v;
    const inad = inadimplencia('p.empresa_id = ? AND pe.vendedor_id = ?', [ctx.emp, ctx.uid]);
    return {
      cards: [
        money('Vendas no mês', vm.v, { icone: 'bi-graph-up-arrow', cor: 'success', sub: `${vm.n} pedidos` }),
        card('Em digitação', fila('venda', ctx.emp, f).n, { icone: 'bi-pencil-square', cor: 'primary', link: '#/fila/venda' }),
        card('Devolvidos para correção', devolvidos, { icone: 'bi-arrow-counterclockwise', cor: 'warning', link: '#/fila/venda' }),
        money('Comissão prevista no mês', com, { icone: 'bi-piggy-bank', cor: 'info' }),
        money('Carteira vencida', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do em aberto` }),
      ],
      graficos: [
        { titulo: 'Minhas vendas (6 meses)', tipo: 'line', ...serieComoGrafico(serieMensal(
          `SELECT substr(created_at,1,7) AS mes, SUM(valor_total) AS v FROM pedidos p WHERE ${f.sql} AND etapa NOT IN ('venda','cancelado') AND created_at >= ? GROUP BY mes`, f.params), 'Vendas (R$)') },
        porEtapa(f),
      ],
      tabelas: [
        tabela('Maiores clientes no ano', ['Cliente', 'Pedidos', 'Total (R$)'], db.all(
          `SELECT c.nome, COUNT(*) AS n, ROUND(SUM(p.valor_total),2) AS v FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE ${f.sql} AND etapa <> 'cancelado' AND p.created_at >= ? GROUP BY c.id ORDER BY v DESC LIMIT 8`, ...f.params, S.hoje().slice(0, 4) + '-01-01',
        ).map((x) => [x.nome, x.n, x.v]), [null, null, 'moeda']),
        tabela('Minhas tarefas de CRM', ['Tarefa', 'Cliente', 'Vencimento'], db.all(
          `SELECT t.titulo, c.nome, t.vencimento FROM crm_tarefas t LEFT JOIN clientes c ON c.id = t.cliente_id WHERE t.responsavel_id = ? AND t.concluida = 0 ORDER BY t.vencimento LIMIT 8`, ctx.uid,
        ).map((x) => [x.titulo, x.nome, x.vencimento]), [null, null, 'date']),
      ],
    };
  },

  supervisor(ctx) {
    const f = filtroPedidos('supervisor', ctx.uid, ctx.emp);
    const vm = vendasMes(f);
    const fs = fila('supervisao', ctx.emp, f);
    const inad = inadimplencia('p.empresa_id = ? AND pe.supervisor_id = ?', [ctx.emp, ctx.uid]);
    const ranking = db.all(
      `SELECT v.nome, IFNULL(SUM(p.valor_total),0) AS v FROM usuarios v
         JOIN equipes e ON e.id = v.equipe_id AND e.supervisor_id = ?
         LEFT JOIN pedidos p ON p.vendedor_id = v.id AND p.empresa_id = ? AND p.etapa NOT IN ('venda','cancelado') AND p.created_at >= ?
        WHERE v.perfil = 'vendedor' GROUP BY v.id ORDER BY v DESC`, ctx.uid, ctx.emp, inicioMes(),
    );
    return {
      cards: [
        money('Vendas da equipe no mês', vm.v, { icone: 'bi-people', cor: 'success', sub: `${vm.n} pedidos` }),
        card('Aguardando minha supervisão', fs.n, { icone: 'bi-person-check', cor: 'primary', link: '#/fila/supervisao', sub: fs.n ? `mais antigo há ${Math.floor(fs.mais_antigo)} dias` : '' }),
        money('Valor na fila de supervisão', fs.v, { icone: 'bi-hourglass-split', cor: 'secondary' }),
        money('Inadimplência da equipe', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do em aberto` }),
      ],
      graficos: [
        { titulo: 'Vendas por vendedor no mês', tipo: 'bar', labels: ranking.map((x) => x.nome), series: [{ nome: 'R$', dados: ranking.map((x) => S.r2(x.v)) }] },
        porEtapa(f),
      ],
      tabelas: [],
    };
  },

  analista(ctx) {
    const fa = fila('analise', ctx.emp);
    const dec = db.get(
      `SELECT SUM(CASE WHEN etapa_origem = 'analise' AND etapa_destino NOT IN ('cancelado','venda','analise') THEN 1 ELSE 0 END) AS aprovados,
              SUM(CASE WHEN etapa_origem = 'analise' AND etapa_destino = 'cancelado' THEN 1 ELSE 0 END) AS reprovados,
              SUM(CASE WHEN etapa_origem = 'analise' AND etapa_destino = 'venda' THEN 1 ELSE 0 END) AS devolvidos
         FROM pedido_historico WHERE created_at >= ?`, inicioMes(),
    );
    const tempo = db.get(
      `SELECT AVG(julianday(s.created_at) - julianday(e.created_at)) * 24 AS horas FROM pedido_historico s
         JOIN pedido_historico e ON e.pedido_id = s.pedido_id AND e.etapa_destino = 'analise' AND e.id < s.id
        WHERE s.etapa_origem = 'analise' AND s.created_at >= ?`, inicioMes(),
    ).horas;
    const alertas = db.get(
      `SELECT COUNT(*) AS n FROM pedidos p WHERE p.empresa_id = ? AND p.etapa = 'analise' AND EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = p.cliente_id AND b.ativo = 1)`, ctx.emp,
    ).n;
    return {
      cards: [
        card('Na fila de análise', fa.n, { icone: 'bi-search', cor: 'primary', link: '#/fila/analise' }),
        money('Valor em análise', fa.v, { icone: 'bi-cash-stack', cor: 'secondary' }),
        card('Com alerta/blacklist', alertas, { icone: 'bi-shield-exclamation', cor: 'danger' }),
        card('Aprovados no mês', dec.aprovados || 0, { icone: 'bi-check-circle', cor: 'success', sub: `${dec.reprovados || 0} reprovados · ${dec.devolvidos || 0} devolvidos` }),
        card('Tempo médio de análise', tempo ? `${S.r2(tempo)} h` : '-', { tipo: 'texto', icone: 'bi-stopwatch', cor: 'info' }),
      ],
      graficos: [
        { titulo: 'Decisões da análise no mês', tipo: 'doughnut', labels: ['Aprovados', 'Reprovados', 'Devolvidos'], series: [{ nome: 'Pedidos', dados: [dec.aprovados || 0, dec.reprovados || 0, dec.devolvidos || 0] }] },
        { titulo: 'Score Serasa das consultas (30 dias)', tipo: 'bar', ...faixasScore() },
      ],
      tabelas: [],
    };
  },

  diretoria(ctx) {
    const f = filtroPedidos('diretoria', ctx.uid, ctx.emp);
    const vm = vendasMes(f);
    const fat = db.get(`SELECT COUNT(*) AS n, IFNULL(SUM(valor),0) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND data_emissao >= ?`, ctx.emp, inicioMes());
    const inad = inadimplencia('p.empresa_id = ?', [ctx.emp]);
    const fd = fila('diretoria', ctx.emp);
    const equipes = db.all(
      `SELECT IFNULL(e.nome,'Sem equipe') AS nome, IFNULL(SUM(p.valor_total),0) AS v FROM pedidos p JOIN usuarios v ON v.id = p.vendedor_id
         LEFT JOIN equipes e ON e.id = v.equipe_id WHERE p.empresa_id = ? AND p.etapa NOT IN ('venda','cancelado') AND p.created_at >= ? GROUP BY e.id ORDER BY v DESC`,
      ctx.emp, inicioMes(),
    );
    return {
      cards: [
        money('Faturamento no mês', fat.v, { icone: 'bi-receipt', cor: 'success', sub: `${fat.n} notas` }),
        money('Vendas no mês', vm.v, { icone: 'bi-graph-up-arrow', cor: 'primary', sub: `${vm.n} pedidos · ticket ${vm.n ? (vm.v / vm.n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}` }),
        card('Aguardando aprovação final', fd.n, { icone: 'bi-award', cor: 'warning', link: '#/fila/diretoria' }),
        money('Contas a receber', inad.aberto, { icone: 'bi-wallet2', cor: 'info' }),
        money('Inadimplência', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do a receber` }),
      ],
      graficos: [
        { titulo: 'Faturamento (12 meses)', tipo: 'line', ...serieComoGrafico(serieMensal(
          `SELECT substr(data_emissao,1,7) AS mes, SUM(valor) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND data_emissao >= ? GROUP BY mes`, [ctx.emp], 12), 'Faturamento (R$)') },
        porEtapa(f),
        { titulo: 'Vendas por equipe no mês', tipo: 'doughnut', labels: equipes.map((x) => x.nome), series: [{ nome: 'R$', dados: equipes.map((x) => S.r2(x.v)) }] },
      ],
      tabelas: [
        tabela('Produtos mais vendidos no mês', ['Produto', 'Quantidade', 'Valor (R$)'], db.all(
          `SELECT pr.nome, SUM(i.quantidade) AS q, i.unidade, ROUND(SUM(i.valor_total),2) AS v FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
             JOIN produtos pr ON pr.id = i.produto_id WHERE p.empresa_id = ? AND p.etapa NOT IN ('venda','cancelado') AND p.created_at >= ?
            GROUP BY pr.id ORDER BY v DESC LIMIT 10`, ctx.emp, inicioMes(),
        ).map((x) => [x.nome, `${x.q.toLocaleString('pt-BR')} ${x.unidade || ''}`, x.v]), [null, null, 'moeda']),
      ],
    };
  },

  producao(ctx) {
    const fp = fila('producao', ctx.emp);
    const atrasados = db.get(`SELECT COUNT(*) AS n FROM pedidos WHERE empresa_id = ? AND etapa = 'producao' AND prazo_producao < date('now','localtime')`, ctx.emp).n;
    const concluidos = db.get(`SELECT COUNT(*) AS n FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id WHERE p.empresa_id = ? AND h.etapa_origem = 'producao' AND h.etapa_destino = 'faturamento' AND h.created_at >= ?`, ctx.emp, inicioMes()).n;
    const semLote = db.get(`SELECT COUNT(*) AS n FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE p.empresa_id = ? AND p.etapa = 'producao' AND (i.lote IS NULL OR i.lote = '')`, ctx.emp).n;
    const aProduzir = db.all(
      `SELECT pr.nome, SUM(i.quantidade * IFNULL(e.quantidade,1)) AS q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id
         LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE p.empresa_id = ? AND p.etapa = 'producao' GROUP BY pr.id ORDER BY q DESC LIMIT 10`, ctx.emp,
    );
    return {
      cards: [
        card('Pedidos em produção', fp.n, { icone: 'bi-gear', cor: 'primary', link: '#/fila/producao' }),
        card('Com prazo vencido', atrasados, { icone: 'bi-alarm', cor: 'danger' }),
        card('Itens sem lote', semLote, { icone: 'bi-upc-scan', cor: 'warning' }),
        card('Concluídos no mês', concluidos, { icone: 'bi-check2-all', cor: 'success' }),
      ],
      graficos: [{ titulo: 'Volume a produzir por produto (kg/L)', tipo: 'bar', labels: aProduzir.map((x) => x.nome), series: [{ nome: 'Quantidade', dados: aProduzir.map((x) => S.r2(x.q)) }] }],
      tabelas: [
        tabela('Próximos prazos', ['Pedido', 'Cliente', 'Chegou em', 'Prazo'], db.all(
          `SELECT p.numero, c.nome, p.data_chegada_producao, p.prazo_producao FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE p.empresa_id = ? AND p.etapa = 'producao' ORDER BY p.prazo_producao LIMIT 10`, ctx.emp,
        ).map((x) => [x.numero, x.nome, x.data_chegada_producao, x.prazo_producao]), [null, null, 'datetime', 'date']),
      ],
    };
  },

  faturamento(ctx) {
    const ff = fila('faturamento', ctx.emp);
    const nf = db.get(
      `SELECT SUM(CASE WHEN status <> 'cancelada' THEN 1 ELSE 0 END) AS emitidas, IFNULL(SUM(CASE WHEN status <> 'cancelada' THEN valor END),0) AS valor,
              SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) AS canceladas
         FROM notas_fiscais WHERE empresa_id = ? AND data_emissao >= ?`, ctx.emp, inicioMes(),
    );
    const cce = db.get(`SELECT COUNT(*) AS n FROM cartas_correcao cc JOIN notas_fiscais n ON n.id = cc.nota_id WHERE n.empresa_id = ? AND cc.created_at >= ?`, ctx.emp, inicioMes()).n;
    const diario = db.all(
      `SELECT substr(data_emissao,1,10) AS d, SUM(valor) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND data_emissao >= ? GROUP BY d ORDER BY d`, ctx.emp, inicioMes(),
    );
    return {
      cards: [
        card('Aguardando faturamento', ff.n, { icone: 'bi-receipt', cor: 'primary', link: '#/fila/faturamento' }),
        money('Valor a faturar', ff.v, { icone: 'bi-cash', cor: 'secondary' }),
        money('Faturado no mês', nf.valor, { icone: 'bi-check-circle', cor: 'success', sub: `${nf.emitidas || 0} notas` }),
        card('Notas canceladas no mês', nf.canceladas || 0, { icone: 'bi-x-octagon', cor: 'danger' }),
        card('Cartas de correção no mês', cce, { icone: 'bi-pencil', cor: 'warning' }),
      ],
      graficos: [{ titulo: 'Faturamento diário no mês', tipo: 'bar', labels: diario.map((x) => x.d.slice(8, 10) + '/' + x.d.slice(5, 7)), series: [{ nome: 'R$', dados: diario.map((x) => S.r2(x.v)) }] }],
      tabelas: [],
    };
  },

  expedicao(ctx) {
    const fe = fila('expedicao', ctx.emp);
    const ft = fila('transito', ctx.emp);
    const atrasadas = db.get(`SELECT COUNT(*) AS n FROM pedidos WHERE empresa_id = ? AND etapa = 'transito' AND data_entrega_prevista < date('now','localtime')`, ctx.emp).n;
    const entregues = db.get(`SELECT COUNT(*) AS n, AVG(julianday(data_entrega) - julianday(data_embarque)) AS dias FROM pedidos WHERE empresa_id = ? AND etapa = 'entregue' AND data_entrega >= ?`, ctx.emp, inicioMes());
    const porTransp = db.all(
      `SELECT IFNULL(t.nome, CASE p.tipo_entrega WHEN 'retirada' THEN 'Retirada' WHEN 'veiculo_proprio' THEN 'Veículo próprio' ELSE 'Sem transportadora' END) AS nome, COUNT(*) AS n
         FROM pedidos p LEFT JOIN transportadoras t ON t.id = p.transportadora_id WHERE p.empresa_id = ? AND p.etapa IN ('expedicao','transito') GROUP BY nome ORDER BY n DESC`, ctx.emp,
    );
    return {
      cards: [
        card('Aguardando embarque', fe.n, { icone: 'bi-box-seam', cor: 'primary', link: '#/fila/expedicao' }),
        card('Em trânsito', ft.n, { icone: 'bi-truck', cor: 'info', link: '#/fila/transito' }),
        card('Entregas atrasadas', atrasadas, { icone: 'bi-alarm', cor: 'danger' }),
        card('Entregues no mês', entregues.n, { icone: 'bi-check2-circle', cor: 'success', sub: entregues.dias ? `média de ${S.r2(entregues.dias)} dias em trânsito` : '' }),
      ],
      graficos: [{ titulo: 'Pedidos por transportadora (expedição + trânsito)', tipo: 'doughnut', labels: porTransp.map((x) => x.nome), series: [{ nome: 'Pedidos', dados: porTransp.map((x) => x.n) }] }],
      tabelas: [
        tabela('Entregas previstas', ['Pedido', 'Cliente', 'Embarque', 'Previsão'], db.all(
          `SELECT p.numero, c.nome, p.data_embarque, p.data_entrega_prevista FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
            WHERE p.empresa_id = ? AND p.etapa = 'transito' ORDER BY p.data_entrega_prevista LIMIT 10`, ctx.emp,
        ).map((x) => [x.numero, x.nome, x.data_embarque, x.data_entrega_prevista]), [null, null, 'date', 'date']),
      ],
    };
  },

  financeiro(ctx) {
    const inad = inadimplencia('p.empresa_id = ?', [ctx.emp]);
    const recebido = db.get(`SELECT IFNULL(SUM(valor_pago),0) AS v FROM parcelas WHERE empresa_id = ? AND data_pagamento >= ?`, ctx.emp, inicioMes()).v;
    const venceHoje = db.get(`SELECT COUNT(*) AS n, IFNULL(SUM(valor),0) AS v FROM parcelas p WHERE empresa_id = ? AND ${S.ABERTA_SQL} AND vencimento = date('now','localtime')`, ctx.emp);
    const neg = db.get(`SELECT COUNT(*) AS n FROM negativacoes WHERE status IN ('inclusao_solicitada','inclusao_aceita','baixa_solicitada')`).n;
    const fc = fila('cobranca', ctx.emp);
    const aging = db.all(
      `SELECT CASE WHEN p.vencimento >= date('now','localtime') THEN 'A vencer'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 30 THEN '1-30'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 60 THEN '31-60'
                   WHEN julianday('now','localtime') - julianday(p.vencimento) <= 90 THEN '61-90' ELSE '90+' END AS f,
              SUM(${S.SALDO_PARCELA_SQL}) AS v
         FROM parcelas p WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} GROUP BY f`, ctx.emp,
    );
    const ordem = ['A vencer', '1-30', '31-60', '61-90', '90+'];
    const am = Object.fromEntries(aging.map((x) => [x.f, x.v]));
    return {
      cards: [
        money('Contas a receber', inad.aberto, { icone: 'bi-wallet2', cor: 'primary' }),
        money('Vencido', inad.vencido, { icone: 'bi-exclamation-triangle', cor: 'danger', sub: `${inad.pct}% do a receber`, link: '#/cobranca' }),
        money('Recebido no mês', recebido, { icone: 'bi-cash-coin', cor: 'success' }),
        money('Vence hoje', venceHoje.v, { icone: 'bi-calendar-event', cor: 'warning', sub: `${venceHoje.n} parcelas` }),
        card('À vista aguardando pagamento', fc.n, { icone: 'bi-hourglass', cor: 'info', link: '#/fila/cobranca' }),
        card('Negativações ativas', neg, { icone: 'bi-shield-x', cor: 'secondary', link: '#/financeiro/negativados' }),
      ],
      graficos: [
        { titulo: 'Saldo por faixa de atraso', tipo: 'bar', labels: ordem, series: [{ nome: 'R$', dados: ordem.map((k) => S.r2(am[k] || 0)) }] },
        { titulo: 'Recebimentos (6 meses)', tipo: 'line', ...serieComoGrafico(serieMensal(
          `SELECT substr(data_pagamento,1,7) AS mes, SUM(valor_pago) AS v FROM parcelas WHERE empresa_id = ? AND data_pagamento >= ? GROUP BY mes`, [ctx.emp]), 'Recebido (R$)') },
      ],
      tabelas: [
        tabela('Maiores devedores', ['Cliente', 'Vencido (R$)', 'Maior atraso (dias)'], db.all(
          `SELECT c.nome, ROUND(SUM(${S.SALDO_PARCELA_SQL}),2) AS v, MAX(CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER)) AS d
             FROM parcelas p JOIN clientes c ON c.id = p.cliente_id WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime')
            GROUP BY c.id ORDER BY v DESC LIMIT 10`, ctx.emp,
        ).map((x) => [x.nome, x.v, x.d]), [null, 'moeda', null]),
      ],
    };
  },
};
PAINEIS.admin = PAINEIS.diretoria;

function serieComoGrafico(s, nome) {
  return { labels: s.labels, series: [{ nome, dados: s.dados }] };
}
function tabela(titulo, colunas, linhas, tipos = []) {
  return { titulo, colunas, linhas, tipos };
}
function faixasScore() {
  const rows = db.all(
    `SELECT CASE WHEN score < 400 THEN '< 400' WHEN score < 550 THEN '400-549' WHEN score < 700 THEN '550-699' ELSE '700+' END AS f, COUNT(*) AS n
       FROM consultas_serasa WHERE created_at >= datetime('now','localtime','-30 days') GROUP BY f`,
  );
  const ordem = ['< 400', '400-549', '550-699', '700+'];
  const m = Object.fromEntries(rows.map((x) => [x.f, x.n]));
  return { labels: ordem, series: [{ nome: 'Consultas', dados: ordem.map((k) => m[k] || 0) }] };
}

r.get('/', (req, res) => {
  const proprio = req.user.perfil;
  // Diretoria/administração podem ver o painel de qualquer perfil.
  const pedido = req.query.perfil && ['admin', 'diretoria'].includes(proprio) ? req.query.perfil : proprio;
  const painel = PAINEIS[pedido] || PAINEIS.diretoria;
  const dados = painel({ uid: req.user.id, emp: req.empresaId });
  res.json({ perfil: pedido, titulo: `Painel ${PERFIS[pedido] || ''}`.trim(), perfis_disponiveis: ['admin', 'diretoria'].includes(proprio) ? Object.keys(PAINEIS).filter((p) => p !== 'admin') : [proprio], ...dados });
});

module.exports = r;
