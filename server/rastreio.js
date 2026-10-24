// Rastreio automático dos pedidos em trânsito: consulta o código de rastreio na transportadora integrada,
// grava os eventos e, quando a entrega é confirmada, conclui o pedido sozinho (Em trânsito → Entregue).
const db = require('./db');
const S = require('./services');
const INT = require('./integracoes/index');

const SRO = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
const SISTEMA = { id: null, nome: 'Rastreio automático', perfil: 'admin', permissoesEfetivas: ['*'] };

/** Provedor que rastreia o pedido: código no padrão dos Correios ou transportadora ligada à integração dos Correios. */
async function provedorDo(p) {
  const cod = String(p.codigo_rastreio || '').trim().toUpperCase();
  if (!cod) return null;
  if ((await INT.modo('correios', p.empresa_id)) === 'desligada') return null;
  if (SRO.test(cod)) return 'correios';
  const { config } = await INT.carregar('correios', p.empresa_id);
  if (config.transportadora_id && config.transportadora_id === p.transportadora_id) return 'correios';
  const t = p.transportadora_id ? await db.get('SELECT nome FROM transportadoras WHERE id = ?', p.transportadora_id) : null;
  return /correio/i.test(t?.nome || '') ? 'correios' : null;
}

async function rastrearPedido(pedidoId, { usuarioId } = {}) {
  const p = await db.get('SELECT * FROM pedidos WHERE id = ?', Number(pedidoId));
  if (!p) throw new S.ErroNegocio('Pedido não encontrado.', 404);
  const prov = await provedorDo(p);
  if (!prov) throw new S.ErroNegocio(p.codigo_rastreio ? 'A transportadora deste pedido não tem rastreio integrado (ligue a integração dos Correios).' : 'Pedido sem código de rastreio.');
  const eventos = await INT.executar(prov, p.empresa_id, 'rastrear', (ctx) => require('./integracoes/frete')[prov].rastrear(ctx, String(p.codigo_rastreio).trim().toUpperCase(), {
    embarque: p.data_embarque, prazo: p.data_embarque && p.data_entrega_prevista ? Math.max(1, S.diasEntre(p.data_embarque, p.data_entrega_prevista)) : 4,
  }), { referencia: `pedido ${p.numero}`, usuarioId });
  let novos = 0;
  for (const e of eventos) {
    if (!e.data) continue;
    const r = await db.run(
      'INSERT INTO pedido_rastreio (pedido_id, data, descricao, local, entregue, origem) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (pedido_id, data, descricao) DO NOTHING',
      p.id, e.data, String(e.descricao).slice(0, 250), e.local || null, e.entregue ? 1 : 0, prov,
    );
    novos += r.changes || 0;
  }
  const ultimo = eventos[0];
  const entrega = eventos.find((e) => e.entregue);
  await db.run(`UPDATE pedidos SET rastreio_status = ?, rastreio_atualizado_em = datetime('now','localtime') WHERE id = ?`, ultimo?.descricao || 'Sem eventos ainda', p.id);
  let concluido = false;
  if (entrega && p.etapa === 'transito') {
    await db.run('UPDATE pedidos SET data_entrega = ? WHERE id = ?', entrega.data.slice(0, 10), p.id);
    await require('./workflow').executar(p.id, 'entregar', SISTEMA, `Entrega confirmada pelo rastreio (${prov === 'correios' ? 'Correios' : prov}) em ${entrega.data.slice(0, 10).split('-').reverse().join('/')}.`);
    concluido = true;
  }
  return { pedido_id: p.id, eventos: eventos.length, novos, status: ultimo?.descricao || null, entregue: !!entrega, concluido };
}

/** Rotina: rastreia todos os pedidos em trânsito com código (por empresa). */
async function atualizarTodos(empresaId, { usuarioId } = {}) {
  const rows = await db.all(
    `SELECT id FROM pedidos WHERE etapa = 'transito' AND codigo_rastreio IS NOT NULL AND codigo_rastreio <> '' ${empresaId ? 'AND empresa_id = ?' : ''}
      ORDER BY COALESCE(rastreio_atualizado_em, '') LIMIT 200`, ...(empresaId ? [empresaId] : []),
  );
  const out = { consultados: 0, entregues: 0, sem_integracao: 0, erros: 0 };
  for (const x of rows) {
    try {
      const r = await rastrearPedido(x.id, { usuarioId });
      out.consultados++;
      if (r.concluido) out.entregues++;
    } catch (e) {
      if (/não tem rastreio integrado|sem código/i.test(e.message)) out.sem_integracao++; else out.erros++;
    }
  }
  return out;
}

const eventos = (pedidoId) => db.all('SELECT data, descricao, local, entregue, origem FROM pedido_rastreio WHERE pedido_id = ? ORDER BY data DESC, id DESC', pedidoId);

module.exports = { rastrearPedido, atualizarTodos, eventos, SRO };
