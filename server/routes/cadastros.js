const express = require('express');
const db = require('../db');
const A = require('../auth');
const { responderLista } = require('../lista');
const { ErroNegocio } = require('../services');

const r = express.Router();

/** CRUD simples: lista paginada, leitura, inclusão, alteração e exclusão. */
function crud(caminho, { tabela, campos, sql, permLer, permEditar, antesSalvar }) {
  const ler = A.exige(...[].concat(permLer));
  const editar = A.exige(...[].concat(permEditar || permLer));
  r.get(caminho, ler, async (req, res) => await responderLista(req, res, { sql: sql || `SELECT * FROM ${tabela}`, sort: 'id', dir: 'asc' }));
  r.get(`${caminho}/:id`, ler, async (req, res) => {
    const item = await db.get(`SELECT * FROM ${tabela} WHERE id = ?`, req.params.id);
    if (!item) throw new ErroNegocio('Registro não encontrado', 404);
    res.json(item);
  });
  r.post(caminho, editar, async (req, res) => {
    const dados = antesSalvar ? antesSalvar(req.body, req) : req.body;
    res.status(201).json({ id: await db.insert(tabela, dados, campos) });
  });
  r.put(`${caminho}/:id`, editar, async (req, res) => {
    const dados = antesSalvar ? antesSalvar(req.body, req) : req.body;
    await db.update(tabela, req.params.id, dados, campos);
    res.json({ ok: true });
  });
  r.delete(`${caminho}/:id`, editar, async (req, res) => {
    try {
      await db.run(`DELETE FROM ${tabela} WHERE id = ?`, req.params.id);
    } catch (e) {
      if (e.code === '23503') throw new ErroNegocio('Registro em uso, não pode ser excluído. Inative-o.');
      throw e;
    }
    res.json({ ok: true });
  });
}

// ---------- Empresas, equipes e usuários ----------
crud('/empresas', { tabela: 'empresas', campos: ['nome', 'cnpj', 'uf', 'endereco', 'cidade', 'cep', 'telefone'], permLer: 'cadastros.empresa' });

crud('/equipes', {
  tabela: 'equipes', campos: ['nome', 'supervisor_id'], permLer: ['cadastros.usuario', 'relatorios'], permEditar: 'cadastros.usuario',
  sql: `SELECT e.id, e.nome, e.supervisor_id, u.nome AS supervisor,
          (SELECT COUNT(*) FROM usuarios x WHERE x.equipe_id = e.id AND x.perfil = 'vendedor') AS vendedores
        FROM equipes e LEFT JOIN usuarios u ON u.id = e.supervisor_id`,
});

// ---------- Colaboradores ----------
// O colaborador é a pessoa (funcionário); o usuário é o acesso dele ao sistema.
const camposColaborador = ['nome', 'cpf', 'cargo', 'setor', 'email', 'telefone', 'data_admissao', 'empresa_id', 'observacao', 'ativo'];
r.get('/colaboradores', A.exige('cadastros.colaborador', 'cadastros.usuario'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT c.id, c.nome, c.cpf, c.cargo, c.setor, c.email, c.telefone, c.data_admissao, e.nome AS empresa, c.ativo,
            u.id AS usuario_id, u.login, u.perfil
          FROM colaboradores c LEFT JOIN empresas e ON e.id = c.empresa_id LEFT JOIN usuarios u ON u.colaborador_id = c.id`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/colaboradores/:id', A.exige('cadastros.colaborador', 'cadastros.usuario'), async (req, res) => {
  const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', Number(req.params.id));
  if (!c) throw new ErroNegocio('Colaborador não encontrado', 404);
  c.usuario = await db.get('SELECT id, login, perfil, ativo FROM usuarios WHERE colaborador_id = ?', c.id);
  res.json(c);
});
function dadosColaborador(b) {
  const d = { ...b };
  if (!String(d.nome || '').trim()) throw new ErroNegocio('Informe o nome do colaborador.');
  if (d.cpf) {
    d.cpf = String(d.cpf).replace(/\D/g, '');
    if (!require('./clientes').validarCpf(d.cpf)) throw new ErroNegocio('CPF inválido.');
  }
  return d;
}
r.post('/colaboradores', A.exige('cadastros.colaborador', 'cadastros.usuario'), async (req, res) =>
  res.status(201).json({ id: await db.insert('colaboradores', dadosColaborador(req.body), camposColaborador) }));
r.put('/colaboradores/:id', A.exige('cadastros.colaborador', 'cadastros.usuario'), async (req, res) => {
  const id = Number(req.params.id);
  await db.tx(async () => {
    await db.update('colaboradores', id, dadosColaborador(req.body), camposColaborador);
    // Colaborador inativado perde o acesso ao sistema.
    if (req.body.ativo === 0) await db.run('UPDATE usuarios SET ativo = 0 WHERE colaborador_id = ?', id);
  });
  res.json({ ok: true });
});

// ---------- Usuários e permissões ----------
const TODAS_PERMISSOES = A.CATALOGO.flatMap(([, itens]) => itens.map(([k]) => k));
r.get('/permissoes', A.exige('cadastros.usuario'), (req, res) => {
  const padrao = Object.fromEntries(Object.keys(A.PERFIS).map((p) => [p, A.PERMISSOES[p].includes('*') ? TODAS_PERMISSOES : TODAS_PERMISSOES.filter((k) => A.can(p, k))]));
  res.json({ catalogo: A.CATALOGO, padrao, perfis: A.PERFIS });
});

const camposUsuario = ['nome', 'login', 'email', 'perfil', 'equipe_id', 'colaborador_id', 'comissao_pct', 'ativo', 'senha_hash', 'trocar_senha', 'permissoes'];
r.get('/usuarios', A.exige('cadastros.usuario'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT u.id, u.nome, u.login, u.email, u.perfil, u.equipe_id, eq.nome AS equipe, c.nome AS colaborador, c.cargo, u.comissao_pct, u.ativo,
            CASE WHEN u.permissoes IS NULL THEN 'Padrão do perfil' ELSE 'Personalizadas' END AS permissoes,
            CASE WHEN u.bloqueado_ate > ? THEN 1 ELSE 0 END AS bloqueado, u.ultimo_acesso,
            (SELECT string_agg(e.nome, ', ') FROM usuario_empresas ue JOIN empresas e ON e.id = ue.empresa_id WHERE ue.usuario_id = u.id) AS empresas
          FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id LEFT JOIN colaboradores c ON c.id = u.colaborador_id`,
    params: [new Date().toISOString()], sort: 'nome', dir: 'asc',
  }),
);
r.get('/usuarios/:id', A.exige('cadastros.usuario'), async (req, res) => {
  const u = await db.get('SELECT id, nome, login, email, perfil, equipe_id, colaborador_id, comissao_pct, ativo, permissoes, bloqueado_ate, ultimo_acesso, trocar_senha FROM usuarios WHERE id = ?', Number(req.params.id));
  if (!u) throw new ErroNegocio('Usuário não encontrado', 404);
  u.empresas = (await db.all('SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?', u.id)).map((x) => x.empresa_id);
  u.personalizadas = !!u.permissoes;
  u.permissoes = A.permissoesDe(u).includes('*') ? TODAS_PERMISSOES : TODAS_PERMISSOES.filter((k) => A.can({ permissoes: u.permissoes, perfil: u.perfil }, k));
  res.json(u);
});
async function salvarUsuario(req, id) {
  const b = { ...req.body };
  if (b.login) b.login = String(b.login).trim().toLowerCase();
  if (b.login && !/^[a-z0-9._-]{3,40}$/.test(b.login)) throw new ErroNegocio('Login deve ter de 3 a 40 letras, números, ponto, hífen ou sublinhado.');
  if (b.perfil && !A.PERFIS[b.perfil]) throw new ErroNegocio('Perfil inválido.');
  if (!id && !b.colaborador_id) throw new ErroNegocio('Selecione o colaborador. Cadastre-o antes em Colaboradores.');
  if (b.colaborador_id) {
    const c = await db.get('SELECT * FROM colaboradores WHERE id = ?', Number(b.colaborador_id));
    if (!c) throw new ErroNegocio('Colaborador não encontrado.');
    const outro = await db.get('SELECT id FROM usuarios WHERE colaborador_id = ? AND id <> ?', c.id, id || 0);
    if (outro) throw new ErroNegocio('Este colaborador já tem um usuário.');
    b.nome ||= c.nome;
    b.email ||= c.email;
  }
  if (b.senha) {
    const fraca = A.validarSenha(b.senha);
    if (fraca) throw new ErroNegocio(fraca);
    b.senha_hash = A.hashSenha(b.senha);
    b.trocar_senha = 1; // senha definida pelo administrador é provisória
  } else if (!id) throw new ErroNegocio('Informe a senha provisória.');
  // Permissões: null = padrão do perfil; lista = personalizadas (só chaves conhecidas).
  if (b.personalizadas === 0 || b.personalizadas === false) b.permissoes = null;
  else if (Array.isArray(b.permissoes)) b.permissoes = JSON.stringify(b.permissoes.filter((k) => TODAS_PERMISSOES.includes(k)));
  else delete b.permissoes;
  if (id === req.user.id && (b.ativo === 0 || (b.perfil && b.perfil !== req.user.perfil))) throw new ErroNegocio('Você não pode inativar nem trocar o perfil do seu próprio usuário.');
  if (b.perfil === 'admin' && req.user.perfil !== 'admin') throw new ErroNegocio('Só um administrador pode criar outro administrador.', 403);
  return db.tx(async () => {
    if (id) await db.update('usuarios', id, { ...b, permissoes: b.permissoes === undefined ? undefined : b.permissoes }, camposUsuario);
    else id = await db.insert('usuarios', b, camposUsuario);
    if (b.permissoes === null) await db.run('UPDATE usuarios SET permissoes = NULL WHERE id = ?', id);
    if (Array.isArray(b.empresas)) {
      await db.run('DELETE FROM usuario_empresas WHERE usuario_id = ?', id);
      for (const e of b.empresas) await db.run('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)', id, e);
    }
    if (b.ativo === 0) await db.run('DELETE FROM sessoes WHERE usuario_id = ?', id);
    return id;
  });
}
r.post('/usuarios', A.exige('cadastros.usuario'), async (req, res) => res.status(201).json({ id: await salvarUsuario(req) }));
r.put('/usuarios/:id', A.exige('cadastros.usuario'), async (req, res) => res.json({ id: await salvarUsuario(req, Number(req.params.id)) }));
r.post('/usuarios/:id/desbloquear', A.exige('cadastros.usuario'), async (req, res) => {
  await db.update('usuarios', Number(req.params.id), { bloqueado_ate: null, tentativas_falhas: 0 });
  res.json({ ok: true });
});

// ---------- Produtos ----------
crud('/grupos-produto', { tabela: 'grupos_produto', campos: ['nome'], permLer: 'cadastros.produto' });

const camposProduto = [
  'codigo', 'nome', 'grupo_id', 'unidade', 'ncm', 'cst', 'cfop', 'gtin', 'reducao_bc', 'perigoso', 'origem', 'qtd_ecommerce',
  'prazo_producao_dias', 'ativo',
];
r.get('/produtos', A.exige('cadastros.produto'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT p.id, p.codigo, p.nome, g.nome AS grupo, p.unidade, p.ncm, p.cst, p.gtin, p.reducao_bc, p.perigoso, p.origem,
            p.qtd_ecommerce, p.ativo, (SELECT COUNT(*) FROM produto_embalagens e WHERE e.produto_id = p.id) AS embalagens
          FROM produtos p LEFT JOIN grupos_produto g ON g.id = p.grupo_id`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/produtos/:id', A.exige('cadastros.produto', 'pedido.criar', 'fila'), async (req, res) => {
  const p = await db.get('SELECT * FROM produtos WHERE id = ?', req.params.id);
  if (!p) throw new ErroNegocio('Produto não encontrado', 404);
  p.embalagens = await db.all('SELECT * FROM produto_embalagens WHERE produto_id = ? ORDER BY quantidade', p.id);
  p.brindes = await db.all(
    'SELECT b.*, pr.nome AS brinde_nome FROM produto_brindes b JOIN produtos pr ON pr.id = b.brinde_produto_id WHERE b.produto_id = ?', p.id,
  );
  p.precos = await db.all(
    `SELECT tp.*, e.descricao AS embalagem, f.nome AS forma FROM produto_precos tp
       LEFT JOIN produto_embalagens e ON e.id = tp.embalagem_id LEFT JOIN formas_pagamento f ON f.id = tp.forma_id
      WHERE tp.produto_id = ? ORDER BY e.quantidade, f.nome`, p.id,
  );
  res.json(p);
});
async function salvarProduto(req, id) {
  const b = req.body;
  return await db.tx(async () => {
    if (id) await db.update('produtos', id, b, camposProduto);
    else id = await db.insert('produtos', b, camposProduto);
    if (Array.isArray(b.embalagens)) {
      const manter = b.embalagens.filter((e) => e.id).map((e) => Number(e.id));
      for (const e of await db.all('SELECT id FROM produto_embalagens WHERE produto_id = ?', id)) {
        if (!manter.includes(e.id)) await db.run('DELETE FROM produto_embalagens WHERE id = ?', e.id);
      }
      for (const e of b.embalagens) {
        const dados = { ...e, produto_id: id };
        const campos = ['produto_id', 'descricao', 'quantidade', 'unidade', 'custo', 'peso_kg', 'estoque_minimo'];
        if (e.id) await db.update('produto_embalagens', e.id, dados, campos);
        else e.id = await db.insert('produto_embalagens', dados, campos);
      }
    }
    if (Array.isArray(b.brindes)) {
      await db.run('DELETE FROM produto_brindes WHERE produto_id = ?', id);
      for (const x of b.brindes) await db.insert('produto_brindes', { ...x, produto_id: id }, ['produto_id', 'brinde_produto_id', 'qtd_minima', 'qtd_brinde', 'observacao']);
    }
    if (Array.isArray(b.precos)) {
      await db.run('DELETE FROM produto_precos WHERE produto_id = ?', id);
      for (const x of b.precos) {
        // Preço pode referenciar embalagem recém-criada pela posição na lista.
        const emb = x.embalagem_idx != null && b.embalagens ? b.embalagens[x.embalagem_idx]?.id : x.embalagem_id;
        await db.insert('produto_precos', { ...x, embalagem_id: emb, produto_id: id }, ['produto_id', 'embalagem_id', 'forma_id', 'valor', 'vigencia_inicio']);
      }
    }
    return id;
  });
}
r.post('/produtos', A.exige('cadastros.produto'), async (req, res) => res.status(201).json({ id: await salvarProduto(req) }));
r.put('/produtos/:id', A.exige('cadastros.produto'), async (req, res) => res.json({ id: await salvarProduto(req, Number(req.params.id)) }));

// ---------- Formas de pagamento ----------
r.get('/formas-pagamento', A.exige('cadastros.forma'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT f.*, (SELECT COUNT(*) FROM condicoes_pagamento c WHERE c.forma_id = f.id) AS condicoes,
            (SELECT COUNT(*) FROM penalidades_comissao p WHERE p.forma_id = f.id) AS penalidades
          FROM formas_pagamento f`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/formas-pagamento/:id', A.exige('cadastros.forma'), async (req, res) => {
  const f = await db.get('SELECT * FROM formas_pagamento WHERE id = ?', req.params.id);
  if (!f) throw new ErroNegocio('Forma não encontrada', 404);
  f.condicoes = await db.all('SELECT * FROM condicoes_pagamento WHERE forma_id = ? ORDER BY parcelas', f.id);
  f.penalidades = await db.all('SELECT * FROM penalidades_comissao WHERE forma_id = ? ORDER BY dias_de', f.id);
  res.json(f);
});
async function salvarForma(req, id) {
  const b = req.body;
  return await db.tx(async () => {
    const campos = ['nome', 'tipo', 'tipo_baixa', 'ativo'];
    if (id) await db.update('formas_pagamento', id, b, campos);
    else id = await db.insert('formas_pagamento', b, campos);
    if (Array.isArray(b.condicoes)) {
      const manter = b.condicoes.filter((c) => c.id).map((c) => Number(c.id));
      for (const c of await db.all('SELECT id FROM condicoes_pagamento WHERE forma_id = ?', id)) {
        if (!manter.includes(c.id)) {
          try { await db.run('DELETE FROM condicoes_pagamento WHERE id = ?', c.id); } catch { throw new ErroNegocio('Condição em uso por pedidos não pode ser removida.'); }
        }
      }
      const cc = ['forma_id', 'descricao', 'parcelas', 'intervalo_dias', 'carencia_dias', 'desconto_pct', 'valor_minimo'];
      for (const c of b.condicoes) {
        if (c.id) await db.update('condicoes_pagamento', c.id, { ...c, forma_id: id }, cc);
        else await db.insert('condicoes_pagamento', { ...c, forma_id: id }, cc);
      }
    }
    if (Array.isArray(b.penalidades)) {
      await db.run('DELETE FROM penalidades_comissao WHERE forma_id = ?', id);
      for (const p of b.penalidades) await db.insert('penalidades_comissao', { ...p, forma_id: id }, ['forma_id', 'dias_de', 'dias_ate', 'perda_pct']);
    }
    return id;
  });
}
r.post('/formas-pagamento', A.exige('cadastros.forma'), async (req, res) => res.status(201).json({ id: await salvarForma(req) }));
r.put('/formas-pagamento/:id', A.exige('cadastros.forma'), async (req, res) => res.json({ id: await salvarForma(req, Number(req.params.id)) }));

// ---------- Transportadoras e bancos ----------
crud('/transportadoras', { tabela: 'transportadoras', campos: ['nome', 'cnpj', 'telefone', 'email', 'ativo'], permLer: 'cadastros.transportadora' });
crud('/bancos', { tabela: 'bancos', campos: ['codigo', 'nome'], permLer: 'financeiro' });

// ---------- Fornecedores ----------
const camposFornecedor = [
  'tipo_pessoa', 'documento', 'razao_social', 'nome_fantasia', 'inscricao_estadual', 'categoria', 'email', 'telefone', 'contato',
  'cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'banco', 'agencia', 'conta', 'chave_pix', 'prazo_pagamento_dias', 'observacao', 'ativo',
];
function dadosFornecedor(b) {
  const d = { ...b };
  if (!String(d.razao_social || '').trim()) throw new ErroNegocio('Informe a razão social ou o nome.');
  d.tipo_pessoa = d.tipo_pessoa === 'F' ? 'F' : 'J';
  if (d.documento) {
    d.documento = String(d.documento).replace(/\D/g, '');
    const { validarCpf, validarCnpj } = require('./clientes');
    if (d.tipo_pessoa === 'J' ? !validarCnpj(d.documento) : !validarCpf(d.documento)) throw new ErroNegocio(d.tipo_pessoa === 'J' ? 'CNPJ inválido.' : 'CPF inválido.');
  }
  if (d.uf) d.uf = String(d.uf).toUpperCase().slice(0, 2);
  return d;
}
crud('/fornecedores', {
  tabela: 'fornecedores', campos: camposFornecedor, permLer: ['cadastros.fornecedor', 'financeiro.pagar', 'estoque.movimentar'], permEditar: 'cadastros.fornecedor',
  antesSalvar: dadosFornecedor,
  sql: `SELECT f.id, f.razao_social, f.nome_fantasia, f.documento, f.categoria, f.cidade, f.uf, f.telefone, f.email, f.contato, f.ativo,
          (SELECT COALESCE(SUM(c.valor - COALESCE(c.valor_pago,0)), 0) FROM contas_pagar c WHERE c.fornecedor_id = f.id AND c.status = 'a_pagar') AS em_aberto
        FROM fornecedores f`,
});

// ---------- Listas de apoio (combos) ----------
r.get('/opcoes', async (req, res) => {
  const u = req.user;
  res.json({
    formas: await db.all('SELECT id, nome, tipo FROM formas_pagamento WHERE ativo = 1 ORDER BY nome'),
    condicoes: await db.all('SELECT c.* FROM condicoes_pagamento c JOIN formas_pagamento f ON f.id = c.forma_id WHERE f.ativo = 1 ORDER BY c.parcelas'),
    grupos: await db.all('SELECT id, nome FROM grupos_produto ORDER BY nome'),
    produtos: await db.all('SELECT id, codigo, nome, grupo_id, unidade FROM produtos WHERE ativo = 1 ORDER BY nome'),
    transportadoras: await db.all('SELECT id, nome FROM transportadoras WHERE ativo = 1 ORDER BY nome'),
    bancos: await db.all('SELECT id, codigo, nome FROM bancos ORDER BY nome'),
    equipes: await db.all('SELECT id, nome, supervisor_id FROM equipes ORDER BY nome'),
    empresas: await db.all('SELECT id, nome FROM empresas ORDER BY nome'),
    fornecedores: await db.all('SELECT id, razao_social AS nome, categoria, prazo_pagamento_dias FROM fornecedores WHERE ativo = 1 ORDER BY razao_social'),
    embalagens: await db.all(
      `SELECT e.id, e.produto_id, e.descricao, e.unidade, p.nome AS produto FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id
        WHERE p.ativo = 1 ORDER BY p.nome, e.quantidade`,
    ),
    usuarios: await db.all('SELECT id, nome, perfil, equipe_id FROM usuarios WHERE ativo = 1 ORDER BY nome'),
    vendedores: await db.all(
      `SELECT id, nome, equipe_id FROM usuarios WHERE ativo = 1 AND perfil = 'vendedor' ${u.perfil === 'vendedor' ? 'AND id = ' + Number(u.id) : ''} ORDER BY nome`,
    ),
  });
});

r.get('/produtos/:id/precos', async (req, res) => {
  res.json({
    embalagens: await db.all('SELECT * FROM produto_embalagens WHERE produto_id = ? ORDER BY quantidade', req.params.id),
    precos: await db.all('SELECT * FROM produto_precos WHERE produto_id = ?', req.params.id),
    brindes: await db.all('SELECT b.*, p.nome AS brinde_nome FROM produto_brindes b JOIN produtos p ON p.id = b.brinde_produto_id WHERE b.produto_id = ?', req.params.id),
  });
});

module.exports = r;
