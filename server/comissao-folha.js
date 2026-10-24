// Comissão paga junto com a folha: as comissões revisadas pelo Financeiro (e os créditos/descontos do vendedor)
// ainda não pagas entram na folha do mês de quem é CLT; para PJ, autônomo ou quem não tem cadastro de colaborador,
// viram uma conta a pagar no fechamento. Fechar a folha marca tudo como pago; reabrir desfaz.
const db = require('./db');
const S = require('./services');
const { SEM_CLT } = require('./colaborador');

const { ErroNegocio, r2 } = S;
const CATEGORIA = 'Comissões';

/** Vendedores com comissão revisada ou lançamento ainda não pagos até a competência, com o destino do pagamento. */
async function apurar(empresaId, comp, { incluirPagasNa = null } = {}) {
  const pagas = incluirPagasNa ? 'OR folha_competencia = :pagas' : '';
  const com = await db.all(
    `SELECT usuario_id, COUNT(*) AS n, SUM(valor) AS valor, MIN(periodo) AS de, MAX(periodo) AS ate FROM comissoes
      WHERE COALESCE(empresa_id, :e) = :e AND periodo <= :comp AND ((status = 'revisada' AND folha_competencia IS NULL) ${pagas})
      GROUP BY usuario_id`, { e: empresaId, comp, pagas: incluirPagasNa },
  );
  const lanc = await db.all(
    `SELECT vendedor_id AS usuario_id, SUM(CASE WHEN tipo_ocorrencia = 'credito' THEN valor ELSE 0 END) AS creditos,
        SUM(CASE WHEN tipo_ocorrencia = 'credito' THEN 0 ELSE valor END) AS descontos FROM lancamentos_vendedor
      WHERE periodo <= :comp AND (folha_competencia IS NULL ${incluirPagasNa ? 'OR folha_competencia = :pagas' : ''}) GROUP BY vendedor_id`,
    { comp, pagas: incluirPagasNa },
  );
  const espera = await db.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS valor FROM comissoes WHERE COALESCE(empresa_id, ?) = ? AND periodo <= ? AND status = 'aberta'`, empresaId, empresaId, comp,
  );
  const ids = [...new Set([...com, ...lanc].map((x) => x.usuario_id))];
  const usuarios = ids.length ? await db.all(
    `SELECT u.id, u.nome, u.perfil, c.id AS colaborador_id, c.nome AS colaborador, c.tipo_contrato, c.data_desligamento
       FROM usuarios u LEFT JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id IN (${ids.map(Number).join(',')})`,
  ) : [];
  const linhas = usuarios.map((u) => {
    const c = com.find((x) => x.usuario_id === u.id) || {};
    const l = lanc.find((x) => x.usuario_id === u.id) || {};
    const destino = !u.colaborador_id ? 'contas_pagar' : SEM_CLT.includes(u.tipo_contrato) ? 'contas_pagar' : 'folha';
    return {
      usuario_id: u.id, nome: u.nome, colaborador_id: u.colaborador_id, vinculo: u.tipo_contrato || null, sem_cadastro: !u.colaborador_id, destino,
      comissoes: c.n || 0, periodos: c.de ? (c.de === c.ate ? c.de : `${c.de} a ${c.ate}`) : null,
      valor: r2(c.valor || 0), creditos: r2(l.creditos || 0), descontos: r2(l.descontos || 0), liquido: r2((c.valor || 0) + (l.creditos || 0) - (l.descontos || 0)),
    };
  }).filter((x) => x.valor || x.creditos || x.descontos).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { competencia: comp, linhas, aguardando_revisao: { n: espera.n, valor: r2(espera.valor) } };
}

/** Eventos da folha para um colaborador CLT (usado por gerarEventos do RH). */
async function eventosDoColaborador(empresaId, comp, usuarioId) {
  const ap = await apurar(empresaId, comp);
  const l = ap.linhas.find((x) => x.usuario_id === usuarioId && x.destino === 'folha');
  if (!l) return [];
  const out = [];
  if (l.valor) out.push({ tipo: 'provento', evento: 'Comissões sobre vendas', referencia: `${l.comissoes} comissão(ões) · ${l.periodos}`, valor: l.valor, obs: 'Comissões revisadas pelo Financeiro ainda não pagas' });
  if (l.creditos) out.push({ tipo: 'provento', evento: 'Crédito ao vendedor', referencia: comp, valor: l.creditos, obs: 'Lançamentos de crédito do vendedor' });
  if (l.descontos) out.push({ tipo: 'desconto', evento: 'Desconto ao vendedor', referencia: comp, valor: l.descontos, obs: 'Lançamentos de desconto do vendedor' });
  return out;
}

/** No fechamento: marca como pagas na folha (CLT) e lança contas a pagar (PJ / sem cadastro). */
async function aoFechar(empresaId, comp, usuarioId) {
  const ap = await apurar(empresaId, comp);
  const [a, m] = comp.split('-').map(Number);
  const venc = `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-${String(Math.min(28, Number(await require('./config').obter('comissao.dia_pagamento')) || 10)).padStart(2, '0')}`;
  const contas = [];
  for (const l of ap.linhas) {
    let contaId = null;
    if (l.destino === 'contas_pagar' && l.liquido > 0) {
      contaId = await db.insert('contas_pagar', {
        empresa_id: empresaId, descricao: `Comissões ${comp.split('-').reverse().join('/')} - ${l.nome}`, categoria: CATEGORIA, competencia: comp, vencimento: venc,
        valor: l.liquido, status: 'a_pagar', usuario_id: usuarioId, comissao_competencia: comp, comissao_usuario_id: l.usuario_id,
        observacao: `${l.comissoes} comissão(ões) de ${l.periodos || comp}${l.creditos ? ` + créditos ${l.creditos.toFixed(2)}` : ''}${l.descontos ? ` − descontos ${l.descontos.toFixed(2)}` : ''}${l.sem_cadastro ? ' · sem cadastro de colaborador' : ` · vínculo ${l.vinculo}`}`,
      });
      contas.push(contaId);
    }
    await db.run(
      `UPDATE comissoes SET status = 'paga', folha_competencia = ?, pago_em = ?, conta_pagar_id = ?
        WHERE usuario_id = ? AND COALESCE(empresa_id, ?) = ? AND periodo <= ? AND status = 'revisada' AND folha_competencia IS NULL`,
      comp, S.hoje(), contaId, l.usuario_id, empresaId, empresaId, comp,
    );
    await db.run('UPDATE lancamentos_vendedor SET folha_competencia = ? WHERE vendedor_id = ? AND periodo <= ? AND folha_competencia IS NULL', comp, l.usuario_id, comp);
  }
  return { vendedores: ap.linhas.length, contas_pagar: contas.length };
}

/** Na reabertura: devolve as comissões para "revisada" e cancela as contas a pagar ainda não pagas. */
async function aoReabrir(empresaId, comp) {
  const pagas = await db.get(
    `SELECT COUNT(*) AS n FROM contas_pagar WHERE empresa_id = ? AND comissao_competencia = ? AND (status = 'pago' OR COALESCE(valor_pago,0) > 0)`, empresaId, comp,
  );
  if (pagas.n) throw new ErroNegocio(`Há ${pagas.n} conta(s) de comissão desta competência já paga(s). Estorne o pagamento antes de reabrir.`);
  await db.run(`UPDATE contas_pagar SET status = 'cancelado', observacao = COALESCE(observacao,'') || ' | Cancelada: folha reaberta' WHERE empresa_id = ? AND comissao_competencia = ? AND status = 'a_pagar'`, empresaId, comp);
  await db.run(`UPDATE comissoes SET status = 'revisada', folha_competencia = NULL, pago_em = NULL, conta_pagar_id = NULL WHERE COALESCE(empresa_id, ?) = ? AND folha_competencia = ?`, empresaId, empresaId, comp);
  await db.run('UPDATE lancamentos_vendedor SET folha_competencia = NULL WHERE folha_competencia = ?', comp);
}

module.exports = { apurar, eventosDoColaborador, aoFechar, aoReabrir, CATEGORIA };
