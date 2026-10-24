// Auditoria, LGPD (direitos do titular) e backups do banco.
const express = require('express');
const zlib = require('node:zlib');
const db = require('../db');
const A = require('../auth');
const S = require('../services');
const { responderLista } = require('../lista');
const { registrar } = require('../auditoria');

const r = express.Router();
const { ErroNegocio } = S;

// ---------- Auditoria ----------
r.get('/auditoria', A.exige('auditoria'), async (req, res) =>
  await responderLista(req, res, {
    sql: `SELECT id, created_at, usuario_id, usuario_nome, acao, entidade, entidade_id, ip, rota,
            antes::text AS antes, depois::text AS depois FROM auditoria`,
    sort: 'id', dir: 'desc', exact: ['acao', 'entidade', 'entidade_id', 'usuario_id'],
  }),
);

// ---------- LGPD: direitos do titular ----------
async function dadosDoTitular(clienteId) {
  const tabelas = {
    cliente: ['SELECT * FROM clientes WHERE id = ?', true],
    enderecos: ['SELECT * FROM cliente_enderecos WHERE cliente_id = ?'],
    telefones: ['SELECT * FROM cliente_telefones WHERE cliente_id = ?'],
    areas_cultivo: ['SELECT * FROM cliente_areas WHERE cliente_id = ?'],
    referencias_comerciais: ['SELECT * FROM cliente_ref_comerciais WHERE cliente_id = ?'],
    referencias_bancarias: ['SELECT * FROM cliente_ref_bancarias WHERE cliente_id = ?'],
    consultas_credito: ['SELECT id, tipo, score, restricoes, valor_restricoes, resultado, justificativa, created_at FROM consultas_serasa WHERE cliente_id = ?'],
    blacklist: ['SELECT tipo, motivo, data_inclusao, ativo, data_exclusao, motivo_exclusao FROM blacklist WHERE cliente_id = ?'],
    pedidos: ['SELECT numero, created_at, etapa, valor_total FROM pedidos WHERE cliente_id = ?'],
    notas_fiscais: ['SELECT numero, serie, data_emissao, valor, status FROM notas_fiscais WHERE cliente_id = ?'],
    parcelas: ['SELECT numero, vencimento, valor, valor_pago, data_pagamento, status FROM parcelas WHERE cliente_id = ?'],
    negativacoes: ['SELECT status, valor, protocolo, created_at FROM negativacoes WHERE cliente_id = ?'],
    cobranca: ['SELECT tipo, resultado, descricao, data_promessa, created_at FROM cobranca_acoes WHERE cliente_id = ?'],
    relacionamento: ['SELECT tipo, assunto, descricao, data FROM crm_interacoes WHERE cliente_id = ?'],
    arquivos: ['SELECT nome_original, categoria, created_at FROM arquivos WHERE cliente_id = ?'],
  };
  const out = {};
  for (const [nome, [sql, unico]] of Object.entries(tabelas)) out[nome] = unico ? await db.get(sql, clienteId) : await db.all(sql, clienteId);
  return out;
}

r.get('/lgpd/cliente/:id/exportar', A.exige('lgpd.titular'), async (req, res) => {
  const id = Number(req.params.id);
  const dados = await dadosDoTitular(id);
  if (!dados.cliente) throw new ErroNegocio('Cliente não encontrado', 404);
  await registrar('lgpd_exportar', 'clientes', id, null, { motivo: req.query.motivo || 'Solicitação do titular' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dados_titular_${id}_${S.hoje()}.json"`);
  res.end(JSON.stringify({ gerado_em: new Date().toISOString(), controlador: 'Agroterra', titular: id, dados }, null, 2));
});

/**
 * Anonimiza o titular: remove dados pessoais e mantém os registros fiscais e financeiros
 * (guardados por obrigação legal), agora sem identificar a pessoa.
 */
r.post('/lgpd/cliente/:id/anonimizar', A.exige('lgpd.titular'), async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 10) throw new ErroNegocio('Informe o motivo (pedido do titular, fim da finalidade...).');
  const c = await db.get('SELECT * FROM clientes WHERE id = ?', id);
  if (!c) throw new ErroNegocio('Cliente não encontrado', 404);
  if (c.anonimizado_em) throw new ErroNegocio('Cliente já anonimizado.');
  const abertas = (await db.get(`SELECT COUNT(*) AS n FROM parcelas p WHERE cliente_id = ? AND ${S.ABERTA_SQL}`, id)).n;
  const ativos = (await db.get(`SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND etapa NOT IN ('entregue','cancelado','devolucao')`, id)).n;
  if (abertas || ativos) throw new ErroNegocio('O cliente tem pedidos em andamento ou parcelas em aberto. Conclua-os antes de anonimizar.');
  await db.tx(async () => {
    await db.run(
      `UPDATE clientes SET nome = ?, nome_fantasia = NULL, documento = ?, inscricao_estadual = NULL, inscricao_produtor = NULL, email = NULL,
         data_nascimento = NULL, observacao = NULL, consentimento_marketing = 0, anonimizado_em = datetime('now','localtime') WHERE id = ?`,
      `Titular anonimizado #${id}`, `ANON${id}`, id,
    );
    await db.run('UPDATE cliente_enderecos SET cep = NULL, logradouro = NULL, numero = NULL, complemento = NULL, bairro = NULL, como_chegar = NULL WHERE cliente_id = ?', id);
    for (const t of ['cliente_telefones', 'cliente_areas', 'cliente_ref_comerciais', 'cliente_ref_bancarias', 'consultas_serasa', 'arquivos']) {
      await db.run(`DELETE FROM ${t} WHERE cliente_id = ?`, id);
    }
    await db.run('UPDATE crm_interacoes SET descricao = NULL WHERE cliente_id = ?', id);
    await db.run('UPDATE cobranca_acoes SET descricao = NULL WHERE cliente_id = ?', id);
    await registrar('lgpd_anonimizar', 'clientes', id, null, { motivo });
  });
  res.json({ ok: true });
});

// ---------- Backups ----------
const FORA_DO_BACKUP = new Set(['sessoes', 'backups', 'schema_versao']);
const RETER_AUTOMATICOS = Number(process.env.BACKUP_RETENCAO || 30);

async function gerarBackup(origem, usuarioId) {
  const tabelas = (await db.all(
    `SELECT table_name AS nome FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )).map((t) => t.nome).filter((t) => !FORA_DO_BACKUP.has(t));
  const conteudo = { versao: 1, gerado_em: new Date().toISOString(), tabelas: {} };
  let registros = 0;
  for (const t of tabelas) {
    const linhas = await db.all(`SELECT * FROM ${t}`);
    registros += linhas.length;
    conteudo.tabelas[t] = linhas.map((l) => {
      const o = {};
      for (const [k, v] of Object.entries(l)) o[k] = v instanceof Uint8Array ? { $base64: Buffer.from(v).toString('base64') } : v;
      return o;
    });
  }
  const gz = zlib.gzipSync(JSON.stringify(conteudo), { level: 9 });
  const id = await db.insert('backups', { origem, usuario_id: usuarioId, tabelas: tabelas.length, registros, tamanho: gz.length, conteudo: gz }, null, { auditoria: false });
  if (origem === 'automatico') {
    await db.run(
      `DELETE FROM backups WHERE origem = 'automatico' AND id NOT IN (SELECT id FROM backups WHERE origem = 'automatico' ORDER BY id DESC LIMIT ?)`,
      RETER_AUTOMATICOS,
    );
  }
  return { id, tabelas: tabelas.length, registros, tamanho: gz.length };
}

r.get('/backups', A.exige('backup'), async (req, res) => {
  res.json(await db.all(
    `SELECT b.id, b.origem, b.tabelas, b.registros, b.tamanho, b.created_at, u.nome AS usuario FROM backups b
       LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT 100`,
  ));
});
r.post('/backups', A.exige('backup'), async (req, res) => {
  const b = await gerarBackup('manual', req.user.id);
  await registrar('backup_manual', 'backups', b.id, null, { registros: b.registros });
  res.status(201).json(b);
});
r.get('/backups/:id/download', A.exige('backup'), async (req, res) => {
  const b = await db.get('SELECT id, conteudo, created_at FROM backups WHERE id = ?', Number(req.params.id));
  if (!b) throw new ErroNegocio('Backup não encontrado', 404);
  await registrar('backup_download', 'backups', b.id, null, null);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="agroterra_backup_${b.created_at.replace(/[: ]/g, '-')}.json.gz"`);
  res.end(Buffer.from(b.conteudo));
});

// ---------- Importação da planilha do sistema anterior ----------
const multer = require('multer');
const importacao = require('../importacao');
const uploadPlanilha = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

r.get('/importacao', A.exige('importacao'), async (req, res) => res.json({ importado: await importacao.situacao() }));

/** Sem "aplicar": só lê a planilha e mostra o que vai entrar. Com "aplicar": faz backup, importa e confere. */
r.post('/importacao', A.exige('importacao'), uploadPlanilha.single('arquivo'), async (req, res) => {
  if (!req.file) throw new ErroNegocio('Envie a planilha (.xlsx).');
  if (!/\.xlsx$/i.test(Buffer.from(req.file.originalname, 'latin1').toString('utf8'))) throw new ErroNegocio('A planilha precisa estar no formato .xlsx.');
  let dados;
  try {
    dados = importacao.transformar(await importacao.lerPlanilha(req.file.buffer), { empresaId: req.empresaId });
  } catch (e) {
    throw new ErroNegocio(`Não consegui ler a planilha: ${e.message}`);
  }
  const resposta = { totais: dados.totais, avisos: dados.avisos, relatorio: importacao.relatorio(dados, req.file.originalname) };
  if (req.body?.aplicar !== '1') return res.json({ ...resposta, importado: await importacao.situacao() });
  const backup = await gerarBackup('manual', req.user.id);
  const t0 = Date.now();
  await importacao.executar(importacao.gerarSql(dados));
  const conferencia = importacao.conferir(dados.totais, await importacao.situacao());
  await registrar('importacao', 'planilha', importacao.ORIGEM, null, { arquivo: req.file.originalname, backup: backup.id, segundos: (Date.now() - t0) / 1000, ok: conferencia.every((c) => c.ok) });
  res.json({ ...resposta, aplicado: true, backup_id: backup.id, conferencia });
});

r.post('/importacao/desfazer', A.exige('importacao'), async (req, res) => {
  if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'DESFAZER') throw new ErroNegocio('Digite DESFAZER para confirmar.');
  const backup = await gerarBackup('manual', req.user.id);
  await importacao.executar(importacao.sqlDesfazer());
  await registrar('importacao_desfeita', 'planilha', importacao.ORIGEM, null, { backup: backup.id });
  res.json({ ok: true, backup_id: backup.id, importado: await importacao.situacao() });
});

/** Rota chamada pelo agendador (Vercel Cron), protegida por CRON_SECRET. */
async function cronBackup(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ erro: 'Não autorizado.' });
  const b = await db.comUsuario({ usuarioNome: 'Agendador', rota: 'cron' }, () => gerarBackup('automatico', null));
  res.json({ ok: true, ...b });
}

/**
 * Rotina diária (Vercel Cron): automações do CRM, limites de crédito automáticos, rastreio dos pedidos em trânsito
 * e consulta dos boletos em aberto no banco. Cada parte roda mesmo que outra falhe.
 */
async function cronCrm(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ erro: 'Não autorizado.' });
  const out = {};
  const parte = async (nome, fn) => { try { out[nome] = await fn(); } catch (e) { out[nome] = { erro: e.message }; } };
  await db.comUsuario({ usuarioNome: 'Agendador', rota: 'cron' }, async () => {
    await parte('crm', async () => {
      const resumo = await require('../crm-automacoes').executar();
      return { geradas: resumo.reduce((a, x) => a + x.geradas, 0), regras: resumo.map((x) => ({ id: x.id, nome: x.nome, geradas: x.geradas })) };
    });
    await parte('credito', () => require('../credito').atualizarAutomaticos());
    await parte('rastreio', () => require('../rastreio').atualizarTodos());
    const empresas = await db.all('SELECT id FROM empresas');
    await parte('boletos', async () => {
      const B = require('../integracoes/boletos');
      const r = { consultados: 0, baixados: 0 };
      for (const e of empresas) { const x = await B.sincronizarAbertos(e.id); r.consultados += x.consultados; r.baixados += x.baixados; }
      return r;
    });
  });
  res.json({ ok: true, ...out, geradas: out.crm?.geradas ?? 0 });
}

module.exports = r;
module.exports.cronBackup = cronBackup;
module.exports.cronCrm = cronCrm;
module.exports.gerarBackup = gerarBackup;
