// Registro de quem alterou o quê: cada inclusão, alteração e exclusão guarda o antes e o depois.
const db = require('./db');

// Tabelas que já são registros de histórico ou não têm valor para auditoria.
const IGNORAR = new Set(['auditoria', 'sessoes', 'sequencias', 'mensagem_leituras', 'backups', 'chat_mensagens', 'parcela_eventos', 'pedido_historico']);
const OCULTAR = new Set(['senha_hash', 'conteudo', 'foto']);

function limpar(obj) {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (OCULTAR.has(k)) out[k] = v == null ? null : '(oculto)';
    else if (Buffer.isBuffer(v) || v instanceof Uint8Array) out[k] = '(binário)';
    else out[k] = v;
  }
  return out;
}

async function registrar(acao, entidade, entidadeId, antes, depois, extra = {}) {
  const u = db.usuarioAtual();
  if ((entidade && IGNORAR.has(entidade)) || u.semAuditoria) return;
  await db.run(
    `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, antes, depois, ip, rota)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
    extra.usuarioId ?? u.usuarioId ?? null, extra.usuarioNome ?? u.usuarioNome ?? null, acao, entidade, entidadeId == null ? null : String(entidadeId),
    antes ? JSON.stringify(limpar(antes)) : null, depois ? JSON.stringify(limpar(depois)) : null, u.ip ?? null, u.rota ?? null,
  );
}

/** Grava só os campos que mudaram. */
async function registrarDiferenca(entidade, id, antes, novos) {
  const a = {};
  const d = {};
  for (const [k, v] of Object.entries(novos)) {
    const velho = antes[k];
    if (String(velho ?? '') !== String(v ?? '')) {
      a[k] = velho;
      d[k] = v;
    }
  }
  if (Object.keys(d).length) await registrar('alterar', entidade, id, a, d);
}

module.exports = { registrar, registrarDiferenca };
