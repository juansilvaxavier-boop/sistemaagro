// Fluxo do pedido de venda: etapas, ações permitidas e validações de passagem.
const db = require('./db');
const sse = require('./sse');
const S = require('./services');
const { can } = require('./auth');

const ETAPAS = {
  venda: { label: 'Vendedor', perfil: 'vendedor', fila: 'fila.venda', icone: 'bi-cart' },
  supervisao: { label: 'Supervisor', perfil: 'supervisor', fila: 'fila.supervisao', icone: 'bi-person-check' },
  analise: { label: 'Análise', perfil: 'analista', fila: 'fila.analise', icone: 'bi-search' },
  diretoria: { label: 'Diretoria', perfil: 'diretoria', fila: 'fila.diretoria', icone: 'bi-award' },
  cobranca: { label: 'Cobrança (à vista)', perfil: 'financeiro', fila: 'fila.cobranca', icone: 'bi-cash-coin' },
  producao: { label: 'Produção', perfil: 'producao', fila: 'fila.producao', icone: 'bi-gear' },
  faturamento: { label: 'Faturamento', perfil: 'faturamento', fila: 'fila.faturamento', icone: 'bi-receipt' },
  expedicao: { label: 'Expedição', perfil: 'expedicao', fila: 'fila.expedicao', icone: 'bi-box-seam' },
  transito: { label: 'Expedição – Trânsito', perfil: 'expedicao', fila: 'fila.transito', icone: 'bi-truck' },
  entregue: { label: 'Entregue', perfil: null, fila: 'fila.transito', icone: 'bi-check2-circle' },
  devolucao: { label: 'Devolução', perfil: 'financeiro', fila: 'fila.devolucao', icone: 'bi-arrow-return-left' },
  cancelado: { label: 'Cancelado', perfil: null, fila: null, icone: 'bi-x-circle' },
};

// Regras de desvio entre etapas. O levantamento não mostra essas regras,
// por isso ficam centralizadas aqui para ajuste com quem usa o sistema.
const REGRAS = {
  // Pedido de vendedor sem supervisor vai direto para a Análise.
  pularSupervisaoSemSupervisor: true,
  // Pedidos com valor abaixo deste limite pulam a Diretoria (0 = todos passam).
  diretoriaAPartirDe: Number(process.env.DIRETORIA_A_PARTIR_DE || 0),
  // Pagamento à vista aguarda confirmação na Cobrança antes da Produção.
  aVistaPassaPelaCobranca: true,
};

function destinoAposAnalise(p) {
  if (p.valor_total >= REGRAS.diretoriaAPartirDe) return 'diretoria';
  return destinoAposDiretoria(p);
}
function destinoAposDiretoria(p) {
  const forma = p.forma_id ? db.get('SELECT tipo FROM formas_pagamento WHERE id = ?', p.forma_id) : null;
  if (REGRAS.aVistaPassaPelaCobranca && forma?.tipo === 'a_vista' && !p.pagamento_confirmado_em) return 'cobranca';
  return 'producao';
}

const avanca = true;
// Ações por etapa. "destino" pode ser função do pedido; "validar" lança ErroNegocio.
const ACOES = {
  venda: {
    enviar: {
      label: 'Enviar pedido', avanca,
      destino: (p) => (p.supervisor_id || !REGRAS.pularSupervisaoSemSupervisor ? 'supervisao' : 'analise'),
      validar: validarPedidoCompleto,
    },
    cancelar: { label: 'Cancelar pedido', destino: 'cancelado', exigeObs: true },
  },
  supervisao: {
    aprovar: { label: 'Aprovar', avanca, destino: 'analise' },
    devolver: { label: 'Devolver ao vendedor', destino: 'venda', exigeObs: true },
    cancelar: { label: 'Cancelar', destino: 'cancelado', exigeObs: true },
  },
  analise: {
    aprovar: { label: 'Aprovar crédito', avanca, destino: destinoAposAnalise, validar: validarAnalise },
    devolver: { label: 'Devolver ao vendedor', destino: 'venda', exigeObs: true },
    reprovar: { label: 'Reprovar crédito', destino: 'cancelado', exigeObs: true },
  },
  diretoria: {
    aprovar: { label: 'Aprovação final', avanca, destino: destinoAposDiretoria, aoExecutar: (p) => S.garantirComissoes(p) },
    devolver: { label: 'Devolver à análise', destino: 'analise', exigeObs: true },
    reprovar: { label: 'Reprovar', destino: 'cancelado', exigeObs: true },
  },
  cobranca: {
    confirmar_pagamento: {
      label: 'Confirmar pagamento', avanca, destino: 'producao',
      aoExecutar: (p) => db.run(`UPDATE pedidos SET pagamento_confirmado_em = datetime('now','localtime') WHERE id = ?`, p.id),
    },
    cancelar: { label: 'Cancelar (sem pagamento)', destino: 'cancelado', exigeObs: true },
  },
  producao: {
    concluir: { label: 'Concluir produção', avanca, destino: 'faturamento', validar: validarLotes },
  },
  faturamento: {
    faturar: {
      label: 'Emitir nota fiscal', avanca, destino: 'expedicao', validar: validarFaturamento,
      aoExecutar: (p, user) => S.emitirNota(p, user.id),
    },
    devolver: { label: 'Devolver à produção', destino: 'producao', exigeObs: true },
  },
  expedicao: {
    embarcar: { label: 'Registrar embarque', avanca, destino: 'transito', validar: validarEmbarque },
  },
  transito: {
    entregar: { label: 'Confirmar entrega', avanca, destino: 'entregue', validar: validarEntrega },
  },
  devolucao: {},
  entregue: {},
  cancelado: {},
};

function validarPedidoCompleto(p) {
  const itens = db.get('SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ?', p.id).n;
  if (!itens) throw new S.ErroNegocio('Inclua ao menos um item no pedido.');
  if (!p.forma_id || !p.condicao_id) throw new S.ErroNegocio('Informe a forma e a condição de pagamento.');
  const cond = db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', p.condicao_id);
  if (cond?.valor_minimo && p.valor_total < cond.valor_minimo) {
    throw new S.ErroNegocio(`Valor mínimo para a condição "${cond.descricao}" é R$ ${cond.valor_minimo.toFixed(2)}.`);
  }
  if (!p.endereco_entrega_id && p.tipo_entrega !== 'retirada') throw new S.ErroNegocio('Informe o endereço de entrega.');
}

function validarAnalise(p) {
  const consulta = db.get(`SELECT id FROM consultas_serasa WHERE cliente_id = ? AND created_at >= datetime('now','localtime','-30 days')`, p.cliente_id);
  if (!consulta) throw new S.ErroNegocio('Faça a consulta Serasa do cliente antes de aprovar.');
  if (p.tipo_entrega === 'transportadora' && !p.frete_ignorado && !(p.transportadora_id && p.frete_valor != null)) {
    throw new S.ErroNegocio('Registre a cotação de frete ou ignore informando o motivo.');
  }
}

function validarLotes(p) {
  const sem = db.get(`SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id = ? AND (lote IS NULL OR lote = '')`, p.id).n;
  if (sem) throw new S.ErroNegocio(`Informe o lote de todos os itens (${sem} sem lote).`);
}

function validarFaturamento(p) {
  if (!p.endereco_entrega_id && p.tipo_entrega !== 'retirada') throw new S.ErroNegocio('Informe o endereço de entrega antes de faturar.');
}

function validarEmbarque(p) {
  if (!p.data_embarque || !p.data_entrega_prevista) throw new S.ErroNegocio('Informe a data de embarque e a data de entrega prevista.');
}

function validarEntrega(p) {
  if (!p.data_entrega) throw new S.ErroNegocio('Informe a data de entrega.');
}

function acoesDisponiveis(pedido, user) {
  const etapa = ETAPAS[pedido.etapa];
  if (!etapa?.fila || !can(user.perfil, etapa.fila)) return [];
  return Object.entries(ACOES[pedido.etapa] || {}).map(([id, a]) => ({ id, label: a.label, avanca: !!a.avanca, exigeObs: !!a.exigeObs }));
}

function executar(pedidoId, acaoId, user, observacao) {
  return db.tx(() => {
    const p = db.get('SELECT * FROM pedidos WHERE id = ?', pedidoId);
    if (!p) throw new S.ErroNegocio('Pedido não encontrado', 404);
    const etapa = ETAPAS[p.etapa];
    const acao = ACOES[p.etapa]?.[acaoId];
    if (!acao) throw new S.ErroNegocio(`Ação "${acaoId}" não disponível na etapa ${etapa?.label || p.etapa}.`);
    if (!can(user.perfil, etapa.fila)) throw new S.ErroNegocio('Seu perfil não atua nesta etapa.', 403);
    if (user.perfil === 'vendedor' && p.vendedor_id !== user.id) throw new S.ErroNegocio('Pedido de outro vendedor.', 403);
    if (acao.exigeObs && !String(observacao || '').trim()) throw new S.ErroNegocio('Informe o motivo/observação.');

    if (acao.avanca) S.exigirClienteLiberado(p.cliente_id);
    if (acao.validar) acao.validar(p);

    const destino = typeof acao.destino === 'function' ? acao.destino(p) : acao.destino;
    const extra = acao.aoExecutar ? acao.aoExecutar(p, user) : null;
    const campos = [`etapa = ?`, `etapa_desde = datetime('now','localtime')`, `updated_at = datetime('now','localtime')`];
    const params = [destino];
    if (p.etapa === 'analise' && acao.avanca) campos.push('analista_id = ?'), params.push(user.id);
    if (destino === 'producao') {
      campos.push(`data_chegada_producao = datetime('now','localtime')`);
      campos.push('prazo_producao = ?');
      params.push(S.addDias(S.hoje(), prazoProducao(p.id)));
    }
    db.run(`UPDATE pedidos SET ${campos.join(', ')} WHERE id = ?`, ...params, p.id);
    S.registrarHistorico(p.id, { origem: p.etapa, destino, acao: acao.label, observacao, usuarioId: user.id });
    if (observacao) db.insert('pedido_comentarios', { pedido_id: p.id, usuario_id: user.id, etapa: p.etapa, texto: `[${acao.label}] ${observacao}` });

    notificarEtapa(p, destino, user, acao.label);
    return { destino, nota: extra && extra.numero ? extra : undefined };
  });
}

function prazoProducao(pedidoId) {
  const r = db.get(
    'SELECT MAX(IFNULL(pr.prazo_producao_dias,3)) AS d FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id WHERE i.pedido_id = ?',
    pedidoId,
  );
  return r?.d || 3;
}

function notificarEtapa(p, destino, user, acao) {
  const info = ETAPAS[destino];
  const dados = { pedido_id: p.id, numero: p.numero, etapa: destino, etapa_label: info?.label, acao, por: user.nome };
  if (info?.perfil) sse.enviar('pedido', dados, { perfis: [info.perfil], exceto: user.id });
  sse.enviar('pedido', dados, { usuarios: [p.vendedor_id, p.supervisor_id].filter(Boolean), exceto: user.id });
}

module.exports = { ETAPAS, ACOES, REGRAS, acoesDisponiveis, executar };
