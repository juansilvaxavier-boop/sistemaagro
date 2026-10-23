// Relatórios com filtros, "Gerar Relatório" (JSON) e "Gerar Excel" (?export=xlsx).
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const W = require('../workflow');
const { enviarXlsx } = require('../lista');

const r = express.Router();
const { ErroNegocio } = S;

const col = (k, l, t) => ({ k, l, t });

/** Monta WHERE a partir dos filtros informados. */
function filtros(q, mapa) {
  const where = [];
  const params = [];
  for (const [chave, [expr, transform]] of Object.entries(mapa)) {
    const v = q[chave];
    if (v === undefined || v === '' || v === null) continue;
    where.push(expr);
    params.push(transform ? transform(v) : v);
  }
  return { where: where.length ? ' AND ' + where.join(' AND ') : '', params };
}
const fimDia = (v) => `${v} 23:59:59`;

function forcarVendedor(req, q) {
  if (req.user.perfil === 'vendedor') q.vendedor_id = req.user.id;
  if (req.user.perfil === 'supervisor') q.supervisor_id = req.user.id;
}

const PARCELA_BASE = `
  FROM parcelas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN pedidos pe ON pe.id = p.pedido_id
  LEFT JOIN notas_fiscais nf ON nf.id = p.nota_id LEFT JOIN usuarios v ON v.id = pe.vendedor_id
  LEFT JOIN usuarios s ON s.id = pe.supervisor_id LEFT JOIN bancos b ON b.id = p.banco_id
  LEFT JOIN formas_pagamento f ON f.id = pe.forma_id`;
const PARCELA_COLS = `p.id, pe.numero AS pedido, nf.numero AS nota, c.documento, c.nome AS cliente, p.numero || '/' || IFNULL(p.total_parcelas::text, '') AS parcela,
  p.vencimento, p.valor, p.juros, p.valor_pago, ${S.SALDO_PARCELA_SQL} AS saldo, ${S.STATUS_PARCELA_SQL} AS status, f.nome AS forma, b.nome AS banco,
  v.nome AS vendedor, s.nome AS supervisor, p.data_pagamento, p.tipo_baixa`;
const filtroParcelaComum = {
  banco_id: ['p.banco_id = ?'], forma_id: ['pe.forma_id = ?'], supervisor_id: ['pe.supervisor_id = ?'], vendedor_id: ['pe.vendedor_id = ?'],
};

const RELATORIOS = {
  'contas-receber': {
    titulo: 'Contas a Receber', perm: 'relatorios.financeiro',
    async gerar(q, ctx) {
      const f = filtros(q, { venc_de: ['p.vencimento >= ?'], venc_ate: ['p.vencimento <= ?'], ...filtroParcelaComum });
      const ordem = q.agrupar_vendedor === '1' ? 'v.nome, p.vencimento' : 'p.vencimento';
      return {
        colunas: [col('vendedor', 'Vendedor'), col('pedido', 'Pedido'), col('nota', 'NF'), col('documento', 'CPF/CNPJ'), col('cliente', 'Cliente'), col('parcela', 'Parcela'),
          col('vencimento', 'Vencimento', 'date'), col('saldo', 'Saldo', 'money'), col('status', 'Status'), col('forma', 'Forma'), col('banco', 'Banco'), col('supervisor', 'Supervisor')],
        linhas: await db.all(`SELECT ${PARCELA_COLS} ${PARCELA_BASE} WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} ${f.where} ORDER BY ${ordem}`, ctx.emp, ...f.params),
        totalizar: ['saldo'], agrupar: q.agrupar_vendedor === '1' ? 'vendedor' : null,
      };
    },
  },
  'contas-recebidas': {
    titulo: 'Contas Recebidas', perm: 'relatorios.financeiro',
    async gerar(q, ctx) {
      const f = filtros(q, { baixa_de: ['p.data_pagamento >= ?'], baixa_ate: ['p.data_pagamento <= ?'], ...filtroParcelaComum });
      return {
        colunas: [col('data_pagamento', 'Data baixa', 'date'), col('pedido', 'Pedido'), col('nota', 'NF'), col('cliente', 'Cliente'), col('parcela', 'Parcela'),
          col('vencimento', 'Vencimento', 'date'), col('valor', 'Valor', 'money'), col('juros', 'Juros', 'money'), col('valor_pago', 'Pago', 'money'),
          col('tipo_baixa', 'Tipo baixa'), col('banco', 'Banco'), col('forma', 'Forma'), col('vendedor', 'Vendedor'), col('supervisor', 'Supervisor')],
        linhas: await db.all(`SELECT ${PARCELA_COLS} ${PARCELA_BASE} WHERE p.empresa_id = ? AND p.valor_pago > 0 ${f.where} ORDER BY p.data_pagamento`, ctx.emp, ...f.params),
        totalizar: ['valor', 'juros', 'valor_pago'],
      };
    },
  },
  vencidas: {
    titulo: 'Vencidas', perm: 'relatorios.financeiro',
    async gerar(q, ctx) {
      const f = filtros(q, { venc_de: ['p.vencimento >= ?'], venc_ate: ['p.vencimento <= ?'], ...filtroParcelaComum });
      let neg = '';
      if (q.negativado === 'sim') neg = ` AND EXISTS (SELECT 1 FROM negativacoes n WHERE n.parcela_id = p.id AND n.status IN ('inclusao_aceita','baixa_solicitada','baixa_rejeitada'))`;
      if (q.negativado === 'nao') neg = ` AND NOT EXISTS (SELECT 1 FROM negativacoes n WHERE n.parcela_id = p.id AND n.status IN ('inclusao_aceita','baixa_solicitada','baixa_rejeitada'))`;
      return {
        colunas: [col('cliente', 'Cliente'), col('documento', 'CPF/CNPJ'), col('pedido', 'Pedido'), col('nota', 'NF'), col('parcela', 'Parcela'), col('vencimento', 'Vencimento', 'date'),
          col('dias_atraso', 'Dias atraso'), col('saldo', 'Saldo', 'money'), col('forma', 'Forma'), col('banco', 'Banco'), col('vendedor', 'Vendedor'), col('supervisor', 'Supervisor')],
        linhas: await db.all(
          `SELECT ${PARCELA_COLS}, CAST(julianday('now','localtime') - julianday(p.vencimento) AS INTEGER) AS dias_atraso ${PARCELA_BASE}
            WHERE p.empresa_id = ? AND ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') ${f.where}${neg} ORDER BY p.vencimento`, ctx.emp, ...f.params,
        ),
        totalizar: ['saldo'],
      };
    },
  },
  faturamento: {
    titulo: 'Faturamento', perm: 'relatorios.financeiro',
    async gerar(q, ctx) {
      const f = filtros(q, { emissao_de: ['nf.data_emissao >= ?'], emissao_ate: ['nf.data_emissao <= ?', fimDia], empresa_id: ['nf.empresa_id = ?'] });
      return {
        colunas: [col('data_emissao', 'Emissão', 'datetime'), col('empresa', 'Empresa'), col('numero', 'NF'), col('pedido', 'Pedido'), col('cliente', 'Cliente'),
          col('vendedor', 'Vendedor'), col('valor', 'Valor', 'money'), col('status', 'Status')],
        linhas: await db.all(
          `SELECT nf.data_emissao, e.nome AS empresa, nf.numero, pe.numero AS pedido, c.nome AS cliente, v.nome AS vendedor, nf.valor, nf.status
             FROM notas_fiscais nf JOIN empresas e ON e.id = nf.empresa_id JOIN clientes c ON c.id = nf.cliente_id
             LEFT JOIN pedidos pe ON pe.id = nf.pedido_id LEFT JOIN usuarios v ON v.id = pe.vendedor_id
            WHERE nf.status <> 'cancelada' ${q.empresa_id ? '' : 'AND nf.empresa_id = ' + Number(ctx.emp)} ${f.where} ORDER BY nf.data_emissao`, ...f.params,
        ),
        totalizar: ['valor'],
      };
    },
  },
  vendas: {
    titulo: 'Vendas', perm: 'relatorios.vendas', escopo: true,
    async gerar(q, ctx) {
      const f = filtros(q, {
        cad_de: ['p.created_at >= ?'], cad_ate: ['p.created_at <= ?', fimDia], forma_id: ['p.forma_id = ?'], supervisor_id: ['p.supervisor_id = ?'],
        vendedor_id: ['p.vendedor_id = ?'], etapa: ['p.etapa = ?'], equipe_id: ['v.equipe_id = ?'],
      });
      return {
        colunas: [col('numero', 'Pedido'), col('created_at', 'Cadastro', 'datetime'), col('cliente', 'Cliente'), col('documento', 'CPF/CNPJ'), col('forma', 'Forma'),
          col('condicao', 'Condição'), col('vendedor', 'Vendedor'), col('supervisor', 'Supervisor'), col('equipe', 'Equipe'), col('etapa', 'Etapa'), col('valor_total', 'Valor', 'money')],
        linhas: (await db.all(
          `SELECT p.numero, p.created_at, c.nome AS cliente, c.documento, f.nome AS forma, cp.descricao AS condicao, v.nome AS vendedor, s.nome AS supervisor,
                  e.nome AS equipe, p.etapa, p.valor_total
             FROM pedidos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN formas_pagamento f ON f.id = p.forma_id
             LEFT JOIN condicoes_pagamento cp ON cp.id = p.condicao_id LEFT JOIN usuarios v ON v.id = p.vendedor_id
             LEFT JOIN usuarios s ON s.id = p.supervisor_id LEFT JOIN equipes e ON e.id = v.equipe_id
            WHERE p.empresa_id = ? ${f.where} ORDER BY p.created_at`, ctx.emp, ...f.params,
        )).map((x) => ({ ...x, etapa: W.ETAPAS[x.etapa]?.label || x.etapa })),
        totalizar: ['valor_total'],
      };
    },
  },
  'historico-vendas': {
    titulo: 'Histórico de Vendas', perm: 'relatorios.vendas', escopo: true,
    async gerar(q, ctx) {
      const f = filtros(q, { emissao_de: ['nf.data_emissao >= ?'], emissao_ate: ['nf.data_emissao <= ?', fimDia], empresa_id: ['nf.empresa_id = ?'], vendedor_id: ['pe.vendedor_id = ?'], supervisor_id: ['pe.supervisor_id = ?'] });
      return {
        colunas: [col('data_emissao', 'Emissão', 'datetime'), col('empresa', 'Empresa'), col('nota', 'NF'), col('pedido', 'Pedido'), col('cliente', 'Cliente'), col('produto', 'Produto'),
          col('embalagem', 'Embalagem'), col('quantidade', 'Qtd'), col('unidade', 'Un'), col('valor_unitario', 'Unitário', 'money'), col('valor_total', 'Total', 'money'), col('brinde', 'Brinde', 'bool'), col('lote', 'Lote')],
        linhas: await db.all(
          `SELECT nf.data_emissao, e.nome AS empresa, nf.numero AS nota, pe.numero AS pedido, c.nome AS cliente, pr.nome AS produto, em.descricao AS embalagem,
                  i.quantidade, i.unidade, i.valor_unitario, i.valor_total, i.brinde, i.lote
             FROM notas_fiscais nf JOIN pedidos pe ON pe.id = nf.pedido_id JOIN pedido_itens i ON i.pedido_id = pe.id JOIN produtos pr ON pr.id = i.produto_id
             LEFT JOIN produto_embalagens em ON em.id = i.embalagem_id JOIN clientes c ON c.id = nf.cliente_id JOIN empresas e ON e.id = nf.empresa_id
            WHERE nf.status <> 'cancelada' ${q.empresa_id ? '' : 'AND nf.empresa_id = ' + Number(ctx.emp)} ${f.where} ORDER BY nf.data_emissao, nf.numero`, ...f.params,
        ),
        totalizar: ['valor_total'],
      };
    },
  },
  'venda-produtos': {
    titulo: 'Venda de Produtos', perm: 'relatorios.vendas', escopo: true,
    async gerar(q, ctx) {
      const dims = {
        produto: ['pr.nome', 'Produto'], grupo: ['g.nome', 'Grupo'], cliente: ['c.nome', 'Cliente'], vendedor: ['v.nome', 'Vendedor'], mes: [`substr(nf.data_emissao,1,7)`, 'Mês'],
      };
      const sum = dims[q.sumarizacao] ? q.sumarizacao : 'produto';
      const grupos = [dims[sum][0]];
      if (q.por_embalagem === '1') grupos.push('em.descricao');
      let de = q.emissao_de;
      if (q.prazo_meses) de = S.addDias(S.hoje(), -30 * Number(q.prazo_meses));
      const f = filtros({ ...q, emissao_de: de }, {
        emissao_de: ['nf.data_emissao >= ?'], emissao_ate: ['nf.data_emissao <= ?', fimDia], vendedor_id: ['pe.vendedor_id = ?'], supervisor_id: ['pe.supervisor_id = ?'], grupo_id: ['pr.grupo_id = ?'],
      });
      const analitico = q.tipo === 'analitico';
      const linhas = await db.all(
        `SELECT ${dims[sum][0]} AS chave, ${q.por_embalagem === '1' ? 'em.descricao' : "''"} AS embalagem,
                ${analitico ? "nf.numero AS nota, substr(nf.data_emissao,1,10) AS emissao, c.nome AS cliente_nome," : ''}
                SUM(i.quantidade) AS quantidade, SUM(i.quantidade * IFNULL(em.quantidade,1)) AS volume, COUNT(DISTINCT pe.id) AS pedidos,
                ROUND(SUM(i.valor_total),2) AS valor
           FROM notas_fiscais nf JOIN pedidos pe ON pe.id = nf.pedido_id JOIN pedido_itens i ON i.pedido_id = pe.id
           JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN grupos_produto g ON g.id = pr.grupo_id LEFT JOIN produto_embalagens em ON em.id = i.embalagem_id
           JOIN clientes c ON c.id = pe.cliente_id LEFT JOIN usuarios v ON v.id = pe.vendedor_id
          WHERE nf.status <> 'cancelada' AND nf.empresa_id = ? ${f.where}
          GROUP BY ${[...grupos, ...(analitico ? ['nf.id', 'c.id'] : [])].join(', ')}
          ${q.quantidade_min ? 'HAVING SUM(i.quantidade) >= ' + Number(q.quantidade_min) : ''}
          ORDER BY ${analitico ? 'chave, emissao' : 'valor DESC'}`, ctx.emp, ...f.params,
      );
      return {
        colunas: [col('chave', dims[sum][1]), ...(q.por_embalagem === '1' ? [col('embalagem', 'Embalagem')] : []),
          ...(analitico ? [col('nota', 'NF'), col('emissao', 'Emissão', 'date'), col('cliente_nome', 'Cliente')] : []),
          col('quantidade', 'Qtd (emb.)'), col('volume', 'Volume (kg/L)'), col('pedidos', 'Pedidos'), col('valor', 'Valor', 'money')],
        linhas, totalizar: ['quantidade', 'volume', 'valor'],
      };
    },
  },
  'vendedores-supervisor': {
    titulo: 'Vendedores por Supervisor', perm: 'relatorios.vendas',
    async gerar() {
      return {
        colunas: [col('supervisor', 'Supervisor'), col('equipe', 'Equipe'), col('vendedor', 'Vendedor'), col('login', 'Login'), col('email', 'E-mail'), col('ativo', 'Ativo', 'bool')],
        linhas: await db.all(
          `SELECT IFNULL(s.nome,'(sem supervisor)') AS supervisor, e.nome AS equipe, v.nome AS vendedor, v.login, v.email, v.ativo
             FROM usuarios v LEFT JOIN equipes e ON e.id = v.equipe_id LEFT JOIN usuarios s ON s.id = e.supervisor_id
            WHERE v.perfil = 'vendedor' ORDER BY supervisor, e.nome, v.nome`,
        ),
        agrupar: 'supervisor',
      };
    },
  },
};

r.get('/', async (req, res) => {
  res.json(Object.entries(RELATORIOS).filter(([, d]) => A.can(req.user, d.perm)).map(([id, d]) => ({ id, titulo: d.titulo })));
});

r.get('/:tipo', async (req, res) => {
  const def = RELATORIOS[req.params.tipo];
  if (!def) throw new ErroNegocio('Relatório não encontrado', 404);
  if (!A.can(req.user, def.perm)) throw new ErroNegocio('Sem acesso a este relatório.', 403);
  const q = { ...req.query };
  forcarVendedor(req, q);
  const out = await def.gerar(q, { emp: req.empresaId, user: req.user });
  const totais = {};
  for (const k of out.totalizar || []) totais[k] = S.r2(out.linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0));
  if (req.query.export === 'xlsx') {
    const linhas = [...out.linhas];
    if (out.totalizar?.length) linhas.push({ [out.colunas[0].k]: `TOTAL (${out.linhas.length} registros)`, ...totais });
    return enviarXlsx(res, { titulo: def.titulo, colunas: out.colunas, linhas });
  }
  res.json({ titulo: def.titulo, colunas: out.colunas, linhas: out.linhas, totais, agrupar: out.agrupar || null, gerado_em: new Date().toISOString() });
});

module.exports = r;
