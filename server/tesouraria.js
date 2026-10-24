// Tesouraria: leitura de extrato OFX, conciliação com parcelas e contas a pagar, fluxo de caixa
// (realizado + previsto) e resultado gerencial do mês.
const db = require('./db');
const S = require('./services');
const C = require('./config');

const { ErroNegocio, r2 } = S;

// ---------- OFX ----------
/** Lê o OFX (SGML 1.x ou XML 2.x): conta, período, saldo e lançamentos. */
function lerOfx(texto) {
  const t = String(texto || '');
  if (!/<OFX>/i.test(t)) throw new ErroNegocio('Arquivo não parece um extrato OFX.');
  const tag = (bloco, nome) => {
    const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : null;
  };
  const data = (v) => (v && /^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
  const num = (v) => Number(String(v || '0').replace(',', '.'));
  const lancamentos = [];
  for (const m of t.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1];
    const valor = num(tag(b, 'TRNAMT'));
    const dt = data(tag(b, 'DTPOSTED'));
    if (!dt || !Number.isFinite(valor) || !valor) continue;
    const descricao = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' · ') || tag(b, 'TRNTYPE') || 'Lançamento';
    const fitid = tag(b, 'FITID') || `${dt}|${valor}|${descricao}`.slice(0, 120);
    lancamentos.push({ data: dt, valor: r2(valor), descricao: descricao.slice(0, 250), documento: tag(b, 'CHECKNUM') || tag(b, 'REFNUM'), fitid });
  }
  if (!lancamentos.length) throw new ErroNegocio('Nenhum lançamento encontrado no extrato.');
  const ledger = t.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|$)/i)?.[1] || '';
  return {
    banco: tag(t, 'BANKID'), conta: tag(t, 'ACCTID'), inicio: data(tag(t, 'DTSTART')), fim: data(tag(t, 'DTEND')),
    saldo: ledger ? num(tag(ledger, 'BALAMT')) : null, saldo_data: ledger ? data(tag(ledger, 'DTASOF')) : null, lancamentos,
  };
}

async function importarOfx(texto, { empresaId, bancoId, arquivo, usuarioId }) {
  const o = lerOfx(texto);
  let banco = Number(bancoId) || null;
  if (!banco && o.banco) banco = (await db.get('SELECT id FROM bancos WHERE codigo = ?', String(o.banco).padStart(3, '0').slice(-3)))?.id || null;
  return db.tx(async () => {
    const extrato = await db.insert('extratos_bancarios', {
      empresa_id: empresaId, banco_id: banco, conta: o.conta, arquivo: arquivo || null, inicio: o.inicio || o.lancamentos[0].data,
      fim: o.fim || o.lancamentos.at(-1).data, saldo_final: o.saldo, saldo_data: o.saldo_data || o.fim, usuario_id: usuarioId,
    });
    let novos = 0;
    for (const l of o.lancamentos) {
      const existe = await db.get('SELECT id FROM extrato_lancamentos WHERE empresa_id = ? AND COALESCE(banco_id, 0) = ? AND fitid = ?', empresaId, banco || 0, l.fitid);
      if (existe) continue;
      await db.run(
        `INSERT INTO extrato_lancamentos (extrato_id, empresa_id, banco_id, data, valor, descricao, documento, fitid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        extrato, empresaId, banco, l.data, l.valor, l.descricao, l.documento, l.fitid,
      );
      novos++;
    }
    await db.run('UPDATE extratos_bancarios SET lancamentos = ? WHERE id = ?', novos, extrato);
    return { extrato_id: extrato, lancamentos: o.lancamentos.length, novos, repetidos: o.lancamentos.length - novos, banco_id: banco, saldo: o.saldo };
  });
}

// ---------- Conciliação ----------
const dias = (a, b) => Math.abs(S.diasEntre(a, b));

/**
 * Sugestões para um lançamento: crédito → parcelas (em aberto pelo saldo, ou já baixadas no mesmo valor e data);
 * débito → contas a pagar. Pontua pelo valor exato e pela proximidade da data.
 */
async function sugestoes(l, { amplo = false } = {}) {
  const v = Math.abs(l.valor);
  // Busca ampla: valor até 10% diferente (juros, desconto, pagamento parcial) e datas até 120 dias.
  const tol = amplo ? Math.max(0.05, v * 0.1) : 0.05;
  const [antes, depois, folga] = amplo ? ['-120 days', '+60 days', 30] : ['-45 days', '+20 days', 5];
  const out = [];
  if (l.valor > 0) {
    const rows = await db.all(
      `SELECT p.id, p.numero, p.total_parcelas, p.vencimento, p.status, p.data_pagamento, p.valor_pago, ${S.SALDO_PARCELA_SQL} AS saldo, c.nome AS cliente, pe.numero AS pedido
         FROM parcelas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN pedidos pe ON pe.id = p.pedido_id
        WHERE p.empresa_id = ? AND NOT EXISTS (SELECT 1 FROM extrato_lancamentos x WHERE x.parcela_id = p.id AND x.status = 'conciliado')
          AND ((${S.ABERTA_SQL} AND ABS(${S.SALDO_PARCELA_SQL} - ?) <= ? AND p.vencimento BETWEEN date(?, ?) AND date(?, ?))
            OR (p.status = 'liquidada' AND ABS(p.valor_pago - ?) <= ? AND p.data_pagamento BETWEEN date(?, ?) AND date(?, ?)))
        LIMIT 30`, l.empresa_id, v, tol, l.data, antes, l.data, depois, v, tol, l.data, `-${folga} days`, l.data, `+${folga} days`,
    );
    for (const p of rows) {
      const ja = p.status === 'liquidada';
      out.push({
        tipo: 'parcela', id: p.id, descricao: `${p.cliente} · parcela ${p.numero}/${p.total_parcelas || 1}${p.pedido ? ` · pedido ${p.pedido}` : ''}`,
        data: ja ? p.data_pagamento : p.vencimento, valor: ja ? p.valor_pago : p.saldo, ja_baixada: ja,
        pontos: Math.max(5, 100 - Math.min(60, dias(l.data, ja ? p.data_pagamento : p.vencimento) * (ja ? 8 : 2)) - (Math.abs((ja ? p.valor_pago : p.saldo) - v) > 0.05 ? 30 : 0)),
      });
    }
  } else {
    const rows = await db.all(
      `SELECT c.id, c.descricao, c.vencimento, c.status, c.data_pagamento, c.valor_pago, f.razao_social AS fornecedor,
          ROUND((c.valor + COALESCE(c.juros,0) - COALESCE(c.desconto,0) - COALESCE(c.valor_pago,0))::numeric, 2)::float8 AS saldo
         FROM contas_pagar c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
        WHERE c.empresa_id = ? AND NOT EXISTS (SELECT 1 FROM extrato_lancamentos x WHERE x.conta_pagar_id = c.id AND x.status = 'conciliado')
          AND ((c.status = 'a_pagar' AND ABS((c.valor + COALESCE(c.juros,0) - COALESCE(c.desconto,0) - COALESCE(c.valor_pago,0)) - ?) <= ?
                AND c.vencimento BETWEEN date(?, ?) AND date(?, ?))
            OR (c.status = 'pago' AND ABS(c.valor_pago - ?) <= ? AND c.data_pagamento BETWEEN date(?, ?) AND date(?, ?)))
        LIMIT 30`, l.empresa_id, v, tol, l.data, antes, l.data, depois, v, tol, l.data, `-${folga} days`, l.data, `+${folga} days`,
    );
    for (const c of rows) {
      const ja = c.status === 'pago';
      out.push({
        tipo: 'conta', id: c.id, descricao: `${c.fornecedor ? `${c.fornecedor} · ` : ''}${c.descricao}`, data: ja ? c.data_pagamento : c.vencimento,
        valor: ja ? c.valor_pago : c.saldo, ja_baixada: ja,
        pontos: Math.max(5, 100 - Math.min(60, dias(l.data, ja ? c.data_pagamento : c.vencimento) * (ja ? 8 : 2)) - (Math.abs((ja ? c.valor_pago : c.saldo) - v) > 0.05 ? 30 : 0)),
      });
    }
  }
  return out.sort((a, b) => b.pontos - a.pontos);
}

/** Concilia: baixa a parcela/conta em aberto com a data e o valor do extrato, ou só liga se já estava baixada. */
async function conciliar(lancId, { tipo, id }, { empresaId, usuarioId }) {
  const l = await db.get('SELECT * FROM extrato_lancamentos WHERE id = ? AND empresa_id = ?', Number(lancId), empresaId);
  if (!l) throw new ErroNegocio('Lançamento não encontrado.', 404);
  if (l.status === 'conciliado') throw new ErroNegocio('Lançamento já conciliado.');
  const v = Math.abs(l.valor);
  await db.tx(async () => {
    if (tipo === 'parcela') {
      if (l.valor < 0) throw new ErroNegocio('Débito do extrato não pode ser ligado a uma parcela a receber.');
      const p = await db.get('SELECT * FROM parcelas WHERE id = ? AND empresa_id = ?', Number(id), empresaId);
      if (!p) throw new ErroNegocio('Parcela não encontrada.');
      if (['a_pagar', 'acordo_judicial'].includes(p.status)) {
        const saldo = r2(p.valor + (p.juros || 0) - (p.desconto || 0) - (p.valor_pago || 0));
        await S.baixarParcela(p.id, {
          data_pagamento: l.data, valor_pago: v, tipo_baixa: p.tipo_baixa || 'TED', banco_id: l.banco_id,
          juros: v > saldo ? r2((p.juros || 0) + v - saldo) : undefined,
        }, usuarioId);
      }
      await db.run(`UPDATE extrato_lancamentos SET status = 'conciliado', parcela_id = ?, conciliado_por = ?, conciliado_em = datetime('now','localtime') WHERE id = ?`, p.id, usuarioId, l.id);
    } else if (tipo === 'conta') {
      if (l.valor > 0) throw new ErroNegocio('Crédito do extrato não pode ser ligado a uma conta a pagar.');
      const c = await db.get('SELECT * FROM contas_pagar WHERE id = ? AND empresa_id = ?', Number(id), empresaId);
      if (!c) throw new ErroNegocio('Conta a pagar não encontrada.');
      if (c.status === 'a_pagar') {
        const saldo = r2(c.valor + (c.juros || 0) - (c.desconto || 0) - (c.valor_pago || 0));
        await require('./routes/pagar').pagarConta(c, { data_pagamento: l.data, valor_pago: Math.min(v, saldo), juros: v > saldo ? r2((c.juros || 0) + v - saldo) : undefined, banco_id: l.banco_id });
      }
      await db.run(`UPDATE extrato_lancamentos SET status = 'conciliado', conta_pagar_id = ?, conciliado_por = ?, conciliado_em = datetime('now','localtime') WHERE id = ?`, c.id, usuarioId, l.id);
    } else throw new ErroNegocio('Escolha a parcela ou a conta.');
  });
  return { ok: true };
}

/** Concilia de uma vez os lançamentos com uma única sugestão forte (valor igual e data próxima). */
async function conciliarAutomatico(empresaId, usuarioId) {
  const pend = await db.all(`SELECT * FROM extrato_lancamentos WHERE empresa_id = ? AND status = 'pendente' ORDER BY data`, empresaId);
  let n = 0;
  const usados = new Set();
  for (const l of pend) {
    const s = (await sugestoes(l)).filter((x) => x.pontos >= 80 && !usados.has(`${x.tipo}${x.id}`));
    if (s.length !== 1) continue;
    try {
      await conciliar(l.id, s[0], { empresaId, usuarioId });
      usados.add(`${s[0].tipo}${s[0].id}`);
      n++;
    } catch { /* fica para conferência manual */ }
  }
  return { conciliados: n, pendentes: pend.length - n };
}

// ---------- Fluxo de caixa ----------
/** Saldo em conta informado à mão (por empresa), usado quando não há extrato importado. */
async function saldoInformado(empresaId) {
  const r = await db.get('SELECT valor FROM configuracoes WHERE chave = ?', `tesouraria.saldo.${empresaId}`);
  try { return r?.valor ? JSON.parse(r.valor) : null; } catch { return null; }
}
async function informarSaldo(empresaId, valor, data, usuarioId) {
  const v = valor === '' || valor == null ? null : Number(String(valor).replace(',', '.'));
  if (v !== null && (!Number.isFinite(v) || !/^\d{4}-\d{2}-\d{2}$/.test(data || ''))) throw new ErroNegocio('Informe o saldo e a data.');
  await db.run(
    `INSERT INTO configuracoes (chave, valor, updated_at, updated_by) VALUES (?, ?, datetime('now','localtime'), ?)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    `tesouraria.saldo.${empresaId}`, v === null ? null : JSON.stringify({ valor: r2(v), data }), usuarioId || null,
  );
}

async function saldoInicial(empresaId) {
  const manual = await saldoInformado(empresaId);
  if (manual) return { ...manual, origem: 'informado' };
  const ult = await db.all(
    `SELECT DISTINCT ON (COALESCE(banco_id, 0)) saldo_final, saldo_data FROM extratos_bancarios
      WHERE empresa_id = ? AND saldo_final IS NOT NULL ORDER BY COALESCE(banco_id, 0), saldo_data DESC, id DESC`, empresaId,
  );
  if (!ult.length) return { valor: 0, data: S.hoje(), origem: 'nenhum' };
  return { valor: r2(ult.reduce((a, x) => a + x.saldo_final, 0)), data: ult.map((x) => x.saldo_data).sort()[0], origem: 'extrato' };
}

const chave = (d, agrupar) => {
  if (agrupar === 'mes') return d.slice(0, 7);
  if (agrupar === 'semana') {
    const dt = new Date(`${d}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }
  return d;
};

/**
 * Fluxo de caixa: realizado (pagamentos recebidos e feitos) até hoje e previsto (vencimentos em aberto) depois.
 * Vencidos em aberto entram como "atrasados" separados (não somam na projeção, salvo incluirAtrasados).
 */
async function fluxo(empresaId, { de, ate, agrupar = 'dia', incluirAtrasados = false }) {
  const hoje = S.hoje();
  const ini = await saldoInicial(empresaId);
  const real = await db.all(
    `SELECT data, SUM(entrada) AS entrada, SUM(saida) AS saida FROM (
       SELECT data_pagamento AS data, valor_pago AS entrada, 0 AS saida FROM parcelas WHERE empresa_id = :e AND data_pagamento IS NOT NULL AND data_pagamento BETWEEN :de AND :ate
       UNION ALL
       SELECT data_pagamento, 0, valor_pago FROM contas_pagar WHERE empresa_id = :e AND data_pagamento IS NOT NULL AND data_pagamento BETWEEN :de AND :ate
     ) t WHERE data <= :hoje GROUP BY data`, { e: empresaId, de, ate, hoje },
  );
  const prev = await db.all(
    `SELECT data, SUM(entrada) AS entrada, SUM(saida) AS saida FROM (
       SELECT p.vencimento AS data, ${S.SALDO_PARCELA_SQL} AS entrada, 0 AS saida FROM parcelas p WHERE p.empresa_id = :e AND ${S.ABERTA_SQL} AND p.vencimento BETWEEN :ini AND :ate
       UNION ALL
       SELECT c.vencimento, 0, c.valor + COALESCE(c.juros,0) - COALESCE(c.desconto,0) - COALESCE(c.valor_pago,0) FROM contas_pagar c
        WHERE c.empresa_id = :e AND c.status = 'a_pagar' AND c.vencimento BETWEEN :ini AND :ate
     ) t GROUP BY data`, { e: empresaId, ini: hoje > de ? hoje : de, ate },
  );
  const atr = await db.get(
    `SELECT (SELECT COALESCE(SUM(${S.SALDO_PARCELA_SQL}),0) FROM parcelas p WHERE p.empresa_id = :e AND ${S.ABERTA_SQL} AND p.vencimento < :hoje) AS receber,
            (SELECT COALESCE(SUM(c.valor + COALESCE(c.juros,0) - COALESCE(c.desconto,0) - COALESCE(c.valor_pago,0)),0) FROM contas_pagar c WHERE c.empresa_id = :e AND c.status = 'a_pagar' AND c.vencimento < :hoje) AS pagar`,
    { e: empresaId, hoje },
  );
  // Saldo de partida no início do período: saldo informado/extrato ajustado pelos pagamentos entre a data do saldo e o início.
  const ajuste = await db.get(
    `SELECT (SELECT COALESCE(SUM(valor_pago),0) FROM parcelas WHERE empresa_id = :e AND data_pagamento > :sd AND data_pagamento < :de)
          - (SELECT COALESCE(SUM(valor_pago),0) FROM contas_pagar WHERE empresa_id = :e AND data_pagamento > :sd AND data_pagamento < :de) AS v`,
    { e: empresaId, sd: ini.data, de },
  );
  const ajusteVolta = de < ini.data ? await db.get(
    `SELECT (SELECT COALESCE(SUM(valor_pago),0) FROM parcelas WHERE empresa_id = :e AND data_pagamento >= :de AND data_pagamento <= :sd)
          - (SELECT COALESCE(SUM(valor_pago),0) FROM contas_pagar WHERE empresa_id = :e AND data_pagamento >= :de AND data_pagamento <= :sd) AS v`,
    { e: empresaId, sd: ini.data, de },
  ) : { v: 0 };
  // Sem saldo informado nem extrato, o fluxo é relativo: começa em zero no início do período.
  let saldo = ini.origem === 'nenhum' ? 0 : r2(ini.valor + (de > ini.data ? ajuste.v : -ajusteVolta.v));
  const grupos = new Map();
  const somar = (lista, tipo) => {
    for (const x of lista) {
      const k = chave(x.data, agrupar);
      const g = grupos.get(k) || { periodo: k, entradas: 0, saidas: 0, entradas_previstas: 0, saidas_previstas: 0 };
      if (tipo === 'real') { g.entradas += x.entrada || 0; g.saidas += x.saida || 0; } else { g.entradas_previstas += x.entrada || 0; g.saidas_previstas += x.saida || 0; }
      grupos.set(k, g);
    }
  };
  somar(real, 'real');
  somar(prev, 'prev');
  if (incluirAtrasados && (atr.receber || atr.pagar)) somar([{ data: hoje > de ? hoje : de, entrada: atr.receber, saida: atr.pagar }], 'prev');
  const linhas = [...grupos.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map((g) => {
    const liquido = r2(g.entradas + g.entradas_previstas - g.saidas - g.saidas_previstas);
    saldo = r2(saldo + liquido);
    return { ...Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])), liquido, saldo };
  });
  const menor = linhas.reduce((m, l) => (m == null || l.saldo < m.saldo ? l : m), null);
  return { saldo_inicial: ini, saldo_partida: linhas.length ? r2(linhas[0].saldo - linhas[0].liquido) : saldo, linhas, atrasados: { receber: r2(atr.receber), pagar: r2(atr.pagar) }, menor_saldo: menor, saldo_final: saldo };
}

// ---------- Resultado do mês (DRE gerencial) ----------
const CATEGORIAS_CUSTO = ['Matéria-prima', 'Embalagem'];

async function dre(empresaId, ano) {
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
  const porMes = async (sql, params) => Object.fromEntries((await db.all(sql, ...params)).map((x) => [x.mes, Number(x.v) || 0]));
  const de = `${ano}-01-01`;
  const ate = `${ano + 1}-01-01`;
  const receita = await porMes(`SELECT substr(data_emissao,1,7) AS mes, SUM(valor) AS v FROM notas_fiscais WHERE empresa_id = ? AND status <> 'cancelada' AND data_emissao >= ? AND data_emissao < ? GROUP BY mes`, [empresaId, de, ate]);
  const devolucoes = await porMes(`SELECT substr(d.created_at,1,7) AS mes, SUM(d.valor) AS v FROM devolucoes d JOIN notas_fiscais n ON n.id = d.nota_id WHERE n.empresa_id = ? AND d.created_at >= ? AND d.created_at < ? GROUP BY mes`, [empresaId, de, ate]);
  const cmv = await porMes(
    `SELECT substr(n.data_emissao,1,7) AS mes, SUM(i.quantidade * COALESCE(i.custo_embalagem, 0)) AS v FROM notas_fiscais n JOIN pedido_itens i ON i.pedido_id = n.pedido_id
      WHERE n.empresa_id = ? AND n.status <> 'cancelada' AND n.data_emissao >= ? AND n.data_emissao < ? GROUP BY mes`, [empresaId, de, ate],
  );
  const comissoes = await porMes(`SELECT periodo AS mes, SUM(valor) AS v FROM comissoes WHERE COALESCE(empresa_id, ?) = ? AND periodo >= ? AND periodo < ? GROUP BY periodo`, [empresaId, empresaId, `${ano}-01`, `${ano + 1}-01`]);
  const fretes = await porMes(
    `SELECT substr(n.data_emissao,1,7) AS mes, SUM(COALESCE(p.frete_valor, 0)) AS v FROM notas_fiscais n JOIN pedidos p ON p.id = n.pedido_id
      WHERE n.empresa_id = ? AND n.status <> 'cancelada' AND COALESCE(p.frete_ignorado, 0) = 0 AND n.data_emissao >= ? AND n.data_emissao < ? GROUP BY mes`, [empresaId, de, ate],
  );
  const despesas = await db.all(
    `SELECT COALESCE(categoria, 'Outros') AS categoria, COALESCE(competencia, substr(vencimento,1,7)) AS mes, SUM(valor) AS v FROM contas_pagar
      WHERE empresa_id = ? AND status <> 'cancelado' AND COALESCE(competencia, substr(vencimento,1,7)) BETWEEN ? AND ?
        AND COALESCE(categoria, 'Outros') NOT IN ('${CATEGORIAS_CUSTO.join("','")}') AND compra_id IS NULL
      GROUP BY 1, 2`, empresaId, `${ano}-01`, `${ano}-12`,
  );
  const imp = Number(await C.obter('dre.impostos_pct')) || 0;
  const v = (m, x) => r2(x[m] || 0);
  const linha = (rotulo, fn, extra = {}) => ({ rotulo, valores: meses.map(fn), ...extra });
  const L = [];
  L.push(linha('Receita bruta (notas emitidas)', (m) => v(m, receita), { tipo: 'receita' }));
  L.push(linha('(−) Devoluções', (m) => -v(m, devolucoes)));
  L.push(linha(`(−) Impostos sobre a venda (${imp}%)`, (m) => -r2(v(m, receita) * imp / 100)));
  const liquida = meses.map((m) => r2(v(m, receita) - v(m, devolucoes) - v(m, receita) * imp / 100));
  L.push({ rotulo: '= Receita líquida', valores: liquida, total: true });
  L.push(linha('(−) Custo dos produtos vendidos', (m) => -v(m, cmv)));
  L.push(linha('(−) Comissões', (m) => -v(m, comissoes)));
  L.push(linha('(−) Fretes de entrega', (m) => -v(m, fretes)));
  const margem = meses.map((m, i) => r2(liquida[i] - v(m, cmv) - v(m, comissoes) - v(m, fretes)));
  L.push({ rotulo: '= Margem de contribuição', valores: margem, total: true });
  const cats = [...new Set(despesas.map((d) => d.categoria))].sort();
  const totDesp = meses.map(() => 0);
  for (const c of cats) {
    const vals = meses.map((m, i) => {
      const x = r2(despesas.filter((d) => d.categoria === c && d.mes === m).reduce((a, d) => a + d.v, 0));
      totDesp[i] += x;
      return -x;
    });
    L.push({ rotulo: `(−) ${c}`, valores: vals, despesa: true });
  }
  const resultado = meses.map((m, i) => r2(margem[i] - totDesp[i]));
  L.push({ rotulo: '= Resultado operacional', valores: resultado, total: true, final: true });
  L.push({ rotulo: 'Margem operacional (%)', valores: meses.map((m, i) => (v(m, receita) ? r2((resultado[i] / v(m, receita)) * 100) : null)), pct: true });
  for (const l of L) if (!l.pct) l.total_ano = r2(l.valores.reduce((a, x) => a + (x || 0), 0));
  return { ano, meses, linhas: L, observacoes: [
    'Receita pelo regime de competência (data de emissão da nota); custo pelo custo da embalagem gravado no pedido.',
    `Compras de ${CATEGORIAS_CUSTO.join(' e ')} e contas geradas por pedidos de compra não entram como despesa: viram estoque e saem no custo dos produtos vendidos.`,
    'Despesas pela competência da conta a pagar (ou pelo mês do vencimento quando não informada).',
  ] };
}

module.exports = { lerOfx, importarOfx, sugestoes, conciliar, conciliarAutomatico, fluxo, dre, saldoInicial, informarSaldo };
