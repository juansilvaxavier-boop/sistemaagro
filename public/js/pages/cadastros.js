// Cadastros (menu Registro): produto, forma de pagamento, transportadoras, fornecedores, usuários, equipes, empresas e senha.
import {
  get, post, put, esc, titulo, abas, DataTable, EditorLista, modal, campo, opcoes, lerForm, preencherForm, toast, state, erro,
} from '../core.js';

export default async function (conteudo, { params: [tela], modo }) {
  if (modo === 'senha') return senha(conteudo);
  const telas = { produtos, formas, transportadoras, fornecedores, equipes, empresas, listas, comissao };
  if (!telas[tela]) { conteudo.innerHTML = '<div class="vazio">Tela não encontrada.</div>'; return; }
  return telas[tela](conteudo);
}

const recarregarOpcoes = async () => { state.opcoes = await get('/api/cadastros/opcoes'); };
const ATIVO = { k: 'ativo', l: 'Ativo', t: 'bool', filter: { options: [['1', 'Sim'], ['0', 'Não']] } };

// ---------- Produto ----------
function produtos(conteudo) {
  const pagina = titulo(conteudo, 'Produto', 'bi-box', '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo produto</button>');
  const t = new DataTable(pagina, {
    url: '/api/cadastros/produtos', title: 'Produtos', sort: 'nome', dir: 'asc',
    columns: [
      { k: 'codigo', l: 'Código' }, { k: 'nome', l: 'Produto' }, { k: 'grupo', l: 'Grupo', filter: { options: state.opcoes.grupos.map((g) => [g.nome, g.nome]) } },
      { k: 'unidade', l: 'Un' }, { k: 'ncm', l: 'NCM' }, { k: 'cst', l: 'CST' }, { k: 'gtin', l: 'GTIN' }, { k: 'reducao_bc', l: 'Red. BC %', t: 'num' },
      { k: 'perigoso', l: 'Perigoso', t: 'bool' }, { k: 'origem', l: 'Origem', filter: { options: [['nacional', 'Nacional'], ['adquirido', 'Adquirido']] } },
      { k: 'qtd_ecommerce', l: 'Qtd e-commerce', t: 'num' }, { k: 'embalagens', l: 'Embalagens', t: 'num' }, ATIVO,
    ],
    rowClick: (r) => abrirProduto(r.id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => abrirProduto(null, () => t.reload()));
}

async function abrirProduto(id, aoSalvar) {
  const p = id ? await get(`/api/cadastros/produtos/${id}`) : { ativo: 1, origem: 'nacional', unidade: 'KG', embalagens: [], brindes: [], precos: [] };
  const geral = `<form data-geral class="row g-2">
    ${campo('codigo', 'Código', { col: 'col-md-2' })}${campo('nome', 'Nome', { col: 'col-md-6', required: true })}
    ${campo('grupo_id', 'Grupo', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.grupos) })}
    ${campo('unidade', 'Unidade', { type: 'select', col: 'col-md-2', options: [['KG', 'KG'], ['L', 'L'], ['UN', 'UN'], ['T', 'T']] })}
    ${campo('ncm', 'NCM', { col: 'col-md-2' })}${campo('cst', 'CST', { col: 'col-md-2' })}${campo('cfop', 'CFOP', { col: 'col-md-2' })}
    ${campo('gtin', 'GTIN/EAN', { col: 'col-md-4' })}
    ${campo('reducao_bc', 'Redução base de cálculo (%)', { type: 'number', col: 'col-md-3', attrs: 'step="0.01"' })}
    ${campo('origem', 'Origem', { type: 'select', col: 'col-md-3', options: [['nacional', 'Nacional (fabricação própria)'], ['adquirido', 'Adquirido de terceiros']] })}
    ${campo('qtd_ecommerce', 'Quantidade padrão e-commerce', { type: 'number', col: 'col-md-3' })}
    ${campo('prazo_producao_dias', 'Prazo de produção (dias)', { type: 'number', col: 'col-md-3' })}
    ${campo('perigoso', 'Produto perigoso', { type: 'checkbox', col: 'col-md-3' })}${campo('ativo', 'Ativo', { type: 'checkbox', col: 'col-md-3' })}</form>`;
  const m = modal({
    title: id ? `Produto: ${esc(p.nome)}` : 'Novo produto', size: 'xl',
    body: abas([
      { id: 'geral', label: 'Geral', html: geral },
      { id: 'emb', label: 'Embalagem', html: '<div data-emb></div>' },
      { id: 'brinde', label: 'Brinde', html: '<p class="small text-muted">Na compra da quantidade mínima deste produto, o cliente ganha o brinde.</p><div data-brinde></div>' },
      { id: 'preco', label: 'Tabela de Preço', html: '<p class="small text-muted">Salve as embalagens antes de definir preços para embalagens novas. Preço sem forma de pagamento vale para todas.</p><div data-preco></div>' },
    ], 'prod'),
    buttons: [{ label: '<i class="bi bi-save"></i> Salvar', onClick: async ({ body }) => {
      const dados = { ...lerForm(body.querySelector('[data-geral]')), embalagens: emb.valores(), brindes: brinde.valores(), precos: preco.valores() };
      if (!dados.nome) { toast('Informe o nome.', 'warning'); return false; }
      const r = id ? await put(`/api/cadastros/produtos/${id}`, dados) : await post('/api/cadastros/produtos', dados);
      toast('Produto salvo.');
      await recarregarOpcoes();
      aoSalvar?.(r.id);
    } }],
  });
  preencherForm(m.body.querySelector('[data-geral]'), p);
  const emb = new EditorLista(m.body.querySelector('[data-emb]'), [
    { k: 'descricao', l: 'Descrição' }, { k: 'quantidade', l: 'Quantidade', type: 'number' },
    { k: 'unidade', l: 'Unidade', type: 'select', options: [['KG', 'KG'], ['L', 'L'], ['UN', 'UN']] }, { k: 'custo', l: 'Custo por embalagem', type: 'number' },
    { k: 'peso_kg', l: 'Peso bruto (kg)', type: 'number' }, { k: 'estoque_minimo', l: 'Estoque mínimo', type: 'number' },
  ], p.embalagens, { novo: { unidade: p.unidade }, rotuloAdd: 'Embalagem' });
  const brinde = new EditorLista(m.body.querySelector('[data-brinde]'), [
    { k: 'brinde_produto_id', l: 'Produto brinde', type: 'select', options: opcoes(state.opcoes.produtos) }, { k: 'qtd_minima', l: 'Qtd mínima comprada', type: 'number' },
    { k: 'qtd_brinde', l: 'Qtd do brinde', type: 'number' }, { k: 'observacao', l: 'Observação' },
  ], p.brindes, { rotuloAdd: 'Regra de brinde' });
  const preco = new EditorLista(m.body.querySelector('[data-preco]'), [
    { k: 'embalagem_id', l: 'Embalagem', type: 'select', options: [['', '—'], ...p.embalagens.map((e) => [e.id, e.descricao])] },
    { k: 'forma_id', l: 'Forma de pagamento', type: 'select', options: opcoes(state.opcoes.formas, 'Todas') },
    { k: 'valor', l: 'Valor', type: 'number' }, { k: 'vigencia_inicio', l: 'Vigência a partir de', type: 'date' },
  ], p.precos, { rotuloAdd: 'Preço' });
}

// ---------- Forma de Pagamento ----------
function formas(conteudo) {
  const pagina = titulo(conteudo, 'Forma de Pagamento', 'bi-credit-card', '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Nova forma</button>');
  const t = new DataTable(pagina, {
    url: '/api/cadastros/formas-pagamento', title: 'Formas de pagamento', sort: 'nome', dir: 'asc',
    columns: [{ k: 'nome', l: 'Forma' }, { k: 'tipo', l: 'Tipo', render: (v) => (v === 'a_vista' ? 'À vista' : 'A prazo') }, { k: 'tipo_baixa', l: 'Tipo de baixa' },
      { k: 'condicoes', l: 'Condições', t: 'num' }, { k: 'penalidades', l: 'Faixas de penalidade', t: 'num' }, ATIVO],
    rowClick: (r) => abrirForma(r.id, () => t.reload()),
  });
  conteudo.querySelector('#btn-novo').addEventListener('click', () => abrirForma(null, () => t.reload()));
}

async function abrirForma(id, aoSalvar) {
  const f = id ? await get(`/api/cadastros/formas-pagamento/${id}`) : { ativo: 1, tipo: 'prazo', condicoes: [], penalidades: [] };
  const m = modal({
    title: id ? `Forma: ${esc(f.nome)}` : 'Nova forma de pagamento', size: 'xl',
    body: `<form data-geral class="row g-2 mb-3">${campo('nome', 'Nome', { col: 'col-md-5', required: true })}
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-md-3', options: [['prazo', 'A prazo'], ['a_vista', 'À vista (passa pela Cobrança)']] })}
      ${campo('tipo_baixa', 'Tipo de baixa padrão', { type: 'select', col: 'col-md-2', options: [['boleto', 'Boleto'], ['PIX', 'PIX'], ['TED', 'TED'], ['cartao', 'Cartão'], ['cheque', 'Cheque'], ['outros', 'Outros']] })}
      ${campo('ativo', 'Ativa', { type: 'checkbox', col: 'col-md-2' })}</form>
      ${abas([
        { id: 'cond', label: 'Condições de pagamento', html: '<div data-cond></div>' },
        { id: 'pen', label: 'Penalidades de comissão', html: '<p class="small text-muted">Perda de % da comissão do vendedor por faixa de dias de atraso no pagamento.</p><div data-pen></div>' },
      ], 'forma')}`,
    buttons: [{ label: '<i class="bi bi-save"></i> Salvar', onClick: async ({ body }) => {
      const dados = { ...lerForm(body.querySelector('[data-geral]')), condicoes: cond.valores(), penalidades: pen.valores() };
      id ? await put(`/api/cadastros/formas-pagamento/${id}`, dados) : await post('/api/cadastros/formas-pagamento', dados);
      toast('Forma de pagamento salva.');
      await recarregarOpcoes();
      aoSalvar?.();
    } }],
  });
  preencherForm(m.body.querySelector('[data-geral]'), f);
  const cond = new EditorLista(m.body.querySelector('[data-cond]'), [
    { k: 'descricao', l: 'Descrição' }, { k: 'parcelas', l: 'Parcelas', type: 'number' }, { k: 'intervalo_dias', l: 'Intervalo (dias)', type: 'number' },
    { k: 'carencia_dias', l: 'Carência 1ª parcela (dias)', type: 'number' }, { k: 'desconto_pct', l: 'Desconto %', type: 'number' }, { k: 'valor_minimo', l: 'Valor mínimo', type: 'number' },
  ], f.condicoes, { novo: { parcelas: 1, intervalo_dias: 30, carencia_dias: 30, desconto_pct: 0, valor_minimo: 0 }, rotuloAdd: 'Condição' });
  const pen = new EditorLista(m.body.querySelector('[data-pen]'), [
    { k: 'dias_de', l: 'De (dias de atraso)', type: 'number' }, { k: 'dias_ate', l: 'Até', type: 'number' }, { k: 'perda_pct', l: '% de perda da comissão', type: 'number' },
  ], f.penalidades, { rotuloAdd: 'Faixa' });
}

// ---------- CRUDs simples ----------
function crudSimples(conteudo, { tituloTela, icone, url, colunas, campos, depois }) {
  const pagina = titulo(conteudo, tituloTela, icone, '<button class="btn btn-sm btn-success" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo</button>');
  const t = new DataTable(pagina, { url, title: tituloTela, columns: colunas, sort: colunas[0].k, dir: 'asc', rowClick: (r) => abrir(r.id) });
  async function abrir(id) {
    const reg = id ? await get(`${url}/${id}`).catch(erro) : {};
    if (id && !reg) return;
    const m = modal({
      title: id ? `Editar ${tituloTela.toLowerCase()}` : `Novo(a) ${tituloTela.toLowerCase()}`, size: 'lg',
      body: `<form class="row g-2">${campos(reg)}</form>`,
      buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
        const dados = lerForm(body.querySelector('form'));
        id ? await put(`${url}/${id}`, dados) : await post(url, dados);
        toast('Salvo.');
        await recarregarOpcoes();
        t.reload();
      } }],
    });
    preencherForm(m.body.querySelector('form'), reg);
    depois?.(m.body, reg);
  }
  conteudo.querySelector('#btn-novo').addEventListener('click', () => abrir(null));
}

function transportadoras(conteudo) {
  crudSimples(conteudo, {
    tituloTela: 'Transportadoras', icone: 'bi-truck-front', url: '/api/cadastros/transportadoras',
    colunas: [{ k: 'nome', l: 'Nome' }, { k: 'cnpj', l: 'CNPJ', t: 'doc' }, { k: 'telefone', l: 'Telefone' }, { k: 'email', l: 'E-mail' }, ATIVO],
    campos: () => `${campo('nome', 'Nome', { col: 'col-md-6', required: true })}${campo('cnpj', 'CNPJ', { col: 'col-md-6' })}
      ${campo('telefone', 'Telefone', { col: 'col-md-4' })}${campo('email', 'E-mail', { type: 'email', col: 'col-md-5' })}${campo('ativo', 'Ativa', { type: 'checkbox', col: 'col-md-3', value: 1 })}`,
  });
}

function equipes(conteudo) {
  crudSimples(conteudo, {
    tituloTela: 'Equipes', icone: 'bi-people-fill', url: '/api/cadastros/equipes',
    colunas: [{ k: 'nome', l: 'Equipe' }, { k: 'supervisor', l: 'Supervisor' }, { k: 'gerente', l: 'Gerente' }, { k: 'vendedores', l: 'Vendedores', t: 'num' }],
    campos: () => `${campo('nome', 'Nome', { col: 'col-md-4', required: true })}
      ${campo('supervisor_id', 'Supervisor', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.usuarios.filter((u) => u.perfil === 'supervisor'), 'Sem supervisor (pedidos vão direto à Análise)') })}
      ${campo('gerente_id', 'Gerente comercial', { type: 'select', col: 'col-md-4', options: opcoes(state.opcoes.usuarios.filter((u) => u.perfil === 'gerente'), 'Gerente geral (regra de comissão)') })}`,
  });
}

function empresas(conteudo) {
  crudSimples(conteudo, {
    tituloTela: 'Empresas', icone: 'bi-building', url: '/api/cadastros/empresas',
    colunas: [{ k: 'nome', l: 'Razão social' }, { k: 'cnpj', l: 'CNPJ', t: 'doc' }, { k: 'cidade', l: 'Cidade' }, { k: 'uf', l: 'UF' }, { k: 'telefone', l: 'Telefone' }],
    campos: () => `${campo('cnpj', 'CNPJ', { col: 'col-md-4', help: 'Com o CNPJ completo, os dados da Receita são preenchidos sozinhos.' })}${campo('nome', 'Razão social', { col: 'col-md-8', required: true })}
      ${campo('cep', 'CEP', { col: 'col-md-3', help: 'Preenche o endereço.' })}${campo('endereco', 'Endereço (remetente das etiquetas)', { col: 'col-md-9' })}
      ${campo('cidade', 'Cidade', { col: 'col-md-5' })}${campo('uf', 'UF', { type: 'select', col: 'col-md-2', options: OPCOES_UF })}${campo('telefone', 'Telefone', { col: 'col-md-5' })}`,
  });
}

const OPCOES_UF = [['', '—'], ...'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ').map((u) => [u, u])];
const CATEGORIAS_FORNECEDOR = ['Matéria-prima', 'Embalagem', 'Frete', 'Serviços', 'Manutenção', 'Energia', 'Aluguel', 'Impostos', 'Outros'];
function fornecedores(conteudo) {
  crudSimples(conteudo, {
    tituloTela: 'Fornecedores', icone: 'bi-shop', url: '/api/cadastros/fornecedores',
    colunas: [
      { k: 'razao_social', l: 'Razão social' }, { k: 'nome_fantasia', l: 'Fantasia' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' },
      { k: 'categoria', l: 'Categoria', filter: { options: CATEGORIAS_FORNECEDOR.map((c) => [c, c]) } }, { k: 'cidade', l: 'Cidade' }, { k: 'uf', l: 'UF' },
      { k: 'telefone', l: 'Telefone' }, { k: 'contato', l: 'Contato' }, { k: 'em_aberto', l: 'A pagar', t: 'money' }, ATIVO,
    ],
    campos: () => '<div class="col-12">' + abas([
      { id: 'geral', label: 'Geral', html: `<div class="row g-2">
        ${campo('tipo_pessoa', 'Tipo', { type: 'select', col: 'col-md-2', options: [['J', 'Jurídica'], ['F', 'Física']] })}
        ${campo('documento', 'CNPJ/CPF', { col: 'col-md-3', help: 'CNPJ preenche os dados da Receita.' })}${campo('razao_social', 'Razão social / nome', { col: 'col-md-7', required: true })}
        ${campo('nome_fantasia', 'Nome fantasia', { col: 'col-md-5' })}${campo('inscricao_estadual', 'Inscrição estadual', { col: 'col-md-3' })}
        ${campo('categoria', 'Categoria', { type: 'select', col: 'col-md-4', options: [['', '—'], ...CATEGORIAS_FORNECEDOR.map((c) => [c, c])] })}
        ${campo('contato', 'Contato', { col: 'col-md-4' })}${campo('telefone', 'Telefone', { col: 'col-md-3' })}${campo('email', 'E-mail', { type: 'email', col: 'col-md-5' })}
        ${campo('prazo_pagamento_dias', 'Prazo de pagamento (dias)', { type: 'number', col: 'col-md-3' })}${campo('ativo', 'Ativo', { type: 'checkbox', col: 'col-md-3', value: 1 })}
        ${campo('observacao', 'Observação', { type: 'textarea', col: 'col-12' })}</div>` },
      { id: 'end', label: 'Endereço', html: `<div class="row g-2">${campo('cep', 'CEP', { col: 'col-md-3', help: 'Preenche o endereço.' })}${campo('logradouro', 'Logradouro', { col: 'col-md-7' })}
        ${campo('numero', 'Número', { col: 'col-md-2' })}${campo('bairro', 'Bairro', { col: 'col-md-4' })}${campo('cidade', 'Cidade', { col: 'col-md-6' })}${campo('uf', 'UF', { type: 'select', col: 'col-md-2', options: OPCOES_UF })}</div>` },
      { id: 'banco', label: 'Dados bancários', html: `<div class="row g-2">${campo('banco', 'Banco', { type: 'select', col: 'col-md-4', options: [['', '—'], ...state.opcoes.bancos.map((b) => [b.nome, `${b.codigo} · ${b.nome}`])] })}${campo('agencia', 'Agência', { col: 'col-md-3' })}
        ${campo('conta', 'Conta', { col: 'col-md-5' })}${campo('chave_pix', 'Chave PIX', { col: 'col-md-12' })}</div>` },
    ], 'forn') + '</div>',
  });
}

// ---------- Listas de opções ----------
async function listas(conteudo) {
  const pagina = titulo(conteudo, 'Listas de opções', 'bi-list-ul');
  const desenhar = async () => {
    const d = await get('/api/cadastros/listas?todos=1');
    const tabela = (tipo) => `<div class="d-flex gap-2 mb-2 flex-wrap"><input class="form-control form-control-sm" data-novo="${tipo}" placeholder="Nova opção de ${esc(d.tipos[tipo].toLowerCase())}" style="max-width:320px">
        ${tipo === 'cargo' ? `<select class="form-select form-select-sm" data-novo-depto style="max-width:200px"><option value="">Departamento…</option>${d.listas.departamento.filter((x) => x.ativo).map((x) => `<option>${esc(x.valor)}</option>`).join('')}</select>
        <select class="form-select form-select-sm" data-novo-funcao style="max-width:200px"><option value="">Sem função comercial</option>${Object.entries(d.funcoes).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-sm btn-success" data-add="${tipo}"><i class="bi bi-plus-lg"></i> Adicionar</button></div>
      <div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Opção</th>${tipo === 'cargo' ? '<th>Departamento</th><th>Função comercial</th>' : ''}<th>Ativa</th><th></th></tr></thead><tbody>
      ${d.listas[tipo].map((x) => `<tr data-id="${x.id}" class="${x.ativo ? '' : 'text-body-secondary'}"><td><input class="form-control form-control-sm" data-valor value="${esc(x.valor)}"></td>
        ${tipo === 'cargo' ? `<td><select class="form-select form-select-sm" data-depto><option value="">—</option>${d.listas.departamento.map((y) => `<option ${y.valor === x.extra.departamento ? 'selected' : ''}>${esc(y.valor)}</option>`).join('')}</select></td>
        <td><select class="form-select form-select-sm" data-funcao><option value="">—</option>${Object.entries(d.funcoes).map(([k, l]) => `<option value="${k}" ${k === x.extra.funcao ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>` : ''}
        <td><input type="checkbox" class="form-check-input" data-ativo ${x.ativo ? 'checked' : ''}></td>
        <td class="text-end"><button class="btn btn-sm btn-outline-success py-0" data-salvar>Salvar</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    pagina.innerHTML = `<p class="text-body-secondary small">Estas são as opções dos campos de escolha do sistema. Renomear uma opção atualiza os cadastros que já a usam; desativar tira da lista sem apagar o histórico.
      A <b>função comercial</b> do cargo define comissão e exige equipe para vendedores.</p>
      ${abas(Object.keys(d.tipos).map((t) => ({ id: t, label: `${esc(d.tipos[t])} <span class="badge text-bg-secondary">${d.listas[t].filter((x) => x.ativo).length}</span>`, html: tabela(t) })), 'lst')}`;
    pagina.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const tipo = b.dataset.add;
      const box = b.parentElement;
      const valor = box.querySelector('[data-novo]').value.trim();
      if (!valor) return;
      const extra = tipo === 'cargo' ? { departamento: box.querySelector('[data-novo-depto]').value || null, funcao: box.querySelector('[data-novo-funcao]').value || null } : null;
      try { await post('/api/cadastros/listas', { tipo, valor, extra }); toast('Opção adicionada.'); await recarregarOpcoes(); desenhar(); } catch (e) { erro(e); }
    }));
    pagina.querySelectorAll('[data-salvar]').forEach((b) => b.addEventListener('click', async () => {
      const tr = b.closest('tr');
      const extra = tr.querySelector('[data-depto]') ? { departamento: tr.querySelector('[data-depto]').value || null, funcao: tr.querySelector('[data-funcao]').value || null } : null;
      try {
        await put(`/api/cadastros/listas/${tr.dataset.id}`, { valor: tr.querySelector('[data-valor]').value.trim(), ativo: tr.querySelector('[data-ativo]').checked, extra });
        toast('Opção salva.'); await recarregarOpcoes();
      } catch (e) { erro(e); }
    }));
  };
  await desenhar();
}

// ---------- Regras de comissão ----------
async function comissao(conteudo) {
  const pagina = titulo(conteudo, 'Regras de comissão', 'bi-percent');
  const cfg = await get('/api/cadastros/config');
  const gerentes = state.opcoes.usuarios.filter((u) => u.perfil === 'gerente');
  pagina.innerHTML = `<div class="row g-3"><div class="col-lg-7"><div class="card"><div class="card-header"><i class="bi bi-sliders"></i> Percentuais</div><div class="card-body">
    <form class="vstack gap-3" data-cfg>${cfg.map((c) => c.tipo !== 'usuarios' ? `<div><label class="form-label">${esc(c.rotulo)}</label>
      <div class="input-group" style="max-width:220px"><input type="number" step="${c.tipo === 'pct' ? '0.01' : '1'}" min="0" ${c.tipo === 'pct' ? 'max="100"' : 'max="28"'} class="form-control" name="${c.chave}" value="${c.valor}">${c.tipo === 'pct' ? '<span class="input-group-text">%</span>' : ''}</div>
      <div class="form-text">Padrão: ${c.padrao}${c.tipo === 'pct' ? '%' : ''}</div></div>` : `<div><label class="form-label">${esc(c.rotulo)}</label>
      ${gerentes.length ? gerentes.map((g) => `<div class="form-check"><input class="form-check-input" type="checkbox" data-gerente value="${g.id}" id="g${g.id}" ${c.valor.includes(g.id) ? 'checked' : ''}><label class="form-check-label" for="g${g.id}">${esc(g.nome)}</label></div>`).join('')
        : '<div class="text-body-secondary small">Nenhum usuário com perfil Gerente comercial. Crie em Usuários e Permissões.</div>'}</div>`).join('')}
      <div><button class="btn btn-success"><i class="bi bi-check2"></i> Salvar regras</button></div></form></div></div></div>
    <div class="col-lg-5"><div class="card"><div class="card-header"><i class="bi bi-info-circle"></i> Como funciona</div><div class="card-body small">
      <ul class="mb-0 ps-3 vstack gap-2">
        <li><b>Gerente comercial</b> recebe o percentual sobre <b>toda venda</b>. Se a equipe do vendedor tiver um gerente definido (Cadastros → Equipes), só ele recebe; senão, os gerentes marcados ao lado (ou todos com o perfil).</li>
        <li><b>Supervisor</b> recebe sobre as vendas da equipe dele.</li>
        <li><b>Vendedor</b> recebe o percentual cheio quando o pedido está <b>dentro da política</b>: nenhum item abaixo do preço de tabela além do desconto máximo. Fora da política, o pedido chega à Diretoria marcado e ela define a comissão.</li>
        <li>Um <b>% individual</b> no cadastro do usuário vendedor substitui a regra.</li>
        <li>A Diretoria pode ajustar a comissão de qualquer pedido antes da aprovação final; a alteração fica no histórico.</li>
        <li>As regras valem para os pedidos aprovados depois da mudança.</li>
        <li>Comissões <b>revisadas</b> pelo Financeiro entram na folha do mês (CLT) quando o RH gera os eventos; para PJ, autônomo ou quem não tem cadastro de colaborador, o fechamento da folha lança uma conta a pagar com vencimento no dia escolhido do mês seguinte.</li></ul></div></div></div></div>`;
  pagina.querySelector('[data-cfg]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(cfg.filter((c) => c.tipo !== 'usuarios').map((c) => [c.chave, f.querySelector(`[name="${c.chave}"]`).value]));
    body['comissao.gerentes'] = [...f.querySelectorAll('[data-gerente]:checked')].map((x) => Number(x.value));
    try { await put('/api/cadastros/config', body); toast('Regras de comissão salvas.'); } catch (err) { erro(err); }
  });
}

// ---------- Alterar Minha Senha ----------
function senha(conteudo) {
  const pagina = titulo(conteudo, 'Alterar Minha Senha', 'bi-key');
  pagina.innerHTML = `<div class="card" style="max-width:420px"><div class="card-body"><form class="row g-2">
    ${campo('atual', 'Senha atual', { type: 'password', col: 'col-12', required: true, attrs: 'autocomplete="current-password"' })}
    ${campo('nova', 'Nova senha (mín. 8 caracteres, com letras e números)', { type: 'password', col: 'col-12', required: true, attrs: 'autocomplete="new-password" minlength="8"' })}
    ${campo('confirmacao', 'Confirme a nova senha', { type: 'password', col: 'col-12', required: true, attrs: 'autocomplete="new-password"' })}
    <div class="col-12"><button class="btn btn-primary">Alterar senha</button></div></form></div></div>`;
  pagina.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/api/auth/senha', lerForm(e.target));
      toast('Senha alterada. Outras sessões foram encerradas.');
      e.target.reset();
    } catch (err) { erro(err); }
  });
}
