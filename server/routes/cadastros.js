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
  r.get(caminho, ler, (req, res) => responderLista(req, res, { sql: sql || `SELECT * FROM ${tabela}`, sort: 'id', dir: 'asc' }));
  r.get(`${caminho}/:id`, ler, (req, res) => {
    const item = db.get(`SELECT * FROM ${tabela} WHERE id = ?`, req.params.id);
    if (!item) throw new ErroNegocio('Registro não encontrado', 404);
    res.json(item);
  });
  r.post(caminho, editar, (req, res) => {
    const dados = antesSalvar ? antesSalvar(req.body, req) : req.body;
    res.status(201).json({ id: db.insert(tabela, dados, campos) });
  });
  r.put(`${caminho}/:id`, editar, (req, res) => {
    const dados = antesSalvar ? antesSalvar(req.body, req) : req.body;
    db.update(tabela, req.params.id, dados, campos);
    res.json({ ok: true });
  });
  r.delete(`${caminho}/:id`, editar, (req, res) => {
    try {
      db.run(`DELETE FROM ${tabela} WHERE id = ?`, req.params.id);
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) throw new ErroNegocio('Registro em uso, não pode ser excluído. Inative-o.');
      throw e;
    }
    res.json({ ok: true });
  });
}

// ---------- Empresas, equipes e usuários ----------
crud('/empresas', { tabela: 'empresas', campos: ['nome', 'cnpj', 'uf'], permLer: 'cadastros.empresa' });

crud('/equipes', {
  tabela: 'equipes', campos: ['nome', 'supervisor_id'], permLer: ['cadastros.usuario', 'relatorios'], permEditar: 'cadastros.usuario',
  sql: `SELECT e.id, e.nome, e.supervisor_id, u.nome AS supervisor,
          (SELECT COUNT(*) FROM usuarios x WHERE x.equipe_id = e.id AND x.perfil = 'vendedor') AS vendedores
        FROM equipes e LEFT JOIN usuarios u ON u.id = e.supervisor_id`,
});

const camposUsuario = ['nome', 'login', 'email', 'perfil', 'equipe_id', 'comissao_pct', 'ativo', 'senha_hash'];
r.get('/usuarios', A.exige('cadastros.usuario'), (req, res) =>
  responderLista(req, res, {
    sql: `SELECT u.id, u.nome, u.login, u.email, u.perfil, u.equipe_id, eq.nome AS equipe, u.comissao_pct, u.ativo,
            (SELECT GROUP_CONCAT(e.nome, ', ') FROM usuario_empresas ue JOIN empresas e ON e.id = ue.empresa_id WHERE ue.usuario_id = u.id) AS empresas
          FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/usuarios/:id', A.exige('cadastros.usuario'), (req, res) => {
  const u = db.get('SELECT id, nome, login, email, perfil, equipe_id, comissao_pct, ativo FROM usuarios WHERE id = ?', req.params.id);
  if (!u) throw new ErroNegocio('Usuário não encontrado', 404);
  u.empresas = db.all('SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?', u.id).map((x) => x.empresa_id);
  res.json(u);
});
function salvarUsuario(req, id) {
  const b = { ...req.body };
  if (b.login) b.login = String(b.login).trim().toLowerCase();
  if (b.perfil && !A.PERFIS[b.perfil]) throw new ErroNegocio('Perfil inválido.');
  if (b.senha) b.senha_hash = A.hashSenha(b.senha);
  else if (!id) throw new ErroNegocio('Informe a senha inicial.');
  return db.tx(() => {
    if (id) db.update('usuarios', id, b, camposUsuario);
    else id = db.insert('usuarios', b, camposUsuario);
    if (Array.isArray(b.empresas)) {
      db.run('DELETE FROM usuario_empresas WHERE usuario_id = ?', id);
      for (const e of b.empresas) db.run('INSERT INTO usuario_empresas (usuario_id, empresa_id) VALUES (?, ?)', id, e);
    }
    return id;
  });
}
r.post('/usuarios', A.exige('cadastros.usuario'), (req, res) => res.status(201).json({ id: salvarUsuario(req) }));
r.put('/usuarios/:id', A.exige('cadastros.usuario'), (req, res) => res.json({ id: salvarUsuario(req, Number(req.params.id)) }));

// ---------- Produtos ----------
crud('/grupos-produto', { tabela: 'grupos_produto', campos: ['nome'], permLer: 'cadastros.produto' });

const camposProduto = [
  'codigo', 'nome', 'grupo_id', 'unidade', 'ncm', 'cst', 'cfop', 'gtin', 'reducao_bc', 'perigoso', 'origem', 'qtd_ecommerce',
  'prazo_producao_dias', 'ativo',
];
r.get('/produtos', A.exige('cadastros.produto'), (req, res) =>
  responderLista(req, res, {
    sql: `SELECT p.id, p.codigo, p.nome, g.nome AS grupo, p.unidade, p.ncm, p.cst, p.gtin, p.reducao_bc, p.perigoso, p.origem,
            p.qtd_ecommerce, p.ativo, (SELECT COUNT(*) FROM produto_embalagens e WHERE e.produto_id = p.id) AS embalagens
          FROM produtos p LEFT JOIN grupos_produto g ON g.id = p.grupo_id`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/produtos/:id', A.exige('cadastros.produto', 'pedido.criar', 'fila'), (req, res) => {
  const p = db.get('SELECT * FROM produtos WHERE id = ?', req.params.id);
  if (!p) throw new ErroNegocio('Produto não encontrado', 404);
  p.embalagens = db.all('SELECT * FROM produto_embalagens WHERE produto_id = ? ORDER BY quantidade', p.id);
  p.brindes = db.all(
    'SELECT b.*, pr.nome AS brinde_nome FROM produto_brindes b JOIN produtos pr ON pr.id = b.brinde_produto_id WHERE b.produto_id = ?', p.id,
  );
  p.precos = db.all(
    `SELECT tp.*, e.descricao AS embalagem, f.nome AS forma FROM produto_precos tp
       LEFT JOIN produto_embalagens e ON e.id = tp.embalagem_id LEFT JOIN formas_pagamento f ON f.id = tp.forma_id
      WHERE tp.produto_id = ? ORDER BY e.quantidade, f.nome`, p.id,
  );
  res.json(p);
});
function salvarProduto(req, id) {
  const b = req.body;
  return db.tx(() => {
    if (id) db.update('produtos', id, b, camposProduto);
    else id = db.insert('produtos', b, camposProduto);
    if (Array.isArray(b.embalagens)) {
      const manter = b.embalagens.filter((e) => e.id).map((e) => Number(e.id));
      for (const e of db.all('SELECT id FROM produto_embalagens WHERE produto_id = ?', id)) {
        if (!manter.includes(e.id)) db.run('DELETE FROM produto_embalagens WHERE id = ?', e.id);
      }
      for (const e of b.embalagens) {
        const dados = { ...e, produto_id: id };
        const campos = ['produto_id', 'descricao', 'quantidade', 'unidade', 'custo'];
        if (e.id) db.update('produto_embalagens', e.id, dados, campos);
        else e.id = db.insert('produto_embalagens', dados, campos);
      }
    }
    if (Array.isArray(b.brindes)) {
      db.run('DELETE FROM produto_brindes WHERE produto_id = ?', id);
      for (const x of b.brindes) db.insert('produto_brindes', { ...x, produto_id: id }, ['produto_id', 'brinde_produto_id', 'qtd_minima', 'qtd_brinde', 'observacao']);
    }
    if (Array.isArray(b.precos)) {
      db.run('DELETE FROM produto_precos WHERE produto_id = ?', id);
      for (const x of b.precos) {
        // Preço pode referenciar embalagem recém-criada pela posição na lista.
        const emb = x.embalagem_idx != null && b.embalagens ? b.embalagens[x.embalagem_idx]?.id : x.embalagem_id;
        db.insert('produto_precos', { ...x, embalagem_id: emb, produto_id: id }, ['produto_id', 'embalagem_id', 'forma_id', 'valor', 'vigencia_inicio']);
      }
    }
    return id;
  });
}
r.post('/produtos', A.exige('cadastros.produto'), (req, res) => res.status(201).json({ id: salvarProduto(req) }));
r.put('/produtos/:id', A.exige('cadastros.produto'), (req, res) => res.json({ id: salvarProduto(req, Number(req.params.id)) }));

// ---------- Formas de pagamento ----------
r.get('/formas-pagamento', A.exige('cadastros.forma'), (req, res) =>
  responderLista(req, res, {
    sql: `SELECT f.*, (SELECT COUNT(*) FROM condicoes_pagamento c WHERE c.forma_id = f.id) AS condicoes,
            (SELECT COUNT(*) FROM penalidades_comissao p WHERE p.forma_id = f.id) AS penalidades
          FROM formas_pagamento f`,
    sort: 'nome', dir: 'asc',
  }),
);
r.get('/formas-pagamento/:id', A.exige('cadastros.forma'), (req, res) => {
  const f = db.get('SELECT * FROM formas_pagamento WHERE id = ?', req.params.id);
  if (!f) throw new ErroNegocio('Forma não encontrada', 404);
  f.condicoes = db.all('SELECT * FROM condicoes_pagamento WHERE forma_id = ? ORDER BY parcelas', f.id);
  f.penalidades = db.all('SELECT * FROM penalidades_comissao WHERE forma_id = ? ORDER BY dias_de', f.id);
  res.json(f);
});
function salvarForma(req, id) {
  const b = req.body;
  return db.tx(() => {
    const campos = ['nome', 'tipo', 'tipo_baixa', 'ativo'];
    if (id) db.update('formas_pagamento', id, b, campos);
    else id = db.insert('formas_pagamento', b, campos);
    if (Array.isArray(b.condicoes)) {
      const manter = b.condicoes.filter((c) => c.id).map((c) => Number(c.id));
      for (const c of db.all('SELECT id FROM condicoes_pagamento WHERE forma_id = ?', id)) {
        if (!manter.includes(c.id)) {
          try { db.run('DELETE FROM condicoes_pagamento WHERE id = ?', c.id); } catch { throw new ErroNegocio('Condição em uso por pedidos não pode ser removida.'); }
        }
      }
      const cc = ['forma_id', 'descricao', 'parcelas', 'intervalo_dias', 'carencia_dias', 'desconto_pct', 'valor_minimo'];
      for (const c of b.condicoes) {
        if (c.id) db.update('condicoes_pagamento', c.id, { ...c, forma_id: id }, cc);
        else db.insert('condicoes_pagamento', { ...c, forma_id: id }, cc);
      }
    }
    if (Array.isArray(b.penalidades)) {
      db.run('DELETE FROM penalidades_comissao WHERE forma_id = ?', id);
      for (const p of b.penalidades) db.insert('penalidades_comissao', { ...p, forma_id: id }, ['forma_id', 'dias_de', 'dias_ate', 'perda_pct']);
    }
    return id;
  });
}
r.post('/formas-pagamento', A.exige('cadastros.forma'), (req, res) => res.status(201).json({ id: salvarForma(req) }));
r.put('/formas-pagamento/:id', A.exige('cadastros.forma'), (req, res) => res.json({ id: salvarForma(req, Number(req.params.id)) }));

// ---------- Transportadoras e bancos ----------
crud('/transportadoras', { tabela: 'transportadoras', campos: ['nome', 'cnpj', 'telefone', 'email', 'ativo'], permLer: 'cadastros.transportadora' });
crud('/bancos', { tabela: 'bancos', campos: ['codigo', 'nome'], permLer: 'financeiro' });

// ---------- Listas de apoio (combos) ----------
r.get('/opcoes', (req, res) => {
  const u = req.user;
  res.json({
    formas: db.all('SELECT id, nome, tipo FROM formas_pagamento WHERE ativo = 1 ORDER BY nome'),
    condicoes: db.all('SELECT c.* FROM condicoes_pagamento c JOIN formas_pagamento f ON f.id = c.forma_id WHERE f.ativo = 1 ORDER BY c.parcelas'),
    grupos: db.all('SELECT id, nome FROM grupos_produto ORDER BY nome'),
    produtos: db.all('SELECT id, codigo, nome, grupo_id, unidade FROM produtos WHERE ativo = 1 ORDER BY nome'),
    transportadoras: db.all('SELECT id, nome FROM transportadoras WHERE ativo = 1 ORDER BY nome'),
    bancos: db.all('SELECT id, codigo, nome FROM bancos ORDER BY nome'),
    equipes: db.all('SELECT id, nome, supervisor_id FROM equipes ORDER BY nome'),
    empresas: db.all('SELECT id, nome FROM empresas ORDER BY nome'),
    usuarios: db.all('SELECT id, nome, perfil, equipe_id FROM usuarios WHERE ativo = 1 ORDER BY nome'),
    vendedores: db.all(
      `SELECT id, nome, equipe_id FROM usuarios WHERE ativo = 1 AND perfil = 'vendedor' ${u.perfil === 'vendedor' ? 'AND id = ' + Number(u.id) : ''} ORDER BY nome`,
    ),
  });
});

r.get('/produtos/:id/precos', (req, res) => {
  res.json({
    embalagens: db.all('SELECT * FROM produto_embalagens WHERE produto_id = ? ORDER BY quantidade', req.params.id),
    precos: db.all('SELECT * FROM produto_precos WHERE produto_id = ?', req.params.id),
    brindes: db.all('SELECT b.*, p.nome AS brinde_nome FROM produto_brindes b JOIN produtos p ON p.id = b.brinde_produto_id WHERE b.produto_id = ?', req.params.id),
  });
});

module.exports = r;
