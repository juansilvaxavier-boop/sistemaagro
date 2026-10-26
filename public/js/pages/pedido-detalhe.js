// Janela do pedido: resumo, ações da etapa, comentários, mensagens, histórico, financeiro e arquivos.
import {
  get, post, put, esc, fmt, modal, abas, campo, opcoes, lerForm, toast, erro, tentar, state, badgeEtapa, tabelaSimples, pedirTexto, ROTULOS, pode, botaoAjuda,
} from '../core.js';
import { painelArquivos } from './arquivos.js';

const FLUXO = ['venda', 'supervisao', 'analise', 'diretoria', 'cobranca', 'producao', 'faturamento', 'expedicao', 'transito', 'entregue'];

export async function abrirPedido(id, aoMudar) {
  let d;
  try { d = await get(`/api/pedidos/${id}`); } catch (e) { return erro(e); }
  const p = d.pedido;
  const atualizar = () => { m.close(); aoMudar?.(); window.atualizarContadores?.(); };

  // Na Diretoria, a primeira aba reúne o pedido completo para a decisão final.
  const diretoria = p.etapa === 'diretoria' && d.acoes.length > 0;
  const lista = [
    ...(diretoria ? [{ id: 'dir', label: '<i class="bi bi-award"></i> Visão da diretoria', html: painelDiretoria(d) }] : []),
    { id: 'resumo', label: '<i class="bi bi-card-text"></i> Pedido', html: resumo(d) },
    ...painelEtapa(d),
    { id: 'coment', label: `<i class="bi bi-chat-left-text"></i> Comentários (${d.comentarios.length})`, html: comentarios(d) },
    { id: 'msg', label: '<i class="bi bi-chat-dots"></i> Mensagens', html: '<div data-msgs>Carregando...</div>' },
    { id: 'hist', label: '<i class="bi bi-clock-history"></i> Histórico', html: historico(d) },
  ];
  if (d.notas.length || d.parcelas.length) lista.push({ id: 'fin', label: '<i class="bi bi-cash-stack"></i> Financeiro', html: financeiro(d) });
  if (pode('arquivos')) lista.push({ id: 'arq', label: '<i class="bi bi-paperclip"></i> Arquivos', html: '<div data-arquivos></div>' });

  const botoes = d.acoes.map((a) => ({
    label: a.label,
    cls: a.avanca ? 'btn-success' : a.id === 'cancelar' || a.id === 'reprovar' ? 'btn-outline-danger' : 'btn-outline-warning',
    onClick: async () => {
      let obs = null;
      if (a.exigeObs) {
        obs = await pedirTexto(`Motivo para "${a.label}"`, { titulo: `Pedido ${p.numero}` });
        if (obs === null) return false;
      } else if (a.avanca) {
        obs = (m.body.querySelector('[name=obs_acao]')?.value || '').trim() || null;
      }
      const r = await post(`/api/pedidos/${p.id}/acao`, { acao: a.id, observacao: obs });
      toast(`Pedido ${p.numero} enviado para ${state.me.etapas[r.destino]?.label}${r.nota ? ` · NF ${r.nota.numero} emitida` : ''}.`);
      atualizar();
    },
  }));
  if (p.etapa === 'venda' && pode('pedido.criar')) {
    botoes.unshift({ label: '<i class="bi bi-pencil"></i> Editar', cls: 'btn-outline-primary', onClick: () => { location.hash = `#/pedido/${p.id}/editar`; } });
  }
  botoes.unshift({ label: '<i class="bi bi-printer"></i> Resumo', cls: 'btn-outline-secondary', onClick: () => { imprimirResumo(d); return false; } });
  if (pode('etiquetas') && ['faturamento', 'expedicao', 'transito', 'entregue'].includes(p.etapa)) {
    botoes.unshift({
      label: '<i class="bi bi-upc-scan"></i> Etiqueta', cls: 'btn-outline-dark',
      onClick: async () => { const { abrirEtiqueta } = await import('../etiqueta.js'); abrirEtiqueta(p.id, aoMudar); return false; },
    });
  }
  if (pode('chamados')) {
    botoes.unshift({
      label: '<i class="bi bi-headset"></i> Chamado', cls: 'btn-outline-secondary',
      onClick: async () => { const { novoChamado } = await import('./chamados.js'); novoChamado({ pedido_numero: p.numero }); return false; },
    });
  }

  const m = modal({
    title: `Pedido ${p.numero} · ${esc(d.cliente.nome)} ${badgeEtapa(p.etapa)} ${['entregue', 'cancelado'].includes(p.etapa) ? '' : botaoAjuda(`etapa:${p.etapa}`, 'Como funciona esta etapa')}`,
    size: 'xl',
    body: `${alertas(d)}${fluxo(p)}${abas(lista, 'ped')}${d.acoes.some((a) => a.avanca) ? `<div class="mt-3 no-print"><label class="form-label">Observação ao enviar (opcional)</label><input name="obs_acao" class="form-control form-control-sm" placeholder="Ex.: cliente pediu entrega até sexta"></div>` : ''}`,
    buttons: botoes,
  });
  ligarEventos(m, d, () => { m.close(); abrirPedido(id, aoMudar); aoMudar?.(); });
}

function alertas(d) {
  const out = [];
  if (d.blacklist.bloqueio) out.push(`<div class="alert alert-danger py-2 mb-2"><i class="bi bi-shield-x"></i> <b>Cliente bloqueado:</b> ${esc(d.blacklist.bloqueio.motivo)}. O pedido não pode avançar.</div>`);
  for (const a of d.blacklist.alertas) out.push(`<div class="alert alert-warning py-2 mb-2"><i class="bi bi-shield-exclamation"></i> <b>Alerta:</b> ${esc(a.motivo)}</div>`);
  return out.join('');
}

function fluxo(p) {
  if (['cancelado', 'devolucao'].includes(p.etapa)) return `<div class="mb-2">${badgeEtapa(p.etapa)}</div>`;
  const etapas = FLUXO.filter((e) => (e !== 'supervisao' || p.supervisor_id) && (e !== 'cobranca' || p.forma?.tipo === 'a_vista'));
  const idx = etapas.indexOf(p.etapa);
  return `<div class="fluxo mb-3">${etapas.map((e, i) => `<span class="passo ${i < idx ? 'feito' : i === idx ? 'atual' : ''}">${esc(state.me.etapas[e].label)}</span>`).join('')}</div>`;
}

function endereco(e) {
  if (!e) return '<span class="text-muted">Não informado</span>';
  return `${esc(e.logradouro || '')}, ${esc(e.numero || 'S/N')} ${esc(e.complemento || '')} · ${esc(e.bairro || '')} · ${esc(e.cidade || '')}/${esc(e.uf || '')} · CEP ${esc(e.cep || '')}
    ${e.zona_rural ? '<span class="badge text-bg-success">Zona rural</span>' : ''} ${e.posta_restante ? '<span class="badge text-bg-warning">Posta restante</span>' : ''}
    ${e.como_chegar ? `<div class="small text-muted"><i class="bi bi-signpost"></i> ${esc(e.como_chegar)}</div>` : ''}`;
}

function resumo(d) {
  const p = d.pedido;
  const end = d.enderecos.find((e) => e.id === p.endereco_entrega_id);
  const tel = d.telefones.map((t) => `${esc(t.numero)}${t.whatsapp ? ' <i class="bi bi-whatsapp text-success"></i>' : ''}`).join(' · ');
  return `${bannerCredito(d)}<div class="row g-3">
    <div class="col-md-6"><div class="card h-100"><div class="card-header py-1">Cliente</div><div class="card-body small">
      <div class="fw-semibold">${esc(d.cliente.nome)}</div>
      <div>${fmt.doc(d.cliente.documento)} ${d.cliente.inscricao_estadual ? '· IE ' + esc(d.cliente.inscricao_estadual) : ''} ${d.cliente.inscricao_produtor ? '· Produtor ' + esc(d.cliente.inscricao_produtor) : ''}</div>
      <div>${tel || ''} ${d.cliente.email ? '· ' + esc(d.cliente.email) : ''}</div>
      <div class="mt-2"><b>Histórico:</b> ${d.historico_cliente.pedidos} pedidos anteriores · ${fmt.money(d.historico_cliente.total)} ${d.historico_cliente.ultimo ? '· último em ' + fmt.date(d.historico_cliente.ultimo) : ''}</div>
      <a href="#/crm/cliente/${d.cliente.id}" class="small" data-fechar>Abrir no CRM <i class="bi bi-box-arrow-up-right"></i></a>
    </div></div></div>
    <div class="col-md-6"><div class="card h-100"><div class="card-header py-1">Pagamento e entrega</div><div class="card-body small">
      <div><b>Forma:</b> ${esc(p.forma?.nome || '-')} · <b>Condição:</b> ${esc(p.condicao?.descricao || '-')}</div>
      ${p.cultura || p.origem_venda ? `<div><b>Cultura:</b> ${esc(p.cultura || '-')}${p.area_ha ? ` · ${fmt.num(p.area_ha)} ha` : ''} · <b>Origem:</b> ${esc(p.origem_venda || '-')}</div>` : ''}
      ${p.dentro_politica === 0 ? `<div><span class="badge text-bg-warning">Fora da política</span> <small class="text-muted">${esc(p.motivo_politica || '')}</small></div>` : ''}
      <div><b>Vendedor:</b> ${esc(p.vendedor)} ${p.supervisor ? '· <b>Supervisor:</b> ' + esc(p.supervisor) : ''} ${p.analista ? '· <b>Analista:</b> ' + esc(p.analista) : ''}</div>
      <div><b>Entrega:</b> ${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || p.tipo_entrega)} ${p.transportadora ? '· ' + esc(p.transportadora) : ''}
        ${p.frete_valor != null ? `· Frete ${fmt.money(p.frete_valor)} (${p.frete_prazo_dias || '-'} dias, cot. ${esc(p.frete_codigo_cotacao || '-')})` : ''} ${p.frete_ignorado ? `<span class="badge text-bg-secondary">Cotação ignorada: ${esc(p.frete_motivo_ignorar)}</span>` : ''}</div>
      <div class="mt-1">${endereco(end)}</div>
      ${p.observacao ? `<div class="mt-2"><b>Obs.:</b> ${esc(p.observacao)}</div>` : ''}
      ${p.codigo_origem ? `<div class="mt-1"><b>Nº no sistema anterior:</b> ${esc(p.codigo_origem)}</div>` : ''}
      ${p.observacao_supervisor ? `<div class="mt-1"><b>Obs. supervisor:</b> ${esc(p.observacao_supervisor)}</div>` : ''}
    </div></div></div>
    <div class="col-12">${tabelaSimples([
      { k: 'grupo', l: 'Grupo' }, { k: 'produto', l: 'Produto' }, { k: 'quantidade', l: 'Qtd', t: 'num' }, { k: 'unidade', l: 'Un' }, { k: 'embalagem', l: 'Embalagem' },
      { k: 'valor_tabela', l: 'Valor tabela', t: 'money' }, { k: 'custo_embalagem', l: 'Custo emb.', t: 'money' }, { k: 'valor_unitario', l: 'Valor unit.', t: 'money' },
      { k: 'valor_total', l: 'Total', t: 'money' }, { k: 'brinde', l: 'Brinde', t: 'bool' }, { k: 'lote', l: 'Lote' },
    ], d.itens)}
    <div class="text-end mt-2">Produtos: <b>${fmt.money(p.valor_produtos)}</b> · Desconto: <b>${fmt.money(p.valor_desconto)}</b> · <span class="fs-5">Total: <b>${fmt.money(p.valor_total)}</b></span></div></div>
    ${d.links.length || pode('pedido.criar') ? `<div class="col-12"><div class="card"><div class="card-header py-1 d-flex">Links de pagamento
      ${['venda', 'cobranca', 'supervisao', 'analise', 'diretoria'].includes(p.etapa) ? '<button class="btn btn-sm btn-outline-success ms-auto py-0" data-gerar-link><i class="bi bi-link-45deg"></i> Gerar link</button>' : ''}</div>
      <div class="card-body p-2">${tabelaSimples([{ k: 'codigo', l: 'Código' }, { k: 'meio', l: 'Meio' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'status', l: 'Status', t: 'status' }, { k: 'created_at', l: 'Gerado em', t: 'datetime' },
        { k: 'url', l: 'Link', render: (v, r) => `<code class="small">${location.origin}/pagar/${r.codigo}</code>${r.status === 'pendente' && pode('fila.cobranca') ? ` <button class="btn btn-sm btn-outline-success py-0" data-link-pago="${r.id}">Marcar pago</button>` : ''}` }],
      d.links, { vazio: 'Nenhum link gerado.' })}</div></div></div>` : ''}
  </div>`;
}

// ---------- Painéis por etapa ----------
function painelEtapa(d) {
  const p = d.pedido;
  const atua = d.acoes.length > 0;
  const out = [];
  const serasaAba = { id: 'serasa', label: '<i class="bi bi-shield-check"></i> Serasa', html: serasa(d, pode('serasa') || pode('fila.diretoria')) };
  if (p.etapa === 'supervisao' && atua) {
    out.push({ id: 'sup', label: '<i class="bi bi-person-check"></i> Supervisão', html: `
      <form data-form="supervisao"><label class="form-label">Observação do supervisor</label>
      <textarea class="form-control" name="observacao_supervisor" rows="3">${esc(p.observacao_supervisor || '')}</textarea>
      <button class="btn btn-sm btn-success mt-2" type="submit">Salvar observação</button></form>
      <h6 class="mt-4">Referências comerciais</h6>${referencias(d, 'comercial', true)}` });
    out.push(serasaAba);
  }
  if (p.etapa === 'analise' && atua) {
    out.push(serasaAba);
    out.push({ id: 'refs', label: '<i class="bi bi-telephone"></i> Referências', html: `<h6>Comerciais</h6>${referencias(d, 'comercial', true)}<h6 class="mt-3">Bancárias</h6>${referencias(d, 'bancaria', true)}` });
    out.push({ id: 'frete', label: '<i class="bi bi-truck"></i> Frete e entrega', html: formFrete(d, true) });
  }
  if (p.etapa === 'diretoria' && atua) {
    out.push({ id: 'refs', label: '<i class="bi bi-telephone"></i> Referências', html: `<h6>Comerciais</h6>${referencias(d, 'comercial', false)}<h6 class="mt-3">Bancárias</h6>${referencias(d, 'bancaria', false)}` });
    out.push({ id: 'frete', label: '<i class="bi bi-truck"></i> Frete e entrega', html: formFrete(d, true) });
    out.push(serasaAba);
  }
  if (p.etapa === 'cobranca' && atua) {
    out.push({ id: 'cob', label: '<i class="bi bi-cash-coin"></i> Pagamento à vista', html: `<div class="alert alert-info">Pagamento à vista: confirme o recebimento (PIX/TED) para liberar o pedido para a produção.
      Valor: <b>${fmt.money(p.valor_total)}</b>. Use a aba Pedido para gerar um link de pagamento.</div>` });
  }
  if (p.etapa === 'producao' && atua) {
    out.push({ id: 'prod', label: '<i class="bi bi-gear"></i> Produção', html: `<form data-form="producao">
      <div class="row g-2 mb-2">${campo('prazo_producao', 'Prazo de produção', { type: 'date', col: 'col-md-3', value: p.prazo_producao || '' })}
      <div class="col-md-5 small d-flex align-items-end">Chegou na produção em ${fmt.datetime(p.data_chegada_producao)}</div></div>
      <table class="table table-sm"><thead><tr><th>Produto</th><th>Qtd</th><th>Embalagem</th><th>Lote *</th><th>Fabricação</th><th>Validade</th></tr></thead><tbody>
      ${d.itens.map((i) => `<tr data-item="${i.id}" data-emb="${i.embalagem_id || ''}"><td>${esc(i.produto)}${i.brinde ? ' <span class="badge text-bg-info">brinde</span>' : ''}</td><td>${fmt.num(i.quantidade)} ${esc(i.unidade || '')}</td><td>${esc(i.embalagem || '')}</td>
        <td><input class="form-control form-control-sm" name="lote" value="${esc(i.lote || '')}" list="fefo-${i.id}" autocomplete="off"><datalist id="fefo-${i.id}"></datalist><div class="form-text small" data-fefo></div></td>
        <td><input type="date" class="form-control form-control-sm" name="fabricacao" value="${esc(i.fabricacao || '')}"></td>
        <td><input type="date" class="form-control form-control-sm" name="validade" value="${esc(i.validade || '')}"></td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm btn-success" type="submit">Salvar lotes</button></form>` });
  }
  if (p.etapa === 'faturamento' && atua) {
    out.push({ id: 'fat', label: '<i class="bi bi-receipt"></i> Faturamento', html: `<form data-form="endereco">
      <label class="form-label">Endereço de entrega (ajuste antes de faturar)</label>
      ${d.enderecos.map((e) => `<div class="form-check border rounded p-2 ps-5 mb-2"><input class="form-check-input" type="radio" name="endereco_entrega_id" value="${e.id}" ${e.id === p.endereco_entrega_id ? 'checked' : ''}>
        <label class="form-check-label small">${endereco(e)}</label></div>`).join('')}
      <button class="btn btn-sm btn-success" type="submit">Salvar endereço</button></form>
      <div class="alert alert-light border mt-3 small mb-0">Ao clicar em <b>Emitir nota fiscal</b>, a NF-e é gerada, as parcelas são criadas conforme a condição de pagamento e as comissões entram em revisão.</div>` });
    out.push(serasaAba);
  }
  if (['expedicao', 'transito'].includes(p.etapa) && atua) {
    const exp = p.etapa === 'expedicao';
    out.push({ id: 'exp', label: `<i class="bi bi-truck"></i> ${exp ? 'Embarque' : 'Entrega'}`, html: `<form data-form="expedicao"><div class="row g-2">
      ${campo('transportadora_id', 'Transportadora', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.transportadoras, '—'), value: p.transportadora_id || '' })}
      ${campo('data_embarque', 'Data de embarque', { type: 'date', col: 'col-md-3', value: p.data_embarque || '', required: exp })}
      ${exp ? campo('data_entrega_prevista', 'Entrega prevista', { type: 'date', col: 'col-md-3', value: p.data_entrega_prevista || '', required: true })
        : campo('data_entrega', 'Data de entrega', { type: 'date', col: 'col-md-3', value: p.data_entrega || '', required: true })}
      <div class="col-md-2 d-flex align-items-end"><button class="btn btn-sm btn-success w-100" type="submit">Salvar</button></div></div>
      <div class="small text-muted mt-2">NF ${esc(d.notas[0]?.numero || '-')} · Prazo de produção ${fmt.date(p.prazo_producao)} · Supervisor ${esc(p.supervisor || '-')}</div></form>` });
  }
  if (!atua && d.serasa.length && (pode('serasa') || pode('fila.diretoria'))) out.push(serasaAba);
  if (p.codigo_rastreio || d.rastreio?.length) {
    out.push({ id: 'rastreio', label: '<i class="bi bi-geo"></i> Rastreio', html: `<div class="d-flex flex-wrap gap-2 align-items-center mb-2">
      <span>Código <b>${esc(p.codigo_rastreio || '-')}</b>${p.rastreio_atualizado_em ? ` · consultado em ${fmt.datetime(p.rastreio_atualizado_em)}` : ''}</span>
      ${p.etapa === 'transito' ? '<button type="button" class="btn btn-sm btn-outline-primary ms-auto" data-rastrear><i class="bi bi-arrow-repeat"></i> Consultar agora</button>' : ''}</div>
      ${d.rastreio?.length ? `<ul class="timeline">${d.rastreio.map((e) => `<li class="${e.entregue ? 't-pagamento' : 't-pedido'}"><div class="small text-muted">${fmt.datetime(e.data)}${e.local ? ` · ${esc(e.local)}` : ''}</div>
        <div class="fw-semibold">${e.entregue ? '<i class="bi bi-check-circle-fill text-success"></i> ' : ''}${esc(e.descricao)}</div></li>`).join('')}</ul>`
        : '<div class="vazio py-3">Nenhum evento ainda. A consulta é automática todo dia para os pedidos em trânsito.</div>'}` });
  }
  return out;
}

function serasa(d, podeConsultar) {
  return `${podeConsultar ? `<div class="d-flex gap-2 mb-2 flex-wrap">
      <button class="btn btn-sm btn-outline-primary" data-serasa="serasa"><i class="bi bi-search"></i> Consultar Serasa</button>
      <button class="btn btn-sm btn-outline-primary" data-serasa="restricao"><i class="bi bi-search"></i> Consultar restrição de crédito</button></div>` : ''}
    ${tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'tipo', l: 'Tipo' }, { k: 'score', l: 'Score', t: 'num' }, { k: 'resultado', l: 'Resultado' },
      { k: 'restricoes', l: 'Restrições', t: 'num' }, { k: 'valor_restricoes', l: 'Valor restrições', t: 'money' }, { k: 'usuario', l: 'Usuário' }, { k: 'justificativa', l: 'Justificativa', cls: 'quebra' }],
    d.serasa, { vazio: 'Nenhuma consulta realizada.' })}`;
}

function referencias(d, tipo, editavel) {
  const lista = tipo === 'bancaria' ? d.ref_bancarias : d.ref_comerciais;
  if (!lista.length) return '<div class="text-muted small">Nenhuma referência cadastrada.</div>';
  return `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr>
    <th>${tipo === 'bancaria' ? 'Banco' : 'Empresa'}</th><th>Contato</th><th>Telefone</th><th>Última checagem</th><th>Checada</th><th>Positivo</th><th>Observações</th>${editavel ? '<th></th>' : ''}</tr></thead><tbody>
    ${lista.map((r) => `<tr data-ref="${r.id}" data-tipo="${tipo}"><td>${esc(r.banco || r.empresa)}${r.agencia ? ` <small class="text-muted">Ag ${esc(r.agencia)} C/C ${esc(r.conta)}</small>` : ''}</td>
      <td>${esc(r.contato || r.gerente || '')}</td><td>${esc(r.telefone || '')}</td><td>${fmt.date(r.ultima_checagem || r.data_checagem)}</td>
      <td>${editavel ? `<input type="checkbox" class="form-check-input" name="checada" ${r.checada ? 'checked' : ''}>` : fmt.bool(r.checada)}</td>
      <td>${editavel ? `<input type="checkbox" class="form-check-input" name="positivo" ${r.positivo ? 'checked' : ''}>` : fmt.bool(r.positivo)}</td>
      <td>${editavel ? `<input class="form-control form-control-sm" name="observacao" value="${esc(r.observacao || '')}">` : esc(r.observacao || '')}</td>
      ${editavel ? '<td><button class="btn btn-sm btn-outline-success py-0" data-salvar-ref>Salvar</button></td>' : ''}</tr>`).join('')}</tbody></table></div>`;
}

function formFrete(d, editavel) {
  const p = d.pedido;
  const dis = editavel ? '' : 'disabled';
  return `<form data-form="frete"><div class="row g-2">
    ${campo('tipo_entrega', 'Tipo de entrega', { type: 'select', col: 'col-md-3', options: Object.entries(ROTULOS.tipo_entrega), value: p.tipo_entrega, attrs: dis })}
    ${campo('transportadora_id', 'Transportadora', { type: 'select', col: 'col-md-3', options: opcoes(state.opcoes.transportadoras, '—'), value: p.transportadora_id || '', attrs: dis })}
    ${campo('frete_codigo_cotacao', 'Código da cotação', { col: 'col-md-2', value: p.frete_codigo_cotacao || '', attrs: dis })}
    ${campo('frete_prazo_dias', 'Prazo (dias)', { type: 'number', col: 'col-md-2', value: p.frete_prazo_dias ?? '', attrs: dis })}
    ${campo('frete_valor', 'Valor do frete', { type: 'number', col: 'col-md-2', value: p.frete_valor ?? '', attrs: `step="0.01" ${dis}` })}
    ${campo('frete_ignorado', 'Ignorar cotação', { type: 'checkbox', col: 'col-md-3', value: p.frete_ignorado, attrs: dis })}
    ${campo('frete_motivo_ignorar', 'Motivo para ignorar', { col: 'col-md-7', value: p.frete_motivo_ignorar || '', attrs: dis })}
    ${editavel ? '<div class="col-md-2 d-flex align-items-end"><button class="btn btn-sm btn-success w-100" type="submit">Salvar frete</button></div>' : ''}
  </div></form>`;
}

/** Situação de crédito para quem decide (Análise, Diretoria, Financeiro): limite, exposição, bloqueios e liberação. */
function bannerCredito(d) {
  const c = d.credito_situacao;
  if (!c || c.a_vista) return '';
  if (c.liberado) return `<div class="alert alert-info py-2 small"><i class="bi bi-unlock"></i> Crédito liberado por ${esc(c.liberado.por || '')} em ${fmt.datetime(c.liberado.em)}: ${esc(c.liberado.justificativa)}</div>`;
  const resumo = `Limite ${c.limite ? fmt.money(c.limite) : 'não definido'} · exposição com este pedido ${fmt.money(c.exposicao)}${c.disponivel != null ? ` · disponível ${fmt.money(c.disponivel)}` : ''}${c.sugerido?.valor ? ` · sugerido ${fmt.money(c.sugerido.valor)}` : ''}`;
  if (!c.bloqueios.length) return `<div class="small text-muted mb-2"><i class="bi bi-shield-check text-success"></i> Crédito OK · ${resumo}</div>`;
  return `<div class="alert alert-danger py-2 small d-flex flex-wrap gap-2 align-items-center"><div class="flex-grow-1"><i class="bi bi-shield-lock"></i> <b>Crédito bloqueado:</b> ${esc(c.bloqueios.join('; '))}<br>${resumo}</div>
    ${c.pode_liberar ? '<button type="button" class="btn btn-sm btn-outline-danger" data-liberar-credito><i class="bi bi-unlock"></i> Liberar crédito deste pedido</button>' : '<span class="text-muted">A Análise só aprova com liberação da Diretoria.</span>'}</div>`;
}

// ---------- Diretoria ----------
const pct = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const PAPEIS = { vendedor: 'Vendedor', supervisor: 'Supervisor', gerente: 'Gerente', indicacao: 'Indicação', outro: 'Outro' };

function painelDiretoria(d) {
  const p = d.pedido;
  const c = d.cliente;
  const cr = d.credito || {};
  const tabela = d.itens.reduce((a, i) => a + (i.brinde ? 0 : Number(i.valor_tabela || 0) * Number(i.quantidade || 0)), 0);
  const descTabela = tabela ? (1 - Number(p.valor_produtos || 0) / tabela) * 100 : 0;
  const brindes = d.itens.filter((i) => i.brinde);
  const comAtual = d.comissoes.reduce((a, x) => a + Number(x.valor || 0), 0);
  const ultSerasa = d.serasa[0];
  const exposicao = Number(cr.em_aberto || 0) + Number(cr.outros_em_andamento || 0) + Number(p.valor_total || 0);
  const estouro = cr.limite_credito > 0 && exposicao > cr.limite_credito;
  const ind = (rotulo, valor, sub = '', cor = '') => `<div class="dir-ind ${cor}"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const end = d.enderecos.find((e) => e.id === p.endereco_entrega_id);
  const obs = d.historico.filter((h) => h.observacao && h.acao !== 'Comissão alterada pela Diretoria');
  return `<div class="dir-inds mb-3">
      ${ind('Valor do pedido', fmt.money(p.valor_total), `${d.itens.length} ite${d.itens.length === 1 ? 'm' : 'ns'} · ${esc(p.condicao?.descricao || '-')}`)}
      ${ind('Desconto sobre a tabela', pct(descTabela), `Tabela ${fmt.money(tabela)}${brindes.length ? ` · ${brindes.length} brinde(s)` : ''}`, descTabela > 10 ? 'alerta' : '')}
      ${ind('Comissão do pedido', `<span data-com-total>${fmt.money(comAtual)}</span>`, `<span data-com-pct>${pct(p.valor_total ? (comAtual / p.valor_total) * 100 : 0)}</span> do pedido`)}
      ${d.credito ? ind('Crédito do cliente', fmt.money(cr.limite_credito), `Exposição com este pedido ${fmt.money(exposicao)}`, estouro ? 'perigo' : '') : ''}
      ${d.credito ? ind('Em aberto · vencido', `${fmt.money(cr.em_aberto)}`, `${fmt.money(cr.vencido)} vencido${cr.maior_atraso ? ` · até ${cr.maior_atraso} dias` : ''}`, cr.vencido > 0 ? 'perigo' : '') : ''}
      ${ind('Serasa', ultSerasa ? `Score ${esc(ultSerasa.score ?? '-')}` : 'Sem consulta', ultSerasa ? `${esc(ultSerasa.resultado || '')} · ${fmt.date(ultSerasa.created_at)}` : 'Consulte na aba Serasa', ultSerasa && ultSerasa.score < 500 ? 'alerta' : '')}
    </div>
    ${p.dentro_politica === 0 ? `<div class="alert alert-warning py-2"><i class="bi bi-exclamation-diamond"></i> <b>Pedido fora da política comercial</b> — ${esc(p.motivo_politica || 'item abaixo da tabela')}. A comissão do vendedor foi sugerida pela regra de fora da política: confirme ou ajuste abaixo.</div>` : ''}
    ${estouro ? `<div class="alert alert-warning py-2"><i class="bi bi-exclamation-triangle"></i> A exposição do cliente (${fmt.money(exposicao)}) passa do limite de crédito (${fmt.money(cr.limite_credito)}).</div>` : ''}

    <div class="card mb-3"><div class="card-header"><i class="bi bi-percent"></i> Comissão do pedido
      ${d.comissoes_definidas ? `<span class="badge text-bg-info ms-1">Ajustada por ${esc(d.comissoes_definidas.por || 'Diretoria')} em ${fmt.datetime(d.comissoes_definidas.em)}</span>` : '<span class="badge text-bg-secondary ms-1">Padrão do cadastro</span>'}</div>
      <div class="card-body">${editorComissoes(d)}</div></div>

    <div class="row g-3">
      <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-person-vcard"></i> Cliente</div><div class="card-body small">
        <div class="fw-semibold fs-6">${esc(c.nome)}</div>
        <div class="text-muted">${fmt.doc(c.documento)} ${c.inscricao_estadual ? '· IE ' + esc(c.inscricao_estadual) : ''} ${c.inscricao_produtor ? '· Produtor ' + esc(c.inscricao_produtor) : ''}</div>
        <dl class="dir-dl mt-2">
          <dt>Telefones</dt><dd>${d.telefones.map((t) => `${esc(t.numero)}${t.whatsapp ? ' <i class="bi bi-whatsapp text-success"></i>' : ''}`).join(' · ') || '—'}</dd>
          <dt>E-mail</dt><dd>${esc(c.email || '—')}</dd>
          <dt>Histórico</dt><dd>${d.historico_cliente.pedidos} pedido(s) · ${fmt.money(d.historico_cliente.total)}${d.historico_cliente.ultimo ? ` · último em ${fmt.date(d.historico_cliente.ultimo)}` : ''}</dd>
          <dt>Endereços</dt><dd>${d.enderecos.map((e) => `<div class="mb-1">${e.id === p.endereco_entrega_id ? '<span class="badge text-bg-primary">Entrega</span> ' : ''}${endereco(e)}</div>`).join('') || '—'}</dd>
          ${c.observacoes ? `<dt>Observações</dt><dd>${esc(c.observacoes)}</dd>` : ''}
        </dl>
        <a href="#/crm/cliente/${c.id}" data-fechar>Abrir visão 360° no CRM <i class="bi bi-box-arrow-up-right"></i></a>
      </div></div></div>
      <div class="col-lg-6"><div class="card h-100"><div class="card-header"><i class="bi bi-clipboard-check"></i> Condições e análise</div><div class="card-body small">
        <dl class="dir-dl">
          <dt>Pagamento</dt><dd>${esc(p.forma?.nome || '-')} · ${esc(p.condicao?.descricao || '-')}</dd>
          <dt>Cultura</dt><dd>${esc(p.cultura || '—')}${p.area_ha ? ` · ${fmt.num(p.area_ha)} ha` : ''}</dd>
          <dt>Origem da venda</dt><dd>${esc(p.origem_venda || '—')}</dd>
          <dt>Equipe</dt><dd>${esc(p.vendedor || '-')}${p.supervisor ? ` · Sup. ${esc(p.supervisor)}` : ''}${p.analista ? ` · Análise ${esc(p.analista)}` : ''}</dd>
          <dt>Entrega</dt><dd>${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || p.tipo_entrega || '-')}${p.transportadora ? ` · ${esc(p.transportadora)}` : ''}${p.frete_valor != null ? ` · Frete ${fmt.money(p.frete_valor)} (${p.frete_prazo_dias || '-'} dias)` : ''}${p.frete_ignorado ? ` · cotação ignorada: ${esc(p.frete_motivo_ignorar || '')}` : ''}</dd>
          <dt>Local</dt><dd>${end ? `${esc(end.cidade || '')}/${esc(end.uf || '')}` : '—'}</dd>
          <dt>Referências</dt><dd>${refResumo(d.ref_comerciais, 'comerciais')} · ${refResumo(d.ref_bancarias, 'bancárias')}</dd>
          ${p.observacao ? `<dt>Obs. do vendedor</dt><dd>${esc(p.observacao)}</dd>` : ''}
          ${p.observacao_supervisor ? `<dt>Obs. do supervisor</dt><dd>${esc(p.observacao_supervisor)}</dd>` : ''}
        </dl>
        ${obs.length ? `<div class="text-muted fw-semibold mt-2 mb-1">Observações do fluxo</div><ul class="timeline">${obs.slice(-4).reverse().map((h) => `<li><div class="text-muted">${fmt.datetime(h.created_at)} · ${esc(h.usuario || '')} · ${esc(h.acao)}</div><div>${esc(h.observacao)}</div></li>`).join('')}</ul>` : ''}
      </div></div></div>
      <div class="col-12"><div class="card"><div class="card-header"><i class="bi bi-box-seam"></i> Itens</div>
        ${tabelaSimples([
          { k: 'produto', l: 'Produto' }, { k: 'embalagem', l: 'Embalagem' }, { k: 'quantidade', l: 'Qtd', t: 'num' },
          { k: 'valor_tabela', l: 'Tabela', t: 'money' }, { k: 'valor_unitario', l: 'Unitário', t: 'money' },
          { k: 'desc', l: 'Desc. s/ tabela', t: 'num', render: (v, r) => (r.brinde ? '<span class="badge text-bg-info">brinde</span>' : r.valor_tabela ? pct((1 - r.valor_unitario / r.valor_tabela) * 100) : '—') },
          { k: 'valor_total', l: 'Total', t: 'money' },
        ], d.itens)}
        <div class="card-footer text-end small">Produtos <b>${fmt.money(p.valor_produtos)}</b> · Desconto da condição <b>${fmt.money(p.valor_desconto)}</b> · <span class="fs-6">Total <b>${fmt.money(p.valor_total)}</b></span></div></div></div>
    </div>`;
}

function refResumo(lista, nome) {
  if (!lista.length) return `sem ${nome}`;
  const ok = lista.filter((r) => r.checada && r.positivo).length;
  return `${ok}/${lista.length} ${nome} positivas`;
}

function editorComissoes(d) {
  const p = d.pedido;
  const definidas = d.comissoes.length || d.comissoes_definidas;
  const linhas = definidas ? d.comissoes : d.comissoes_padrao;
  const usuarios = state.opcoes.usuarios.filter((u) => ['vendedor', 'supervisor', 'gerente', 'diretoria', 'admin'].includes(u.perfil) || linhas.some((c) => c.usuario_id === u.id));
  const padrao = Object.fromEntries(d.comissoes_padrao.map((c) => [`${c.usuario_id}:${c.papel}`, c.percentual]));
  const linha = (c) => `<tr>
    <td><select class="form-select form-select-sm" name="usuario_id" aria-label="Colaborador">${usuarios.map((u) => `<option value="${u.id}" ${u.id === c.usuario_id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></td>
    <td><select class="form-select form-select-sm" name="papel" aria-label="Papel">${Object.entries(PAPEIS).map(([k, l]) => `<option value="${k}" ${k === c.papel ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td class="num text-muted small" data-padrao>${padrao[`${c.usuario_id}:${c.papel}`] != null ? pct(padrao[`${c.usuario_id}:${c.papel}`]) : '—'}</td>
    <td><div class="input-group input-group-sm"><input type="number" step="any" min="0" max="100" class="form-control" name="percentual" value="${c.percentual ?? ''}" aria-label="Percentual"><span class="input-group-text">%</span></div></td>
    <td><div class="input-group input-group-sm"><span class="input-group-text">R$</span><input type="number" step="any" min="0" class="form-control" name="valor" value="${c.percentual != null ? (p.valor_total * c.percentual / 100).toFixed(2) : ''}" aria-label="Valor"></div></td>
    <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" data-rem title="Remover"><i class="bi bi-x-lg"></i></button></td></tr>`;
  return `<form data-form="comissoes">
    <div class="table-responsive"><table class="table table-sm align-middle mb-2 tabela-comissao"><thead><tr><th>Colaborador</th><th>Papel</th><th class="num">% cadastro</th><th style="width:130px">% do pedido</th><th style="width:160px">Valor</th><th></th></tr></thead>
    <tbody>${linhas.map(linha).join('')}</tbody>
    <tfoot><tr><th colspan="3" class="text-end">Total da comissão</th><th data-tot-pct>—</th><th data-tot-valor>—</th><th></th></tr></tfoot></table></div>
    <template>${linha({ papel: 'outro', percentual: 0 })}</template>
    <div class="d-flex flex-wrap gap-2 align-items-center">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-add-com><i class="bi bi-plus-lg"></i> Colaborador</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-com-padrao><i class="bi bi-arrow-counterclockwise"></i> Voltar ao padrão</button>
      <input class="form-control form-control-sm" name="motivo" placeholder="Motivo da alteração (opcional)" style="max-width:320px">
      <button class="btn btn-sm btn-success ms-auto" type="submit"><i class="bi bi-check2"></i> Salvar comissão</button>
    </div>
    <div class="form-text">Altere pelo % ou pelo valor em R$; um calcula o outro sobre ${fmt.money(p.valor_total)}. Sem nenhuma linha, o pedido fica sem comissão. A alteração fica no histórico do pedido.</div></form>`;
}

function comentarios(d) {
  return `<form data-form="comentario" class="d-flex gap-2 mb-3"><input name="texto" class="form-control form-control-sm" placeholder="Escreva um comentário no pedido" required>
    <button class="btn btn-sm btn-success">Comentar</button></form>
    ${d.comentarios.length ? `<ul class="list-group">${d.comentarios.map((c) => `<li class="list-group-item small"><div class="d-flex"><b>${esc(c.usuario)}</b>
      <span class="ms-2">${badgeEtapa(c.etapa)}</span><span class="ms-auto text-muted">${fmt.datetime(c.created_at)}</span></div>${esc(c.texto)}</li>`).join('')}</ul>` : '<div class="vazio py-3">Sem comentários.</div>'}`;
}

function historico(d) {
  return `<ul class="timeline">${d.historico.slice().reverse().map((h) => `<li><div class="small text-muted">${fmt.datetime(h.created_at)} · ${esc(h.usuario || '')}</div>
    <div><b>${esc(h.acao)}</b> ${h.etapa_origem ? `${badgeEtapa(h.etapa_origem)} → ` : ''}${h.etapa_destino ? badgeEtapa(h.etapa_destino) : ''}</div>
    ${h.observacao ? `<div class="small">${esc(h.observacao)}</div>` : ''}</li>`).join('')}</ul>`;
}

function financeiro(d) {
  return `<h6>Notas fiscais</h6>${tabelaSimples([{ k: 'numero', l: 'Nº' }, { k: 'serie', l: 'Série' }, { k: 'data_emissao', l: 'Emissão', t: 'datetime' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'status', l: 'Status', t: 'status' }, { k: 'chave', l: 'Chave de acesso', cls: 'small' }], d.notas)}
    <h6 class="mt-3">Parcelas</h6>${tabelaSimples([{ k: 'numero', l: 'Parcela' }, { k: 'vencimento', l: 'Vencimento', t: 'date' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'juros', l: 'Juros', t: 'money' },
      { k: 'valor_pago', l: 'Pago', t: 'money' }, { k: 'saldo', l: 'Saldo', t: 'money' }, { k: 'data_pagamento', l: 'Pagamento', t: 'date' }, { k: 'tipo_baixa', l: 'Tipo baixa' }, { k: 'status_atual', l: 'Status', t: 'status' }], d.parcelas)}`;
}

// ---------- Eventos ----------
function ligarComissoes(fc, d, recarregar) {
  const total = Number(d.pedido.valor_total) || 0;
  const padrao = Object.fromEntries(d.comissoes_padrao.map((c) => [`${c.usuario_id}:${c.papel}`, c.percentual]));
  const somar = () => {
    let sp = 0;
    let sv = 0;
    fc.querySelectorAll('tbody tr').forEach((tr) => {
      sp += Number(tr.querySelector('[name=percentual]').value) || 0;
      sv += Number(tr.querySelector('[name=valor]').value) || 0;
      const k = `${tr.querySelector('[name=usuario_id]').value}:${tr.querySelector('[name=papel]').value}`;
      tr.querySelector('[data-padrao]').textContent = padrao[k] != null ? pct(padrao[k]) : '—';
    });
    fc.querySelector('[data-tot-pct]').textContent = pct(sp);
    fc.querySelector('[data-tot-valor]').textContent = fmt.money(sv);
    const dir = fc.closest('.tab-pane');
    if (dir?.querySelector('[data-com-total]')) {
      dir.querySelector('[data-com-total]').textContent = fmt.money(sv);
      dir.querySelector('[data-com-pct]').textContent = pct(sp);
    }
    fc.querySelector('[data-tot-pct]').classList.toggle('text-danger', sp > 100);
  };
  fc.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.name === 'percentual') tr.querySelector('[name=valor]').value = e.target.value === '' ? '' : (total * Number(e.target.value) / 100).toFixed(2);
    if (e.target.name === 'valor') tr.querySelector('[name=percentual]').value = e.target.value === '' || !total ? '' : Math.round((Number(e.target.value) / total) * 100 * 10000) / 10000;
    somar();
  });
  fc.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') somar(); });
  fc.addEventListener('click', (e) => {
    if (e.target.closest('[data-rem]')) { e.target.closest('tr').remove(); somar(); }
    if (e.target.closest('[data-add-com]')) { fc.querySelector('tbody').append(fc.querySelector('template').content.cloneNode(true)); somar(); }
    if (e.target.closest('[data-com-padrao]')) {
      const tb = fc.querySelector('tbody');
      tb.innerHTML = '';
      for (const c of d.comissoes_padrao) {
        tb.append(fc.querySelector('template').content.cloneNode(true));
        const tr = tb.lastElementChild;
        tr.querySelector('[name=usuario_id]').value = c.usuario_id;
        tr.querySelector('[name=papel]').value = c.papel;
        tr.querySelector('[name=percentual]').value = c.percentual;
        tr.querySelector('[name=valor]').value = (total * c.percentual / 100).toFixed(2);
      }
      somar();
    }
  });
  fc.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const comissoes = [...fc.querySelectorAll('tbody tr')].map((tr) => ({
      usuario_id: Number(tr.querySelector('[name=usuario_id]').value),
      papel: tr.querySelector('[name=papel]').value,
      percentual: tr.querySelector('[name=percentual]').value,
    }));
    if (await tentar(() => put(`/api/pedidos/${d.pedido.id}/comissoes`, { comissoes, motivo: fc.querySelector('[name=motivo]').value.trim() || null }), 'Comissão salva.')) recarregar();
  });
  somar();
}

function ligarEventos(m, d, recarregar) {
  const p = d.pedido;
  const el = m.body;
  el.querySelectorAll('[data-fechar]').forEach((a) => a.addEventListener('click', () => m.close()));

  const form = (nome, fn) => el.querySelector(`[data-form="${nome}"]`)?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (await tentar(() => fn(ev.target), 'Salvo.')) recarregar();
  });
  el.querySelector('[data-rastrear]')?.addEventListener('click', async () => {
    const r = await tentar(() => post(`/api/pedidos/${p.id}/rastreio`));
    if (r) { toast(r.concluido ? 'Entrega confirmada pelo rastreio: pedido concluído.' : `Rastreio atualizado: ${r.status || 'sem eventos'}.`); recarregar(); }
  });
  el.querySelector('[data-liberar-credito]')?.addEventListener('click', async () => {
    const justificativa = await pedirTexto('Por que liberar o crédito deste pedido?', { titulo: 'Liberar crédito', min: 10 });
    if (justificativa && await tentar(() => post(`/api/credito/pedidos/${p.id}/liberar`, { justificativa }), 'Crédito liberado.')) recarregar();
  });
  form('supervisao', (f) => put(`/api/pedidos/${p.id}/supervisao`, lerForm(f)));
  form('frete', (f) => put(`/api/pedidos/${p.id}/frete`, lerForm(f)));
  form('endereco', (f) => put(`/api/pedidos/${p.id}/endereco`, lerForm(f)));
  form('expedicao', (f) => put(`/api/pedidos/${p.id}/expedicao`, lerForm(f)));
  form('comentario', (f) => post(`/api/pedidos/${p.id}/comentarios`, lerForm(f)));
  fefo(el.querySelector('[data-form="producao"]'));
  form('producao', (f) => put(`/api/pedidos/${p.id}/producao`, {
    prazo_producao: f.querySelector('[name=prazo_producao]').value || null,
    itens: [...f.querySelectorAll('tr[data-item]')].map((tr) => ({ id: Number(tr.dataset.item), ...lerForm(tr) })),
  }));
  const fc = el.querySelector('[data-form="comissoes"]');
  if (fc) ligarComissoes(fc, d, recarregar);
  el.querySelectorAll('[data-salvar-ref]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    if (await tentar(() => put(`/api/clientes/referencias/${tr.dataset.tipo}/${tr.dataset.ref}`, lerForm(tr)), 'Referência atualizada.')) recarregar();
  }));
  el.querySelectorAll('[data-serasa]').forEach((b) => b.addEventListener('click', async () => {
    const consultar = (justificativa) => post(`/api/clientes/${d.cliente.id}/serasa`, { tipo: b.dataset.serasa, pedido_id: p.id, justificativa });
    try {
      const r = await consultar();
      toast(`Score ${r.score} · ${r.resultado}`, r.score >= 500 ? 'success' : 'warning', 'Consulta Serasa');
      recarregar();
    } catch (e) {
      if (e.status !== 428) return erro(e);
      const j = await pedirTexto(e.message, { titulo: 'Justificar nova consulta' });
      if (j && await tentar(() => consultar(j), 'Consulta realizada.')) recarregar();
    }
  }));
  el.querySelector('[data-gerar-link]')?.addEventListener('click', async () => {
    if (await tentar(() => post(`/api/pedidos/${p.id}/links`, { valor: p.valor_total, meio: 'PIX' }), 'Link de pagamento gerado.')) recarregar();
  });
  el.querySelectorAll('[data-link-pago]').forEach((b) => b.addEventListener('click', async () => {
    if (await tentar(() => post(`/api/pedidos/${p.id}/links/${b.dataset.linkPago}/pago`), 'Link marcado como pago.')) recarregar();
  }));

  // Mensagens do pedido
  const caixa = el.querySelector('[data-msgs]');
  const carregarMsgs = async () => {
    const msgs = await get(`/api/mensagens?pedido_id=${p.id}`).catch(() => []);
    const setores = [...new Set(Object.values(state.me.etapas).map((e) => e.perfil).filter(Boolean))];
    caixa.innerHTML = `<form class="row g-2 mb-3" data-form-msg>
      <div class="col-md-3"><select class="form-select form-select-sm" name="setor_destino"><option value="">Todos os setores</option>${setores.map((s) => `<option value="${s}">${esc(state.me.perfis[s])}</option>`).join('')}</select></div>
      <div class="col-md-7"><input class="form-control form-control-sm" name="texto" required placeholder="Mensagem vinculada ao pedido ${p.numero}"></div>
      <div class="col-md-2"><button class="btn btn-sm btn-success w-100">Enviar</button></div></form>
      ${msgs.length ? `<ul class="list-group">${msgs.map((x) => `<li class="list-group-item small"><b>${esc(x.remetente)}</b> → ${esc(x.destinatario || (x.setor_destino ? state.me.perfis[x.setor_destino] : 'Todos'))}
        <span class="text-muted float-end">${fmt.datetime(x.created_at)}</span><div>${esc(x.texto)}</div></li>`).join('')}</ul>` : '<div class="vazio py-3">Nenhuma mensagem neste pedido.</div>'}`;
    caixa.querySelector('[data-form-msg]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (await tentar(() => post('/api/mensagens', { ...lerForm(ev.target), pedido_id: p.id }), 'Mensagem enviada.')) carregarMsgs();
    });
  };
  el.querySelector('[data-aba="msg"]') && carregarMsgs();
  const arq = el.querySelector('[data-arquivos]');
  if (arq) painelArquivos(arq, { pedido_id: p.id, cliente_id: d.cliente.id });
}

function imprimirResumo(d) {
  const p = d.pedido;
  const end = d.enderecos.find((e) => e.id === p.endereco_entrega_id);
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${p.numero}</title>
  <style>body{font:12px Arial;margin:24px}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:4px}th{background:#e8f5e9}.r{text-align:right}.box{border:1px solid #ccc;padding:8px;margin-top:8px}</style></head><body>
  <h1>${esc(p.empresa?.nome || '')} — Resumo do Pedido ${p.numero}</h1><div>Emitido em ${fmt.datetime(p.created_at)} · Etapa: ${esc(p.etapa_label)}</div>
  <div class="box"><b>Cliente:</b> ${esc(d.cliente.nome)} · ${fmt.doc(d.cliente.documento)}<br><b>Entrega:</b> ${end ? `${esc(end.logradouro)}, ${esc(end.numero || '')} - ${esc(end.cidade)}/${esc(end.uf)}${end.como_chegar ? '<br><b>Como chegar:</b> ' + esc(end.como_chegar) : ''}` : '-'}
  <br><b>Pagamento:</b> ${esc(p.forma?.nome || '')} · ${esc(p.condicao?.descricao || '')} · <b>Vendedor:</b> ${esc(p.vendedor)}</div>
  <table><thead><tr><th>Produto</th><th>Embalagem</th><th class="r">Qtd</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody>
  ${d.itens.map((i) => `<tr><td>${esc(i.produto)}${i.brinde ? ' (brinde)' : ''}</td><td>${esc(i.embalagem || '')}</td><td class="r">${fmt.num(i.quantidade)} ${esc(i.unidade || '')}</td><td class="r">${fmt.money(i.valor_unitario)}</td><td class="r">${fmt.money(i.valor_total)}</td></tr>`).join('')}
  </tbody></table><p class="r">Produtos ${fmt.money(p.valor_produtos)} · Desconto ${fmt.money(p.valor_desconto)} · <b>Total ${fmt.money(p.valor_total)}</b></p>
  ${p.observacao ? `<div class="box"><b>Observações:</b> ${esc(p.observacao)}</div>` : ''}
  <p style="margin-top:48px">_______________________________<br>${esc(d.cliente.nome)}</p><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

/** Sugere os lotes do estoque na ordem de vencimento (primeiro que vence, primeiro que sai) e preenche a validade. */
async function fefo(f) {
  if (!f || !pode('estoque')) return;
  const hojeIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  for (const tr of f.querySelectorAll('tr[data-emb]')) {
    if (!tr.dataset.emb) continue;
    const lotes = (await get(`/api/estoque/lotes/${tr.dataset.emb}`).catch(() => [])).filter((l) => l.lote && l.saldo > 0);
    const validos = lotes.filter((l) => !l.validade || l.validade >= hojeIso);
    tr.querySelector('datalist').innerHTML = lotes.map((l) => `<option value="${esc(l.lote)}">${l.validade && l.validade < hojeIso ? 'VENCIDO · ' : ''}saldo ${fmt.num(l.saldo)}${l.validade ? ' · val. ' + fmt.date(l.validade) : ''}</option>`).join('');
    const inp = tr.querySelector('[name=lote]');
    const aviso = tr.querySelector('[data-fefo]');
    const conferir = () => {
      const l = lotes.find((x) => x.lote === inp.value);
      const val = tr.querySelector('[name=validade]');
      if (l?.validade && !val.value) val.value = l.validade;
      aviso.innerHTML = l?.validade && l.validade < hojeIso ? '<span class="text-danger"><i class="bi bi-exclamation-octagon"></i> Lote vencido</span>'
        : validos[0] && inp.value !== validos[0].lote ? `Vence primeiro: <a href="#" data-usar>${esc(validos[0].lote)}</a>` : '';
      aviso.querySelector('[data-usar]')?.addEventListener('click', (ev) => { ev.preventDefault(); inp.value = validos[0].lote; val.value = validos[0].validade || val.value; conferir(); });
    };
    inp.addEventListener('change', conferir);
    conferir();
  }
}
