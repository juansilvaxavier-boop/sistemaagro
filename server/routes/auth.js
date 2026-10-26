const express = require('express');
const db = require('../db');
const A = require('../auth');
const sse = require('../sse');
const { registrar } = require('../auditoria');
const { ETAPAS } = require('../workflow');
const { ErroNegocio } = require('../services');

const r = express.Router();
const VERSAO_TERMO = '2026-10';

function setCookie(res, token, req) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${A.COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${A.SESSION_HOURS * 3600}${seguro}`);
}

const empresasDo = A.empresasDoUsuario;

r.post('/login', async (req, res) => {
  const { login, senha } = req.body || {};
  const ip = A.ipDe(req);
  const u = await db.get('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', String(login || '').trim().toLowerCase());
  if (u?.bloqueado_ate && u.bloqueado_ate > new Date().toISOString()) {
    const min = Math.ceil((Date.parse(u.bloqueado_ate) - Date.now()) / 60e3);
    return res.status(423).json({ erro: `Usuário bloqueado por excesso de tentativas. Tente novamente em ${min} min.` });
  }
  if (!u || !A.conferirSenha(senha, u.senha_hash)) {
    if (u) {
      const tentativas = u.tentativas_falhas + 1;
      const bloqueio = tentativas >= A.MAX_TENTATIVAS ? new Date(Date.now() + A.BLOQUEIO_MIN * 60e3).toISOString() : null;
      await db.run('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?', bloqueio ? 0 : tentativas, bloqueio, u.id);
      await db.comUsuario({ ip, rota: 'POST /api/auth/login' }, () => registrar('login_falhou', 'usuarios', u.id, null, { tentativas }, { usuarioId: u.id, usuarioNome: u.nome }));
    }
    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  }
  const empresas = await empresasDo(u);
  if (!empresas.length) return res.status(403).json({ erro: 'Usuário sem empresa liberada.' });
  await db.run(`UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso = datetime('now','localtime') WHERE id = ?`, u.id);
  await db.comUsuario({ ip, rota: 'POST /api/auth/login' }, () => registrar('login', 'usuarios', u.id, null, null, { usuarioId: u.id, usuarioNome: u.nome }));
  const token = await A.criarSessao(u.id, empresas.length === 1 ? empresas[0].id : null);
  setCookie(res, token, req);
  res.json({ empresas, empresaEscolhida: empresas.length === 1 ? empresas[0].id : null, trocarSenha: !!u.trocar_senha, aceitarTermo: !u.termo_aceito_em });
});

const pendente = A.autenticado({ semEmpresa: true, semPendencias: true });

r.post('/empresa', pendente, async (req, res) => {
  const empresas = await empresasDo(req.user);
  // "todas": visão consolidada das empresas liberadas para o usuário (só consulta).
  const todas = req.body?.empresa_id === 'todas';
  const id = Number(req.body?.empresa_id);
  if (todas ? empresas.length < 2 : !empresas.some((e) => e.id === id)) return res.status(403).json({ erro: 'Empresa não liberada para o usuário.' });
  // Nova sessão já com a empresa escolhida (o token assinado carrega a empresa).
  await db.run('DELETE FROM sessoes WHERE token = ?', req.token);
  setCookie(res, await A.criarSessao(req.user.id, todas ? null : id, { todas }), req);
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => {
  const token = A.lerCookie(req, A.COOKIE);
  if (token) await db.run('DELETE FROM sessoes WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${A.COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

r.get('/me', pendente, async (req, res) => {
  const u = await db.get('SELECT foto IS NOT NULL AS tem_foto, ultimo_acesso FROM usuarios WHERE id = ?', req.user.id);
  res.json({
    usuario: { ...req.user, perfil_label: A.PERFIS[req.user.perfil], tem_foto: !!u?.tem_foto, permissoesEfetivas: undefined },
    empresa: req.todasEmpresas ? { id: 0, nome: 'Todas as empresas', cnpj: null, todas: true, ids: req.todasEmpresas }
      : req.empresaId ? await db.get('SELECT id, nome, cnpj FROM empresas WHERE id = ?', req.empresaId) : null,
    empresas: await empresasDo(req.user),
    permissoes: req.user.permissoesEfetivas,
    pendencias: { trocarSenha: req.user.trocar_senha, aceitarTermo: !req.user.termo_aceito_em, versaoTermo: VERSAO_TERMO },
    etapas: ETAPAS,
    perfis: A.PERFIS,
  });
});

r.post('/senha', pendente, async (req, res) => {
  const { atual, nova, confirmacao } = req.body || {};
  const u = await db.get('SELECT senha_hash FROM usuarios WHERE id = ?', req.user.id);
  if (!A.conferirSenha(atual, u.senha_hash)) throw new ErroNegocio('Senha atual incorreta.');
  const fraca = A.validarSenha(nova);
  if (fraca) throw new ErroNegocio(fraca);
  if (nova !== confirmacao) throw new ErroNegocio('A confirmação não confere.');
  if (nova === atual) throw new ErroNegocio('A nova senha deve ser diferente da atual.');
  await db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', A.hashSenha(nova), req.user.id);
  await db.run('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?', req.user.id, req.token);
  await registrar('trocar_senha', 'usuarios', req.user.id, null, null);
  res.json({ ok: true });
});

r.post('/termo', pendente, async (req, res) => {
  await db.run(`UPDATE usuarios SET termo_aceito_em = datetime('now','localtime') WHERE id = ?`, req.user.id);
  await registrar('aceitar_termo', 'usuarios', req.user.id, null, { versao: VERSAO_TERMO });
  res.json({ ok: true });
});

// ---------- Meu perfil (somente leitura, exceto a foto) ----------
r.get('/perfil', A.autenticado(), async (req, res) => {
  const u = await db.get(
    `SELECT u.id, u.nome, u.login, u.email, u.perfil, u.comissao_pct, u.created_at, u.ultimo_acesso, u.foto IS NOT NULL AS tem_foto,
       eq.nome AS equipe, sup.nome AS supervisor,
       c.nome AS colaborador_nome, c.cpf, c.cargo, c.setor, c.telefone, c.data_admissao, c.email AS email_colaborador
     FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id LEFT JOIN usuarios sup ON sup.id = eq.supervisor_id
     LEFT JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ?`, req.user.id,
  );
  const empresas = await empresasDo(req.user);
  const permissoes = A.CATALOGO.map(([grupo, itens]) => [grupo, itens.filter(([k]) => A.can(req.user, k)).map(([, l]) => l)]).filter(([, l]) => l.length);
  res.json({ ...u, tem_foto: !!u.tem_foto, perfil_label: A.PERFIS[u.perfil], empresas, permissoes });
});

const FOTO_MAX = 600 * 1024;
r.put('/perfil/foto', A.autenticado(), async (req, res) => {
  const m = String(req.body?.imagem || '').match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new ErroNegocio('Envie uma imagem PNG, JPG ou WEBP.');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > FOTO_MAX) throw new ErroNegocio('Imagem muito grande (máx. 600 KB).');
  await db.run('UPDATE usuarios SET foto = ?, foto_mime = ? WHERE id = ?', buf, m[1], req.user.id);
  await registrar('alterar_foto', 'usuarios', req.user.id, null, null);
  sse.enviar('usuario', { id: req.user.id, foto: true }, { todos: true });
  res.json({ ok: true });
});
r.delete('/perfil/foto', A.autenticado(), async (req, res) => {
  await db.run('UPDATE usuarios SET foto = NULL, foto_mime = NULL WHERE id = ?', req.user.id);
  res.json({ ok: true });
});

// Foto de qualquer usuário (para avatares no chat e no menu).
r.get('/foto/:id', A.autenticado({ semEmpresa: true, semPendencias: true }), async (req, res) => {
  const u = await db.get('SELECT foto, foto_mime FROM usuarios WHERE id = ?', Number(req.params.id));
  if (!u?.foto) return res.status(404).end();
  res.setHeader('Content-Type', u.foto_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(Buffer.from(u.foto));
});

r.get('/eventos', A.autenticado(), (req, res) => sse.conectar(req, res));

module.exports = r;
