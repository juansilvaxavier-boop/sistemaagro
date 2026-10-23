// Janela do pedido: resumo, ações da etapa, comentários, mensagens, histórico, financeiro e arquivos.
import {
  get, post, put, esc, fmt, modal, abas, campo, opcoes, lerForm, toast, erro, tentar, state, badgeEtapa, tabelaSimples, pedirTexto, ROTULOS, pode,
} from '../core.js';
import { painelArquivos } from './arquivos.js';

const FLUXO = ['venda', 'supervisao', 'analise', 'diretoria', 'cobranca', 'producao', 'faturamento', 'expedicao', 'transito', 'entregue'];

export async function abrirPedido(id, aoMudar) {
  let d;
  try { d = await get(`/api/pedidos/${id}`); } catch (e) { return erro(e); }
  const p = d.pedido;
  const atualizar = () => { m.close(); aoMudar?.(); window.atualizarContadores?.(); };

  const lista = [
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

  const m = modal({
    title: `Pedido ${p.numero} · ${esc(d.cliente.nome)} ${badgeEtapa(p.etapa)}`,
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
  return `<div class="row g-3">
    <div class="col-md-6"><div class="card h-100"><div class="card-header py-1">Cliente</div><div class="card-body small">
      <div class="fw-semibold">${esc(d.cliente.nome)}</div>
      <div>${fmt.doc(d.cliente.documento)} ${d.cliente.inscricao_estadual ? '· IE ' + esc(d.cliente.inscricao_estadual) : ''} ${d.cliente.inscricao_produtor ? '· Produtor ' + esc(d.cliente.inscricao_produtor) : ''}</div>
      <div>${tel || ''} ${d.cliente.email ? '· ' + esc(d.cliente.email) : ''}</div>
      <div class="mt-2"><b>Histórico:</b> ${d.historico_cliente.pedidos} pedidos anteriores · ${fmt.money(d.historico_cliente.total)} ${d.historico_cliente.ultimo ? '· último em ' + fmt.date(d.historico_cliente.ultimo) : ''}</div>
      <a href="#/crm/cliente/${d.cliente.id}" class="small" data-fechar>Abrir no CRM <i class="bi bi-box-arrow-up-right"></i></a>
    </div></div></div>
    <div class="col-md-6"><div class="card h-100"><div class="card-header py-1">Pagamento e entrega</div><div class="card-body small">
      <div><b>Forma:</b> ${esc(p.forma?.nome || '-')} · <b>Condição:</b> ${esc(p.condicao?.descricao || '-')}</div>
      <div><b>Vendedor:</b> ${esc(p.vendedor)} ${p.supervisor ? '· <b>Supervisor:</b> ' + esc(p.supervisor) : ''} ${p.analista ? '· <b>Analista:</b> ' + esc(p.analista) : ''}</div>
      <div><b>Entrega:</b> ${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || p.tipo_entrega)} ${p.transportadora ? '· ' + esc(p.transportadora) : ''}
        ${p.frete_valor != null ? `· Frete ${fmt.money(p.frete_valor)} (${p.frete_prazo_dias || '-'} dias, cot. ${esc(p.frete_codigo_cotacao || '-')})` : ''} ${p.frete_ignorado ? `<span class="badge text-bg-secondary">Cotação ignorada: ${esc(p.frete_motivo_ignorar)}</span>` : ''}</div>
      <div class="mt-1">${endereco(end)}</div>
      ${p.observacao ? `<div class="mt-2"><b>Obs.:</b> ${esc(p.observacao)}</div>` : ''}
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
    out.push({ id: 'dir', label: '<i class="bi bi-award"></i> Aprovação', html: `
      <h6>Cotação de frete</h6>${formFrete(d, true)}
      <h6 class="mt-3">Referências bancárias</h6>${referencias(d, 'bancaria', false)}
      <h6 class="mt-3">Comissões do pedido</h6>${comissoes(d)}` });
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
      ${d.itens.map((i) => `<tr data-item="${i.id}"><td>${esc(i.produto)}${i.brinde ? ' <span class="badge text-bg-info">brinde</span>' : ''}</td><td>${fmt.num(i.quantidade)} ${esc(i.unidade || '')}</td><td>${esc(i.embalagem || '')}</td>
        <td><input class="form-control form-control-sm" name="lote" value="${esc(i.lote || '')}"></td>
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

function comissoes(d) {
  const linhas = d.comissoes.length ? d.comissoes : [
    { usuario_id: d.pedido.vendedor_id, papel: 'vendedor', percentual: '' },
    ...(d.pedido.supervisor_id ? [{ usuario_id: d.pedido.supervisor_id, papel: 'supervisor', percentual: '' }] : []),
  ];
  const usuarios = state.opcoes.usuarios.filter((u) => ['vendedor', 'supervisor', 'diretoria'].includes(u.perfil));
  const linha = (c) => `<tr><td><select class="form-select form-select-sm" name="usuario_id">${usuarios.map((u) => `<option value="${u.id}" ${u.id === c.usuario_id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></td>
    <td><select class="form-select form-select-sm" name="papel">${['vendedor', 'supervisor', 'indicacao', 'outro'].map((x) => `<option ${x === c.papel ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><input type="number" step="0.01" class="form-control form-control-sm" name="percentual" value="${c.percentual ?? ''}" placeholder="% padrão do cadastro"></td>
    <td class="num">${c.valor != null ? fmt.money(c.valor) : ''}</td><td><button type="button" class="btn btn-sm btn-outline-danger py-0" data-rem>&times;</button></td></tr>`;
  return `<form data-form="comissoes"><table class="table table-sm"><thead><tr><th>Colaborador</th><th>Papel</th><th>%</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${linhas.map(linha).join('')}</tbody></table>
    <template>${linha({ papel: 'outro' })}</template>
    <button type="button" class="btn btn-sm btn-outline-secondary" data-add-com>+ Colaborador</button>
    <button class="btn btn-sm btn-success" type="submit">Salvar comissões</button>
    <div class="form-text">Sem comissões definidas, a aprovação aplica o % do cadastro de cada usuário.</div></form>`;
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
function ligarEventos(m, d, recarregar) {
  const p = d.pedido;
  const el = m.body;
  el.querySelectorAll('[data-fechar]').forEach((a) => a.addEventListener('click', () => m.close()));

  const form = (nome, fn) => el.querySelector(`[data-form="${nome}"]`)?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (await tentar(() => fn(ev.target), 'Salvo.')) recarregar();
  });
  form('supervisao', (f) => put(`/api/pedidos/${p.id}/supervisao`, lerForm(f)));
  form('frete', (f) => put(`/api/pedidos/${p.id}/frete`, lerForm(f)));
  form('endereco', (f) => put(`/api/pedidos/${p.id}/endereco`, lerForm(f)));
  form('expedicao', (f) => put(`/api/pedidos/${p.id}/expedicao`, lerForm(f)));
  form('comentario', (f) => post(`/api/pedidos/${p.id}/comentarios`, lerForm(f)));
  form('producao', (f) => put(`/api/pedidos/${p.id}/producao`, {
    prazo_producao: f.querySelector('[name=prazo_producao]').value || null,
    itens: [...f.querySelectorAll('tr[data-item]')].map((tr) => ({ id: Number(tr.dataset.item), ...lerForm(tr) })),
  }));
  form('comissoes', (f) => put(`/api/pedidos/${p.id}/comissoes`, {
    comissoes: [...f.querySelectorAll('tbody tr')].map((tr) => ({ ...lerForm(tr), usuario_id: Number(tr.querySelector('[name=usuario_id]').value) })),
  }));
  const fc = el.querySelector('[data-form="comissoes"]');
  if (fc) {
    fc.addEventListener('click', (e) => {
      if (e.target.closest('[data-rem]')) e.target.closest('tr').remove();
      if (e.target.closest('[data-add-com]')) fc.querySelector('tbody').append(fc.querySelector('template').content.cloneNode(true));
    });
  }
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

