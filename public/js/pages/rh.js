// RH e DP: painel, ficha do colaborador, férias, ponto e ocorrências, solicitações e eventos da folha.
import {
  get, post, put, del, esc, fmt, titulo, abas, DataTable, modal, campo, opcoes, lerForm, preencherForm, toast, tentar, pode, btnAcao, tabelaSimples,
  pedirTexto, confirmar, kpi, baixar, erro,
} from '../core.js';

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const opts = (mapa, vazio) => [...(vazio ? [['', vazio]] : []), ...Object.entries(mapa)];
const SIT_FERIAS = { em_aquisicao: ['Em aquisição', 'secondary'], a_gozar: ['A gozar', 'primary'], vence_logo: ['Vence em breve', 'warning'], vencida: ['Vencida', 'danger'], gozadas: ['Gozadas', 'success'], em_dia: ['Em dia', 'success'] };
const ST_FERIAS = { solicitada: ['Solicitada', 'warning'], aprovada: ['Aprovada', 'success'], recusada: ['Recusada', 'danger'], cancelada: ['Cancelada', 'secondary'] };
const ST_SOL = { aberta: ['Aberta', 'warning'], aprovada: ['Aprovada', 'success'], recusada: ['Recusada', 'danger'], concluida: ['Concluída', 'secondary'] };
const bdg = (mapa, v) => { const [l, c] = mapa[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };
let O = null;
const carregarOpcoes = async () => (O = await get('/api/rh/opcoes'));

export default async function (conteudo, { params: [tela] }) {
  await carregarOpcoes();
  const telas = { painel, colaboradores, ferias, ocorrencias, solicitacoes, folha };
  return (telas[tela || 'painel'] || painel)(conteudo);
}

// ---------- Painel ----------
async function painel(conteudo) {
  const pagina = titulo(conteudo, 'Painel do RH', 'bi-person-workspace');
  const d = await get('/api/rh/painel');
  pagina.innerHTML = `<div class="kpis mb-3">
      ${kpi('Colaboradores ativos', fmt.num(d.ativos), { icone: 'bi-people', link: '#/rh/colaboradores', sub: `${d.admissoes_mes} admissões e ${d.desligamentos_mes} desligamentos no mês` })}
      ${kpi('Turnover (12 meses)', fmt.pct(d.turnover_12m), { icone: 'bi-arrow-left-right', cor: 'info' })}
      ${kpi('Solicitações abertas', fmt.num(d.solicitacoes), { icone: 'bi-inbox', cor: d.solicitacoes ? 'warning' : 'success', link: '#/rh/solicitacoes' })}
      ${kpi('Férias', fmt.num(d.em_ferias), { icone: 'bi-sun', cor: d.ferias_vencidas ? 'danger' : 'primary', link: '#/rh/ferias', sub: `em férias hoje · ${d.ferias_pendentes} para aprovar · ${d.ferias_vencidas} vencidas` })}
      ${d.folha_base != null ? kpi('Custo mensal (salários + benefícios)', fmt.money(d.folha_base + d.beneficios), { icone: 'bi-cash-stack', cor: 'secondary', sub: `${fmt.money(d.folha_base)} em salários`, link: '#/rh/folha' }) : ''}
    </div>
    <div class="row g-3"><div class="col-lg-8"><div class="card h-100"><div class="card-header py-2"><i class="bi bi-bell"></i> Alertas e prazos</div><div class="card-body">
      ${d.alertas.length ? d.alertas.map((a) => `<div class="d-flex gap-2 align-items-start mb-2"><i class="bi ${a.tipo === 'erro' ? 'bi-x-octagon text-danger' : 'bi-exclamation-triangle text-warning'}"></i>
        <div><a href="#" data-colab="${a.colaborador_id}">${esc(a.nome)}</a> · ${esc(a.texto)}</div></div>`).join('') : '<div class="vazio py-3"><i class="bi bi-check2-circle"></i>Nenhum prazo vencendo.</div>'}
    </div></div></div><div class="col-lg-4">
      <div class="card mb-3"><div class="card-header py-2"><i class="bi bi-cake2"></i> Aniversariantes do mês</div><div class="card-body small">
        ${d.aniversariantes.map((a) => `<div class="d-flex justify-content-between py-1 border-bottom"><span>${esc(a.nome)}</span><span class="text-body-secondary">dia ${a.dia}</span></div>`).join('') || '<div class="text-body-secondary">Nenhum.</div>'}</div></div>
      <div class="card"><div class="card-header py-2"><i class="bi bi-diagram-3"></i> Pessoas por departamento</div><div class="card-body small">
        ${d.por_departamento.map((x) => `<div class="d-flex justify-content-between py-1"><span>${esc(x.nome)}</span><b>${x.n}</b></div>`).join('')}</div></div>
    </div></div>`;
  pagina.querySelectorAll('[data-colab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); abrirFicha(Number(a.dataset.colab)); }));
}

// ---------- Colaboradores ----------
function colaboradores(conteudo) {
  const gere = pode('rh.gerir');
  const pagina = titulo(conteudo, 'Colaboradores', 'bi-person-vcard', gere ? '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-person-plus"></i> Admitir colaborador</button>' : '');
  const t = new DataTable(pagina, {
    url: '/api/rh/colaboradores', title: 'Colaboradores', sort: 'nome', dir: 'asc', filtrosIniciais: { situacao: 'ativo' },
    columns: [
      { k: 'nome', l: 'Nome', render: (v, r) => `<b>${esc(v)}</b>${r.solicitacoes ? ` <span class="badge text-bg-warning" title="Solicitações abertas">${r.solicitacoes}</span>` : ''}` },
      { k: 'cargo', l: 'Cargo' }, { k: 'departamento', l: 'Departamento', filter: { options: O.departamentos.map((x) => [x, x]) } },
      { k: 'tipo_contrato', l: 'Contrato', filter: { options: opts(O.contratos) }, render: (v) => esc(O.contratos[v] || v || '') },
      { k: 'data_admissao', l: 'Admissão', t: 'date' }, { k: 'anos_casa', l: 'Anos de casa', t: 'num' }, { k: 'gestor', l: 'Gestor' },
      ...(pode('rh.gerir') || pode('rh.folha') ? [{ k: 'salario', l: 'Salário', t: 'money' }] : []),
      { k: 'cpf', l: 'CPF', t: 'doc' }, { k: 'telefone', l: 'Telefone' }, { k: 'login', l: 'Usuário' },
      { k: 'situacao', l: 'Situação', filter: { options: [['ativo', 'Ativo'], ['desligado', 'Desligado']] }, render: (v, r) => (v === 'ativo' ? '<span class="badge text-bg-success">Ativo</span>' : `<span class="badge text-bg-secondary">Desligado ${fmt.date(r.data_desligamento)}</span>`) },
    ],
    rowClick: (r) => abrirFicha(r.id, () => t.reload()),
    // Acesso ao sistema direto da lista (antes ficava só em Cadastros → Colaboradores).
    ...(pode('cadastros.usuario') ? {
      actions: (r) => (r.usuario_id ? btnAcao('usuario', 'bi-person-lock', 'Editar usuário de acesso') : r.situacao === 'ativo' ? btnAcao('criar', 'bi-person-plus', 'Criar usuário de acesso', 'outline-success') : ''),
      onAction: {
        criar: async (r) => { const { abrirUsuario } = await import('./usuarios.js'); abrirUsuario(null, () => t.reload(), r); },
        usuario: async (r) => { const { abrirUsuario } = await import('./usuarios.js'); abrirUsuario(r.usuario_id, () => t.reload()); },
      },
    } : {}),
  });
  conteudo.querySelector('#btn-novo')?.addEventListener('click', () => editarColaborador(null, (id) => { t.reload(); abrirFicha(id, () => t.reload()); }));
}

async function editarColaborador(id, aoSalvar) {
  const { abrirFormColaborador } = await import('../colaborador-form.js');
  return abrirFormColaborador(id, { modo: 'rh', aoSalvar: async (novo) => { await carregarOpcoes(); aoSalvar?.(novo); } });
}

export async function abrirFicha(id, aoMudar) {
  const d = await get(`/api/rh/colaboradores/${id}`);
  const c = d.colaborador;
  const g = d.pode_gerir;
  const desligado = !!c.data_desligamento;
  const reabrir = () => { m.close(); aoMudar?.(); abrirFicha(id, aoMudar); };
  const info = (l, v) => `<div class="col-md-3 col-6"><div class="small text-body-secondary">${l}</div><div>${v || '—'}</div></div>`;
  const lista = [
    { id: 'resumo', label: '<i class="bi bi-person"></i> Resumo', html: `<div class="row g-3 mb-3">
      ${info('Cargo', esc(c.cargo))}${info('Departamento', esc(c.departamento || c.setor))}${info('Contrato', esc(O.contratos[c.tipo_contrato] || c.tipo_contrato))}${info('Admissão', fmt.date(c.data_admissao))}
      ${info('Jornada', esc(c.jornada))}${info('Ponto', c.bate_ponto === 0 ? 'Não registra ponto' : 'Registra ponto')}${c.salario !== undefined ? info('Salário', fmt.money(c.salario)) : ''}${info('CPF', fmt.doc(c.cpf))}${info('Nascimento', fmt.date(c.data_nascimento))}
      ${info('Telefone', esc(c.telefone))}${info('E-mail', esc(c.email))}${info('Cidade', esc([c.cidade, c.uf].filter(Boolean).join('/')))}${info('Usuário no sistema', d.usuario ? `<code>${esc(d.usuario.login)}</code>${d.usuario.ativo ? '' : ' (inativo)'}` : 'sem acesso')}
      ${info('Banco de horas', `<b class="${d.banco_horas < 0 ? 'text-danger' : ''}">${fmt.num(d.banco_horas)} h</b>`)}
      ${desligado ? info('Desligamento', `${fmt.date(c.data_desligamento)} · ${esc(O.desligamentos[c.tipo_desligamento] || '')}`) : ''}</div>
      <h6>Histórico do contrato</h6>${tabelaSimples([{ k: 'data', l: 'Data', t: 'date' }, { k: 'tipo', l: 'Tipo', render: (v) => esc(O.historico[v] || v) }, { k: 'cargo', l: 'Cargo' },
        { k: 'departamento', l: 'Departamento' }, ...(c.salario !== undefined ? [{ k: 'salario', l: 'Salário', t: 'money' }] : []), { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'usuario', l: 'Por' }], d.historico)}` },
    { id: 'ferias', label: '<i class="bi bi-sun"></i> Férias', html: `
      ${tabelaSimples([{ k: 'inicio', l: 'Período aquisitivo', render: (v, r) => `${fmt.date(v)} a ${fmt.date(r.fim)}` }, { k: 'faltas', l: 'Faltas', t: 'num' }, { k: 'direito', l: 'Direito', t: 'num' },
        { k: 'usados', l: 'Usados', t: 'num' }, { k: 'pendentes', l: 'Aguardando', t: 'num' }, { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'limite_concessivo', l: 'Conceder até', t: 'date' },
        { k: 'situacao', l: 'Situação', render: (v) => bdg(SIT_FERIAS, v) }], d.periodos, { vazio: 'Sem períodos (informe a admissão; PJ e autônomo não têm férias).' })}
      ${g && !desligado ? '<button class="btn btn-sm btn-success mt-2" data-ferias><i class="bi bi-calendar-plus"></i> Programar férias</button>' : ''}
      <h6 class="mt-3">Programações</h6>${tabelaSimples([{ k: 'inicio', l: 'Início', t: 'date' }, { k: 'fim', l: 'Fim', t: 'date' }, { k: 'dias', l: 'Dias', t: 'num' }, { k: 'abono_dias', l: 'Abono', t: 'num' },
        { k: 'status', l: 'Status', render: (v) => bdg(ST_FERIAS, v) }, { k: 'observacao', l: 'Observação' }, { k: 'id', l: '', render: (v, r) => (g && ['solicitada', 'aprovada'].includes(r.status) ? `<button class="btn btn-sm btn-outline-danger py-0" data-cancelar-ferias="${v}">Cancelar</button>` : '') }], d.ferias)}` },
    { id: 'ponto', label: '<i class="bi bi-clock"></i> Ponto e ocorrências', html: `${g && !desligado ? '<button class="btn btn-sm btn-success mb-2" data-ocorrencia><i class="bi bi-plus-lg"></i> Lançar ocorrência</button>' : ''}
      ${tabelaSimples([{ k: 'data', l: 'Data', t: 'date' }, { k: 'tipo', l: 'Tipo', render: (v) => esc(O.ocorrencias[v] || v) }, { k: 'horas', l: 'Horas', t: 'num' }, { k: 'dias', l: 'Dias', t: 'num' },
        { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'arquivo_id', l: 'Anexo', render: (v) => (v ? `<a href="/api/rh/documentos/${v}?inline=1" target="_blank"><i class="bi bi-paperclip"></i></a>` : '') }, { k: 'usuario', l: 'Por' },
        { k: 'id', l: '', render: (v) => (g ? `<button class="btn btn-sm btn-outline-danger py-0" data-del-oc="${v}">&times;</button>` : '') }], d.ocorrencias)}` },
    { id: 'beneficios', label: '<i class="bi bi-gift"></i> Benefícios', html: sub('beneficios', d.beneficios, [{ k: 'tipo', l: 'Benefício', render: (v) => esc(O.beneficios[v] || v) }, { k: 'descricao', l: 'Descrição' },
      { k: 'valor_empresa', l: 'Custo empresa', t: 'money' }, { k: 'valor_desconto', l: 'Desconto do colaborador', t: 'money' }, { k: 'inicio', l: 'Início', t: 'date' }, { k: 'ativo', l: 'Ativo', t: 'bool' }], g) },
    { id: 'dependentes', label: '<i class="bi bi-people"></i> Dependentes', html: sub('dependentes', d.dependentes, [{ k: 'nome', l: 'Nome' }, { k: 'parentesco', l: 'Parentesco' }, { k: 'data_nascimento', l: 'Nascimento', t: 'date' },
      { k: 'cpf', l: 'CPF', t: 'doc' }, { k: 'irrf', l: 'IRRF', t: 'bool' }, { k: 'salario_familia', l: 'Salário-família', t: 'bool' }], g) },
    { id: 'exames', label: '<i class="bi bi-heart-pulse"></i> Exames (ASO)', html: sub('exames', d.exames, [{ k: 'tipo', l: 'Tipo', render: (v) => esc(O.exames[v] || v) }, { k: 'data', l: 'Data', t: 'date' },
      { k: 'validade', l: 'Validade', render: (v) => (v && v < hoje() ? `<span class="text-danger fw-semibold">${fmt.date(v)}</span>` : fmt.date(v)) }, { k: 'resultado', l: 'Resultado' }, { k: 'clinica', l: 'Clínica' }], g) },
    { id: 'docs', label: '<i class="bi bi-folder2"></i> Documentos', html: `${g ? `<form class="row g-2 mb-3" data-doc><div class="col-md-3"><select class="form-select form-select-sm" name="categoria">${['Contrato de trabalho', 'Documento pessoal', 'Comprovante de residência', 'ASO', 'Atestado', 'Certificado/curso', 'Advertência assinada', 'Outros'].map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="col-md-4"><input class="form-control form-control-sm" name="descricao" placeholder="Descrição"></div><div class="col-md-3"><input type="file" class="form-control form-control-sm" name="arquivo" required></div>
      <div class="col-md-2"><button class="btn btn-sm btn-success w-100"><i class="bi bi-upload"></i> Enviar</button></div></form>` : ''}
      ${tabelaSimples([{ k: 'categoria', l: 'Categoria' }, { k: 'descricao', l: 'Descrição' }, { k: 'nome_original', l: 'Arquivo', render: (v, r) => `<a href="/api/rh/documentos/${r.id}?inline=1" target="_blank">${esc(v)}</a>` },
        { k: 'tamanho', l: 'Tamanho', render: (v) => `${fmt.num(v / 1024)} KB` }, { k: 'created_at', l: 'Enviado em', t: 'datetime' }, { k: 'usuario', l: 'Por' },
        { k: 'id', l: '', render: (v) => (g ? `<button class="btn btn-sm btn-outline-danger py-0" data-del-doc="${v}">&times;</button>` : '') }], d.documentos, { vazio: 'Nenhum documento.' })}` },
  ];
  const botoes = [];
  if (g) botoes.push({ label: '<i class="bi bi-pencil"></i> Editar ficha', cls: 'btn-outline-primary', onClick: () => { editarColaborador(id, reabrir); } });
  if (g && !desligado) botoes.push({ label: '<i class="bi bi-box-arrow-right"></i> Desligar', cls: 'btn-outline-danger', onClick: () => { desligar(c, reabrir); return false; } });
  if (g && desligado) botoes.push({ label: 'Desfazer desligamento', cls: 'btn-outline-secondary', onClick: async () => { if (await tentar(() => post(`/api/rh/colaboradores/${id}/reativar`), 'Desligamento desfeito.')) reabrir(); return false; } });
  const m = modal({ title: `${esc(c.nome)} ${desligado ? '<span class="badge text-bg-secondary">Desligado</span>' : ''}`, size: 'xl', body: abas(lista, 'ficha'), buttons: botoes });
  const b = m.body;
  b.querySelector('[data-ferias]')?.addEventListener('click', () => programarFerias(c, d.periodos, reabrir));
  b.querySelector('[data-ocorrencia]')?.addEventListener('click', () => lancarOcorrencia(c.id, reabrir));
  b.querySelectorAll('[data-cancelar-ferias]').forEach((x) => x.addEventListener('click', async () => {
    if (await confirmar('Cancelar estas férias?', { ok: 'Cancelar férias', cls: 'btn-danger' }) && await tentar(() => post(`/api/rh/ferias/${x.dataset.cancelarFerias}/status`, { status: 'cancelada' }), 'Férias canceladas.')) reabrir();
  }));
  b.querySelectorAll('[data-del-oc]').forEach((x) => x.addEventListener('click', async () => { if (await confirmar('Excluir esta ocorrência?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/rh/ocorrencias/${x.dataset.delOc}`))) reabrir(); }));
  b.querySelectorAll('[data-del-doc]').forEach((x) => x.addEventListener('click', async () => { if (await confirmar('Excluir este documento?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/rh/documentos/${x.dataset.delDoc}`))) reabrir(); }));
  b.querySelector('[data-doc]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await tentar(() => post(`/api/rh/colaboradores/${id}/documentos`, new FormData(e.target)), 'Documento enviado.')) reabrir();
  });
  b.querySelectorAll('[data-add-sub]').forEach((x) => x.addEventListener('click', () => editarSub(id, x.dataset.addSub, null, reabrir)));
  b.querySelectorAll('[data-edit-sub]').forEach((x) => x.addEventListener('click', () => {
    const [s, itemId] = x.dataset.editSub.split(':');
    editarSub(id, s, d[s].find((i) => i.id === Number(itemId)), reabrir);
  }));
}

function sub(nome, linhas, colunas, g) {
  return `${g ? `<button class="btn btn-sm btn-success mb-2" data-add-sub="${nome}"><i class="bi bi-plus-lg"></i> Adicionar</button>` : ''}
    ${tabelaSimples([...colunas, ...(g ? [{ k: 'id', l: '', render: (v) => `<button class="btn btn-sm btn-outline-secondary py-0" data-edit-sub="${nome}:${v}"><i class="bi bi-pencil"></i></button>` }] : [])], linhas)}`;
}

function editarSub(colabId, nome, item, aoSalvar) {
  const forms = {
    beneficios: () => `${campo('tipo', 'Benefício', { type: 'select', col: 'col-md-6', options: opts(O.beneficios) })}${campo('descricao', 'Descrição', { col: 'col-md-6' })}
      ${campo('valor_empresa', 'Custo para a empresa (R$/mês)', { type: 'number', col: 'col-md-6', attrs: 'step="0.01" min="0"' })}${campo('valor_desconto', 'Desconto do colaborador (R$/mês)', { type: 'number', col: 'col-md-6', attrs: 'step="0.01" min="0"' })}
      ${campo('inicio', 'Início', { type: 'date', col: 'col-md-4' })}${campo('fim', 'Fim', { type: 'date', col: 'col-md-4' })}${campo('ativo', 'Ativo', { type: 'checkbox', col: 'col-md-4', value: 1 })}`,
    dependentes: () => `${campo('nome', 'Nome', { col: 'col-md-8', required: true })}${campo('parentesco', 'Parentesco', { type: 'select', col: 'col-md-4', options: ['Filho(a)', 'Cônjuge', 'Companheiro(a)', 'Enteado(a)', 'Pai/Mãe', 'Outro'].map((x) => [x, x]) })}
      ${campo('data_nascimento', 'Nascimento', { type: 'date', col: 'col-md-4' })}${campo('cpf', 'CPF', { col: 'col-md-4' })}<div class="col-md-4"></div>
      ${campo('irrf', 'Dependente para IRRF', { type: 'checkbox', col: 'col-md-6' })}${campo('salario_familia', 'Salário-família', { type: 'checkbox', col: 'col-md-6' })}`,
    exames: () => `${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-6', options: opts(O.exames) })}${campo('data', 'Data', { type: 'date', col: 'col-md-3', value: hoje() })}
      ${campo('validade', 'Validade', { type: 'date', col: 'col-md-3', help: 'Em branco: 1 ano.' })}${campo('resultado', 'Resultado', { type: 'select', col: 'col-md-4', options: [['apto', 'Apto'], ['inapto', 'Inapto'], ['apto_restricao', 'Apto com restrição']] })}
      ${campo('clinica', 'Clínica', { col: 'col-md-8' })}${campo('observacao', 'Observação', { col: 'col-12' })}`,
  };
  const m = modal({
    title: item ? 'Editar' : 'Adicionar', size: 'lg', body: `<form class="row g-2">${forms[nome]()}</form>`,
    buttons: [
      ...(item ? [{ label: '<i class="bi bi-trash"></i> Excluir', cls: 'btn-outline-danger', onClick: async () => { await del(`/api/rh/colaboradores/${colabId}/${nome}/${item.id}`); toast('Excluído.'); aoSalvar(); } }] : []),
      { label: 'Salvar', onClick: async ({ body }) => {
        const d = lerForm(body.querySelector('form'));
        item ? await put(`/api/rh/colaboradores/${colabId}/${nome}/${item.id}`, d) : await post(`/api/rh/colaboradores/${colabId}/${nome}`, d);
        toast('Salvo.');
        aoSalvar();
      } },
    ],
  });
  if (item) preencherForm(m.body.querySelector('form'), item);
}

function programarFerias(c, periodos, aoSalvar) {
  const disp = periodos.filter((p) => p.completo && p.saldo > 0);
  if (!disp.length) return toast('Não há período aquisitivo completo com saldo.', 'warning');
  modal({
    title: `Programar férias · ${esc(c.nome)}`, size: 'lg',
    body: `<form class="row g-2">
      ${campo('aquisitivo_inicio', 'Período aquisitivo', { type: 'select', col: 'col-md-6', options: disp.reverse().map((p) => [p.inicio, `${fmt.date(p.inicio)} a ${fmt.date(p.fim)} · saldo ${p.saldo} dias · até ${fmt.date(p.limite_concessivo)}`]) })}
      ${campo('inicio', 'Início do gozo', { type: 'date', col: 'col-md-3', required: true })}${campo('dias', 'Dias de gozo', { type: 'number', col: 'col-md-3', value: 30, attrs: 'min="5" max="30"' })}
      ${campo('abono_dias', 'Dias vendidos (abono)', { type: 'number', col: 'col-md-4', value: 0, attrs: 'min="0" max="10"' })}${campo('adiantar_13', 'Adiantar 1ª parcela do 13º', { type: 'checkbox', col: 'col-md-4' })}
      <div class="col-md-4 small text-body-secondary d-flex align-items-end" data-fim></div>
      ${campo('observacao', 'Observação', { col: 'col-12' })}</form>
      <div class="form-text">Regras da CLT: até 3 períodos, um deles com 14 dias ou mais e nenhum com menos de 5; abono de até 1/3. O aviso ao colaborador deve ser dado com 30 dias de antecedência e o pagamento até 2 dias antes do início.</div>`,
    onShow: ({ body }) => {
      const f = body.querySelector('form');
      const calc = () => {
        const ini = f.inicio.value;
        const dias = Number(f.dias.value) || 0;
        if (!ini || !dias) { body.querySelector('[data-fim]').textContent = ''; return; }
        const volta = new Date(ini + 'T12:00:00');
        volta.setDate(volta.getDate() + dias);
        body.querySelector('[data-fim]').textContent = `Retorno ao trabalho em ${volta.toLocaleDateString('pt-BR')}`;
      };
      f.addEventListener('input', calc);
    },
    buttons: [{ label: 'Programar', onClick: async ({ body }) => {
      await post('/api/rh/ferias', { ...lerForm(body.querySelector('form')), colaborador_id: c.id });
      toast('Férias programadas.');
      aoSalvar?.();
    } }],
  });
}

function lancarOcorrencia(colabId, aoSalvar) {
  modal({
    title: 'Lançar ocorrência', size: 'lg',
    body: `<form class="row g-2">
      ${colabId ? '' : campo('colaborador_id', 'Colaborador', { type: 'select', col: 'col-md-6', required: true, options: opcoes(O.colaboradores) })}
      ${campo('tipo', 'Tipo', { type: 'select', col: colabId ? 'col-md-6' : 'col-md-6', options: opts(O.ocorrencias) })}
      ${campo('data', 'Data', { type: 'date', col: 'col-md-3', value: hoje(), required: true })}
      ${campo('horas', 'Horas', { type: 'number', col: 'col-md-3', attrs: 'step="0.25" min="0"' })}${campo('dias', 'Dias', { type: 'number', col: 'col-md-3', attrs: 'step="0.5" min="0"' })}
      ${campo('descricao', 'Descrição', { col: 'col-md-9' })}
      <div class="col-12"><label class="form-label">Anexo (atestado, advertência assinada...)</label><input type="file" class="form-control form-control-sm" name="arquivo"></div></form>
      <div class="form-text">Horas extras, faltas, atrasos e suspensões do mês viram eventos da folha ao clicar em <b>Gerar eventos</b> na tela da Folha.</div>`,
    buttons: [{ label: 'Lançar', onClick: async ({ body }) => {
      const fd = new FormData(body.querySelector('form'));
      if (colabId) fd.append('colaborador_id', colabId);
      await post('/api/rh/ocorrencias', fd);
      toast('Ocorrência lançada.');
      aoSalvar?.();
    } }],
  });
}

function desligar(c, aoSalvar) {
  modal({
    title: `Desligar · ${esc(c.nome)}`, size: 'md',
    body: `<form class="row g-2">${campo('data', 'Data do desligamento', { type: 'date', col: 'col-md-6', value: hoje(), required: true })}
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-6', options: opts(O.desligamentos) })}${campo('motivo', 'Motivo / observação', { type: 'textarea', col: 'col-12' })}</form>
      <div class="alert alert-warning small mt-2 mb-0">O acesso da pessoa ao sistema é encerrado na hora. Rescisão, aviso prévio e verbas ficam com a contabilidade.</div>`,
    buttons: [{ label: 'Confirmar desligamento', cls: 'btn-danger', onClick: async ({ body }) => {
      await post(`/api/rh/colaboradores/${c.id}/desligar`, lerForm(body.querySelector('form')));
      toast('Desligamento registrado.');
      await carregarOpcoes();
      aoSalvar?.();
    } }],
  });
}

// ---------- Férias ----------
async function ferias(conteudo) {
  const pagina = titulo(conteudo, 'Férias', 'bi-sun');
  const carregar = async () => {
    const d = await get('/api/rh/ferias');
    const g = pode('rh.gerir');
    pagina.innerHTML = abas([
      { id: 'prog', label: `<i class="bi bi-calendar-week"></i> Programação (${d.programadas.length})`, html: tabelaSimples([
        { k: 'colaborador', l: 'Colaborador' }, { k: 'departamento', l: 'Departamento' }, { k: 'inicio', l: 'Início', t: 'date' }, { k: 'fim', l: 'Fim', t: 'date' },
        { k: 'dias', l: 'Dias', t: 'num' }, { k: 'abono_dias', l: 'Abono', t: 'num' }, { k: 'status', l: 'Status', render: (v) => bdg(ST_FERIAS, v) }, { k: 'observacao', l: 'Observação' },
        { k: 'id', l: '', render: (v, r) => (g && r.status === 'solicitada' ? `<button class="btn btn-sm btn-success py-0" data-aprovar="${v}">Aprovar</button> <button class="btn btn-sm btn-outline-danger py-0" data-recusar="${v}">Recusar</button>` : '') },
      ], d.programadas, { vazio: 'Nenhuma férias programada.' }) },
      { id: 'saldos', label: '<i class="bi bi-hourglass-split"></i> Saldos e prazos', html: tabelaSimples([
        { k: 'colaborador', l: 'Colaborador', render: (v, r) => `<a href="#" data-colab="${r.colaborador_id}">${esc(v)}</a>` }, { k: 'departamento', l: 'Departamento' }, { k: 'admissao', l: 'Admissão', t: 'date' },
        { k: 'saldo', l: 'Saldo vencido (dias)', t: 'num' }, { k: 'periodos_abertos', l: 'Períodos em aberto', t: 'num' }, { k: 'limite', l: 'Conceder até', t: 'date' },
        { k: 'proporcional', l: 'Proporcional atual', t: 'num' }, { k: 'situacao', l: 'Situação', render: (v) => bdg(SIT_FERIAS, v) },
      ], d.saldos.sort((a, b) => ['vencida', 'vence_logo', 'a_gozar', 'em_dia'].indexOf(a.situacao) - ['vencida', 'vence_logo', 'a_gozar', 'em_dia'].indexOf(b.situacao))) },
    ], 'fer');
    pagina.querySelectorAll('[data-aprovar]').forEach((b) => b.addEventListener('click', async () => { if (await tentar(() => post(`/api/rh/ferias/${b.dataset.aprovar}/status`, { status: 'aprovada' }), 'Férias aprovadas.')) carregar(); }));
    pagina.querySelectorAll('[data-recusar]').forEach((b) => b.addEventListener('click', async () => {
      const resposta = await pedirTexto('Motivo da recusa', { titulo: 'Recusar férias' });
      if (resposta && await tentar(() => post(`/api/rh/ferias/${b.dataset.recusar}/status`, { status: 'recusada', resposta }), 'Férias recusadas.')) carregar();
    }));
    pagina.querySelectorAll('[data-colab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); abrirFicha(Number(a.dataset.colab), carregar); }));
  };
  await carregar();
}

// ---------- Ponto e ocorrências ----------
function ocorrencias(conteudo) {
  const pagina = titulo(conteudo, 'Ponto e Ocorrências', 'bi-clock-history', pode('rh.gerir') ? '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Lançar ocorrência</button>' : '');
  const t = new DataTable(pagina, {
    url: '/api/rh/ocorrencias', title: 'Ocorrências', sort: 'data', dir: 'desc',
    columns: [
      { k: 'data', l: 'Data', t: 'date' }, { k: 'colaborador', l: 'Colaborador' }, { k: 'departamento', l: 'Departamento' },
      { k: 'tipo', l: 'Tipo', filter: { options: opts(O.ocorrencias) }, render: (v) => esc(O.ocorrencias[v] || v) },
      { k: 'horas', l: 'Horas', t: 'num' }, { k: 'dias', l: 'Dias', t: 'num' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'arquivo_id', l: 'Anexo', filter: false, render: (v) => (v ? `<a href="/api/rh/documentos/${v}?inline=1" target="_blank"><i class="bi bi-paperclip"></i></a>` : '') }, { k: 'lancado_por', l: 'Lançado por' },
    ],
    rowClick: (r) => abrirFicha(r.colaborador_id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo')?.addEventListener('click', () => lancarOcorrencia(null, () => t.reload()));
}

// ---------- Solicitações ----------
function solicitacoes(conteudo) {
  const pagina = titulo(conteudo, 'Solicitações dos Colaboradores', 'bi-inbox');
  const t = new DataTable(pagina, {
    url: '/api/rh/solicitacoes', title: 'Solicitações', sort: 'id', dir: 'desc', filtrosIniciais: { status: 'aberta' },
    columns: [
      { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'colaborador', l: 'Colaborador' }, { k: 'departamento', l: 'Departamento' },
      { k: 'tipo', l: 'Tipo', filter: { options: opts(O.solicitacoes) }, render: (v) => esc(O.solicitacoes[v] || v) }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'data_inicio', l: 'De', t: 'date' }, { k: 'data_fim', l: 'Até', t: 'date' },
      { k: 'arquivo_id', l: 'Anexo', filter: false, render: (v) => (v ? `<a href="/api/rh/documentos/${v}?inline=1" target="_blank"><i class="bi bi-paperclip"></i></a>` : '') },
      { k: 'status', l: 'Status', filter: { options: Object.entries(ST_SOL).map(([k, [l]]) => [k, l]) }, render: (v) => bdg(ST_SOL, v) }, { k: 'resposta', l: 'Resposta', cls: 'quebra' }, { k: 'respondido_por', l: 'Respondido por' },
    ],
    actions: (r) => (r.status === 'aberta' && pode('rh.gerir') ? btnAcao('responder', 'bi-reply', 'Responder', 'outline-success') : ''),
    onAction: { responder: (r) => modal({
      title: `Responder · ${esc(r.colaborador)}`, size: 'lg',
      body: `<p class="mb-2"><b>${esc(O.solicitacoes[r.tipo])}</b>: ${esc(r.descricao)}</p>${r.tipo === 'ferias' ? '<div class="alert alert-info small py-2">Ao aprovar, as férias ficam aprovadas na programação.</div>' : ''}
        ${r.tipo === 'atestado' ? '<div class="alert alert-info small py-2">Ao aceitar, o atestado entra no ponto como dias abonados.</div>' : ''}
        <form class="row g-2">${campo('status', 'Resultado', { type: 'select', col: 'col-md-4', options: [['concluida', 'Atendida/concluída'], ['aprovada', 'Aprovada'], ['recusada', 'Recusada']] })}
        ${campo('resposta', 'Resposta ao colaborador', { type: 'textarea', col: 'col-12' })}</form>`,
      buttons: [{ label: 'Enviar resposta', onClick: async ({ body }) => { await post(`/api/rh/solicitacoes/${r.id}/responder`, lerForm(body.querySelector('form'))); toast('Resposta enviada.'); t.reload(); } }],
    }) },
    rowClick: (r) => abrirFicha(r.colaborador_id),
  });
}

// ---------- Folha (eventos do mês) ----------
async function folha(conteudo) {
  const pagina = titulo(conteudo, 'Folha: Eventos do Mês', 'bi-cash-stack', `<input type="month" class="form-control form-control-sm" id="comp" value="${hoje().slice(0, 7)}" style="width:auto">`);
  const compEl = conteudo.querySelector('#comp');
  const carregar = async () => {
    const [d, cm] = await Promise.all([get(`/api/rh/folha?competencia=${compEl.value}`), get(`/api/rh/folha/comissoes?competencia=${compEl.value}`)]);
    const aberta = !d.fechada;
    const DEST = { folha: ['Na folha', 'success'], contas_pagar: ['Contas a pagar', 'info'] };
    const blocoComissoes = cm.linhas.length || cm.aguardando_revisao.n ? `<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><i class="bi bi-percent"></i> Comissões ${aberta ? 'que esta folha vai pagar' : 'pagas nesta competência'}
        <span class="ms-auto small text-muted">Total ${fmt.money(cm.linhas.reduce((a, l) => a + l.liquido, 0))}</span></div>
      ${cm.aguardando_revisao.n ? `<div class="alert alert-warning py-2 m-2 small"><i class="bi bi-hourglass-split"></i> ${cm.aguardando_revisao.n} comissão(ões) (${fmt.money(cm.aguardando_revisao.valor)}) ainda <b>aguardam a revisão do Financeiro</b> e ficam para a próxima folha. <a href="#/financeiro/comissoes">Revisar comissões</a></div>` : ''}
      ${cm.linhas.length ? `<div class="table-responsive"><table class="table table-sm mb-0 align-middle"><thead><tr><th>Vendedor</th><th>Pagamento</th><th>Períodos</th><th class="num">Comissões</th><th class="num">Créditos</th><th class="num">Descontos</th><th class="num">Líquido</th></tr></thead><tbody>
        ${cm.linhas.map((l) => `<tr><td>${esc(l.nome)}${l.sem_cadastro ? ' <span class="badge text-bg-warning" title="Usuário sem cadastro de colaborador">sem cadastro</span>' : ''}</td>
          <td><span class="badge text-bg-${DEST[l.destino][1]}">${DEST[l.destino][0]}</span>${l.vinculo && l.destino !== 'folha' ? ` <span class="small text-muted">${esc(l.vinculo)}</span>` : ''}</td>
          <td class="small">${esc(l.periodos || '—')} · ${l.comissoes}</td><td class="num">${fmt.money(l.valor)}</td><td class="num text-success">${fmt.money(l.creditos)}</td><td class="num text-danger">${fmt.money(l.descontos)}</td><td class="num fw-semibold">${fmt.money(l.liquido)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div class="small text-muted px-3 py-2">CLT: entram como evento ao <b>Gerar eventos automáticos</b>. PJ, autônomo e sem cadastro: o <b>fechamento</b> lança a conta a pagar. Ao fechar, as comissões ficam marcadas como pagas; reabrir desfaz.</div></div>` : '';
    pagina.innerHTML = `<div class="alert alert-light border small"><i class="bi bi-info-circle"></i> Aqui o DP reúne os eventos variáveis do mês (horas extras, faltas, comissões, descontos de benefícios, prêmios)
      para enviar à contabilidade. O cálculo de INSS, IRRF, FGTS e do líquido fica com a contabilidade. Valores de horas são estimativas pelo divisor da carga horária de cada contrato (44 h → 220, 40 h → 200).</div>
      <div class="kpis mb-3">${kpi('Salários base', fmt.money(d.totais.salarios), { icone: 'bi-wallet2' })}${kpi('Proventos variáveis', fmt.money(d.totais.proventos), { icone: 'bi-plus-circle', cor: 'success' })}
        ${kpi('Descontos', fmt.money(d.totais.descontos), { icone: 'bi-dash-circle', cor: 'danger' })}${kpi('Situação', d.fechada ? 'Fechada' : 'Aberta', { icone: d.fechada ? 'bi-lock' : 'bi-unlock', cor: d.fechada ? 'secondary' : 'warning', sub: d.fechada ? `por ${esc(d.fechamento.usuario || '')} em ${fmt.datetime(d.fechamento.fechado_em)}` : 'pode lançar e gerar eventos' })}</div>
      <div class="d-flex gap-2 mb-3 flex-wrap no-print">
        ${aberta ? '<button class="btn btn-sm btn-success" data-gerar><i class="bi bi-magic"></i> Gerar eventos automáticos</button><button class="btn btn-sm btn-outline-success" data-novo><i class="bi bi-plus-lg"></i> Lançar evento</button>' : ''}
        <button class="btn btn-sm btn-outline-success" data-exportar><i class="bi bi-file-earmark-excel"></i> Exportar para a contabilidade</button>
        ${aberta ? '<button class="btn btn-sm btn-outline-secondary ms-auto" data-fechar><i class="bi bi-lock"></i> Fechar competência</button>' : (pode('rh.gerir') ? '<button class="btn btn-sm btn-outline-danger ms-auto" data-reabrir><i class="bi bi-unlock"></i> Reabrir</button>' : '')}
      </div>
      ${blocoComissoes}
      <div class="card"><div class="table-responsive"><table class="table table-sm mb-0 align-middle"><thead><tr><th>Colaborador</th><th>Cargo</th><th>Contrato</th><th class="num">Salário</th><th>Eventos</th><th class="num">Proventos</th><th class="num">Descontos</th></tr></thead><tbody>
      ${d.linhas.map((l) => `<tr><td><b>${esc(l.nome)}</b>${l.admitido_no_mes ? ' <span class="badge text-bg-success">admitido</span>' : ''}${l.desligado_no_mes ? ' <span class="badge text-bg-secondary">desligado</span>' : ''}</td>
        <td class="small">${esc(l.cargo || '')}</td><td class="small">${esc(l.tipo_contrato || '')}</td><td class="num">${fmt.money(l.salario)}</td>
        <td class="small">${l.eventos.map((e) => `<div class="d-flex gap-1 align-items-center"><span class="${e.tipo === 'provento' ? 'text-success' : 'text-danger'}">${e.tipo === 'provento' ? '+' : '−'}</span>
          <span>${esc(e.evento)}${e.referencia ? ` <span class="text-body-secondary">(${esc(e.referencia)})</span>` : ''}: <b>${fmt.money(e.valor)}</b></span>
          ${e.origem !== 'manual' ? '<span class="badge text-bg-light" title="Gerado automaticamente">auto</span>' : ''}
          ${aberta ? `<button class="btn btn-link btn-sm p-0" data-edit-ev="${e.id}" title="Ajustar valor"><i class="bi bi-pencil"></i></button><button class="btn btn-link btn-sm p-0 text-danger" data-del-ev="${e.id}" title="Excluir"><i class="bi bi-x"></i></button>` : ''}</div>`).join('') || '<span class="text-body-secondary">—</span>'}</td>
        <td class="num text-success">${fmt.money(l.proventos)}</td><td class="num text-danger">${fmt.money(l.descontos)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const comp = d.competencia;
    pagina.querySelector('[data-gerar]')?.addEventListener('click', async () => {
      const r = await tentar(() => post('/api/rh/folha/gerar', { competencia: comp }));
      if (r) { toast(`${r.eventos} eventos gerados para ${r.colaboradores} colaboradores.`); carregar(); }
    });
    pagina.querySelector('[data-novo]')?.addEventListener('click', () => modal({
      title: 'Lançar evento', size: 'lg',
      body: `<form class="row g-2">${campo('colaborador_id', 'Colaborador', { type: 'select', col: 'col-md-6', required: true, options: opcoes(d.linhas.map((l) => ({ id: l.id, nome: l.nome }))) })}
        ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-3', options: [['provento', 'Provento'], ['desconto', 'Desconto']] })}${campo('valor', 'Valor (R$)', { type: 'number', col: 'col-md-3', required: true, attrs: 'step="0.01" min="0"' })}
        ${campo('evento', 'Evento', { col: 'col-md-6', required: true, attrs: 'list="eventos-comuns"' })}${campo('referencia', 'Referência', { col: 'col-md-6', attrs: 'placeholder="ex.: 10 h, 2 dias, 40%"' })}
        <datalist id="eventos-comuns">${['Adiantamento salarial', 'Prêmio/bonificação', 'Adicional noturno', 'Insalubridade', 'Periculosidade', 'Ajuda de custo', 'Desconto de empréstimo consignado', 'Pensão alimentícia', 'Desconto de farmácia', 'Reembolso de despesas'].map((x) => `<option value="${x}">`).join('')}</datalist>
        ${campo('observacao', 'Observação', { col: 'col-12' })}</form>`,
      buttons: [{ label: 'Lançar', onClick: async ({ body }) => { await post('/api/rh/folha/eventos', { ...lerForm(body.querySelector('form')), competencia: comp }); toast('Evento lançado.'); carregar(); } }],
    }));
    pagina.querySelectorAll('[data-edit-ev]').forEach((b) => b.addEventListener('click', async () => {
      const ev = d.linhas.flatMap((l) => l.eventos).find((e) => e.id === Number(b.dataset.editEv));
      const v = await pedirTexto(`Novo valor para "${esc(ev.evento)}" (ajustado à mão, deixa de ser recalculado)`, { titulo: 'Ajustar evento', valor: String(ev.valor) });
      if (v !== null && await tentar(() => put(`/api/rh/folha/eventos/${ev.id}`, { valor: Number(String(v).replace(',', '.')) }), 'Evento ajustado.')) carregar();
    }));
    pagina.querySelectorAll('[data-del-ev]').forEach((b) => b.addEventListener('click', async () => { if (await tentar(() => del(`/api/rh/folha/eventos/${b.dataset.delEv}`))) carregar(); }));
    pagina.querySelector('[data-exportar]').addEventListener('click', () => tentar(() => baixar(`/api/rh/folha/exportar?competencia=${comp}`, `eventos_folha_${comp}.xlsx`)));
    pagina.querySelector('[data-fechar]')?.addEventListener('click', async () => {
      if (await confirmar(`Fechar a competência ${comp.split('-').reverse().join('/')}? Depois disso não dá para lançar ocorrências nem eventos neste mês.`, { ok: 'Fechar' })
        ) {
        const r = await tentar(() => post('/api/rh/folha/fechar', { competencia: comp }));
        if (r) { toast(`Competência fechada. Comissões de ${r.comissoes.vendedores} vendedor(es) marcadas como pagas${r.comissoes.contas_pagar ? `; ${r.comissoes.contas_pagar} conta(s) a pagar lançada(s) para PJ/autônomos` : ''}.`); carregar(); }
      }
    });
    pagina.querySelector('[data-reabrir]')?.addEventListener('click', async () => {
      const motivo = await pedirTexto('Motivo da reabertura', { titulo: 'Reabrir competência' });
      if (motivo && await tentar(() => post('/api/rh/folha/reabrir', { competencia: comp, motivo }), 'Competência reaberta.')) carregar();
    });
  };
  compEl.addEventListener('change', () => carregar().catch(erro));
  await carregar();
}

