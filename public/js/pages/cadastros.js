// Cadastros (menu Registro): produto, forma de pagamento, transportadoras, usuários, equipes, empresas e senha.
import {
  get, post, put, esc, titulo, abas, DataTable, EditorLista, modal, campo, opcoes, lerForm, preencherForm, toast, state, erro,
} from '../core.js';

export default async function (conteudo, { params: [tela], modo }) {
  if (modo === 'senha') return senha(conteudo);
  const telas = { produtos, formas, transportadoras, equipes, empresas };
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
    colunas: [{ k: 'nome', l: 'Equipe' }, { k: 'supervisor', l: 'Supervisor' }, { k: 'vendedores', l: 'Vendedores', t: 'num' }],
    campos: () => `${campo('nome', 'Nome', { col: 'col-md-6', required: true })}
      ${campo('supervisor_id', 'Supervisor', { type: 'select', col: 'col-md-6', options: opcoes(state.opcoes.usuarios.filter((u) => u.perfil === 'supervisor'), '—') })}`,
  });
}

function empresas(conteudo) {
  crudSimples(conteudo, {
    tituloTela: 'Empresas', icone: 'bi-building', url: '/api/cadastros/empresas',
    colunas: [{ k: 'nome', l: 'Razão social' }, { k: 'cnpj', l: 'CNPJ', t: 'doc' }, { k: 'uf', l: 'UF' }],
    campos: () => `${campo('nome', 'Razão social', { col: 'col-md-6', required: true })}${campo('cnpj', 'CNPJ', { col: 'col-md-4' })}${campo('uf', 'UF', { col: 'col-md-2' })}`,
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
