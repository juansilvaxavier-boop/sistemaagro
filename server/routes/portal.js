// Portal do cliente: o produtor entra com CPF/CNPJ e senha, acompanha pedidos e entregas, vê boletos, notas e extrato
// e faz pedido pela tabela de preço da região dele (o pedido cai na fila do vendedor da carteira, que confere e envia).
// Acesso liberado pela empresa: o cadastro do cliente gera um link de convite, válido por 7 dias, para criar a senha.
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const sse = require('../sse');

const { ErroNegocio } = S;
const COOKIE = 'agt_portal';
const HORAS = 12;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const CONVITE_DIAS = 7;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const digitos = (v) => String(v || '').replace(/\D/g, '');

/** Situação do pedido como o cliente enxerga (sem o nome das filas internas). */
const SITUACAO = {
  venda: 'Recebido', supervisao: 'Em análise', analise: 'Em análise', diretoria: 'Em análise', cobranca: 'Aguardando pagamento',
  producao: 'Em separação', faturamento: 'Faturando', expedicao: 'Pronto para envio', transito: 'Em transporte', entregue: 'Entregue',
  devolucao: 'Em devolução', cancelado: 'Cancelado',
};
const PASSOS = ['Recebido', 'Em análise', 'Em separação', 'Faturando', 'Em transporte', 'Entregue'];
const passoDe = (etapa) => ({ venda: 0, supervisao: 1, analise: 1, diretoria: 1, cobranca: 1, producao: 2, faturamento: 3, expedicao: 4, transito: 4, entregue: 5 })[etapa] ?? -1;

function cookie(res, token, horas) {
  const seguro = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/api/portal; Max-Age=${Math.round(horas * 3600)}${seguro}`);
}

async function abrirSessao(res, clienteId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('DELETE FROM portal_sessoes WHERE expira < ?', new Date().toISOString());
  await db.run('INSERT INTO portal_sessoes (token, cliente_id, expira) VALUES (?, ?, ?)', sha(token), clienteId, new Date(Date.now() + HORAS * 3600e3).toISOString());
  await db.run(`UPDATE portal_acessos SET tentativas = 0, bloqueado_ate = NULL, ultimo_acesso = datetime('now','localtime') WHERE cliente_id = ?`, clienteId);
  cookie(res, token, HORAS);
}

const r = express.Router();

r.post('/login', async (req, res) => {
  const doc = digitos(req.body?.documento);
  const senha = String(req.body?.senha || '');
  const falha = () => res.status(401).json({ erro: 'CPF/CNPJ ou senha incorretos.' });
  if (!doc || !senha) return falha();
  const c = await db.get(
    `SELECT c.id, c.nome, a.senha_hash, a.ativo, a.tentativas, a.bloqueado_ate FROM clientes c JOIN portal_acessos a ON a.cliente_id = c.id
      WHERE regexp_replace(c.documento, '[^0-9]', '', 'g') = ? AND c.anonimizado_em IS NULL`, doc,
  );
  if (!c || !c.ativo || !c.senha_hash) return falha();
  if (c.bloqueado_ate && c.bloqueado_ate > new Date().toISOString()) {
    return res.status(423).json({ erro: `Acesso bloqueado por excesso de tentativas. Tente de novo em ${Math.ceil((Date.parse(c.bloqueado_ate) - Date.now()) / 60e3)} min.` });
  }
  if (!A.conferirSenha(senha, c.senha_hash)) {
    const t = c.tentativas + 1;
    const bloqueio = t >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MIN * 60e3).toISOString() : null;
    await db.run('UPDATE portal_acessos SET tentativas = ?, bloqueado_ate = ? WHERE cliente_id = ?', bloqueio ? 0 : t, bloqueio, c.id);
    return falha();
  }
  await abrirSessao(res, c.id);
  res.json({ ok: true, nome: c.nome });
});

/** Primeiro acesso (ou nova senha) pelo link de convite gerado pela empresa. */
r.get('/convite/:token', async (req, res) => {
  const a = await db.get(
    'SELECT c.nome, a.convite_expira FROM portal_acessos a JOIN clientes c ON c.id = a.cliente_id WHERE a.convite_token = ? AND a.ativo = 1', sha(req.params.token),
  );
  if (!a || a.convite_expira < new Date().toISOString()) throw new ErroNegocio('Link inválido ou vencido. Peça um novo ao seu vendedor.', 404);
  res.json({ nome: a.nome });
});

r.post('/ativar', async (req, res) => {
  const { token, senha } = req.body || {};
  const a = await db.get('SELECT cliente_id, convite_expira FROM portal_acessos WHERE convite_token = ? AND ativo = 1', sha(token || ''));
  if (!a || a.convite_expira < new Date().toISOString()) throw new ErroNegocio('Link inválido ou vencido. Peça um novo ao seu vendedor.');
  const erro = A.validarSenha(senha);
  if (erro) throw new ErroNegocio(erro);
  await db.run('UPDATE portal_acessos SET senha_hash = ?, convite_token = NULL, convite_expira = NULL WHERE cliente_id = ?', A.hashSenha(senha), a.cliente_id);
  await db.run('DELETE FROM portal_sessoes WHERE cliente_id = ?', a.cliente_id);
  await abrirSessao(res, a.cliente_id);
  res.json({ ok: true });
});

r.post('/sair', async (req, res) => {
  const t = A.lerCookie(req, COOKIE);
  if (t) await db.run('DELETE FROM portal_sessoes WHERE token = ?', sha(t));
  cookie(res, '', 0);
  res.json({ ok: true });
});

// ---------- Daqui em diante, só com sessão do portal ----------
r.use(async (req, res, next) => {
  const t = A.lerCookie(req, COOKIE);
  const s = t ? await db.get(
    `SELECT s.cliente_id, s.expira, c.nome, c.documento, c.vendedor_id FROM portal_sessoes s JOIN clientes c ON c.id = s.cliente_id
       JOIN portal_acessos a ON a.cliente_id = s.cliente_id WHERE s.token = ? AND a.ativo = 1`, sha(t),
  ) : null;
  if (!s || s.expira < new Date().toISOString()) return res.status(401).json({ erro: 'Sessão expirada. Entre de novo.' });
  req.cliente = { id: s.cliente_id, nome: s.nome, documento: s.documento, vendedor_id: s.vendedor_id };
  db.comUsuario({ usuarioId: null, usuarioNome: `Portal: ${s.nome}`, ip: A.ipDe(req), rota: `${req.method} ${req.originalUrl.split('?')[0]}` }, next);
});

r.get('/me', async (req, res) => {
  const v = req.cliente.vendedor_id ? await db.get(
    `SELECT u.nome, u.email, COALESCE(c.celular, c.telefone) AS telefone FROM usuarios u LEFT JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ?`, req.cliente.vendedor_id,
  ) : null;
  const empresa = await db.get('SELECT e.nome FROM empresas e ORDER BY (SELECT COUNT(*) FROM pedidos p WHERE p.empresa_id = e.id AND p.cliente_id = ?) DESC, e.id LIMIT 1', req.cliente.id);
  res.json({ nome: req.cliente.nome, documento: req.cliente.documento, vendedor: v, empresa: empresa?.nome });
});

r.get('/resumo', async (req, res) => {
  const id = req.cliente.id;
  const hoje = S.hoje();
  const f = await db.get(
    `SELECT COALESCE(SUM(valor + COALESCE(juros,0) - COALESCE(desconto,0) - COALESCE(valor_pago,0)), 0) AS aberto,
        COALESCE(SUM(CASE WHEN vencimento < ? THEN valor + COALESCE(juros,0) - COALESCE(desconto,0) - COALESCE(valor_pago,0) END), 0) AS vencido,
        COUNT(*) FILTER (WHERE vencimento < ?) AS qtd_vencidas, MIN(vencimento) FILTER (WHERE vencimento >= ?) AS proximo
       FROM parcelas WHERE cliente_id = ? AND status IN ('a_pagar','parcial')`, hoje, hoje, hoje, id,
  );
  const prox = f.proximo ? await db.get(
    `SELECT SUM(valor + COALESCE(juros,0) - COALESCE(desconto,0) - COALESCE(valor_pago,0)) AS v FROM parcelas WHERE cliente_id = ? AND status IN ('a_pagar','parcial') AND vencimento = ?`, id, f.proximo,
  ) : null;
  const ped = await db.get(
    `SELECT COUNT(*) FILTER (WHERE etapa NOT IN ('entregue','cancelado','devolucao')) AS andamento, COUNT(*) FILTER (WHERE etapa = 'transito') AS transito,
        COALESCE(SUM(valor_total) FILTER (WHERE etapa NOT IN ('venda','cancelado') AND created_at >= ?), 0) AS comprado_12m
       FROM pedidos WHERE cliente_id = ?`, S.addDias(hoje, -365), id,
  );
  res.json({ ...f, proximo_valor: S.r2(prox?.v || 0), aberto: S.r2(f.aberto), vencido: S.r2(f.vencido), ...ped, ultimos: await listaPedidos(id, 5) });
});

async function listaPedidos(clienteId, limite = 200) {
  const rows = await db.all(
    `SELECT p.id, p.numero, p.created_at, p.etapa, p.valor_total, p.codigo_rastreio, p.rastreio_status, p.data_entrega_prevista, p.data_entrega, p.origem_portal,
        t.nome AS transportadora, (SELECT COUNT(*) FROM pedido_itens i WHERE i.pedido_id = p.id) AS itens
       FROM pedidos p LEFT JOIN transportadoras t ON t.id = p.transportadora_id WHERE p.cliente_id = ? ORDER BY p.id DESC LIMIT ${Number(limite)}`, clienteId,
  );
  return rows.map((p) => ({ ...p, situacao: SITUACAO[p.etapa] || p.etapa, passo: passoDe(p.etapa) }));
}

r.get('/pedidos', async (req, res) => res.json({ passos: PASSOS, pedidos: await listaPedidos(req.cliente.id) }));

r.get('/pedidos/:id', async (req, res) => {
  const p = await db.get(
    `SELECT p.id, p.numero, p.created_at, p.etapa, p.valor_produtos, p.valor_desconto, p.valor_total, p.observacao, p.tipo_entrega, p.codigo_rastreio, p.rastreio_status,
        p.data_embarque, p.data_entrega_prevista, p.data_entrega, p.frete_valor, t.nome AS transportadora, f.nome AS forma, c.descricao AS condicao,
        e.logradouro, e.numero AS end_numero, e.bairro, e.cidade, e.uf, e.cep
       FROM pedidos p LEFT JOIN transportadoras t ON t.id = p.transportadora_id LEFT JOIN formas_pagamento f ON f.id = p.forma_id
       LEFT JOIN condicoes_pagamento c ON c.id = p.condicao_id LEFT JOIN cliente_enderecos e ON e.id = p.endereco_entrega_id
      WHERE p.id = ? AND p.cliente_id = ?`, Number(req.params.id), req.cliente.id,
  );
  if (!p) throw new ErroNegocio('Pedido não encontrado.', 404);
  const [itens, historico, rastreio, notas, parcelas] = await Promise.all([
    db.all(`SELECT pr.nome AS produto, e.descricao AS embalagem, i.quantidade, i.unidade, i.valor_unitario, i.valor_total, i.brinde, i.lote, i.validade
              FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE i.pedido_id = ? ORDER BY i.id`, p.id),
    db.all('SELECT etapa_destino, created_at FROM pedido_historico WHERE pedido_id = ? ORDER BY id', p.id),
    db.all('SELECT data, descricao, local, entregue FROM pedido_rastreio WHERE pedido_id = ? ORDER BY data DESC', p.id),
    db.all(`SELECT numero, serie, valor, chave, status, data_emissao FROM notas_fiscais WHERE pedido_id = ? AND cliente_id = ? ORDER BY id`, p.id, req.cliente.id),
    parcelasDo(req.cliente.id, 'p.pedido_id = ?', [p.id]),
  ]);
  // Linha do tempo: primeira vez que o pedido chegou em cada passo.
  const quando = {};
  quando[0] = p.created_at;
  for (const h of historico) { const i = passoDe(h.etapa_destino); if (i >= 0 && !quando[i]) quando[i] = h.created_at; }
  res.json({ ...p, situacao: SITUACAO[p.etapa] || p.etapa, passo: passoDe(p.etapa), passos: PASSOS.map((l, i) => ({ label: l, em: quando[i] || null })), itens, rastreio, notas, parcelas });
});

async function parcelasDo(clienteId, filtro = '1=1', params = []) {
  const hoje = S.hoje();
  const rows = await db.all(
    `SELECT p.id, p.numero, p.total_parcelas, p.vencimento, p.valor, p.juros, p.desconto, p.valor_pago, p.data_pagamento, p.status,
        p.boleto_linha, p.boleto_url, p.boleto_pix, pe.numero AS pedido, n.numero AS nota
       FROM parcelas p LEFT JOIN pedidos pe ON pe.id = p.pedido_id LEFT JOIN notas_fiscais n ON n.id = p.nota_id
      WHERE p.cliente_id = ? AND p.status <> 'cancelada' AND ${filtro} ORDER BY p.vencimento, p.id`, clienteId, ...params,
  );
  return rows.map((x) => {
    const saldo = S.r2(x.valor + (x.juros || 0) - (x.desconto || 0) - (x.valor_pago || 0));
    const aberta = ['a_pagar', 'parcial'].includes(x.status);
    return { ...x, saldo: aberta ? saldo : 0, situacao: !aberta ? 'Paga' : x.vencimento < hoje ? 'Vencida' : 'Em aberto', dias_atraso: aberta && x.vencimento < hoje ? S.diasEntre(x.vencimento, hoje) : 0 };
  });
}

r.get('/parcelas', async (req, res) => {
  const desde = S.addDias(S.hoje(), -365);
  res.json(await parcelasDo(req.cliente.id, `(p.status IN ('a_pagar','parcial') OR p.data_pagamento >= ?)`, [desde]));
});

r.get('/notas', async (req, res) => {
  res.json(await db.all(
    `SELECT n.numero, n.serie, n.valor, n.chave, n.status, n.data_emissao, p.numero AS pedido FROM notas_fiscais n LEFT JOIN pedidos p ON p.id = n.pedido_id
      WHERE n.cliente_id = ? ORDER BY n.data_emissao DESC LIMIT 200`, req.cliente.id,
  ));
});

/** Extrato: compras (notas) e pagamentos em ordem, com saldo devedor corrido. */
r.get('/extrato', async (req, res) => {
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de || '') ? req.query.de : S.addDias(S.hoje(), -365);
  const notas = await db.all(`SELECT substr(data_emissao,1,10) AS data, valor, numero FROM notas_fiscais WHERE cliente_id = ? AND status = 'autorizada' AND data_emissao >= ?`, req.cliente.id, desde);
  const pags = await db.all(`SELECT data_pagamento AS data, valor_pago, numero, total_parcelas, (SELECT numero FROM notas_fiscais n WHERE n.id = parcelas.nota_id) AS nota FROM parcelas WHERE cliente_id = ? AND valor_pago > 0 AND data_pagamento >= ?`, req.cliente.id, desde);
  const anterior = await db.get(
    `SELECT COALESCE((SELECT SUM(valor) FROM notas_fiscais WHERE cliente_id = ? AND status = 'autorizada' AND data_emissao < ?), 0)
          - COALESCE((SELECT SUM(valor_pago) FROM parcelas WHERE cliente_id = ? AND valor_pago > 0 AND data_pagamento < ?), 0) AS s`, req.cliente.id, desde, req.cliente.id, desde,
  );
  const mov = [
    ...notas.map((n) => ({ data: n.data, descricao: `Compra · NF ${n.numero}`, debito: n.valor, credito: 0 })),
    ...pags.map((p) => ({ data: p.data, descricao: `Pagamento parcela ${p.numero}/${p.total_parcelas || '?'}${p.nota ? ` · NF ${p.nota}` : ''}`, debito: 0, credito: p.valor_pago })),
  ].sort((a, b) => a.data.localeCompare(b.data) || b.debito - a.debito);
  let saldo = S.r2(anterior.s);
  for (const m of mov) { saldo = S.r2(saldo + m.debito - m.credito); m.saldo = saldo; }
  res.json({ de: desde, saldo_anterior: S.r2(anterior.s), movimentos: mov, saldo_final: saldo });
});

// ---------- Novo pedido ----------
r.get('/catalogo', async (req, res) => {
  const P = require('../precos');
  const enderecos = await db.all('SELECT id, logradouro, numero, bairro, cidade, uf, cep, principal FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC, id', req.cliente.id);
  const formas = await db.all(`SELECT id, nome, tipo FROM formas_pagamento WHERE ativo = 1 ORDER BY nome`);
  const condicoes = await db.all('SELECT id, forma_id, descricao, parcelas, valor_minimo FROM condicoes_pagamento ORDER BY forma_id, parcelas');
  const formaId = Number(req.query.forma_id) || formas[0]?.id || null;
  const enderecoId = Number(req.query.endereco_id) || enderecos[0]?.id || null;
  const tabela = await P.tabelaVigente(await P.ufDe(req.cliente.id, enderecoId));
  const embs = await db.all(
    `SELECT e.id AS embalagem_id, e.descricao AS embalagem, e.unidade, p.id AS produto_id, p.nome AS produto, p.codigo, g.nome AS grupo
       FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id LEFT JOIN grupos_produto g ON g.id = p.grupo_id
      WHERE p.ativo = 1 ORDER BY g.nome NULLS LAST, p.nome, e.id`,
  );
  const itens = [];
  for (const e of embs) {
    const pr = await P.preco({ produtoId: e.produto_id, embalagemId: e.embalagem_id, formaId, tabela });
    if (pr.valor > 0) itens.push({ ...e, preco: pr.valor });
  }
  const comprados = new Set((await db.all(
    'SELECT DISTINCT i.embalagem_id FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE p.cliente_id = ? AND p.etapa <> \'cancelado\'', req.cliente.id,
  )).map((x) => x.embalagem_id));
  itens.forEach((i) => { i.ja_comprou = comprados.has(i.embalagem_id) ? 1 : 0; });
  res.json({ forma_id: formaId, endereco_id: enderecoId, formas, condicoes, enderecos, tabela: tabela ? `${tabela.nome}${tabela.safra ? ` (safra ${tabela.safra})` : ''}` : null, itens });
});

r.post('/pedidos', async (req, res) => {
  const b = req.body || {};
  const c = req.cliente;
  if (!c.vendedor_id) throw new ErroNegocio('Sua conta ainda não tem um vendedor responsável. Fale com a empresa para fazer o pedido.');
  await S.exigirClienteLiberado(c.id);
  const itens = (Array.isArray(b.itens) ? b.itens : []).filter((i) => Number(i.quantidade) > 0);
  if (!itens.length) throw new ErroNegocio('Escolha ao menos um produto.');
  if (itens.length > 50) throw new ErroNegocio('Pedido com itens demais.');
  const forma = await db.get('SELECT id FROM formas_pagamento WHERE id = ? AND ativo = 1', Number(b.forma_id));
  if (!forma) throw new ErroNegocio('Escolha a forma de pagamento.');
  const cond = b.condicao_id ? await db.get('SELECT id FROM condicoes_pagamento WHERE id = ? AND forma_id = ?', Number(b.condicao_id), forma.id) : null;
  if (b.condicao_id && !cond) throw new ErroNegocio('Condição de pagamento inválida.');
  const end = b.endereco_entrega_id ? await db.get('SELECT id FROM cliente_enderecos WHERE id = ? AND cliente_id = ?', Number(b.endereco_entrega_id), c.id) : null;
  if (b.endereco_entrega_id && !end) throw new ErroNegocio('Endereço inválido.');
  const prods = [];
  for (const it of itens) {
    const e = await db.get('SELECT e.id, e.produto_id FROM produto_embalagens e JOIN produtos p ON p.id = e.produto_id WHERE e.id = ? AND p.ativo = 1', Number(it.embalagem_id));
    if (!e) throw new ErroNegocio('Produto indisponível no pedido.');
    // O cliente não define preço: sempre o de tabela da região.
    prods.push({ produto_id: e.produto_id, embalagem_id: e.id, quantidade: Math.min(Number(it.quantidade), 100000) });
  }
  const empresa = await db.get(
    'SELECT e.id FROM empresas e ORDER BY (SELECT COUNT(*) FROM pedidos p WHERE p.empresa_id = e.id AND p.cliente_id = ?) DESC, e.id LIMIT 1', c.id,
  );
  const { salvarItens } = require('./pedidos');
  const out = await db.tx(async () => {
    const vend = await db.get('SELECT u.id, u.nome, e.supervisor_id FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?', c.vendedor_id);
    const numero = await db.nextSeq('pedido', 100001);
    const obs = String(b.observacao || '').trim().slice(0, 1000);
    const pid = await db.insert('pedidos', {
      numero, empresa_id: empresa.id, cliente_id: c.id, vendedor_id: c.vendedor_id, supervisor_id: vend?.supervisor_id, etapa: 'venda',
      forma_id: forma.id, condicao_id: cond?.id || null, tipo_entrega: b.tipo_entrega === 'retirada' ? 'retirada' : 'transportadora',
      endereco_entrega_id: end?.id || (await db.get('SELECT id FROM cliente_enderecos WHERE cliente_id = ? ORDER BY principal DESC LIMIT 1', c.id))?.id,
      observacao: `Pedido feito pelo cliente no portal.${obs ? ` ${obs}` : ''}`, origem_portal: 1, origem_venda: 'Portal do cliente',
    });
    await salvarItens(pid, prods, forma.id);
    await S.recalcularPedido(pid);
    await S.registrarHistorico(pid, { origem: null, destino: 'venda', acao: 'Pedido feito pelo cliente no portal', usuarioId: null });
    return { id: pid, numero };
  });
  sse.enviar('pedido', { pedido_id: out.id, numero: out.numero, etapa: 'venda', etapa_label: 'Vendedor', acao: 'Novo pedido pelo portal', por: c.nome }, { usuarios: [c.vendedor_id] });
  res.status(201).json(out);
});

r.put('/senha', async (req, res) => {
  const { atual, nova } = req.body || {};
  const a = await db.get('SELECT senha_hash FROM portal_acessos WHERE cliente_id = ?', req.cliente.id);
  if (!A.conferirSenha(atual || '', a?.senha_hash)) throw new ErroNegocio('Senha atual incorreta.');
  const erro = A.validarSenha(nova);
  if (erro) throw new ErroNegocio(erro);
  await db.run('UPDATE portal_acessos SET senha_hash = ? WHERE cliente_id = ?', A.hashSenha(nova), req.cliente.id);
  const t = A.lerCookie(req, COOKIE);
  await db.run('DELETE FROM portal_sessoes WHERE cliente_id = ? AND token <> ?', req.cliente.id, sha(t));
  res.json({ ok: true });
});

// ---------- Administração do acesso (usuários do sistema) ----------
const admin = express.Router();
admin.use(A.exige('clientes.editar'));

async function clienteDoUsuario(req) {
  const id = Number(req.params.clienteId);
  await require('./clientes').exigirAcessoCliente(req.user, id);
  const c = await db.get('SELECT id, nome FROM clientes WHERE id = ? AND anonimizado_em IS NULL', id);
  if (!c) throw new ErroNegocio('Cliente não encontrado.', 404);
  return c;
}

admin.get('/:clienteId', async (req, res) => {
  const c = await clienteDoUsuario(req);
  const a = await db.get(
    `SELECT a.ativo, a.senha_hash IS NOT NULL AS tem_senha, a.convite_expira, a.ultimo_acesso, a.bloqueado_ate, a.created_at, u.nome AS criado_por
       FROM portal_acessos a LEFT JOIN usuarios u ON u.id = a.criado_por WHERE a.cliente_id = ?`, c.id,
  );
  const pedidos = (await db.get('SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND origem_portal = 1', c.id)).n;
  res.json(a ? { ...a, tem_senha: !!a.tem_senha, pedidos_portal: pedidos } : { ativo: 0, sem_acesso: true, pedidos_portal: pedidos });
});

/** Gera o link de primeiro acesso / nova senha (o anterior deixa de valer). */
admin.post('/:clienteId/convite', async (req, res) => {
  const c = await clienteDoUsuario(req);
  const token = crypto.randomBytes(24).toString('base64url');
  const expira = new Date(Date.now() + CONVITE_DIAS * 864e5).toISOString();
  await db.run(
    `INSERT INTO portal_acessos (cliente_id, ativo, convite_token, convite_expira, criado_por) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT (cliente_id) DO UPDATE SET ativo = 1, convite_token = excluded.convite_token, convite_expira = excluded.convite_expira, tentativas = 0, bloqueado_ate = NULL`,
    c.id, sha(token), expira, req.user.id,
  );
  await require('../auditoria').registrar('portal_convite', 'clientes', c.id, null, { expira });
  const origem = process.env.APP_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  res.json({ link: `${origem}/portal.html#convite=${token}`, expira });
});

admin.post('/:clienteId/desativar', async (req, res) => {
  const c = await clienteDoUsuario(req);
  await db.run('UPDATE portal_acessos SET ativo = 0, convite_token = NULL WHERE cliente_id = ?', c.id);
  await db.run('DELETE FROM portal_sessoes WHERE cliente_id = ?', c.id);
  res.json({ ok: true });
});

module.exports = r;
module.exports.admin = admin;
module.exports.SITUACAO = SITUACAO;
