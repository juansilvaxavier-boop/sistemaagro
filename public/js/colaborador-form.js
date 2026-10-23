// Cadastro completo do colaborador (usado em Cadastros → Colaboradores e no RH).
// Tudo que é escolha vem de listas: vínculo, cargo, departamento, equipe, carga horária, escala, banco etc.
import { get, post, put, esc, modal, campo, abas, lerForm, preencherForm, toast, state, pode, fmt, tentar } from './core.js';

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const opt = (lista, vazio = '—') => [['', vazio], ...lista];
const de = (o) => Object.entries(o);
const vals = (a) => a.map((x) => [x, x]);

async function gestores() {
  if (pode('rh')) return (await get('/api/rh/opcoes')).colaboradores;
  return (await get('/api/cadastros/colaboradores?all=1&f_ativo=1')).rows.map((c) => ({ id: c.id, nome: c.nome, cargo: c.cargo }));
}

/** Cargos agrupados por departamento (optgroup), mantendo o valor atual mesmo se saiu da lista. */
function selectCargo(cargos, atual) {
  const grupos = {};
  for (const c of cargos) (grupos[c.extra.departamento || 'Outros'] ||= []).push(c);
  const temAtual = !atual || cargos.some((c) => c.valor === atual);
  return `<div class="col-md-4"><label class="form-label">Cargo *</label><select class="form-select" name="cargo" required>
    <option value="">Selecione…</option>${temAtual ? '' : `<option value="${esc(atual)}">${esc(atual)} (fora da lista)</option>`}
    ${Object.entries(grupos).map(([g, l]) => `<optgroup label="${esc(g)}">${l.map((c) => `<option value="${esc(c.valor)}" data-funcao="${esc(c.extra.funcao || '')}" data-depto="${esc(c.extra.departamento || '')}">${esc(c.valor)}</option>`).join('')}</optgroup>`).join('')}
  </select>${pode('cadastros.listas') ? '<div class="form-text">Falta um cargo? Cadastre em <a href="#/cadastros/listas" data-fechar>Listas de opções</a>.</div>' : ''}</div>`;
}

/**
 * Abre o cadastro. modo: 'rh' (usa /api/rh) ou 'cadastros' (usa /api/cadastros).
 * aoSalvar(id) é chamado depois de salvar.
 */
export async function abrirFormColaborador(id, { modo = 'cadastros', aoSalvar } = {}) {
  const base = modo === 'rh' ? '/api/rh/colaboradores' : '/api/cadastros/colaboradores';
  const [registro, listaGestores] = await Promise.all([
    id ? get(`${base}/${id}`) : null,
    gestores().catch(() => []),
  ]);
  const c = registro ? (registro.colaborador || registro) : {
    tipo_contrato: 'clt', experiencia_dias: 90, data_admissao: hoje(), carga_horaria: 44, escala: '5x2', bate_ponto: 1, whatsapp: 1,
    nacionalidade: 'Brasileira', empresa_id: state.me.empresa.id, ativo: 1,
  };
  const docs = registro?.documentos || [];
  const O = state.opcoes.colaborador;
  const L = state.opcoes.listas;
  const gere = pode('rh.gerir');
  const ufs = vals(O.ufs);

  const pessoal = `<div class="row g-2">
    ${campo('nome', 'Nome completo', { col: 'col-md-6', required: true })}${campo('cpf', 'CPF', { col: 'col-md-3', attrs: 'inputmode="numeric"' })}
    ${campo('data_nascimento', 'Nascimento', { type: 'date', col: 'col-md-3' })}
    ${campo('rg', 'RG', { col: 'col-md-3' })}${campo('rg_orgao', 'Órgão emissor', { type: 'select', col: 'col-md-2', options: opt(vals(O.rg_orgao)) })}
    ${campo('rg_uf', 'UF do RG', { type: 'select', col: 'col-md-2', options: opt(ufs) })}
    ${campo('sexo', 'Sexo', { type: 'select', col: 'col-md-2', options: opt(de(O.sexo)) })}
    ${campo('estado_civil', 'Estado civil', { type: 'select', col: 'col-md-3', options: opt(vals(O.estado_civil)) })}
    ${campo('escolaridade', 'Escolaridade', { type: 'select', col: 'col-md-4', options: opt(vals(O.escolaridade)) })}
    ${campo('nacionalidade', 'Nacionalidade', { type: 'select', col: 'col-md-3', options: opt(vals(['Brasileira', 'Estrangeira'])) })}
    ${campo('naturalidade', 'Naturalidade (cidade/UF)', { col: 'col-md-5' })}
    ${campo('nome_mae', 'Nome da mãe', { col: 'col-md-6' })}${campo('pis', 'PIS/NIS', { col: 'col-md-3', attrs: 'inputmode="numeric"' })}
    ${campo('ctps', 'CTPS (nº/série)', { col: 'col-md-3' })}${campo('cnh', 'CNH', { col: 'col-md-3' })}</div>`;

  const contato = `<div class="row g-2">
    ${campo('celular', 'Celular', { col: 'col-md-3', attrs: 'inputmode="tel"' })}${campo('whatsapp', 'Celular é WhatsApp', { type: 'checkbox', col: 'col-md-3' })}
    ${campo('telefone', 'Telefone fixo', { col: 'col-md-3', attrs: 'inputmode="tel"' })}${campo('email', 'E-mail', { type: 'email', col: 'col-md-3' })}
    ${campo('contato_emergencia', 'Contato de emergência', { col: 'col-md-6' })}${campo('telefone_emergencia', 'Telefone de emergência', { col: 'col-md-3' })}
    <div class="col-12"><hr class="my-2"></div>
    ${campo('cep', 'CEP', { col: 'col-md-3', attrs: 'inputmode="numeric"', help: 'Digite o CEP: o endereço é preenchido sozinho.' })}
    ${campo('logradouro', 'Endereço', { col: 'col-md-7' })}${campo('numero', 'Número', { col: 'col-md-2' })}
    ${campo('complemento', 'Complemento', { col: 'col-md-4' })}${campo('bairro', 'Bairro', { col: 'col-md-4' })}
    ${campo('cidade', 'Cidade', { col: 'col-md-3' })}${campo('uf', 'UF', { type: 'select', col: 'col-md-1', options: opt(ufs, '') })}</div>`;

  const contrato = `<div class="row g-2">
    ${campo('tipo_contrato', 'Vínculo', { type: 'select', col: 'col-md-4', required: true, options: de(O.vinculos) })}
    ${selectCargo(L.cargo, c.cargo)}
    ${campo('departamento', 'Departamento', { type: 'select', col: 'col-md-4', options: opt(L.departamento.map((x) => [x.valor, x.valor]).concat(c.departamento && !L.departamento.some((x) => x.valor === c.departamento) ? [[c.departamento, c.departamento]] : [])) })}
    <div class="col-md-4" data-bloco-equipe><label class="form-label">Equipe <span data-eq-obrig class="text-danger d-none">*</span></label>
      <select class="form-select" name="equipe_id"><option value="">—</option>${state.opcoes.equipes.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('')}</select>
      <div class="form-text" data-eq-dica>Obrigatória para vendedores.</div></div>
    ${campo('gestor_id', 'Gestor direto', { type: 'select', col: 'col-md-4', options: opt(listaGestores.filter((g) => g.id !== Number(id)).map((g) => [g.id, `${g.nome}${g.cargo ? ' · ' + g.cargo : ''}`])) })}
    ${campo('empresa_id', 'Empresa', { type: 'select', col: 'col-md-4', options: state.opcoes.empresas.map((e) => [e.id, e.nome]) })}
    ${campo('data_admissao', 'Início / admissão', { type: 'date', col: 'col-md-3' })}
    ${campo('experiencia_dias', 'Experiência', { type: 'select', col: 'col-md-3', options: [['0', 'Sem experiência'], ['30', '30 dias'], ['45', '45 dias'], ['60', '60 dias'], ['90', '90 dias']] })}
    ${campo('carga_horaria', 'Carga horária', { type: 'select', col: 'col-md-3', options: opt(O.cargas.map((h) => [h, `${h} h por semana`])) })}
    ${campo('escala', 'Escala', { type: 'select', col: 'col-md-3', options: opt(de(O.escalas)) })}
    ${campo('bate_ponto', 'Bate ponto?', { type: 'select', col: 'col-md-3', options: [['1', 'Sim, registra ponto'], ['0', 'Não registra ponto']] })}
    ${gere ? campo('salario', 'Salário / honorário (R$)', { type: 'number', col: 'col-md-3', attrs: 'min="0" step="0.01"' }) : ''}
    <div class="col-12 d-none" data-bloco-pj><div class="row g-2 border rounded-3 p-2 mx-0 mt-1 bg-body-tertiary">
      <div class="col-12 small fw-semibold">Dados da empresa (PJ)</div>
      ${campo('cnpj', 'CNPJ', { col: 'col-md-4', attrs: 'inputmode="numeric"', help: 'Com o CNPJ, a razão social vem da Receita.' })}${campo('razao_social', 'Razão social', { col: 'col-md-8' })}</div></div>
    ${campo('ativo', 'Ativo (inativar também bloqueia o usuário)', { type: 'checkbox', col: 'col-md-6' })}
    ${campo('observacao', 'Observação', { type: 'textarea', col: 'col-12' })}</div>`;

  const banco = gere ? `<div class="row g-2">
    ${campo('banco', 'Banco', { type: 'select', col: 'col-md-5', options: opt(state.opcoes.bancos.map((b) => [b.nome, `${b.codigo} · ${b.nome}`]).concat(c.banco && !state.opcoes.bancos.some((b) => b.nome === c.banco) ? [[c.banco, c.banco]] : [])) })}
    ${campo('tipo_conta', 'Tipo de conta', { type: 'select', col: 'col-md-3', options: opt(de(O.tipo_conta)) })}
    ${campo('agencia', 'Agência', { col: 'col-md-2' })}${campo('conta', 'Conta', { col: 'col-md-2' })}${campo('chave_pix', 'Chave PIX', { col: 'col-md-6' })}</div>` : '';

  const documentos = `<div data-docs>
    <div class="alert alert-light border small d-none" data-aviso-contrato><i class="bi bi-file-earmark-text"></i> Para vendedor, anexe o <b>contrato assinado</b> (representação comercial ou contrato de trabalho).</div>
    <div class="row g-2 align-items-end">
      <div class="col-md-4"><label class="form-label">Tipo de documento</label><select class="form-select form-select-sm" data-doc-cat>
        ${['Contrato', 'Termo aditivo', 'Documento pessoal', 'Comprovante de endereço', 'Cartão do CNPJ', 'Certificado / curso', 'Outros'].map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label">Arquivo (PDF ou imagem)</label><input type="file" class="form-control form-control-sm" data-doc-arq accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"></div>
      <div class="col-md-2"><button type="button" class="btn btn-sm btn-outline-success w-100" data-doc-enviar ${id ? '' : 'disabled'}><i class="bi bi-upload"></i> Enviar</button></div>
    </div>
    ${id ? '' : '<div class="form-text">O arquivo escolhido é enviado junto ao salvar o cadastro.</div>'}
    <div class="mt-3" data-doc-lista>${listaDocs(docs)}</div></div>`;

  const m = modal({
    title: id ? `Colaborador · ${esc(c.nome)}` : 'Novo colaborador', size: 'xl',
    body: `<form novalidate>${abas([
      { id: 'pessoal', label: '<i class="bi bi-person"></i> Dados pessoais', html: pessoal },
      { id: 'contrato', label: '<i class="bi bi-briefcase"></i> Vínculo e cargo', html: contrato },
      { id: 'contato', label: '<i class="bi bi-geo-alt"></i> Contato e endereço', html: contato },
      ...(gere ? [{ id: 'banco', label: '<i class="bi bi-bank"></i> Dados bancários', html: banco }] : []),
      { id: 'docs', label: `<i class="bi bi-paperclip"></i> Documentos${docs.length ? ` (${docs.length})` : ''}`, html: documentos },
    ], 'colab')}</form>
    ${registro?.usuario ? `<div class="alert alert-light border mt-3 mb-0 small"><i class="bi bi-person-lock"></i> Usuário de acesso: <code>${esc(registro.usuario.login)}</code> · ${esc(state.me.perfis[registro.usuario.perfil] || '')}</div>` : ''}`,
    buttons: [{ label: '<i class="bi bi-check2"></i> Salvar', onClick: async ({ body }) => {
      const form = body.querySelector('form');
      const d = lerForm(form);
      if (!d.nome?.trim()) { toast('Informe o nome completo.', 'warning'); abrirAba(body, 'pessoal'); return false; }
      if (!d.cargo) { toast('Escolha o cargo.', 'warning'); abrirAba(body, 'contrato'); return false; }
      if (funcaoDoCargo(form) === 'vendedor' && !d.equipe_id) { toast('Vendedor precisa de uma equipe.', 'warning'); abrirAba(body, 'contrato'); return false; }
      const r = id ? await put(`${base}/${id}`, d) : await post(base, d);
      const novoId = id || r.id;
      const arq = body.querySelector('[data-doc-arq]');
      if (!id && arq.files[0]) await enviarDoc(novoId, arq.files[0], body.querySelector('[data-doc-cat]').value).catch((e) => toast(`Cadastro salvo, mas o arquivo não foi enviado: ${e.message}`, 'warning'));
      toast(id ? 'Cadastro atualizado.' : 'Colaborador cadastrado.');
      aoSalvar?.(novoId);
    } }],
  });
  const b = m.body;
  const form = b.querySelector('form');
  preencherForm(form, { ...c, bate_ponto: String(c.bate_ponto ?? 1), experiencia_dias: String(c.experiencia_dias ?? 90), carga_horaria: c.carga_horaria ?? '' });
  b.querySelectorAll('[data-fechar]').forEach((a) => a.addEventListener('click', () => m.close()));

  const vinculo = form.querySelector('[name=tipo_contrato]');
  const cargoSel = form.querySelector('[name=cargo]');
  const atualizar = (origem) => {
    const pj = vinculo.value === 'pj';
    b.querySelector('[data-bloco-pj]').classList.toggle('d-none', !pj);
    if (origem === 'vinculo') form.querySelector('[name=bate_ponto]').value = O.sem_clt.includes(vinculo.value) ? '0' : '1';
    const funcao = funcaoDoCargo(form);
    const vendedor = funcao === 'vendedor';
    b.querySelector('[data-eq-obrig]').classList.toggle('d-none', !vendedor);
    form.querySelector('[name=equipe_id]').required = vendedor;
    b.querySelector('[data-eq-dica]').textContent = vendedor ? 'Obrigatória: a equipe define supervisor, gerente e comissões.' : 'Usada por vendedores, supervisores e gerentes.';
    b.querySelector('[data-aviso-contrato]').classList.toggle('d-none', !vendedor);
    if (origem === 'cargo') {
      const depto = cargoSel.selectedOptions[0]?.dataset.depto;
      if (depto) form.querySelector('[name=departamento]').value = depto;
    }
  };
  vinculo.addEventListener('change', () => atualizar('vinculo'));
  cargoSel.addEventListener('change', () => atualizar('cargo'));
  atualizar();

  b.querySelector('[data-doc-enviar]').addEventListener('click', async () => {
    const arq = b.querySelector('[data-doc-arq]');
    if (!arq.files[0]) return toast('Escolha o arquivo.', 'warning');
    if (await tentar(() => enviarDoc(id, arq.files[0], b.querySelector('[data-doc-cat]').value), 'Documento anexado.')) {
      arq.value = '';
      const novo = await get(`${base}/${id}`);
      b.querySelector('[data-doc-lista]').innerHTML = listaDocs(novo.documentos || []);
    }
  });
}

function funcaoDoCargo(form) {
  return form.querySelector('[name=cargo]').selectedOptions[0]?.dataset.funcao || '';
}
function abrirAba(body, aba) {
  const btn = [...body.querySelectorAll('.nav-link')].find((x) => x.dataset.bsTarget?.endsWith(`-${aba}`));
  if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

function listaDocs(docs) {
  if (!docs.length) return '<div class="text-body-secondary small">Nenhum documento anexado.</div>';
  return `<ul class="list-group">${docs.map((d) => `<li class="list-group-item d-flex align-items-center gap-2 small">
    <i class="bi ${d.categoria === 'Contrato' ? 'bi-file-earmark-check text-success' : 'bi-file-earmark'}"></i>
    <a href="/api/rh/documentos/${d.id}?inline=1" target="_blank" rel="noopener">${esc(d.nome_original)}</a>
    <span class="badge text-bg-secondary">${esc(d.categoria || '')}</span><span class="ms-auto text-body-secondary">${fmt.datetime(d.created_at)}</span></li>`).join('')}</ul>`;
}

async function enviarDoc(colabId, arquivo, categoria) {
  const fd = new FormData();
  fd.append('arquivo', arquivo);
  fd.append('categoria', categoria);
  const r = await fetch(`/api/rh/colaboradores/${colabId}/documentos`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'agroterra' } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Falha no envio.');
  return r.json();
}
