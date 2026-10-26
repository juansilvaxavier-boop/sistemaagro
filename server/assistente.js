// Assistente de IA: tira dúvidas de uso do sistema e consulta dados só de leitura,
// sempre com as permissões e a abrangência de quem pergunta.
// Sem ANTHROPIC_API_KEY, responde pelo manual (busca por palavras-chave).
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const A = require('./auth');
const E = require('./escopo');
const W = require('./workflow');
const S = require('./services');
const RH = require('./rh');
const { mascararLinhas } = require('./lgpd');

const MANUAL = fs.readFileSync(path.join(__dirname, 'assistente-manual.md'), 'utf8');
const MODELO = () => process.env.ASSISTENTE_MODELO || 'claude-opus-5-5';
const ESFORCO = () => process.env.ASSISTENTE_ESFORCO || 'low';
const LIMITE_HORA = () => Number(process.env.ASSISTENTE_LIMITE_HORA || 40);
const PRAZO_MS = 50_000; // a função na Vercel tem 60 s
const MAX_VOLTAS = 6;

const INSTRUCOES = `Você é o Assistente Acelera, a ajuda embutida no sistema da Acelera Fertilizantes (ERP de uma empresa do agronegócio).
Seu trabalho é explicar como usar o sistema e responder perguntas sobre os dados que a pessoa pode ver, usando as ferramentas de consulta.

Como responder:
- Português do Brasil, direto e curto. Passo a passo numerado quando a pessoa perguntar "como faço".
- Para indicar uma tela, use um link markdown com o endereço do manual, por exemplo [Fila do Vendedor](#/fila/venda). Para um pedido, use [Pedido 123](#/pedido/ID) com o id que a ferramenta devolveu.
- Indique só telas que a pessoa tem acesso (lista em "Telas liberadas"). Se ela pedir algo fora do acesso dela, diga que depende de permissão e quem costuma liberar (administrador, em Cadastros → Usuários e Permissões).
- Para números e situação de pedidos, clientes, pendências ou férias, consulte as ferramentas em vez de supor. Os resultados já vêm filtrados pelo que a pessoa pode ver; se vier vazio, diga que não encontrou na abrangência dela.
- Você só consulta. Não consegue aprovar, cancelar, alterar ou criar nada: explique onde a pessoa faz isso.
- Não revele dados de outros usuários além do que as ferramentas devolverem, e não repita documentos completos se vierem mascarados.
- Se a dúvida não estiver coberta pelo manual nem pelas ferramentas, diga que não sabe e sugira abrir um chamado interno para TI.

<manual>
${MANUAL}
</manual>`;

// ---------- Ferramentas (somente leitura) ----------
const ETAPAS_ENUM = Object.keys(W.ETAPAS);
const etapaLabel = (e) => W.ETAPAS[e]?.label || e;
const limitar = (n, max = 20) => Math.max(1, Math.min(max, Number(n) || 10));

const FERRAMENTAS = {
  buscar_pedidos: {
    description: 'Lista pedidos de venda que o usuário pode ver (já filtrados pela abrangência dele). Filtre por número, nome do cliente ou etapa. Devolve os mais recentes primeiro.',
    input_schema: {
      type: 'object',
      properties: {
        numero: { type: 'integer', description: 'Número do pedido' },
        cliente: { type: 'string', description: 'Parte do nome do cliente' },
        etapa: { type: 'string', enum: ETAPAS_ENUM, description: 'Etapa atual do pedido' },
        limite: { type: 'integer', description: 'Máximo de pedidos (1 a 20, padrão 10)' },
      },
    },
    async executar(req, { numero, cliente, etapa, limite }) {
      const cond = ['p.empresa_id = ?', E.vendas(req.user, 'p')];
      const params = [req.empresaId];
      if (numero) { cond.push('p.numero = ?'); params.push(Number(numero)); }
      if (cliente) { cond.push('c.nome ILIKE ?'); params.push(`%${String(cliente).slice(0, 80)}%`); }
      if (etapa) { cond.push('p.etapa = ?'); params.push(etapa); }
      const rows = await db.all(
        `SELECT p.id, p.numero, p.created_at AS data, c.nome AS cliente, p.valor_total AS valor, p.etapa, p.etapa_desde, v.nome AS vendedor
           FROM pedidos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios v ON v.id = p.vendedor_id
          WHERE ${cond.join(' AND ')} ORDER BY p.id DESC LIMIT ${limitar(limite)}`, ...params,
      );
      return { pedidos: rows.map((p) => ({ ...p, etapa: etapaLabel(p.etapa), link: `#/pedido/${p.id}` })) };
    },
  },
  detalhar_pedido: {
    description: 'Detalhe de um pedido pelo número: cliente, valor, pagamento, etapa e há quantos dias está nela, itens, nota fiscal, rastreio, últimos passos do histórico (com motivos de devolução) e as ações que o usuário pode fazer nele.',
    input_schema: { type: 'object', properties: { numero: { type: 'integer', description: 'Número do pedido' } }, required: ['numero'] },
    async executar(req, { numero }) {
      const p = await db.get(
        `SELECT p.*, c.nome AS cliente, v.nome AS vendedor, s.nome AS supervisor, f.nome AS forma, cp.descricao AS condicao, t.nome AS transportadora,
                CAST(julianday('now','localtime') - julianday(p.etapa_desde) AS INTEGER) AS dias_na_etapa
           FROM pedidos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios v ON v.id = p.vendedor_id LEFT JOIN usuarios s ON s.id = p.supervisor_id
           LEFT JOIN formas_pagamento f ON f.id = p.forma_id LEFT JOIN condicoes_pagamento cp ON cp.id = p.condicao_id
           LEFT JOIN transportadoras t ON t.id = p.transportadora_id
          WHERE p.numero = ? AND p.empresa_id = ? AND ${E.vendas(req.user, 'p')}`, Number(numero), req.empresaId,
      );
      if (!p) return { erro: 'Pedido não encontrado na abrangência do usuário.' };
      const itens = await db.all(
        'SELECT pr.nome AS produto, i.quantidade, i.valor_total FROM pedido_itens i JOIN produtos pr ON pr.id = i.produto_id WHERE i.pedido_id = ? ORDER BY i.id', p.id,
      );
      const historico = await db.all(
        `SELECT h.created_at AS data, h.acao, h.etapa_origem, h.etapa_destino, h.observacao, u.nome AS usuario
           FROM pedido_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.pedido_id = ? ORDER BY h.id DESC LIMIT 6`, p.id,
      );
      const nota = await db.get(`SELECT numero, data_emissao, status FROM notas_fiscais WHERE pedido_id = ? AND status <> 'cancelada'`, p.id);
      return {
        id: p.id, numero: p.numero, link: `#/pedido/${p.id}`, criado_em: p.created_at, cliente: p.cliente, vendedor: p.vendedor, supervisor: p.supervisor,
        valor: p.valor_total, forma: p.forma, condicao: p.condicao, etapa: etapaLabel(p.etapa), dias_na_etapa: p.dias_na_etapa,
        transportadora: p.transportadora, codigo_rastreio: p.codigo_rastreio, entrega_prevista: p.data_entrega_prevista, entregue_em: p.data_entrega,
        nota_fiscal: nota || null,
        itens,
        historico: historico.map((h) => ({ ...h, etapa_origem: h.etapa_origem && etapaLabel(h.etapa_origem), etapa_destino: h.etapa_destino && etapaLabel(h.etapa_destino) })),
        acoes_que_o_usuario_pode_fazer: W.acoesDisponiveis(p, req.user).map((a) => a.label),
      };
    },
  },
  contar_pedidos_por_etapa: {
    description: 'Quantos pedidos em andamento o usuário pode ver em cada etapa, com o valor somado.',
    input_schema: { type: 'object', properties: {} },
    async executar(req) {
      const rows = await db.all(
        `SELECT p.etapa, COUNT(*) AS n, IFNULL(SUM(p.valor_total),0) AS valor FROM pedidos p
          WHERE p.empresa_id = ? AND ${E.vendas(req.user, 'p')} AND p.etapa NOT IN ('entregue','cancelado') GROUP BY p.etapa`, req.empresaId,
      );
      return { etapas: rows.map((r) => ({ etapa: etapaLabel(r.etapa), pedidos: r.n, valor: S.r2(r.valor), link: `#/fila/${r.etapa}` })) };
    },
  },
  buscar_clientes: {
    description: 'Procura clientes pelo nome ou documento entre os que o usuário pode ver. Documentos e contatos vêm mascarados conforme a LGPD.',
    input_schema: { type: 'object', properties: { termo: { type: 'string', description: 'Parte do nome, CPF ou CNPJ' } }, required: ['termo'] },
    async executar(req, { termo }) {
      if (!A.can(req.user, 'clientes') && !A.can(req.user, 'crm')) return { erro: 'O usuário não tem acesso a clientes.' };
      const t = String(termo || '').slice(0, 80);
      const dig = t.replace(/\D/g, '');
      const rows = await db.all(
        `SELECT c.id, c.nome, c.documento, v.nome AS vendedor,
                (SELECT cidade || '/' || uf FROM cliente_enderecos e WHERE e.cliente_id = c.id ORDER BY principal DESC LIMIT 1) AS cidade,
                (SELECT COUNT(*) FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1) AS na_blacklist
           FROM clientes c LEFT JOIN usuarios v ON v.id = c.vendedor_id
          WHERE ${E.clientes(req.user, 'c')} AND (c.nome ILIKE ? ${dig.length >= 3 ? 'OR c.documento LIKE ?' : ''})
          ORDER BY c.nome LIMIT 10`, `%${t}%`, ...(dig.length >= 3 ? [`%${dig}%`] : []),
      );
      const crm = A.can(req.user, 'crm');
      return { clientes: mascararLinhas(req.user, rows).map((c) => ({ ...c, na_blacklist: !!c.na_blacklist, link: crm ? `#/crm/cliente/${c.id}` : '#/clientes' })) };
    },
  },
  minhas_pendencias: {
    description: 'Resumo do que está pendente para o usuário: pedidos nas filas dele, chamados abertos, tarefas do CRM, parcelas vencidas, solicitações de RH e mensagens não lidas do chat.',
    input_schema: { type: 'object', properties: {} },
    async executar(req) {
      const u = req.user;
      const out = {};
      const filas = Object.entries(W.ETAPAS).filter(([k, e]) => e.fila && !['entregue', 'cancelado'].includes(k) && A.can(u, e.fila));
      if (filas.length) {
        const rows = await db.all(
          `SELECT p.etapa, COUNT(*) AS n FROM pedidos p WHERE p.empresa_id = ? AND ${E.vendas(u, 'p')}
            AND p.etapa IN (${filas.map(() => '?').join(',')}) GROUP BY p.etapa`, req.empresaId, ...filas.map(([k]) => k),
        );
        out.filas = rows.map((r) => ({ fila: etapaLabel(r.etapa), pedidos: r.n, link: `#/fila/${r.etapa}` }));
      }
      if (A.can(u, 'chamados')) {
        out.chamados = await db.get(
          `SELECT SUM(CASE WHEN solicitante_id = ? THEN 1 ELSE 0 END) AS abertos_por_mim, SUM(CASE WHEN responsavel_id = ? THEN 1 ELSE 0 END) AS comigo,
                  SUM(CASE WHEN responsavel_id IS NULL AND setor_destino = ? THEN 1 ELSE 0 END) AS sem_responsavel_no_meu_setor
             FROM chamados WHERE status NOT IN ('resolvido','fechado')`, u.id, u.id, u.perfil,
        );
        out.chamados.link = '#/chamados';
      }
      if (A.can(u, 'crm')) {
        out.tarefas_crm = await db.get(
          `SELECT COUNT(*) AS pendentes, SUM(CASE WHEN vencimento < date('now','localtime') THEN 1 ELSE 0 END) AS atrasadas
             FROM crm_tarefas WHERE concluida = 0 AND responsavel_id = ?`, u.id,
        );
      }
      if (['financeiro.parcelas', 'cobranca', 'relatorios.vendas'].some((p) => A.can(u, p))) {
        out.parcelas_vencidas = await db.get(
          `SELECT COUNT(*) AS n, IFNULL(SUM(p.valor),0) AS valor FROM parcelas p
            WHERE p.empresa_id = ? AND p.status = 'a_pagar' AND p.vencimento < date('now','localtime') AND ${E.financeiro(u, 'p')}`, req.empresaId,
        );
        out.parcelas_vencidas.valor = S.r2(out.parcelas_vencidas.valor);
      }
      if (u.colaborador_id) {
        out.minhas_solicitacoes_rh = (await db.get(`SELECT COUNT(*) AS n FROM rh_solicitacoes WHERE colaborador_id = ? AND status = 'aberta'`, u.colaborador_id)).n;
      }
      if (A.can(u, 'rh')) out.solicitacoes_rh_para_responder = (await db.get(`SELECT COUNT(*) AS n FROM rh_solicitacoes WHERE status = 'aberta'`)).n;
      if (A.can(u, 'chat')) out.chat_nao_lidas = (await require('./chat').naoLidas(u.id)).n;
      return out;
    },
  },
  minhas_ferias: {
    description: 'Saldo de férias do próprio usuário por período aquisitivo (dias de direito, usados, pendentes, prazo limite) e férias já programadas.',
    input_schema: { type: 'object', properties: {} },
    async executar(req) {
      if (!req.user.colaborador_id) return { erro: 'O usuário não tem ficha de colaborador vinculada.' };
      const colab = await db.get('SELECT * FROM colaboradores WHERE id = ?', req.user.colaborador_id);
      const periodos = await RH.periodosFerias(colab);
      const programadas = await db.all(
        `SELECT inicio, fim, dias, abono_dias, status FROM rh_ferias WHERE colaborador_id = ? AND status IN ('solicitada','aprovada') AND fim >= date('now','localtime') ORDER BY inicio`, colab.id,
      );
      return {
        periodos: periodos.map((p) => ({ aquisitivo: `${p.inicio} a ${p.fim}`, completo: p.completo, direito: p.direito, usados: p.usados, saldo: p.saldo, limite_para_gozar: p.limite_concessivo, situacao: p.situacao })),
        programadas, link: '#/meu-rh',
      };
    },
  },
};

const TOOLS = Object.entries(FERRAMENTAS).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema }));

/** Contexto da pessoa (fica fora do cache: muda por usuário). */
function contexto(req, telas) {
  const u = req.user;
  return `Usuário: ${u.nome} · perfil ${A.PERFIS[u.perfil] || u.perfil} · dados que pode ver: ${E.NIVEIS[E.abrangencia(u)]}.
Hoje: ${S.hoje()}.
Telas liberadas: ${telas.length ? telas.join('; ') : 'não informado'}.`;
}

// ---------- Modo manual (sem chave da API) ----------
const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PARADAS = new Set('a o e de da do das dos em no na nos nas um uma para por com como que eu meu minha onde qual quais se ser sao os as ao e ou mais menos fazer faco posso consigo'.split(' '));
const SECOES = MANUAL.split(/\n(?=## )/).slice(1).flatMap((sec) => {
  const [titulo, ...linhas] = sec.split('\n');
  const t = titulo.replace(/^## /, '');
  return linhas.join('\n').split(/\n(?=- |\d+\. )/).map((trecho) => ({ titulo: t, texto: trecho.trim() })).filter((x) => x.texto);
});

function responderPeloManual(pergunta) {
  const termos = normalizar(pergunta).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !PARADAS.has(w));
  const radical = (w) => w.slice(0, Math.max(4, w.length - 2));
  const pontuados = SECOES.map((s) => {
    const alvo = normalizar(`${s.titulo} ${s.texto}`);
    const tit = normalizar(s.titulo);
    let p = 0;
    for (const w of termos) {
      if (alvo.includes(radical(w))) p += 1;
      if (tit.includes(radical(w))) p += 1;
    }
    return { ...s, p };
  }).filter((s) => s.p > 0).sort((a, b) => b.p - a.p);
  const melhores = pontuados.filter((s) => s.p >= pontuados[0]?.p * 0.75).slice(0, 3);
  if (!melhores.length) {
    return 'Não encontrei isso no manual. Tente com outras palavras (por exemplo: "como peço férias", "pedido devolvido", "cancelar pedido") ou abra um chamado interno para TI.';
  }
  return `Encontrei isto no manual:\n\n${melhores.map((s) => `**${s.titulo}**\n${s.texto.length > 600 ? s.texto.slice(0, 600) + '…' : s.texto}`).join('\n\n')}`;
}

// ---------- Chamada à API ----------
const fabricaReal = () => {
  const Anthropic = require('@anthropic-ai/sdk');
  const C = Anthropic.default || Anthropic;
  return new C({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
};
let fabricaCliente = fabricaReal;
let cliente;
const usarIa = () => !!process.env.ANTHROPIC_API_KEY || !!fabricaCliente.teste;

async function usoNaUltimaHora(usuarioId) {
  return (await db.get(`SELECT COUNT(*) AS n FROM assistente_uso WHERE usuario_id = ? AND created_at >= datetime('now','localtime','-1 hours')`, usuarioId)).n;
}

/**
 * Responde à conversa. `mensagens`: [{ role: 'user'|'assistant', content: string }], a última do usuário.
 * Devolve { resposta, modo }.
 */
async function responder(req, mensagens, telas = []) {
  const ultima = mensagens.at(-1)?.content || '';
  if (!usarIa()) {
    await db.run('INSERT INTO assistente_uso (usuario_id, modo) VALUES (?, ?)', req.user.id, 'manual');
    return { resposta: responderPeloManual(ultima), modo: 'manual' };
  }
  if (await usoNaUltimaHora(req.user.id) >= LIMITE_HORA()) {
    throw new S.ErroNegocio('Você atingiu o limite de perguntas ao assistente nesta hora. Tente novamente mais tarde.', 429);
  }
  cliente ||= fabricaCliente();
  const msgs = mensagens.map((m) => ({ role: m.role, content: m.content }));
  const system = [
    { type: 'text', text: INSTRUCOES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contexto(req, telas) },
  ];
  const usadas = [];
  const uso = { entrada: 0, saida: 0 };
  const inicio = Date.now();
  let resp;
  let erro = null;
  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const restante = PRAZO_MS - (Date.now() - inicio);
      if (restante < 5000) break;
      resp = await cliente.beta.messages.create({
        model: MODELO(),
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: ESFORCO() },
        system,
        tools: TOOLS,
        messages: msgs,
      }, { timeout: restante });
      uso.entrada += (resp.usage?.input_tokens || 0) + (resp.usage?.cache_read_input_tokens || 0) + (resp.usage?.cache_creation_input_tokens || 0);
      uso.saida += resp.usage?.output_tokens || 0;
      if (resp.stop_reason === 'refusal') break;
      msgs.push({ role: 'assistant', content: resp.content });
      if (resp.stop_reason === 'pause_turn') continue;
      if (resp.stop_reason !== 'tool_use') break;
      const resultados = [];
      for (const b of resp.content.filter((x) => x.type === 'tool_use')) {
        usadas.push(b.name);
        const f = FERRAMENTAS[b.name];
        let conteudo;
        let falhou = false;
        try {
          conteudo = f ? await f.executar(req, b.input || {}) : { erro: 'Ferramenta desconhecida.' };
        } catch (e) {
          conteudo = { erro: e.message };
          falhou = true;
        }
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(conteudo), ...(falhou ? { is_error: true } : {}) });
      }
      msgs.push({ role: 'user', content: resultados });
    }
  } catch (e) {
    erro = e.message;
    console.error('[assistente]', e.status || '', e.message);
  }
  await db.run(
    'INSERT INTO assistente_uso (usuario_id, modo, ferramentas, tokens_entrada, tokens_saida, erro) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id, 'ia', usadas.join(',') || null, uso.entrada, uso.saida, erro,
  );
  if (erro || !resp) {
    return { resposta: `O assistente de IA está indisponível agora. Enquanto isso, veja o que achei no manual:\n\n${responderPeloManual(ultima)}`, modo: 'manual' };
  }
  if (resp.stop_reason === 'refusal') return { resposta: 'Não posso ajudar com esse pedido. Posso explicar como usar alguma tela do sistema?', modo: 'ia' };
  let texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (resp.stop_reason === 'max_tokens') texto += '\n\n_(A resposta foi cortada por ser longa. Peça para continuar.)_';
  if (resp.stop_reason === 'tool_use' || resp.stop_reason === 'pause_turn') texto ||= 'A consulta demorou mais que o esperado. Tente uma pergunta mais específica.';
  return { resposta: texto || 'Não consegui montar uma resposta. Tente reformular a pergunta.', modo: 'ia' };
}

module.exports = {
  responder, responderPeloManual, FERRAMENTAS, TOOLS, usarIa,
  // Testes injetam um cliente falso.
  _definirCliente(fn) { fabricaCliente = fn; fabricaCliente.teste = true; cliente = null; },
  _restaurar() { fabricaCliente = fabricaReal; cliente = null; },
};
