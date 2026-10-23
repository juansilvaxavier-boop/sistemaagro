// Regras de negócio compartilhadas entre as rotas.
const crypto = require('node:crypto');
const db = require('./db');

class ErroNegocio extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const FUSO = 'America/Sao_Paulo';
/** Data de hoje no fuso de São Paulo (o servidor pode estar em UTC). */
function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}
function addDias(iso, dias) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
function diasEntre(a, b) {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400e3);
}
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Status efetivo da parcela (vencida é calculada). */
const STATUS_PARCELA_SQL = `CASE WHEN p.status = 'a_pagar' AND p.vencimento < date('now','localtime') THEN 'vencida' ELSE p.status END`;
const SALDO_PARCELA_SQL = `ROUND(p.valor + IFNULL(p.juros,0) - IFNULL(p.desconto,0) - IFNULL(p.valor_pago,0), 2)`;
// "negociada" = parcela substituída por um acordo (deixa de compor o saldo em aberto).
const ABERTA_SQL = `p.status IN ('a_pagar','acordo_judicial')`;

// ---------- Blacklist ----------
async function situacaoBlacklist(clienteId) {
  const itens = await db.all('SELECT * FROM blacklist WHERE cliente_id = ? AND ativo = 1 ORDER BY data_inclusao DESC', clienteId);
  return {
    bloqueio: itens.find((b) => b.tipo === 'bloqueio') || null,
    alertas: itens.filter((b) => b.tipo === 'alerta'),
  };
}

async function exigirClienteLiberado(clienteId) {
  const { bloqueio } = await situacaoBlacklist(clienteId);
  if (bloqueio) throw new ErroNegocio(`Cliente bloqueado na blacklist: ${bloqueio.motivo}`);
}

// ---------- Serasa (simulado) ----------
// Sem integração real: gera um resultado determinístico a partir do documento,
// para que a mesma consulta devolva sempre o mesmo resultado.
function simularSerasa(documento) {
  const h = crypto.createHash('sha256').update(String(documento)).digest();
  const score = 200 + (h.readUInt16BE(0) % 800);
  const restricoes = score < 400 ? 1 + (h[2] % 4) : score < 550 ? h[2] % 2 : 0;
  const valor = restricoes ? r2((h.readUInt16BE(3) % 20000) + 150) : 0;
  const resultado = score >= 700 ? 'Baixo risco' : score >= 500 ? 'Risco moderado' : 'Alto risco';
  return { score, restricoes, valor_restricoes: valor, resultado };
}

const VALIDADE_CONSULTA_DIAS = 30;

async function consultarSerasa({ clienteId, pedidoId, usuarioId, tipo = 'serasa', justificativa }) {
  const cliente = await db.get('SELECT id, documento FROM clientes WHERE id = ?', clienteId);
  if (!cliente) throw new ErroNegocio('Cliente não encontrado', 404);
  const recente = await db.get(
    `SELECT * FROM consultas_serasa WHERE cliente_id = ? AND tipo = ? AND created_at >= datetime('now','localtime', ?) ORDER BY id DESC`,
    clienteId, tipo, `-${VALIDADE_CONSULTA_DIAS} days`,
  );
  if (recente && !String(justificativa || '').trim()) {
    throw new ErroNegocio(
      `Já existe consulta de ${recente.created_at.slice(0, 10).split('-').reverse().join('/')}. Informe a justificativa para nova consulta.`,
      428,
    );
  }
  const r = simularSerasa(cliente.documento + (tipo === 'restricao' ? ':r' : ''));
  const id = await db.insert('consultas_serasa', {
    cliente_id: clienteId, pedido_id: pedidoId, usuario_id: usuarioId, tipo, justificativa, ...r,
  });
  return await db.get('SELECT * FROM consultas_serasa WHERE id = ?', id);
}

// ---------- Pedido ----------
async function recalcularPedido(pedidoId) {
  const ped = await db.get('SELECT * FROM pedidos WHERE id = ?', pedidoId);
  const soma = (await db.get('SELECT IFNULL(SUM(valor_total),0) AS v FROM pedido_itens WHERE pedido_id = ? AND brinde = 0', pedidoId)).v;
  const cond = ped.condicao_id ? await db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', ped.condicao_id) : null;
  const desconto = r2(soma * ((cond?.desconto_pct || 0) / 100));
  await db.run(
    `UPDATE pedidos SET valor_produtos = ?, valor_desconto = ?, valor_total = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    r2(soma), desconto, r2(soma - desconto), pedidoId,
  );
}

async function registrarHistorico(pedidoId, { origem, destino, acao, observacao, usuarioId }) {
  await db.insert('pedido_historico', {
    pedido_id: pedidoId, etapa_origem: origem, etapa_destino: destino, acao, observacao, usuario_id: usuarioId,
  });
}

/** Comissões padrão do pedido: vendedor e supervisor com o % do cadastro do usuário. */
async function garantirComissoes(pedido) {
  const existentes = (await db.get('SELECT COUNT(*) AS n FROM pedido_comissoes WHERE pedido_id = ?', pedido.id)).n;
  if (existentes) return;
  const pessoas = [
    [pedido.vendedor_id, 'vendedor'],
    [pedido.supervisor_id, 'supervisor'],
  ];
  for (const [uid, papel] of pessoas) {
    if (!uid) continue;
    const u = await db.get('SELECT comissao_pct FROM usuarios WHERE id = ?', uid);
    const pct = u?.comissao_pct || 0;
    if (!pct) continue;
    await db.insert('pedido_comissoes', {
      pedido_id: pedido.id, usuario_id: uid, papel, percentual: pct, valor: r2((pedido.valor_total * pct) / 100),
    });
  }
}

// ---------- Faturamento ----------
async function emitirNota(pedido, usuarioId) {
  if (await db.get(`SELECT id FROM notas_fiscais WHERE pedido_id = ? AND status <> 'cancelada'`, pedido.id)) {
    throw new ErroNegocio('Pedido já possui nota fiscal emitida.');
  }
  const numero = await db.nextSeq(`nfe_${pedido.empresa_id}`, 1);
  const empresa = await db.get('SELECT * FROM empresas WHERE id = ?', pedido.empresa_id);
  const chave = gerarChaveNfe(empresa, numero);
  const notaId = await db.insert('notas_fiscais', {
    numero, serie: 1, empresa_id: pedido.empresa_id, pedido_id: pedido.id, cliente_id: pedido.cliente_id,
    valor: pedido.valor_total, chave,
  });
  await gerarParcelas(pedido, notaId);
  await gerarComissoesFaturamento(pedido);
  return await db.get('SELECT * FROM notas_fiscais WHERE id = ?', notaId);
}

function gerarChaveNfe(empresa, numero) {
  const cnpj = String(empresa?.cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
  const d = new Date();
  const base = `35${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${cnpj}55001${String(numero).padStart(9, '0')}1${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return base + (dv >= 10 ? 0 : dv);
}

async function gerarParcelas(pedido, notaId) {
  const cond = pedido.condicao_id ? await db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', pedido.condicao_id) : null;
  const forma = pedido.forma_id ? await db.get('SELECT * FROM formas_pagamento WHERE id = ?', pedido.forma_id) : null;
  const n = Math.max(cond?.parcelas || 1, 1);
  const base = hoje();
  const valorParcela = Math.floor((pedido.valor_total / n) * 100) / 100;
  for (let i = 0; i < n; i++) {
    const valor = i === n - 1 ? r2(pedido.valor_total - valorParcela * (n - 1)) : valorParcela;
    const venc = forma?.tipo === 'a_vista' ? base : addDias(base, (cond?.carencia_dias ?? 30) + i * (cond?.intervalo_dias ?? 30));
    const pago = forma?.tipo === 'a_vista' && pedido.pagamento_confirmado_em;
    await db.insert('parcelas', {
      pedido_id: pedido.id, nota_id: notaId, cliente_id: pedido.cliente_id, empresa_id: pedido.empresa_id,
      numero: i + 1, total_parcelas: n, vencimento: venc, vencimento_original: venc, valor,
      status: pago ? 'liquidada' : 'a_pagar',
      valor_pago: pago ? valor : 0,
      data_pagamento: pago ? pedido.pagamento_confirmado_em.slice(0, 10) : null,
      tipo_baixa: pago ? forma.tipo_baixa || 'PIX' : forma?.tipo_baixa || 'boleto',
      nosso_numero: String(await db.nextSeq('nosso_numero', 100000)),
    });
  }
}

async function gerarComissoesFaturamento(pedido) {
  await garantirComissoes(pedido);
  const periodo = hoje().slice(0, 7);
  for (const c of await db.all('SELECT pc.*, u.perfil FROM pedido_comissoes pc JOIN usuarios u ON u.id = pc.usuario_id WHERE pedido_id = ?', pedido.id)) {
    await db.insert('comissoes', {
      usuario_id: c.usuario_id, periodo, perfil: c.perfil, tipo_comissao: c.papel === 'supervisor' ? 'supervisao' : 'venda',
      empresa_id: pedido.empresa_id, pedido_id: pedido.id, valor_base: pedido.valor_total, percentual: c.percentual,
      valor: c.valor, status: 'aberta',
    });
  }
}

// ---------- Parcelas ----------
async function eventoParcela(parcelaId, tipo, descricao, usuarioId) {
  await db.insert('parcela_eventos', { parcela_id: parcelaId, tipo, descricao, usuario_id: usuarioId });
}

async function baixarParcela(id, dados, usuarioId) {
  const p = await db.get('SELECT * FROM parcelas WHERE id = ?', id);
  if (!p) throw new ErroNegocio('Parcela não encontrada', 404);
  if (['liquidada', 'cancelada', 'devolvida', 'negociada'].includes(p.status)) throw new ErroNegocio('Parcela não está em aberto.');
  const dataPg = dados.data_pagamento || hoje();
  const juros = r2(dados.juros ?? p.juros);
  const desconto = r2(dados.desconto ?? p.desconto);
  const devido = r2(p.valor + juros - desconto - p.valor_pago);
  const pago = r2(dados.valor_pago ?? devido);
  if (pago <= 0) throw new ErroNegocio('Informe o valor pago.');
  const totalPago = r2(p.valor_pago + pago);
  const liquidou = totalPago >= r2(p.valor + juros - desconto) - 0.009;
  await db.update('parcelas', id, {
    juros, desconto, valor_pago: totalPago, data_pagamento: dataPg,
    status: liquidou ? 'liquidada' : p.status, tipo_baixa: dados.tipo_baixa || p.tipo_baixa, banco_id: dados.banco_id || p.banco_id,
  });
  await eventoParcela(id, liquidou ? 'baixa' : 'baixa_parcial', `Pago ${pago.toFixed(2)} via ${dados.tipo_baixa || p.tipo_baixa || '-'} em ${dataPg}`, usuarioId);

  if (liquidou) {
    await aplicarPenalidadeComissao(p, dataPg);
    // Título negativado quitado: solicita baixa no Serasa automaticamente.
    const neg = await db.get(`SELECT * FROM negativacoes WHERE parcela_id = ? AND status = 'inclusao_aceita'`, id);
    if (neg) {
      await db.run(`UPDATE negativacoes SET status = 'baixa_solicitada', updated_at = datetime('now','localtime') WHERE id = ?`, neg.id);
    }
  }
  return await db.get('SELECT * FROM parcelas WHERE id = ?', id);
}

/** Perda de % da comissão por faixa de dias de atraso (cadastro da forma de pagamento). */
async function aplicarPenalidadeComissao(parcela, dataPagamento) {
  const atraso = diasEntre(parcela.vencimento_original || parcela.vencimento, dataPagamento);
  if (atraso <= 0 || !parcela.pedido_id) return 0;
  const ped = await db.get('SELECT forma_id FROM pedidos WHERE id = ?', parcela.pedido_id);
  const pen = await db.get(
    'SELECT perda_pct FROM penalidades_comissao WHERE forma_id = ? AND ? BETWEEN dias_de AND dias_ate ORDER BY perda_pct DESC',
    ped?.forma_id, atraso,
  );
  if (!pen) return 0;
  await db.run(
    `UPDATE comissoes SET perda_pct = GREATEST(perda_pct, ?), valor = ROUND(valor_base * percentual / 100 * (1 - GREATEST(perda_pct, ?) / 100), 2),
       observacao = 'Penalidade por atraso de ' || ?::text || ' dias'
     WHERE pedido_id = ? AND status = 'aberta'`,
    pen.perda_pct, pen.perda_pct, atraso, parcela.pedido_id,
  );
  return pen.perda_pct;
}

async function prorrogarParcela(id, { vencimento, juros, motivo }, usuarioId) {
  const p = await db.get('SELECT * FROM parcelas WHERE id = ?', id);
  if (!p) throw new ErroNegocio('Parcela não encontrada', 404);
  if (!['a_pagar', 'acordo_judicial'].includes(p.status)) throw new ErroNegocio('Só é possível prorrogar parcelas em aberto.');
  if (!vencimento) throw new ErroNegocio('Informe o novo vencimento.');
  await db.update('parcelas', id, { vencimento, juros: r2((p.juros || 0) + (Number(juros) || 0)), prorrogacoes: p.prorrogacoes + 1 });
  await eventoParcela(id, 'prorrogacao', `De ${p.vencimento} para ${vencimento}. ${motivo || ''}`.trim(), usuarioId);
}

// ---------- Devolução ----------
async function registrarDevolucao(dados, usuarioId) {
  const nota = await db.get('SELECT * FROM notas_fiscais WHERE id = ?', dados.nota_id);
  if (!nota) throw new ErroNegocio('Nota fiscal não encontrada', 404);
  if (nota.status === 'cancelada') throw new ErroNegocio('Nota cancelada não aceita devolução.');
  const valor = r2(dados.total ? nota.valor : dados.valor);
  if (!(valor > 0)) throw new ErroNegocio('Informe o valor da devolução.');
  if (!dados.motivo) throw new ErroNegocio('Informe o motivo.');
  const jaDevolvido = (await db.get('SELECT IFNULL(SUM(valor),0) AS v FROM devolucoes WHERE nota_id = ?', nota.id)).v;
  if (r2(jaDevolvido + valor) > nota.valor + 0.009) throw new ErroNegocio('Valor devolvido excede o valor da nota.');

  const id = await db.insert('devolucoes', {
    nota_id: nota.id, pedido_id: nota.pedido_id, motivo: dados.motivo, tipo: dados.tipo || 'mercadoria',
    valor, frete: r2(dados.frete), total: dados.total ? 1 : 0, baixa_parcelas: dados.baixa_parcelas === false ? 0 : 1, usuario_id: usuarioId,
  });
  const total = dados.total || r2(jaDevolvido + valor) >= nota.valor - 0.009;
  await db.run('UPDATE notas_fiscais SET status = ? WHERE id = ?', total ? 'devolvida' : 'devolvida_parcial', nota.id);

  if (dados.baixa_parcelas !== false) {
    // Abate o valor devolvido das parcelas em aberto, da última para a primeira.
    let restante = valor;
    const abertas = await db.all(`SELECT * FROM parcelas p WHERE nota_id = ? AND ${ABERTA_SQL} ORDER BY numero DESC`, nota.id);
    for (const p of abertas) {
      if (restante <= 0) break;
      const saldo = r2(p.valor - p.valor_pago);
      const abate = Math.min(saldo, restante);
      restante = r2(restante - abate);
      if (abate >= saldo - 0.009) {
        await db.run(`UPDATE parcelas SET status = 'devolvida', valor = valor_pago WHERE id = ?`, p.id);
      } else {
        await db.run('UPDATE parcelas SET valor = ROUND(valor - ?::float8, 2) WHERE id = ?', abate, p.id);
      }
      await eventoParcela(p.id, 'devolucao', `Abatido ${abate.toFixed(2)} pela devolução #${id}`, usuarioId);
    }
  }

  if (nota.pedido_id) {
    const ped = await db.get('SELECT * FROM pedidos WHERE id = ?', nota.pedido_id);
    await db.run(
      `UPDATE comissoes SET valor = GREATEST(0, ROUND(valor - percentual / 100.0 * ? * (1 - perda_pct / 100.0), 2)), observacao = 'Ajustada por devolução'
        WHERE pedido_id = ? AND status = 'aberta'`,
      valor, ped.id,
    );
    if (total) {
      await registrarHistorico(ped.id, { origem: ped.etapa, destino: 'devolucao', acao: 'Devolução total', observacao: dados.motivo, usuarioId });
      await db.run(`UPDATE pedidos SET etapa = 'devolucao', etapa_desde = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`, ped.id);
    } else {
      await registrarHistorico(ped.id, { origem: ped.etapa, destino: ped.etapa, acao: 'Devolução parcial', observacao: `${dados.motivo} (R$ ${valor.toFixed(2)})`, usuarioId });
    }
  }
  return await db.get('SELECT * FROM devolucoes WHERE id = ?', id);
}

module.exports = {
  ErroNegocio, hoje, addDias, diasEntre, r2,
  STATUS_PARCELA_SQL, SALDO_PARCELA_SQL, ABERTA_SQL,
  situacaoBlacklist, exigirClienteLiberado, simularSerasa, consultarSerasa,
  recalcularPedido, registrarHistorico, garantirComissoes, emitirNota, gerarParcelas,
  baixarParcela, prorrogarParcela, aplicarPenalidadeComissao, eventoParcela, registrarDevolucao,
};
