// Produtividade: o que cada setor e cada colaborador fez no período (pedidos movimentados por etapa,
// cobranças, acordos, vendas, notas emitidas, CRM, chamados e horas no ponto).
// Quem não tem a permissão "produtividade" vê só o próprio resultado.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const W = require('../workflow');
const P = require('../ponto');

const r = express.Router();
const { r2 } = S;

const ORDEM = ['venda', 'supervisao', 'analise', 'diretoria', 'cobranca', 'producao', 'faturamento', 'expedicao', 'transito', 'entregue'];
// O que "avançar" significa em cada etapa.
const AVANCO = {
  venda: 'Enviados', supervisao: 'Aprovados', analise: 'Aprovados', diretoria: 'Aprovados', cobranca: 'Pagamentos confirmados',
  producao: 'Produções concluídas', faturamento: 'Notas emitidas', expedicao: 'Embarques', transito: 'Entregas', entregue: 'Enviados à devolução', devolucao: 'Tratados',
};

function resultado(origem, destino) {
  if (destino === 'cancelado') return ['analise', 'diretoria'].includes(origem) ? 'reprovado' : 'cancelado';
  const a = ORDEM.indexOf(origem);
  const b = ORDEM.indexOf(destino);
  return a >= 0 && b >= 0 && b < a ? 'devolvido' : 'avancado';
}

function periodo(q) {
  const hoje = S.hoje();
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const de = ok(q.de) ? q.de : `${hoje.slice(0, 7)}-01`;
  const ate = ok(q.ate) ? q.ate : hoje;
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

r.get('/', async (req, res) => {
  const todos = A.can(req.user, 'produtividade');
  const filtroUsuario = todos ? (Number(req.query.usuario_id) || null) : req.user.id;
  const { de, ate } = periodo(req.query);
  const ini = `${de} 00:00:00`;
  const fim = `${ate} 23:59:59`;
  const emp = req.empresaId;
  const u = (col) => (filtroUsuario ? ` AND ${col} = ${Number(filtroUsuario)}` : '');

  // Pedidos que cada pessoa tirou de cada etapa, com o tempo que o pedido ficou parado ali.
  const movs = await db.all(`SELECT h.usuario_id, h.etapa_origem AS etapa, h.etapa_destino AS destino, COUNT(*) AS n, COUNT(DISTINCT h.pedido_id) AS pedidos,
      COALESCE(SUM(p.valor_total), 0) AS valor,
      AVG(EXTRACT(EPOCH FROM (CAST(h.created_at AS timestamp) - CAST(e.created_at AS timestamp))) / 3600.0) AS horas, COUNT(e.created_at) AS n_tempo
    FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id
    LEFT JOIN LATERAL (SELECT h2.created_at FROM pedido_historico h2 WHERE h2.pedido_id = h.pedido_id AND h2.etapa_destino = h.etapa_origem AND h2.id < h.id
      ORDER BY h2.id DESC LIMIT 1) e ON TRUE
    WHERE p.empresa_id = ? AND h.created_at BETWEEN ? AND ? AND h.etapa_origem IS NOT NULL AND h.etapa_destino IS NOT NULL
      AND h.etapa_origem <> h.etapa_destino AND h.usuario_id IS NOT NULL${u('h.usuario_id')}
    GROUP BY h.usuario_id, h.etapa_origem, h.etapa_destino`, emp, ini, fim);

  const vendas = await db.all(`SELECT p.vendedor_id AS usuario_id, COUNT(*) AS n, COALESCE(SUM(p.valor_total), 0) AS valor FROM pedidos p
    WHERE p.empresa_id = ? AND p.created_at BETWEEN ? AND ? AND p.etapa <> 'cancelado'${u('p.vendedor_id')} GROUP BY p.vendedor_id`, emp, ini, fim);
  const notas = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS valor FROM notas_fiscais WHERE empresa_id = ? AND status = 'autorizada'
    AND data_emissao BETWEEN ? AND ?`, emp, ini, fim);
  // Ações de cobrança e acordos (clientes são da base comum das empresas, como na tela de Cobrança).
  const cob = await db.all(`SELECT usuario_id, tipo, COALESCE(resultado, '') AS resultado, COUNT(*) AS n, COUNT(DISTINCT cliente_id) AS clientes,
      COALESCE(SUM(CASE WHEN resultado = 'promessa' THEN valor_promessa ELSE 0 END), 0) AS promessas
    FROM cobranca_acoes WHERE created_at BETWEEN ? AND ? AND usuario_id IS NOT NULL${u('usuario_id')} GROUP BY usuario_id, tipo, COALESCE(resultado, '')`, ini, fim);
  // Conversão: pagamentos de parcelas que já estavam vencidas, feitos até 30 dias depois de uma ação de cobrança do período.
  // O pagamento conta para o último analista que cobrou o cliente antes dele (último toque).
  const recuperado = await db.all(`SELECT t.usuario_id, COUNT(DISTINCT t.cliente_id) AS clientes, COUNT(*) AS parcelas, COALESCE(SUM(t.valor), 0) AS valor FROM (
      SELECT p.cliente_id, p.valor_pago AS valor,
        (SELECT a.usuario_id FROM cobranca_acoes a WHERE a.cliente_id = p.cliente_id AND a.usuario_id IS NOT NULL AND a.created_at BETWEEN ? AND ?
          AND substr(a.created_at, 1, 10) <= p.data_pagamento AND substr(a.created_at, 1, 10) >= to_char(CAST(p.data_pagamento AS date) - 30, 'YYYY-MM-DD')
          AND p.vencimento < substr(a.created_at, 1, 10)
          ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS usuario_id
      FROM parcelas p WHERE p.empresa_id = ? AND COALESCE(p.valor_pago, 0) > 0 AND p.data_pagamento >= ?
        AND p.data_pagamento <= to_char(CAST(? AS date) + 30, 'YYYY-MM-DD')
    ) t WHERE t.usuario_id IS NOT NULL${u('t.usuario_id')} GROUP BY t.usuario_id`, ini, fim, emp, de, ate);
  // Promessas: cumprida = o cliente pagou algo entre a ação e 3 dias depois da data prometida.
  const hoje = S.hoje();
  const promessas = await db.all(`SELECT x.usuario_id, COUNT(*) AS n, SUM(x.cumprida) AS cumpridas,
      SUM(CASE WHEN x.cumprida = 0 AND x.limite < ? THEN 1 ELSE 0 END) AS quebradas,
      SUM(CASE WHEN x.cumprida = 0 AND x.limite >= ? THEN 1 ELSE 0 END) AS a_vencer FROM (
      SELECT a.usuario_id, to_char(CAST(a.data_promessa AS date) + 3, 'YYYY-MM-DD') AS limite,
        CASE WHEN EXISTS (SELECT 1 FROM parcelas p WHERE p.cliente_id = a.cliente_id AND p.empresa_id = ? AND COALESCE(p.valor_pago, 0) > 0
          AND p.data_pagamento >= substr(a.created_at, 1, 10) AND p.data_pagamento <= to_char(CAST(a.data_promessa AS date) + 3, 'YYYY-MM-DD')) THEN 1 ELSE 0 END AS cumprida
      FROM cobranca_acoes a WHERE a.resultado = 'promessa' AND a.data_promessa IS NOT NULL AND a.usuario_id IS NOT NULL AND a.created_at BETWEEN ? AND ?${u('a.usuario_id')}
    ) x GROUP BY x.usuario_id`, hoje, hoje, emp, ini, fim);
  const acordos = await db.all(`SELECT usuario_id, COUNT(*) AS n, COALESCE(SUM(valor_acordo), 0) AS valor FROM acordos
    WHERE created_at BETWEEN ? AND ? AND usuario_id IS NOT NULL${u('usuario_id')} GROUP BY usuario_id`, ini, fim);
  // Interações de CRM sem contar as que a própria cobrança registra.
  const crm = await db.all(`SELECT usuario_id, COUNT(*) AS n FROM crm_interacoes WHERE data BETWEEN ? AND ? AND usuario_id IS NOT NULL
    AND assunto NOT LIKE 'Cobrança:%'${u('usuario_id')} GROUP BY usuario_id`, ini, fim);
  const tarefas = await db.all(`SELECT responsavel_id AS usuario_id, COUNT(*) AS n FROM crm_tarefas WHERE concluida = 1 AND concluida_em BETWEEN ? AND ?
    AND responsavel_id IS NOT NULL${u('responsavel_id')} GROUP BY responsavel_id`, ini, fim);
  const chamados = await db.all(`SELECT responsavel_id AS usuario_id, COUNT(*) AS n FROM chamados WHERE COALESCE(empresa_id, ?) = ? AND resolvido_em BETWEEN ? AND ?
    AND responsavel_id IS NOT NULL${u('responsavel_id')} GROUP BY responsavel_id`, emp, emp, ini, fim);
  const serieMov = await db.all(`SELECT substr(h.created_at, 1, 10) AS dia, COUNT(*) AS n FROM pedido_historico h JOIN pedidos p ON p.id = h.pedido_id
    WHERE p.empresa_id = ? AND h.created_at BETWEEN ? AND ? AND h.etapa_origem IS NOT NULL AND h.etapa_destino IS NOT NULL AND h.etapa_origem <> h.etapa_destino
      AND h.usuario_id IS NOT NULL${u('h.usuario_id')} GROUP BY substr(h.created_at, 1, 10)`, emp, ini, fim);
  const serieCob = await db.all(`SELECT substr(created_at, 1, 10) AS dia, COUNT(*) AS n FROM cobranca_acoes WHERE created_at BETWEEN ? AND ?
    AND usuario_id IS NOT NULL${u('usuario_id')} GROUP BY substr(created_at, 1, 10)`, ini, fim);

  // ---------- Por pessoa ----------
  const pessoas = {};
  const pessoa = (id) => (pessoas[id] ||= {
    usuario_id: Number(id), vendas_qtd: 0, vendas_valor: 0, movimentos: 0, avancados: 0, devolvidos: 0, reprovados: 0, cancelados: 0,
    cobrancas: 0, clientes_cobrados: 0, promessas: 0, promessas_valor: 0, clientes_pagaram: 0, recuperado: 0, parcelas_recuperadas: 0,
    promessas_cumpridas: 0, promessas_quebradas: 0, promessas_a_vencer: 0, conversao: null, cumprimento: null, acordos: 0, acordos_valor: 0, interacoes: 0, tarefas: 0, chamados: 0,
    por_etapa: {}, por_tipo_cobranca: {}, horas_ponto: null,
  });
  for (const m of movs) {
    const x = pessoa(m.usuario_id);
    const res = resultado(m.etapa, m.destino);
    x.movimentos += Number(m.n);
    x[`${res}s`] += Number(m.n);
    const e = (x.por_etapa[m.etapa] ||= { n: 0, avancado: 0, devolvido: 0, reprovado: 0, cancelado: 0, valor: 0, horas_soma: 0, n_tempo: 0 });
    e.n += Number(m.n); e[res] += Number(m.n); e.valor += Number(m.valor);
    if (m.horas != null) { e.horas_soma += Number(m.horas) * Number(m.n_tempo); e.n_tempo += Number(m.n_tempo); }
  }
  for (const v of vendas) Object.assign(pessoa(v.usuario_id), { vendas_qtd: Number(v.n), vendas_valor: r2(v.valor) });
  for (const c of cob) {
    const x = pessoa(c.usuario_id);
    x.cobrancas += Number(c.n);
    x.por_tipo_cobranca[c.tipo] = (x.por_tipo_cobranca[c.tipo] || 0) + Number(c.n);
    if (c.resultado === 'promessa') { x.promessas += Number(c.n); x.promessas_valor = r2(x.promessas_valor + Number(c.promessas)); }
  }
  const clientesCobrados = await db.all(`SELECT usuario_id, COUNT(DISTINCT cliente_id) AS n FROM cobranca_acoes WHERE created_at BETWEEN ? AND ?
    AND usuario_id IS NOT NULL${u('usuario_id')} GROUP BY usuario_id`, ini, fim);
  for (const c of clientesCobrados) pessoa(c.usuario_id).clientes_cobrados = Number(c.n);
  for (const a of acordos) Object.assign(pessoa(a.usuario_id), { acordos: Number(a.n), acordos_valor: r2(a.valor) });
  for (const x of recuperado) Object.assign(pessoa(x.usuario_id), { clientes_pagaram: Number(x.clientes), recuperado: r2(x.valor), parcelas_recuperadas: Number(x.parcelas) });
  for (const x of promessas) {
    Object.assign(pessoa(x.usuario_id), { promessas_cumpridas: Number(x.cumpridas || 0), promessas_quebradas: Number(x.quebradas || 0), promessas_a_vencer: Number(x.a_vencer || 0) });
  }
  const taxa = (a, b) => (b ? r2((a / b) * 100) : null);
  for (const x of Object.values(pessoas)) {
    if (x.clientes_cobrados) x.conversao = taxa(Math.min(x.clientes_pagaram, x.clientes_cobrados), x.clientes_cobrados);
    x.cumprimento = taxa(x.promessas_cumpridas, x.promessas_cumpridas + x.promessas_quebradas);
  }
  for (const c of crm) pessoa(c.usuario_id).interacoes = Number(c.n);
  for (const t of tarefas) pessoa(t.usuario_id).tarefas = Number(t.n);
  for (const c of chamados) pessoa(c.usuario_id).chamados = Number(c.n);
  if (filtroUsuario) pessoa(filtroUsuario);

  const ids = Object.keys(pessoas).map(Number);
  const usuarios = ids.length ? await db.all(`SELECT u.id, u.nome, u.perfil, u.colaborador_id, c.departamento, c.cargo FROM usuarios u
    LEFT JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id IN (${ids.join(',')})`) : [];
  for (const us of usuarios) {
    const x = pessoas[us.id];
    Object.assign(x, { nome: us.nome, perfil: us.perfil, perfil_label: A.PERFIS[us.perfil] || us.perfil, departamento: us.departamento, cargo: us.cargo });
    if (us.colaborador_id) {
      const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', us.colaborador_id);
      if (c && c.bate_ponto !== 0) {
        const t = (await P.apurar(c, de, ate)).totais;
        if (t.marcacoes) x.horas_ponto = r2(t.trabalhado / 60);
      }
    }
  }
  const colaboradores = Object.values(pessoas).filter((x) => x.nome).map((x) => {
    const etapas = Object.entries(x.por_etapa).map(([etapa, e]) => ({
      etapa, label: W.ETAPAS[etapa]?.label || etapa, avanco: AVANCO[etapa] || 'Avançados',
      n: e.n, avancado: e.avancado, devolvido: e.devolvido, reprovado: e.reprovado, cancelado: e.cancelado, valor: r2(e.valor),
      horas_medias: e.n_tempo ? r2(e.horas_soma / e.n_tempo) : null,
    })).sort((a, b) => ORDEM.indexOf(a.etapa) - ORDEM.indexOf(b.etapa));
    const total = x.movimentos + x.cobrancas + x.acordos + x.interacoes + x.tarefas + x.chamados + x.vendas_qtd;
    return { ...x, por_etapa: etapas, total };
  }).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  // ---------- Por setor (etapa do pedido) ----------
  const setores = {};
  for (const m of movs) {
    const s = (setores[m.etapa] ||= { etapa: m.etapa, label: W.ETAPAS[m.etapa]?.label || m.etapa, avanco: AVANCO[m.etapa] || 'Avançados',
      n: 0, avancado: 0, devolvido: 0, reprovado: 0, cancelado: 0, valor: 0, horas_soma: 0, n_tempo: 0, pessoas: {} });
    const res = resultado(m.etapa, m.destino);
    s.n += Number(m.n); s[res] += Number(m.n);
    if (res === 'avancado') s.valor += Number(m.valor);
    if (m.horas != null) { s.horas_soma += Number(m.horas) * Number(m.n_tempo); s.n_tempo += Number(m.n_tempo); }
    s.pessoas[m.usuario_id] = (s.pessoas[m.usuario_id] || 0) + Number(m.n);
  }
  const nomes = Object.fromEntries(usuarios.map((x) => [x.id, x.nome]));
  const listaSetores = Object.values(setores).map(({ horas_soma: hs, n_tempo: nt, pessoas: ps, ...s }) => ({
    ...s, valor: r2(s.valor), horas_medias: nt ? r2(hs / nt) : null,
    pessoas: Object.entries(ps).map(([id, n]) => ({ usuario_id: Number(id), nome: nomes[id] || '—', n })).sort((a, b) => b.n - a.n),
  })).sort((a, b) => ORDEM.indexOf(a.etapa) - ORDEM.indexOf(b.etapa));

  // ---------- Cobrança ----------
  const somaCob = (f) => cob.filter(f).reduce((a, c) => a + Number(c.n), 0);
  const porTipo = {};
  const porResultado = {};
  for (const c of cob) {
    porTipo[c.tipo] = (porTipo[c.tipo] || 0) + Number(c.n);
    porResultado[c.resultado || 'sem_resultado'] = (porResultado[c.resultado || 'sem_resultado'] || 0) + Number(c.n);
  }
  const s = (k) => colaboradores.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const analise = setores.analise;
  const dias = {};
  for (const x of serieMov) (dias[x.dia] ||= { dia: x.dia, pedidos: 0, cobrancas: 0 }).pedidos = Number(x.n);
  for (const x of serieCob) (dias[x.dia] ||= { dia: x.dia, pedidos: 0, cobrancas: 0 }).cobrancas = Number(x.n);

  res.json({
    de, ate, todos, usuario_id: filtroUsuario,
    resumo: {
      cobrancas: somaCob(() => true), clientes_cobrados: s('clientes_cobrados'), promessas: s('promessas'), promessas_valor: r2(s('promessas_valor')),
      acordos: s('acordos'), acordos_valor: r2(s('acordos_valor')),
      clientes_pagaram: s('clientes_pagaram'), recuperado: r2(s('recuperado')),
      conversao: s('clientes_cobrados') ? r2((Math.min(s('clientes_pagaram'), s('clientes_cobrados')) / s('clientes_cobrados')) * 100) : null,
      promessas_cumpridas: s('promessas_cumpridas'), promessas_quebradas: s('promessas_quebradas'), promessas_a_vencer: s('promessas_a_vencer'),
      cumprimento: s('promessas_cumpridas') + s('promessas_quebradas') ? r2((s('promessas_cumpridas') / (s('promessas_cumpridas') + s('promessas_quebradas'))) * 100) : null,
      analisados: analise?.n || 0, analise_aprovados: analise?.avancado || 0, analise_devolvidos: analise?.devolvido || 0, analise_reprovados: analise?.reprovado || 0,
      analise_horas: analise?.n_tempo ? r2(analise.horas_soma / analise.n_tempo) : null,
      notas: Number(notas.n), faturado: r2(notas.valor), vendas_qtd: s('vendas_qtd'), vendas_valor: r2(s('vendas_valor')),
      movimentos: s('movimentos'), interacoes: s('interacoes'), tarefas: s('tarefas'), chamados: s('chamados'),
    },
    setores: listaSetores,
    cobranca: { por_tipo: porTipo, por_resultado: porResultado },
    serie: Object.values(dias).sort((a, b) => a.dia.localeCompare(b.dia)),
    colaboradores,
  });
});

/** Lista de pessoas para o filtro (só para quem vê todos). */
r.get('/usuarios', A.exige('produtividade'), async (req, res) => {
  res.json(await db.all('SELECT id, nome, perfil FROM usuarios WHERE ativo = 1 ORDER BY nome'));
});

module.exports = r;
