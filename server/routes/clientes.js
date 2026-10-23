const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');
const { mascararObjeto, mascararLinhas } = require('../lgpd');
const { registrar } = require('../auditoria');

const r = express.Router();
const { ErroNegocio } = S;

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

function validarDocumento(doc, tipo) {
  const d = soDigitos(doc);
  if (tipo === 'J' ? !validarCnpj(d) : !validarCpf(d)) throw new ErroNegocio(tipo === 'J' ? 'CNPJ inválido.' : 'CPF inválido.');
  return d;
}
function validarCpf(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function validarCnpj(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Clientes visíveis conforme a abrangência: carteira própria, da equipe ou todos. */
function escopoClientes(user, alias = 'c') {
  return { sql: require('../escopo').clientes(user, alias), params: [] };
}

async function exigirAcessoCliente(user, clienteId) {
  const e = escopoClientes(user);
  const ok = await db.get(`SELECT id FROM clientes c WHERE c.id = ? AND ${e.sql}`, clienteId, ...e.params);
  if (!ok) throw new ErroNegocio('Cliente não encontrado ou fora da sua carteira.', 404);
}

r.get('/', A.exige('clientes', 'crm', 'cobranca'), async (req, res) => {
  const e = escopoClientes(req.user);
  await responderLista(req, res, {
    sql: `SELECT c.id, c.tipo_pessoa, c.documento, c.nome, c.email, c.inscricao_estadual, c.vendedor_id, v.nome AS vendedor,
            (SELECT cidade || '/' || uf FROM cliente_enderecos en WHERE en.cliente_id = c.id ORDER BY principal DESC LIMIT 1) AS cidade,
            (SELECT numero FROM cliente_telefones t WHERE t.cliente_id = c.id LIMIT 1) AS telefone,
            (SELECT tipo FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 ORDER BY CASE tipo WHEN 'bloqueio' THEN 0 ELSE 1 END LIMIT 1) AS blacklist,
            c.created_at
          FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id WHERE ${e.sql}`,
    params: e.params, sort: 'nome', dir: 'asc',
  });
});

r.get('/busca', A.exige('clientes', 'pedido.criar', 'crm', 'cobranca', 'arquivos'), async (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const qd = `%${soDigitos(req.query.q) || '#'}%`;
  const e = escopoClientes(req.user);
  res.json(await db.all(`SELECT c.id, c.nome, c.documento, c.tipo_pessoa FROM clientes c WHERE (c.nome ILIKE ? OR c.documento LIKE ?) AND ${e.sql} ORDER BY c.nome LIMIT 20`, q, qd, ...e.params));
});

r.get('/:id', A.exige('clientes', 'pedido.criar', 'crm', 'cobranca', 'fila'), async (req, res) => {
  const id = Number(req.params.id);
  await exigirAcessoCliente(req.user, id);
  const c = await db.get('SELECT c.*, v.nome AS vendedor FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id WHERE c.id = ?', id);
  if (!c) throw new ErroNegocio('Cliente não encontrado', 404);
  c.enderecos = await db.all('SELECT * FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id', id);
  c.telefones = await db.all('SELECT * FROM cliente_telefones WHERE cliente_id = ?', id);
  c.areas = await db.all('SELECT * FROM cliente_areas WHERE cliente_id = ?', id);
  c.ref_comerciais = await db.all('SELECT * FROM cliente_ref_comerciais WHERE cliente_id = ?', id);
  c.ref_bancarias = await db.all('SELECT * FROM cliente_ref_bancarias WHERE cliente_id = ?', id);
  c.blacklist = await S.situacaoBlacklist(id);
  // LGPD: registra o acesso ao cadastro e esconde dados pessoais de quem não tem a permissão.
  await registrar('visualizar', 'clientes', id, null, null);
  mascararObjeto(req.user, c);
  mascararLinhas(req.user, c.telefones.map((t) => Object.assign(t, { telefone: t.numero }))).forEach((t) => { t.numero = t.telefone; delete t.telefone; });
  c.dados_mascarados = !A.can(req.user, 'lgpd.dados');
  res.json(c);
});

const camposCliente = ['tipo_pessoa', 'documento', 'nome', 'nome_fantasia', 'inscricao_estadual', 'inscricao_produtor', 'email', 'data_nascimento', 'vendedor_id', 'limite_credito', 'observacao', 'base_legal', 'consentimento_marketing', 'consentimento_em'];
const filhos = {
  enderecos: ['cliente_enderecos', ['tipo', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'zona_rural', 'posta_restante', 'como_chegar', 'principal']],
  telefones: ['cliente_telefones', ['tipo', 'numero', 'contato', 'whatsapp']],
  areas: ['cliente_areas', ['tipo_cultivo', 'qtd_pes', 'area', 'medida']],
  ref_comerciais: ['cliente_ref_comerciais', ['empresa', 'contato', 'telefone', 'ultima_checagem', 'checada', 'positivo', 'observacao']],
  ref_bancarias: ['cliente_ref_bancarias', ['banco', 'agencia', 'conta', 'gerente', 'telefone', 'data_checagem', 'checada', 'positivo', 'observacao']],
};

/** Sincroniza uma aba de lista: mantém ids enviados, cria novos e remove os que saíram. */
async function sincronizar(tabela, campos, clienteId, itens) {
  const manter = itens.filter((i) => i.id).map((i) => Number(i.id));
  for (const x of await db.all(`SELECT id FROM ${tabela} WHERE cliente_id = ?`, clienteId)) {
    if (!manter.includes(x.id)) {
      try {
        await db.run(`DELETE FROM ${tabela} WHERE id = ?`, x.id);
      } catch {
        throw new ErroNegocio('Endereço em uso por pedido não pode ser removido.');
      }
    }
  }
  for (const i of itens) {
    const dados = { ...i, cliente_id: clienteId };
    if (i.id) await db.update(tabela, i.id, dados, campos);
    else await db.insert(tabela, dados, ['cliente_id', ...campos]);
  }
}

async function salvarCliente(req, id) {
  const b = { ...req.body };
  if (!String(b.nome || '').trim()) throw new ErroNegocio('Informe o nome.');
  // Quem vê os dados pessoais mascarados não pode sobrescrevê-los ao editar.
  if (id && !A.can(req.user, 'lgpd.dados')) {
    delete b.documento;
    delete b.email;
    delete b.telefones;
  }
  for (const k of ['base_legal', 'consentimento_marketing']) if (b[k] === undefined) delete b[k];
  if (b.consentimento_marketing) b.consentimento_em ||= new Date().toISOString().slice(0, 10);
  if (b.documento !== undefined || !id) b.documento = validarDocumento(b.documento, b.tipo_pessoa || 'F');
  // Quem vê só os próprios dados cadastra na própria carteira; o supervisor, em alguém da equipe.
  const E = require('../escopo');
  if (E.abrangencia(req.user) === 'proprio') b.vendedor_id = req.user.id;
  else if (b.vendedor_id && E.vendedoresSql(req.user) && !(await db.get(`SELECT 1 AS ok WHERE ? IN (${E.vendedoresSql(req.user)})`, Number(b.vendedor_id)))) {
    throw new ErroNegocio('Vendedor fora da sua equipe.', 403);
  }
  return await db.tx(async () => {
    if (b.documento) {
      const dup = await db.get('SELECT id FROM clientes WHERE documento = ? AND id <> ?', b.documento, id || 0);
      if (dup) throw new ErroNegocio('Já existe cliente com este CPF/CNPJ.', 409);
    }
    if (id) await db.update('clientes', id, b, camposCliente);
    else id = await db.insert('clientes', b, camposCliente);
    for (const [chave, [tabela, campos]] of Object.entries(filhos)) {
      if (Array.isArray(b[chave])) await sincronizar(tabela, campos, id, b[chave]);
    }
    return id;
  });
}

r.post('/', A.exige('clientes.editar', 'pedido.criar'), async (req, res) => res.status(201).json({ id: await salvarCliente(req) }));
r.put('/:id', A.exige('clientes.editar', 'serasa'), async (req, res) => {
  await exigirAcessoCliente(req.user, Number(req.params.id));
  res.json({ id: await salvarCliente(req, Number(req.params.id)) });
});

// Checagem de referência (análise/supervisão)
r.put('/referencias/:tipo/:id', A.exige('serasa', 'fila.analise', 'fila.supervisao'), async (req, res) => {
  const t = req.params.tipo === 'bancaria' ? filhos.ref_bancarias : filhos.ref_comerciais;
  const dados = { ...req.body };
  if (req.params.tipo === 'bancaria') dados.data_checagem = dados.data_checagem || S.hoje();
  else dados.ultima_checagem = dados.ultima_checagem || S.hoje();
  await db.update(t[0], req.params.id, dados, t[1]);
  res.json({ ok: true });
});

// ---------- Histórico de compra ----------
r.get('/historico/compras', A.exige('clientes.historico', 'fila'), async (req, res) => {
  const doc = soDigitos(req.query.documento);
  const cliente = await db.get('SELECT id, nome, documento, tipo_pessoa FROM clientes WHERE documento = ? OR id = ?', doc, Number(req.query.cliente_id) || 0);
  if (!cliente) return res.json({ cliente: null, pedidos: [], resumo: null });
  const pedidos = await db.all(
    `SELECT p.id, p.numero, p.created_at, p.etapa, p.valor_total, f.nome AS forma, c.descricao AS condicao, v.nome AS vendedor,
       e.nome AS empresa, nf.numero AS nota
     FROM pedidos p LEFT JOIN formas_pagamento f ON f.id = p.forma_id LEFT JOIN condicoes_pagamento c ON c.id = p.condicao_id
     LEFT JOIN usuarios v ON v.id = p.vendedor_id LEFT JOIN empresas e ON e.id = p.empresa_id
     LEFT JOIN notas_fiscais nf ON nf.pedido_id = p.id AND nf.status <> 'cancelada'
     WHERE p.cliente_id = ? AND ${require('../escopo').vendas(req.user, 'p')} ORDER BY p.created_at DESC`, cliente.id,
  );
  const fin = await db.get(
    `SELECT IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} THEN ${S.SALDO_PARCELA_SQL} END),0) AS em_aberto,
            IFNULL(SUM(CASE WHEN ${S.ABERTA_SQL} AND p.vencimento < date('now','localtime') THEN ${S.SALDO_PARCELA_SQL} END),0) AS vencido,
            IFNULL(SUM(p.valor_pago),0) AS pago,
            MAX(CASE WHEN p.status = 'liquidada' THEN julianday(p.data_pagamento) - julianday(p.vencimento_original) END) AS maior_atraso
       FROM parcelas p WHERE p.cliente_id = ? AND ${require('../escopo').financeiro(req.user, 'p')}`, cliente.id,
  );
  const ativos = pedidos.filter((p) => p.etapa !== 'cancelado');
  res.json({
    cliente,
    pedidos,
    resumo: {
      pedidos: ativos.length,
      total_comprado: S.r2(ativos.reduce((a, p) => a + p.valor_total, 0)),
      ticket_medio: ativos.length ? S.r2(ativos.reduce((a, p) => a + p.valor_total, 0) / ativos.length) : 0,
      primeira_compra: ativos.at(-1)?.created_at,
      ultima_compra: ativos[0]?.created_at,
      ...fin,
      maior_atraso: Math.max(0, Math.round(fin.maior_atraso || 0)),
    },
    blacklist: await S.situacaoBlacklist(cliente.id),
  });
});

// ---------- Serasa ----------
r.get('/:id/serasa', A.exige('serasa', 'fila'), async (req, res) => {
  res.json(await db.all(
    'SELECT s.*, u.nome AS usuario FROM consultas_serasa s LEFT JOIN usuarios u ON u.id = s.usuario_id WHERE cliente_id = ? ORDER BY s.id DESC',
    req.params.id,
  ));
});
r.post('/:id/serasa', A.exige('serasa', 'fila.diretoria'), async (req, res) => {
  res.status(201).json(await S.consultarSerasa({
    clienteId: Number(req.params.id), pedidoId: req.body?.pedido_id, usuarioId: req.user.id,
    tipo: req.body?.tipo === 'restricao' ? 'restricao' : 'serasa', justificativa: req.body?.justificativa,
  }));
});

// ---------- Blacklist ----------
r.get('/blacklist/lista', A.exige('blacklist'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT b.id, b.cliente_id, c.documento, c.nome, b.tipo, b.motivo, b.data_inclusao, u.nome AS usuario,
            b.ativo, b.data_exclusao, ux.nome AS usuario_exclusao, b.motivo_exclusao
          FROM blacklist b JOIN clientes c ON c.id = b.cliente_id
          LEFT JOIN usuarios u ON u.id = b.usuario_id LEFT JOIN usuarios ux ON ux.id = b.usuario_exclusao_id`,
    sort: 'data_inclusao', exact: ['ativo', 'tipo'],
  }),
);
r.post('/blacklist', A.exige('blacklist.editar'), async (req, res) => {
  const { cliente_id, tipo, motivo } = req.body || {};
  if (!['alerta', 'bloqueio'].includes(tipo)) throw new ErroNegocio('Tipo deve ser alerta ou bloqueio.');
  if (!String(motivo || '').trim()) throw new ErroNegocio('Informe o motivo.');
  if (!await db.get('SELECT id FROM clientes WHERE id = ?', cliente_id)) throw new ErroNegocio('Cliente não encontrado.', 404);
  res.status(201).json({ id: await db.insert('blacklist', { cliente_id, tipo, motivo, usuario_id: req.user.id }) });
});
r.post('/blacklist/:id/excluir', A.exige('blacklist.editar'), async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) throw new ErroNegocio('Informe o motivo da exclusão.');
  await db.run(
    `UPDATE blacklist SET ativo = 0, motivo_exclusao = ?, usuario_exclusao_id = ?, data_exclusao = datetime('now','localtime') WHERE id = ? AND ativo = 1`,
    motivo, req.user.id, req.params.id,
  );
  res.json({ ok: true });
});

module.exports = r;
module.exports.escopoClientes = escopoClientes;
module.exports.exigirAcessoCliente = exigirAcessoCliente;
module.exports.validarCpf = validarCpf;
module.exports.validarCnpj = validarCnpj;
