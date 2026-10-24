// Calendário da safra: janelas de plantio e adubação por cultura (e UF, quando difere), cruzadas com as
// áreas de cultivo de cada cliente para saber quando oferecer o produto.
const db = require('./db');
const S = require('./services');

// Janelas típicas no Brasil (ajustáveis na tela). mes_fim < mes_inicio = janela que vira o ano.
const PADRAO = [
  ['Soja', 'Plantio', 9, 12, 45], ['Milho', 'Plantio (verão)', 9, 11, 45], ['Milho', 'Plantio (safrinha)', 1, 3, 40],
  ['Café', 'Adubação (1ª parcela)', 10, 12, 30], ['Café', 'Adubação (2ª parcela)', 1, 3, 30], ['Cana-de-açúcar', 'Plantio e adubação', 1, 4, 45],
  ['Algodão', 'Plantio', 11, 1, 45], ['Feijão', 'Plantio (águas)', 9, 11, 35], ['Feijão', 'Plantio (seca)', 1, 3, 35], ['Feijão', 'Plantio (inverno)', 5, 6, 35],
  ['Trigo', 'Plantio', 4, 6, 40], ['Sorgo', 'Plantio', 2, 3, 35], ['Arroz', 'Plantio', 9, 12, 40], ['Pastagem', 'Adubação', 10, 12, 30],
  ['Citros', 'Adubação', 9, 11, 30], ['Batata', 'Plantio', 4, 7, 30], ['Eucalipto', 'Adubação', 10, 12, 30], ['Mandioca', 'Plantio', 4, 6, 30],
];

let pronto;
async function garantirPadroes() {
  pronto ||= (async () => {
    if ((await db.get('SELECT COUNT(*) AS n FROM calendario_safra')).n) return;
    const marca = await db.get(`SELECT 1 AS x FROM configuracoes WHERE chave = 'safra.calendario_semeado'`);
    if (marca) return;
    for (const [cultura, atividade, mi, mf, ant] of PADRAO) {
      await db.run('INSERT INTO calendario_safra (cultura, atividade, mes_inicio, mes_fim, antecedencia_dias) VALUES (?, ?, ?, ?, ?)', cultura, atividade, mi, mf, ant);
    }
    await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('safra.calendario_semeado', '1') ON CONFLICT (chave) DO NOTHING`);
  })().catch((e) => { pronto = null; throw e; });
  return pronto;
}

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Próxima janela (início/fim) que ainda não terminou, a partir de hoje. */
function proximaJanela(mi, mf, hoje) {
  const ano = Number(hoje.slice(0, 4));
  for (const a of [ano - 1, ano, ano + 1]) {
    const inicio = `${a}-${String(mi).padStart(2, '0')}-01`;
    const anoFim = mf < mi ? a + 1 : a;
    const fimMes = new Date(Date.UTC(anoFim, mf, 0)).toISOString().slice(0, 10);
    if (fimMes >= hoje) return { inicio, fim: fimMes };
  }
  return null;
}

/**
 * Janelas dos clientes que começam (ou estão abertas) até `horizonte` dias à frente.
 * filtroSql: restrição de clientes (abrangência). Devolve uma linha por cliente × cultura × atividade.
 */
async function janelas({ horizonte = 120, filtroSql = 'TRUE', hoje = S.hoje() } = {}) {
  await garantirPadroes();
  const cal = await db.all('SELECT * FROM calendario_safra WHERE ativo = 1');
  const areas = await db.all(
    `SELECT a.cliente_id, a.tipo_cultivo AS cultura, SUM(COALESCE(a.area, 0)) AS area, MAX(a.medida) AS medida, c.nome AS cliente, c.vendedor_id, v.nome AS vendedor,
        (SELECT e.uf FROM cliente_enderecos e WHERE e.cliente_id = c.id ORDER BY e.principal DESC, e.id LIMIT 1) AS uf,
        (SELECT MAX(p.created_at) FROM pedidos p WHERE p.cliente_id = c.id AND p.etapa NOT IN ('venda','cancelado')) AS ultima_compra
       FROM cliente_areas a JOIN clientes c ON c.id = a.cliente_id LEFT JOIN usuarios v ON v.id = c.vendedor_id
      WHERE c.anonimizado_em IS NULL AND ${filtroSql}
        AND NOT EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 AND b.tipo = 'bloqueio')
      GROUP BY a.cliente_id, a.tipo_cultivo, c.id, v.nome`,
  );
  const limite = S.addDias(hoje, horizonte);
  const out = [];
  for (const a of areas) {
    const doCultivo = cal.filter((c) => norm(c.cultura) === norm(a.cultura) && (!c.uf || c.uf === a.uf));
    // Linha específica da UF substitui a geral da mesma atividade.
    const porAtividade = new Map();
    for (const c of doCultivo) if (!porAtividade.has(norm(c.atividade)) || c.uf) porAtividade.set(norm(c.atividade), c);
    for (const c of porAtividade.values()) {
      const j = proximaJanela(c.mes_inicio, c.mes_fim, hoje);
      if (!j) continue;
      const aviso = S.addDias(j.inicio, -c.antecedencia_dias);
      if (aviso > limite) continue;
      out.push({
        cliente_id: a.cliente_id, cliente: a.cliente, vendedor_id: a.vendedor_id, vendedor: a.vendedor, uf: a.uf, cultura: a.cultura, area: a.area, medida: a.medida,
        atividade: c.atividade, inicio: j.inicio, fim: j.fim, aviso_em: aviso, antecedencia: c.antecedencia_dias, ultima_compra: a.ultima_compra,
        situacao: hoje >= j.inicio ? 'aberta' : hoje >= aviso ? 'oferecer' : 'proxima',
        comprou_na_janela: !!a.ultima_compra && a.ultima_compra.slice(0, 10) >= S.addDias(aviso, -30),
      });
    }
  }
  return out.sort((x, y) => x.aviso_em.localeCompare(y.aviso_em) || (y.area || 0) - (x.area || 0));
}

module.exports = { PADRAO, garantirPadroes, janelas, proximaJanela };
