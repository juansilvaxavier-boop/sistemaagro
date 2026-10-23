const express = require('express');
const db = require('../db');
const A = require('../auth');
const sse = require('../sse');
const { ETAPAS } = require('../workflow');

const r = express.Router();

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${A.COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${A.SESSION_HOURS * 3600}`);
}

function empresasDo(usuario) {
  if (['admin', 'diretoria'].includes(usuario.perfil)) return db.all('SELECT id, nome, cnpj FROM empresas ORDER BY nome');
  return db.all(
    'SELECT e.id, e.nome, e.cnpj FROM empresas e JOIN usuario_empresas ue ON ue.empresa_id = e.id WHERE ue.usuario_id = ? ORDER BY e.nome',
    usuario.id,
  );
}

r.post('/login', (req, res) => {
  const { login, senha } = req.body || {};
  const u = db.get('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', String(login || '').trim().toLowerCase());
  if (!u || !A.conferirSenha(senha, u.senha_hash)) return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  const empresas = empresasDo(u);
  if (!empresas.length) return res.status(403).json({ erro: 'Usuário sem empresa liberada.' });
  const token = A.criarSessao(u.id, empresas.length === 1 ? empresas[0].id : null);
  setCookie(res, token);
  res.json({ empresas, empresaEscolhida: empresas.length === 1 ? empresas[0].id : null });
});

r.post('/empresa', A.autenticado({ semEmpresa: true }), (req, res) => {
  const id = Number(req.body?.empresa_id);
  if (!empresasDo(req.user).some((e) => e.id === id)) return res.status(403).json({ erro: 'Empresa não liberada para o usuário.' });
  db.run('UPDATE sessoes SET empresa_id = ? WHERE token = ?', id, req.token);
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  const token = A.lerCookie(req, A.COOKIE);
  if (token) db.run('DELETE FROM sessoes WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${A.COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

r.get('/me', A.autenticado({ semEmpresa: true }), (req, res) => {
  const lista = A.PERMISSOES[req.user.perfil] || [];
  res.json({
    usuario: { ...req.user, perfil_label: A.PERFIS[req.user.perfil] },
    empresa: req.empresaId ? db.get('SELECT id, nome, cnpj FROM empresas WHERE id = ?', req.empresaId) : null,
    empresas: empresasDo(req.user),
    permissoes: lista,
    etapas: ETAPAS,
    perfis: A.PERFIS,
  });
});

r.post('/senha', A.autenticado({ semEmpresa: true }), (req, res) => {
  const { atual, nova, confirmacao } = req.body || {};
  const u = db.get('SELECT senha_hash FROM usuarios WHERE id = ?', req.user.id);
  if (!A.conferirSenha(atual, u.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  if (!nova || String(nova).length < 6) return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres.' });
  if (nova !== confirmacao) return res.status(400).json({ erro: 'A confirmação não confere.' });
  db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', A.hashSenha(nova), req.user.id);
  db.run('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?', req.user.id, req.token);
  res.json({ ok: true });
});

r.get('/eventos', A.autenticado(), (req, res) => sse.conectar(req, res));

module.exports = r;
