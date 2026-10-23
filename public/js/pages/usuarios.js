// Colaboradores (pessoas) e Usuários (acesso ao sistema) com permissões individuais.
import {
  get, post, put, esc, titulo, DataTable, modal, campo, opcoes, lerForm, preencherForm, toast, state, btnAcao, abas, pode, erro,
} from '../core.js';

export default async function (conteudo, { params: [tela] }) {
  return tela === 'colaboradores' ? colaboradores(conteudo) : usuarios(conteudo);
}

// ---------- Colaboradores ----------
function colaboradores(conteudo) {
  const pagina = titulo(conteudo, 'Colaboradores', 'bi-person-vcard', '<button class="btn btn-primary btn-sm" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo colaborador</button>');
  pagina.insertAdjacentHTML('beforebegin', '<p class="text-body-secondary mt-n2 mb-3">Cadastre aqui as pessoas da empresa. Depois crie o usuário de acesso de cada uma, com o perfil e as permissões dela.</p>');
  const t = new DataTable(pagina, {
    url: '/api/cadastros/colaboradores', title: 'Colaboradores', sort: 'nome', dir: 'asc',
    columns: [
      { k: 'nome', l: 'Nome' }, { k: 'cpf', l: 'CPF', t: 'doc' }, { k: 'cargo', l: 'Cargo' }, { k: 'setor', l: 'Setor' }, { k: 'email', l: 'E-mail' },
      { k: 'telefone', l: 'Telefone' }, { k: 'empresa', l: 'Empresa' }, { k: 'data_admissao', l: 'Admissão', t: 'date' },
      { k: 'login', l: 'Usuário', render: (v, r) => (v ? `<code>${esc(v)}</code> <small class="text-body-secondary">${esc(state.me.perfis[r.perfil] || '')}</small>` : '<span class="text-body-secondary">sem acesso</span>') },
      { k: 'ativo', l: 'Ativo', t: 'bool', filter: { options: [['1', 'Sim'], ['0', 'Não']] } },
    ],
    actions: (r) => (r.usuario_id ? btnAcao('usuario', 'bi-person-lock', 'Editar usuário') : pode('cadastros.usuario') ? btnAcao('criar', 'bi-person-plus', 'Criar usuário', 'outline-success') : ''),
    onAction: {
      criar: (r) => abrirUsuario(null, () => t.reload(), r),
      usuario: (r) => abrirUsuario(r.usuario_id, () => t.reload()),
    },
    rowClick: (r) => abrirColaborador(r.id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => abrirColaborador(null, () => t.reload()));
}

async function abrirColaborador(id, aoSalvar) {
  const c = id ? await get(`/api/cadastros/colaboradores/${id}`) : { ativo: 1, empresa_id: state.me.empresa.id };
  const m = modal({
    title: id ? `Colaborador: ${esc(c.nome)}` : 'Novo colaborador', size: 'lg',
    body: `<form class="row g-3">
      ${campo('nome', 'Nome completo', { col: 'col-md-8', required: true })}${campo('cpf', 'CPF', { col: 'col-md-4', attrs: 'inputmode="numeric"' })}
      ${campo('cargo', 'Cargo', { col: 'col-md-4' })}
      ${campo('setor', 'Setor', { type: 'select', col: 'col-md-4', options: [['', '—'], ...['Vendas', 'Supervisão', 'Análise de crédito', 'Diretoria', 'Financeiro', 'Cobrança', 'Produção', 'Faturamento', 'Expedição', 'Administração'].map((s) => [s, s])] })}
      ${campo('data_admissao', 'Admissão', { type: 'date', col: 'col-md-4' })}
      ${campo('email', 'E-mail', { type: 'email', col: 'col-md-6' })}${campo('telefone', 'Telefone', { col: 'col-md-6' })}
      ${campo('empresa_id', 'Empresa', { type: 'select', col: 'col-md-6', options: opcoes(state.opcoes.empresas, '—') })}
      ${campo('ativo', 'Ativo (inativar também bloqueia o usuário)', { type: 'checkbox', col: 'col-md-6' })}
      ${campo('observacao', 'Observação', { type: 'textarea', col: 'col-12' })}
      ${c.usuario ? `<div class="col-12"><div class="alert alert-light border mb-0"><i class="bi bi-person-lock"></i> Usuário de acesso: <code>${esc(c.usuario.login)}</code> · ${esc(state.me.perfis[c.usuario.perfil])}</div></div>` : ''}
    </form>`,
    buttons: [{ label: '<i class="bi bi-check2"></i> Salvar', onClick: async ({ body }) => {
      const d = lerForm(body.querySelector('form'));
      id ? await put(`/api/cadastros/colaboradores/${id}`, d) : await post('/api/cadastros/colaboradores', d);
      toast('Colaborador salvo.');
      aoSalvar?.();
    } }],
  });
  preencherForm(m.body.querySelector('form'), c);
}

// ---------- Usuários ----------
let cachePerm;
const permissoes = async () => (cachePerm ||= await get('/api/cadastros/permissoes'));

function usuarios(conteudo) {
  const pagina = titulo(conteudo, 'Usuários e Permissões', 'bi-person-lock', '<button class="btn btn-primary btn-sm" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo usuário</button>');
  const t = new DataTable(pagina, {
    url: '/api/cadastros/usuarios', title: 'Usuários', sort: 'nome', dir: 'asc',
    columns: [
      { k: 'nome', l: 'Nome', render: (v, r) => `${esc(v)}${r.bloqueado ? ' <span class="badge text-bg-danger">bloqueado</span>' : ''}` },
      { k: 'login', l: 'Login', render: (v) => `<code>${esc(v)}</code>` }, { k: 'cargo', l: 'Cargo' },
      { k: 'perfil', l: 'Perfil', filter: { options: Object.entries(state.me.perfis) }, render: (v) => esc(state.me.perfis[v] || v) },
      { k: 'permissoes', l: 'Permissões', filter: { options: [['Padrão do perfil', 'Padrão do perfil'], ['Personalizadas', 'Personalizadas']] },
        render: (v) => (v === 'Personalizadas' ? '<span class="badge text-bg-warning">Personalizadas</span>' : '<span class="text-body-secondary">Padrão do perfil</span>') },
      { k: 'equipe', l: 'Equipe' }, { k: 'empresas', l: 'Empresas' }, { k: 'ultimo_acesso', l: 'Último acesso', t: 'datetime' },
      { k: 'ativo', l: 'Ativo', t: 'bool', filter: { options: [['1', 'Sim'], ['0', 'Não']] } },
    ],
    rowClick: (r) => abrirUsuario(r.id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => abrirUsuario(null, () => t.reload()));
}

function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (n, i) => (i % 4 === 3 ? nums[n % nums.length] : letras[n % letras.length])).join('');
}

export async function abrirUsuario(id, aoSalvar, colaborador) {
  const [perm, colabs] = await Promise.all([permissoes(), get('/api/cadastros/colaboradores?all=1&f_ativo=1')]);
  const u = id ? await get(`/api/cadastros/usuarios/${id}`) : {
    ativo: 1, perfil: 'vendedor', empresas: [state.me.empresa.id], colaborador_id: colaborador?.id, login: sugerirLogin(colaborador?.nome), permissoes: [],
  };
  const livres = colabs.rows.filter((c) => !c.usuario_id || c.usuario_id === id);
  if (!id && !livres.length) {
    toast('Cadastre primeiro o colaborador em Cadastros → Colaboradores.', 'warning');
    location.hash = '#/cadastros/colaboradores';
    return;
  }
  const grupos = perm.catalogo.map(([g, itens]) => `<div class="permissao-grupo"><div class="fw-semibold small text-uppercase text-body-secondary mb-1">${esc(g)}</div>
    ${itens.map(([k, l]) => `<div class="form-check"><input class="form-check-input" type="checkbox" id="p-${k}" data-perm="${k}"><label class="form-check-label small" for="p-${k}">${esc(l)}</label></div>`).join('')}</div>`).join('');
  const dados = `<form class="row g-3" data-dados>
    ${campo('colaborador_id', 'Colaborador', { type: 'select', col: 'col-md-6', required: true, options: [['', 'Selecione…'], ...livres.map((c) => [c.id, `${c.nome}${c.cargo ? ' · ' + c.cargo : ''}`])] })}
    ${campo('login', 'Login', { col: 'col-md-3', required: true, attrs: 'autocapitalize="none" pattern="[a-z0-9._-]{3,40}"' })}
    ${campo('perfil', 'Perfil de acesso', { type: 'select', col: 'col-md-3', options: Object.entries(perm.perfis) })}
    ${campo('equipe_id', 'Equipe (vendedores)', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.equipes, '—') })}
    ${campo('comissao_pct', 'Comissão padrão (%)', { type: 'number', col: 'col-md-4', attrs: 'step="0.01" min="0" max="100"' })}
    ${campo('ativo', 'Usuário ativo', { type: 'checkbox', col: 'col-md-4' })}
    <div class="col-md-6"><label class="form-label">Empresas liberadas</label>${state.opcoes.empresas.map((e) => `<div class="form-check">
      <input class="form-check-input" type="checkbox" data-empresa="${e.id}" id="emp-${e.id}" ${u.empresas?.includes(e.id) ? 'checked' : ''}><label class="form-check-label" for="emp-${e.id}">${esc(e.nome)}</label></div>`).join('')}</div>
    <div class="col-md-6"><label class="form-label" for="senha-u">${id ? 'Nova senha provisória (opcional)' : 'Senha provisória'}</label>
      <div class="input-group"><input class="form-control" id="senha-u" name="senha" autocomplete="new-password" ${id ? '' : 'required'}>
      <button type="button" class="btn btn-outline-secondary" data-gerar>Gerar</button></div>
      <div class="form-text">A pessoa troca a senha no primeiro acesso. Mín. 8 caracteres com letras e números.</div></div>
    ${u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString() ? '<div class="col-12"><div class="alert alert-danger d-flex align-items-center gap-2 mb-0"><i class="bi bi-lock"></i> Bloqueado por tentativas de senha erradas. <button type="button" class="btn btn-sm btn-danger ms-auto" data-desbloquear>Desbloquear</button></div></div>' : ''}
  </form>`;
  const permHtml = `<div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" id="personalizar" ${u.personalizadas ? 'checked' : ''}>
    <label class="form-check-label" for="personalizar"><strong>Personalizar permissões deste usuário</strong><br><small class="text-body-secondary">Desligado: usa as permissões padrão do perfil escolhido.</small></label></div>
    <div class="d-flex gap-2 mb-3"><button type="button" class="btn btn-sm btn-outline-secondary" data-marcar="1">Marcar todas</button><button type="button" class="btn btn-sm btn-outline-secondary" data-marcar="0">Desmarcar todas</button>
    <button type="button" class="btn btn-sm btn-outline-secondary" data-restaurar>Copiar do perfil</button></div>
    <div class="colunas-perm" data-perms>${grupos}</div>`;
  const m = modal({
    title: id ? `Usuário: ${esc(u.nome)}` : 'Novo usuário', size: 'xl',
    body: abas([{ id: 'dados', label: '<i class="bi bi-person"></i> Acesso', html: dados }, { id: 'perm', label: '<i class="bi bi-ui-checks"></i> Permissões', html: permHtml }], 'usr'),
    buttons: [{ label: '<i class="bi bi-check2"></i> Salvar', onClick: async ({ body }) => {
      const f = body.querySelector('[data-dados]');
      if (!f.reportValidity()) return false;
      const d = lerForm(f);
      d.empresas = [...body.querySelectorAll('[data-empresa]:checked')].map((x) => Number(x.dataset.empresa));
      if (!d.empresas.length) { toast('Libere ao menos uma empresa.', 'warning'); return false; }
      d.personalizadas = body.querySelector('#personalizar').checked ? 1 : 0;
      if (d.personalizadas) d.permissoes = [...body.querySelectorAll('[data-perm]:checked')].map((x) => x.dataset.perm);
      if (!d.senha) delete d.senha;
      d.colaborador_id = Number(d.colaborador_id);
      const r = id ? await put(`/api/cadastros/usuarios/${id}`, d) : await post('/api/cadastros/usuarios', d);
      if (d.senha) {
        modal({ title: 'Senha provisória', size: 'md', body: `<p>Envie ao usuário por um canal seguro. Ele troca a senha no primeiro acesso.</p>
          <div class="input-group"><input class="form-control" readonly value="${esc(d.senha)}" id="sp"><button class="btn btn-outline-secondary" type="button" id="copiar">Copiar</button></div>
          <p class="small text-body-secondary mt-2 mb-0">Login: <code>${esc(d.login)}</code></p>`,
          onShow: ({ body: b }) => b.querySelector('#copiar').addEventListener('click', () => navigator.clipboard?.writeText(d.senha).then(() => toast('Senha copiada.')).catch(() => b.querySelector('#sp').select())) });
      } else toast('Usuário salvo.');
      aoSalvar?.(r.id);
    } }],
  });
  const b = m.body;
  preencherForm(b.querySelector('[data-dados]'), u);
  const caixas = [...b.querySelectorAll('[data-perm]')];
  const marcar = (lista) => caixas.forEach((c) => { c.checked = lista.includes(c.dataset.perm); });
  const perfilSel = b.querySelector('[name=perfil]');
  const sincronizar = () => {
    const pers = b.querySelector('#personalizar').checked;
    caixas.forEach((c) => { c.disabled = !pers; });
    b.querySelectorAll('[data-marcar],[data-restaurar]').forEach((x) => { x.disabled = !pers; });
    if (!pers) marcar(perm.padrao[perfilSel.value] || []);
  };
  marcar(u.personalizadas ? u.permissoes : perm.padrao[u.perfil] || []);
  sincronizar();
  perfilSel.addEventListener('change', sincronizar);
  b.querySelector('#personalizar').addEventListener('change', sincronizar);
  b.querySelectorAll('[data-marcar]').forEach((x) => x.addEventListener('click', () => caixas.forEach((c) => { c.checked = x.dataset.marcar === '1'; })));
  b.querySelector('[data-restaurar]').addEventListener('click', () => marcar(perm.padrao[perfilSel.value] || []));
  b.querySelector('[data-gerar]').addEventListener('click', () => { b.querySelector('#senha-u').value = gerarSenha(); });
  b.querySelector('[name=colaborador_id]').addEventListener('change', (e) => {
    const c = livres.find((x) => x.id === Number(e.target.value));
    const l = b.querySelector('[name=login]');
    if (c && !l.value) l.value = sugerirLogin(c.nome);
  });
  b.querySelector('[data-desbloquear]')?.addEventListener('click', async () => {
    await post(`/api/cadastros/usuarios/${id}/desbloquear`).catch(erro);
    toast('Usuário desbloqueado.');
    m.close();
    aoSalvar?.();
  });
}

function sugerirLogin(nome) {
  if (!nome) return '';
  const p = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  return p.length > 1 ? `${p[0]}.${p.at(-1)}` : p[0] || '';
}

