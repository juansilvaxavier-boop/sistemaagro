// Boletos das parcelas pelo banco integrado (Cora): emissão manual ou ao faturar, consulta com baixa
// automática quando o banco confirma o pagamento, e cancelamento.
const db = require('../db');
const S = require('../services');
const INT = require('./index');

const { ErroNegocio } = S;
const ABERTA = ['a_pagar', 'acordo_judicial'];
const PAGO = ['PAID'];
const CANCELADO = ['CANCELLED', 'CANCELED'];

async function parcelaCompleta(id) {
  const p = await db.get(
    `SELECT p.*, c.nome AS cliente, c.documento, c.email, pe.numero AS pedido_numero
       FROM parcelas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN pedidos pe ON pe.id = p.pedido_id WHERE p.id = ?`, Number(id),
  );
  if (!p) throw new ErroNegocio('Parcela não encontrada.', 404);
  return p;
}

async function emitir(parcelaId, { empresaId, usuarioId } = {}) {
  const p = await parcelaCompleta(parcelaId);
  const emp = p.empresa_id || empresaId;
  if (!ABERTA.includes(p.status)) throw new ErroNegocio(`Parcela ${p.numero} não está em aberto.`);
  if (p.boleto_id && !CANCELADO.includes(p.boleto_status)) throw new ErroNegocio(`A parcela ${p.numero} já tem boleto emitido.`);
  const saldo = S.r2(p.valor + (p.juros || 0) - (p.desconto || 0) - (p.valor_pago || 0));
  const venc = p.vencimento < S.hoje() ? S.hoje() : p.vencimento;
  const end = await db.get('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id LIMIT 1', p.cliente_id);
  const r = await INT.executar('cora', emp, 'emitir_boleto', (ctx) => require('./cora').emitir(ctx, {
    codigo: `P${p.id}`, valor: saldo, vencimento: venc,
    descricao: `${p.pedido_numero ? `Pedido ${p.pedido_numero} - ` : ''}parcela ${p.numero}/${p.total_parcelas || 1}`,
    cliente: { nome: p.cliente, documento: p.documento, email: p.email, endereco: end },
  }), { referencia: `parcela ${p.id}`, usuarioId });
  await db.update('parcelas', p.id, {
    boleto_provedor: 'cora', boleto_id: r.id, boleto_status: r.status || 'OPEN', boleto_linha: r.linha, boleto_codigo_barras: r.codigo_barras,
    boleto_url: r.url, boleto_pix: r.pix, boleto_emitido_em: S.agora(), tipo_baixa: 'boleto',
  });
  await db.insert('parcela_eventos', { parcela_id: p.id, tipo: 'boleto', descricao: `Boleto emitido no banco Cora (${r.id}) com vencimento ${venc.split('-').reverse().join('/')}`, usuario_id: usuarioId || null }, null, { auditoria: false });
  return { parcela_id: p.id, ...r };
}

/** Consulta o banco; se pago, dá baixa na parcela (com a data e o valor do banco). */
async function sincronizar(parcelaId, { usuarioId, pagoSimulado } = {}) {
  const p = await parcelaCompleta(parcelaId);
  if (!p.boleto_id) throw new ErroNegocio('Parcela sem boleto emitido.');
  const saldo = S.r2(p.valor + (p.juros || 0) - (p.desconto || 0) - (p.valor_pago || 0));
  const r = await INT.executar('cora', p.empresa_id, 'consultar_boleto', (ctx) => require('./cora').consultar(ctx, p.boleto_id, { pagoSimulado, valor: saldo }), { referencia: `parcela ${p.id}`, usuarioId });
  let baixou = false;
  if (PAGO.includes(r.status) && ABERTA.includes(p.status)) {
    await db.tx(async () => {
      // Pago acima do saldo = juros/multa cobrados pelo banco.
      const pago = r.valor_pago > 0 ? S.r2(r.valor_pago) : saldo;
      await S.baixarParcela(p.id, {
        data_pagamento: (r.pago_em || S.hoje()).slice(0, 10), valor_pago: pago, tipo_baixa: 'boleto',
        juros: pago > saldo ? S.r2((p.juros || 0) + pago - saldo) : undefined,
      }, usuarioId || null);
      await db.run('UPDATE parcelas SET boleto_status = ? WHERE id = ?', r.status, p.id);
    });
    baixou = true;
  } else if (r.status && r.status !== p.boleto_status) {
    await db.run('UPDATE parcelas SET boleto_status = ? WHERE id = ?', r.status, p.id);
  }
  return { parcela_id: p.id, status: r.status, baixou };
}

async function cancelar(parcelaId, { usuarioId } = {}) {
  const p = await parcelaCompleta(parcelaId);
  if (!p.boleto_id || CANCELADO.includes(p.boleto_status)) throw new ErroNegocio('Parcela sem boleto ativo.');
  if (PAGO.includes(p.boleto_status)) throw new ErroNegocio('Boleto já pago não pode ser cancelado.');
  await INT.executar('cora', p.empresa_id, 'cancelar_boleto', (ctx) => require('./cora').cancelar(ctx, p.boleto_id), { referencia: `parcela ${p.id}`, usuarioId });
  await db.run(`UPDATE parcelas SET boleto_status = 'CANCELLED' WHERE id = ?`, p.id);
  await db.insert('parcela_eventos', { parcela_id: p.id, tipo: 'boleto', descricao: `Boleto ${p.boleto_id} cancelado no banco`, usuario_id: usuarioId || null }, null, { auditoria: false });
  return { ok: true };
}

/** Depois do faturamento: emite os boletos das parcelas por boleto, se a Cora estiver configurada para isso. Erros não travam o faturamento. */
async function aposFaturar(pedidoId, usuarioId) {
  const ped = await db.get('SELECT empresa_id FROM pedidos WHERE id = ?', pedidoId);
  if (!ped || (await INT.modo('cora', ped.empresa_id)) === 'desligada') return [];
  const { config } = await INT.carregar('cora', ped.empresa_id);
  if (!config.emitir_ao_faturar) return [];
  const parcelas = await db.all(`SELECT id FROM parcelas WHERE pedido_id = ? AND status = 'a_pagar' AND COALESCE(tipo_baixa, 'boleto') = 'boleto' AND boleto_id IS NULL ORDER BY numero`, pedidoId);
  const out = [];
  for (const x of parcelas) {
    try { out.push(await emitir(x.id, { usuarioId })); } catch (e) { out.push({ parcela_id: x.id, erro: e.message }); }
  }
  return out;
}

/** Rotina diária: consulta os boletos em aberto e dá baixa nos pagos. */
async function sincronizarAbertos(empresaId, limite = 200) {
  if (['desligada', 'simulacao'].includes(await INT.modo('cora', empresaId))) return { consultados: 0, baixados: 0 };
  const rows = await db.all(
    `SELECT id FROM parcelas WHERE empresa_id = ? AND boleto_provedor = 'cora' AND boleto_id IS NOT NULL AND status IN ('a_pagar','acordo_judicial')
       AND COALESCE(boleto_status, 'OPEN') NOT IN ('PAID','CANCELLED','CANCELED') ORDER BY vencimento LIMIT ?`, empresaId, limite,
  );
  let baixados = 0;
  for (const x of rows) {
    try { if ((await sincronizar(x.id)).baixou) baixados++; } catch { /* registrado no log da integração */ }
  }
  return { consultados: rows.length, baixados };
}

module.exports = { emitir, sincronizar, cancelar, aposFaturar, sincronizarAbertos };
