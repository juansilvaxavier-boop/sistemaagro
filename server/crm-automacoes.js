// Automações do CRM: regras configuráveis que olham clientes, pedidos, oportunidades, propostas e parcelas
// e criam tarefas para o vendedor (ou supervisor / usuário escolhido). Cada situação gera uma tarefa só uma vez
// (chave única por regra), então a mesma regra pode rodar várias vezes por dia sem duplicar.
const db = require('./db');
const S = require('./services');
const sse = require('./sse');

const { ErroNegocio } = S;
const PRIORIDADES = ['baixa', 'normal', 'alta'];
const RESPONSAVEIS = ['vendedor', 'supervisor', 'usuario'];
const dataBR = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const SEM_BLOQUEIO = `NOT EXISTS (SELECT 1 FROM blacklist b WHERE b.cliente_id = c.id AND b.ativo = 1 AND b.tipo = 'bloqueio') AND c.anonimizado_em IS NULL`;
const ESTAGIOS = { prospeccao: 'Prospecção', qualificacao: 'Qualificação', proposta: 'Proposta', negociacao: 'Negociação' };
const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
const modDias = (n) => `-${Math.max(0, Number(n) || 0)} days`;

/**
 * Cada gatilho devolve linhas { chave, cliente_id, vendedor_id, valor, ...vars } para a regra.
 * "dias" é o parâmetro principal; a janela evita que o histórico antigo gere tarefas em massa na primeira execução.
 */
const GATILHOS = {
  sem_compra: {
    nome: 'Cliente sem comprar', dias: 180, rotuloDias: 'Dias sem comprar',
    ajuda: 'Clientes que já compraram e estão há pelo menos N dias sem pedido. Gera de novo só depois de uma nova compra.',
    titulo: 'Reativar {cliente}: {dias_reais} dias sem comprar', prazo: 3,
    variaveis: ['cliente', 'vendedor', 'dias_reais', 'data', 'valor'],
    buscar: (r) => db.all(
      `SELECT c.id AS cliente_id, c.nome AS cliente, c.vendedor_id, MAX(p.created_at) AS data, ROUND(SUM(p.valor_total), 2) AS valor,
          CAST(julianday('now','localtime') - julianday(MAX(p.created_at)) AS INTEGER) AS dias_reais
        FROM clientes c JOIN pedidos p ON p.cliente_id = c.id AND p.etapa <> 'cancelado'
       WHERE ${SEM_BLOQUEIO}
       GROUP BY c.id HAVING MAX(p.created_at) <= datetime('now','localtime', ?)`, modDias(r.dias),
    ).then((l) => l.map((x) => ({ ...x, chave: `cli:${x.cliente_id}:${String(x.data).slice(0, 10)}` }))),
  },
  pos_venda: {
    nome: 'Pós-venda após a entrega', dias: 7, rotuloDias: 'Dias após a entrega',
    ajuda: 'Pedidos entregues há N dias: ligar para saber se chegou tudo certo e como está a aplicação.',
    titulo: 'Pós-venda do pedido {pedido} ({cliente})', prazo: 2,
    variaveis: ['cliente', 'vendedor', 'pedido', 'valor', 'data'],
    buscar: (r) => db.all(
      `SELECT p.id AS pedido_id, p.numero AS pedido, p.cliente_id, c.nome AS cliente, p.vendedor_id, p.valor_total AS valor, p.data_entrega AS data
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
        WHERE p.data_entrega IS NOT NULL AND p.etapa <> 'cancelado' AND ${SEM_BLOQUEIO}
          AND substr(p.data_entrega, 1, 10) <= date('now','localtime', ?) AND substr(p.data_entrega, 1, 10) > date('now','localtime', ?)`,
      modDias(r.dias), modDias(Number(r.dias) + 30),
    ).then((l) => l.map((x) => ({ ...x, chave: `ped:${x.pedido_id}` }))),
  },
  cliente_novo: {
    nome: 'Primeira compra (boas-vindas)', dias: 30, rotuloDias: 'Dias após a primeira compra',
    ajuda: 'Clientes novos: acompanhamento N dias depois do primeiro pedido para fidelizar.',
    titulo: 'Acompanhar cliente novo {cliente} (1º pedido em {data})', prazo: 3,
    variaveis: ['cliente', 'vendedor', 'pedido', 'valor', 'data'],
    buscar: (r) => db.all(
      `SELECT c.id AS cliente_id, c.nome AS cliente, c.vendedor_id, MIN(p.created_at) AS data, MIN(p.numero) AS pedido, ROUND(SUM(p.valor_total), 2) AS valor
         FROM clientes c JOIN pedidos p ON p.cliente_id = c.id AND p.etapa <> 'cancelado'
        WHERE ${SEM_BLOQUEIO}
        GROUP BY c.id HAVING MIN(p.created_at) <= datetime('now','localtime', ?) AND MIN(p.created_at) > datetime('now','localtime', ?)`,
      modDias(r.dias), modDias(Number(r.dias) + 30),
    ).then((l) => l.map((x) => ({ ...x, chave: `novo:${x.cliente_id}` }))),
  },
  recompra_safra: {
    nome: 'Recompra da safra', dias: 30, rotuloDias: 'Dias de antecedência',
    ajuda: 'Faz 1 ano da última compra do cliente: avisa N dias antes para oferecer o produto da próxima safra.',
    titulo: 'Recompra da safra: {cliente} comprou em {data} ({produto})', prazo: 5,
    variaveis: ['cliente', 'vendedor', 'data', 'valor', 'produto'],
    buscar: (r) => db.all(
      `SELECT c.id AS cliente_id, c.nome AS cliente, c.vendedor_id, MAX(p.created_at) AS data, ROUND(SUM(p.valor_total), 2) AS valor,
          (SELECT pr.nome FROM pedido_itens i JOIN pedidos p2 ON p2.id = i.pedido_id JOIN produtos pr ON pr.id = i.produto_id
            WHERE p2.cliente_id = c.id AND p2.etapa <> 'cancelado' GROUP BY pr.id, pr.nome ORDER BY SUM(i.valor_total) DESC LIMIT 1) AS produto
         FROM clientes c JOIN pedidos p ON p.cliente_id = c.id AND p.etapa <> 'cancelado'
        WHERE ${SEM_BLOQUEIO}
        GROUP BY c.id HAVING MAX(p.created_at) > datetime('now','localtime','-365 days') AND MAX(p.created_at) <= datetime('now','localtime', ?)`,
      modDias(365 - Math.min(Number(r.dias) || 0, 300)),
    ).then((l) => l.map((x) => ({ ...x, chave: `rec:${x.cliente_id}:${String(x.data).slice(0, 10)}` }))),
  },
  oportunidade_parada: {
    nome: 'Oportunidade parada', dias: 15, rotuloDias: 'Dias sem movimentação',
    ajuda: 'Oportunidades abertas sem mudança de estágio há N dias. A tarefa vai para o responsável da oportunidade.',
    titulo: 'Retomar a oportunidade "{oportunidade}" ({cliente})', prazo: 1,
    variaveis: ['cliente', 'vendedor', 'oportunidade', 'valor', 'estagio', 'dias_reais'],
    buscar: (r) => db.all(
      `SELECT o.id AS oportunidade_id, o.titulo AS oportunidade, o.estagio, o.cliente_id, c.nome AS cliente, COALESCE(o.responsavel_id, c.vendedor_id) AS vendedor_id,
          o.valor_estimado AS valor, COALESCE(o.updated_at, o.created_at) AS data,
          CAST(julianday('now','localtime') - julianday(COALESCE(o.updated_at, o.created_at)) AS INTEGER) AS dias_reais
         FROM crm_oportunidades o JOIN clientes c ON c.id = o.cliente_id
        WHERE o.estagio NOT IN ('ganha','perdida') AND COALESCE(o.updated_at, o.created_at) <= datetime('now','localtime', ?)`, modDias(r.dias),
    ).then((l) => l.map((x) => ({ ...x, chave: `op:${x.oportunidade_id}:${String(x.data).slice(0, 10)}` }))),
  },
  fechamento_previsto: {
    nome: 'Fechamento previsto chegando', dias: 3, rotuloDias: 'Dias antes da previsão',
    ajuda: 'Oportunidades abertas com previsão de fechamento nos próximos N dias (ou já passada há até 7 dias).',
    titulo: 'Fechar "{oportunidade}" ({cliente}) até {data}', prazo: 0,
    variaveis: ['cliente', 'vendedor', 'oportunidade', 'valor', 'data'],
    buscar: (r) => db.all(
      `SELECT o.id AS oportunidade_id, o.titulo AS oportunidade, o.cliente_id, c.nome AS cliente, COALESCE(o.responsavel_id, c.vendedor_id) AS vendedor_id,
          o.valor_estimado AS valor, o.previsao_fechamento AS data
         FROM crm_oportunidades o JOIN clientes c ON c.id = o.cliente_id
        WHERE o.estagio NOT IN ('ganha','perdida') AND o.previsao_fechamento IS NOT NULL
          AND o.previsao_fechamento <= date('now','localtime', ?) AND o.previsao_fechamento >= date('now','localtime','-7 days')`,
      `+${Math.max(0, Number(r.dias) || 0)} days`,
    ).then((l) => l.map((x) => ({ ...x, chave: `opf:${x.oportunidade_id}:${x.data}` }))),
  },
  proposta_sem_retorno: {
    nome: 'Proposta sem retorno', dias: 5, rotuloDias: 'Dias desde o envio',
    ajuda: 'Propostas enviadas há N dias, ainda válidas e sem resposta do cliente.',
    titulo: 'Cobrar retorno da proposta {proposta} ({cliente})', prazo: 1,
    variaveis: ['cliente', 'vendedor', 'proposta', 'valor', 'data'],
    buscar: (r) => db.all(
      `SELECT p.id AS proposta_id, p.numero AS proposta, p.cliente_id, c.nome AS cliente, p.vendedor_id, p.valor_total AS valor, p.enviada_em AS data
         FROM propostas p JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status = 'enviada' AND p.validade >= date('now','localtime') AND COALESCE(p.enviada_em, p.updated_at) <= datetime('now','localtime', ?)`,
      modDias(r.dias),
    ).then((l) => l.map((x) => ({ ...x, chave: `prop:${x.proposta_id}` }))),
  },
  parcela_vencida: {
    nome: 'Cliente com parcela vencida', dias: 5, rotuloDias: 'Dias de atraso',
    ajuda: 'Avisa o vendedor quando o cliente da carteira tem parcela vencida há N dias (até 60 dias), para ajudar a cobrança.',
    titulo: 'Cliente {cliente} com {valor} vencido desde {data}', prazo: 1,
    variaveis: ['cliente', 'vendedor', 'valor', 'data'],
    buscar: (r) => db.all(
      `SELECT c.id AS cliente_id, c.nome AS cliente, c.vendedor_id, MIN(p.vencimento) AS data, ROUND(SUM(${S.SALDO_PARCELA_SQL}), 2) AS valor
         FROM parcelas p JOIN clientes c ON c.id = p.cliente_id
        WHERE ${S.ABERTA_SQL} AND p.vencimento <= date('now','localtime', ?) AND p.vencimento > date('now','localtime', ?)
        GROUP BY c.id`, modDias(r.dias), modDias(Number(r.dias) + 60),
    ).then((l) => l.map((x) => ({ ...x, chave: `parc:${x.cliente_id}:${x.data}` }))),
  },
  calendario_safra: {
    nome: 'Calendário da safra', dias: 0, rotuloDias: 'Dias de antecedência (0 = os do calendário)',
    ajuda: 'Clientes com área da cultura cadastrada: avisa antes da janela de plantio/adubação do calendário da safra, se ainda não compraram para ela.',
    titulo: 'Oferecer adubação para {cultura} de {cliente} ({area}): {atividade} a partir de {data}', prazo: 3,
    variaveis: ['cliente', 'vendedor', 'cultura', 'atividade', 'area', 'data'],
    buscar: async (r) => {
      const hoje = S.hoje();
      const lista = await require('./safra').janelas({ horizonte: Math.max(Number(r.dias) || 0, 200), hoje });
      return lista.filter((j) => !j.comprou_na_janela && hoje <= j.fim && hoje >= (Number(r.dias) > 0 ? S.addDias(j.inicio, -Number(r.dias)) : j.aviso_em))
        .map((j) => ({
          ...j, data: j.inicio, area: j.area ? `${Number(j.area).toLocaleString('pt-BR')} ${j.medida || 'ha'}` : 'área não informada', valor: j.area || 0,
          chave: `saf:${j.cliente_id}:${norm(j.cultura)}:${norm(j.atividade)}:${j.inicio.slice(0, 7)}`,
        }));
    },
  },
  aniversario: {
    nome: 'Aniversário do cliente', dias: 0, rotuloDias: 'Dias de antecedência',
    ajuda: 'Clientes pessoa física com data de nascimento: lembra N dias antes (0 = no dia).',
    titulo: 'Aniversário de {cliente} em {data}', prazo: 0,
    variaveis: ['cliente', 'vendedor', 'data'],
    buscar: async (r) => {
      const ant = Math.max(0, Number(r.dias) || 0);
      const hoje = new Date(`${S.hoje()}T12:00:00Z`);
      const l = await db.all(`SELECT c.id AS cliente_id, c.nome AS cliente, c.vendedor_id, c.data_nascimento FROM clientes c
        WHERE c.data_nascimento IS NOT NULL AND length(c.data_nascimento) >= 10 AND ${SEM_BLOQUEIO}`);
      const out = [];
      for (const x of l) {
        const [, m, d] = x.data_nascimento.slice(0, 10).split('-').map(Number);
        for (const ano of [hoje.getUTCFullYear(), hoje.getUTCFullYear() + 1]) {
          const alvo = new Date(Date.UTC(ano, m - 1, d, 12));
          const falta = Math.round((alvo - hoje) / 864e5);
          if (falta >= 0 && falta <= ant) out.push({ ...x, data: alvo.toISOString().slice(0, 10), chave: `niver:${x.cliente_id}:${ano}` });
        }
      }
      return out;
    },
  },
};

// Regras criadas na primeira vez que o CRM é aberto. Parcela vencida e aniversário começam desligadas.
const PADROES = [
  ['sem_compra', 1, 30], ['pos_venda', 1, 50], ['cliente_novo', 1, 50], ['recompra_safra', 1, 50],
  ['oportunidade_parada', 1, 50], ['fechamento_previsto', 1, 50], ['proposta_sem_retorno', 1, 50],
  ['parcela_vencida', 0, 50], ['aniversario', 0, 50], ['calendario_safra', 1, 50],
];
// Regras incluídas em versões posteriores: criadas uma vez nas instalações que já tinham as padrão.
const NOVAS = ['calendario_safra'];

let semeado = false;
async function garantirPadroes() {
  if (semeado) return;
  const marca = await db.get(`SELECT valor FROM configuracoes WHERE chave = 'crm.automacoes_semeadas'`);
  if (!marca) {
    await db.tx(async () => {
      for (const [g, ativa, limite] of PADROES) {
        const d = GATILHOS[g];
        await db.insert('crm_automacoes', { nome: d.nome, gatilho: g, ativa, dias: d.dias, titulo: d.titulo, prazo_dias: d.prazo, limite, prioridade: g === 'fechamento_previsto' ? 'alta' : 'normal' }, null, { auditoria: false });
      }
      await db.run(`INSERT INTO configuracoes (chave, valor) VALUES ('crm.automacoes_semeadas', '1') ON CONFLICT (chave) DO NOTHING`);
      for (const g of NOVAS) await db.run(`INSERT INTO configuracoes (chave, valor) VALUES (?, '1') ON CONFLICT (chave) DO NOTHING`, `crm.automacao_semeada.${g}`);
    });
  } else {
    for (const g of NOVAS) {
      if (await db.get('SELECT 1 AS x FROM configuracoes WHERE chave = ?', `crm.automacao_semeada.${g}`)) continue;
      const [, ativa, limite] = PADROES.find((x) => x[0] === g);
      const d = GATILHOS[g];
      await db.insert('crm_automacoes', { nome: d.nome, gatilho: g, ativa, dias: d.dias, titulo: d.titulo, prazo_dias: d.prazo, limite, prioridade: 'normal' }, null, { auditoria: false });
      await db.run(`INSERT INTO configuracoes (chave, valor) VALUES (?, '1') ON CONFLICT (chave) DO NOTHING`, `crm.automacao_semeada.${g}`);
    }
  }
  semeado = true;
}

function validar(b, atual = {}) {
  const r = { ...atual, ...b };
  if (!GATILHOS[r.gatilho]) throw new ErroNegocio('Escolha o gatilho da automação.');
  if (!String(r.nome || '').trim()) throw new ErroNegocio('Informe o nome da automação.');
  if (!String(r.titulo || '').trim()) throw new ErroNegocio('Informe o título da tarefa.');
  const dias = Number(r.dias);
  if (!(Number.isInteger(dias) && dias >= 0 && dias <= 730)) throw new ErroNegocio('Dias deve ser um número inteiro entre 0 e 730.');
  const prazo = Number(r.prazo_dias ?? 0);
  if (!(Number.isInteger(prazo) && prazo >= 0 && prazo <= 90)) throw new ErroNegocio('Prazo da tarefa deve ser de 0 a 90 dias.');
  const limite = Number(r.limite ?? 50);
  if (!(Number.isInteger(limite) && limite >= 1 && limite <= 500)) throw new ErroNegocio('Limite por execução deve ser de 1 a 500.');
  if (!PRIORIDADES.includes(r.prioridade || 'normal')) throw new ErroNegocio('Prioridade inválida.');
  if (!RESPONSAVEIS.includes(r.responsavel || 'vendedor')) throw new ErroNegocio('Responsável inválido.');
  if (r.responsavel === 'usuario' && !r.responsavel_id) throw new ErroNegocio('Escolha o usuário que recebe as tarefas.');
  const vm = r.valor_minimo === '' || r.valor_minimo == null ? null : Number(r.valor_minimo);
  if (vm !== null && !(vm >= 0)) throw new ErroNegocio('Valor mínimo inválido.');
  return {
    nome: String(r.nome).trim(), gatilho: r.gatilho, ativa: r.ativa === undefined ? 1 : r.ativa ? 1 : 0, dias, valor_minimo: vm,
    equipe_id: Number(r.equipe_id) || null, titulo: String(r.titulo).trim().slice(0, 200), descricao: r.descricao ? String(r.descricao).slice(0, 2000) : null,
    prazo_dias: prazo, prioridade: r.prioridade || 'normal', responsavel: r.responsavel || 'vendedor', responsavel_id: Number(r.responsavel_id) || null, limite,
  };
}

const preencher = (modelo, vars) => String(modelo || '').replace(/\{(\w+)\}/g, (m, k) => {
  const v = vars[k];
  if (v === undefined || v === null || v === '') return k in vars ? '' : m;
  if (k === 'valor') return moeda(v);
  if (k === 'data') return dataBR(v);
  if (k === 'estagio') return ESTAGIOS[v] || v;
  return String(v);
});

/** Linhas do gatilho já com filtros da regra, responsável escolhido e sem as que já viraram tarefa. */
async function candidatos(regra) {
  const linhas = await GATILHOS[regra.gatilho].buscar(regra);
  const usuarios = new Map((await db.all(
    `SELECT u.id, u.nome, u.ativo, u.equipe_id, eq.supervisor_id FROM usuarios u LEFT JOIN equipes eq ON eq.id = u.equipe_id`,
  )).map((u) => [u.id, u]));
  const ja = new Set((await db.all('SELECT chave FROM crm_tarefas WHERE automacao_id = ?', regra.id)).map((x) => x.chave));
  const ativo = (id) => (id && usuarios.get(id)?.ativo ? id : null);
  const out = [];
  for (const l of linhas) {
    if (ja.has(l.chave)) continue;
    if (regra.valor_minimo != null && !(Number(l.valor || 0) >= regra.valor_minimo)) continue;
    const vend = usuarios.get(l.vendedor_id);
    if (regra.equipe_id && vend?.equipe_id !== regra.equipe_id) continue;
    const resp = regra.responsavel === 'usuario' ? ativo(regra.responsavel_id)
      : regra.responsavel === 'supervisor' ? ativo(vend?.supervisor_id) || ativo(l.vendedor_id) || ativo(regra.responsavel_id)
        : ativo(l.vendedor_id) || ativo(regra.responsavel_id);
    const vars = { ...l, dias: regra.dias, vendedor: vend?.nome || '' };
    out.push({ ...l, responsavel_id: resp || ativo(regra.created_by), titulo: preencher(regra.titulo, vars), descricao: regra.descricao ? preencher(regra.descricao, vars) : null });
  }
  // Os de maior valor primeiro: com limite por execução, os clientes mais importantes são atendidos antes.
  return out.sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0));
}

/**
 * Executa as regras ativas (ou só a regra informada). Com simular=true só conta e mostra exemplos.
 * Devolve um resumo por regra.
 */
async function executar({ regraId, simular = false } = {}) {
  await garantirPadroes();
  const regras = regraId
    ? await db.all('SELECT * FROM crm_automacoes WHERE id = ?', regraId)
    : await db.all('SELECT * FROM crm_automacoes WHERE ativa = 1 ORDER BY id');
  if (regraId && !regras.length) throw new ErroNegocio('Automação não encontrada.', 404);
  const resumo = [];
  const avisar = new Map();
  for (const regra of regras) {
    const lista = await candidatos(regra);
    const lote = lista.slice(0, regra.limite || 50);
    let geradas = 0;
    if (!simular) {
      const venc = S.addDias(S.hoje(), regra.prazo_dias || 0);
      for (const t of lote) {
        if (!t.responsavel_id) continue;
        const r = await db.get(
          `INSERT INTO crm_tarefas (cliente_id, titulo, descricao, vencimento, responsavel_id, prioridade, automacao_id, chave, pedido_id, oportunidade_id, proposta_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (automacao_id, chave) DO NOTHING RETURNING id`,
          t.cliente_id || null, t.titulo, t.descricao, venc, t.responsavel_id, regra.prioridade, regra.id, t.chave,
          t.pedido_id || null, t.oportunidade_id || null, t.proposta_id || null,
        );
        if (r) { geradas++; avisar.set(t.responsavel_id, (avisar.get(t.responsavel_id) || 0) + 1); }
      }
      await db.run(`UPDATE crm_automacoes SET ultima_execucao = datetime('now','localtime') WHERE id = ?`, regra.id);
    }
    resumo.push({
      id: regra.id, nome: regra.nome, gatilho: regra.gatilho, encontrados: lista.length, geradas, pendentes: Math.max(0, lista.length - lote.length),
      exemplos: lote.slice(0, 8).map((t) => ({ titulo: t.titulo, cliente_id: t.cliente_id, responsavel_id: t.responsavel_id })),
    });
  }
  for (const [uid, n] of avisar) sse.enviar('crm_tarefas', { n }, { usuarios: [uid] });
  if (!simular && resumo.some((r) => r.geradas)) {
    await require('./auditoria').registrar('automacao_crm', 'crm_automacoes', regraId || null, null, { geradas: resumo.reduce((a, r) => a + r.geradas, 0), regras: resumo.map((r) => [r.id, r.geradas]) });
  }
  return resumo;
}

// Execução automática: pelo agendador diário e, como reserva, na primeira consulta de tarefas do dia.
let rodando;
async function executarSeNecessario() {
  await garantirPadroes();
  const r = await db.get(`SELECT MIN(COALESCE(ultima_execucao, '')) AS u FROM crm_automacoes WHERE ativa = 1`);
  if (r?.u == null || String(r.u).slice(0, 10) >= S.hoje()) return null;
  rodando ||= db.comUsuario({ usuarioNome: 'Automação CRM', rota: 'crm-automacoes' }, () => executar()).finally(() => { rodando = null; });
  return rodando;
}

const catalogo = () => Object.entries(GATILHOS).map(([id, g]) => ({
  id, nome: g.nome, ajuda: g.ajuda, dias: g.dias, rotuloDias: g.rotuloDias, titulo: g.titulo, prazo: g.prazo, variaveis: g.variaveis,
}));

module.exports = { GATILHOS, PRIORIDADES, RESPONSAVEIS, catalogo, validar, executar, executarSeNecessario, garantirPadroes, preencher };
