// Regras de RH e DP: períodos de férias (CLT), banco de horas, alertas e eventos variáveis da folha.
const db = require('./db');
const S = require('./services');

const { ErroNegocio, r2 } = S;

const TIPOS_CONTRATO = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', temporario: 'Temporário', aprendiz: 'Jovem aprendiz', autonomo: 'Autônomo' };
const TIPOS_OCORRENCIA = {
  falta: 'Falta injustificada', falta_justificada: 'Falta justificada', atestado: 'Atestado médico', atraso: 'Atraso/saída antecipada',
  hora_extra_50: 'Hora extra 50%', hora_extra_100: 'Hora extra 100%', banco_credito: 'Banco de horas: crédito', banco_debito: 'Banco de horas: débito',
  advertencia: 'Advertência', suspensao: 'Suspensão', elogio: 'Elogio/reconhecimento', outro: 'Outro',
};
const TIPOS_HISTORICO = { admissao: 'Admissão', reajuste: 'Reajuste salarial', promocao: 'Promoção', mudanca_cargo: 'Mudança de cargo', transferencia: 'Transferência', desligamento: 'Desligamento', outro: 'Outro' };
const TIPOS_BENEFICIO = { vale_transporte: 'Vale-transporte', vale_refeicao: 'Vale-refeição', vale_alimentacao: 'Vale-alimentação', plano_saude: 'Plano de saúde', plano_odonto: 'Plano odontológico', seguro_vida: 'Seguro de vida', outro: 'Outro' };
const TIPOS_EXAME = { admissional: 'Admissional', periodico: 'Periódico', retorno: 'Retorno ao trabalho', mudanca_funcao: 'Mudança de função', demissional: 'Demissional' };
const TIPOS_SOLICITACAO = { ferias: 'Férias', atestado: 'Envio de atestado', documento: 'Declaração/documento', alteracao_dados: 'Alteração de dados cadastrais', adiantamento: 'Adiantamento salarial', outro: 'Outro assunto' };
const TIPOS_DESLIGAMENTO = { sem_justa_causa: 'Dispensa sem justa causa', justa_causa: 'Dispensa por justa causa', pedido: 'Pedido de demissão', acordo: 'Acordo (art. 484-A)', fim_contrato: 'Término de contrato/experiência', outro: 'Outro' };

/** Soma meses a uma data ISO (o dia fica no último dia do mês quando não existe, ex.: 31/02). */
function addMeses(iso, n) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Dias de férias pela quantidade de faltas injustificadas no período aquisitivo (CLT, art. 130). */
function diasDeDireito(faltas) {
  if (faltas <= 5) return 30;
  if (faltas <= 14) return 24;
  if (faltas <= 23) return 18;
  if (faltas <= 32) return 12;
  return 0;
}

/**
 * Períodos aquisitivos do colaborador com direito, dias já usados, saldo e prazo para conceder.
 * Situação: em_aquisicao | a_gozar | vence_logo (menos de 60 dias para o fim do concessivo) | vencida | gozadas.
 */
async function periodosFerias(colab, hoje = S.hoje()) {
  if (!colab?.data_admissao || colab.tipo_contrato === 'pj' || colab.tipo_contrato === 'autonomo') return [];
  const limiteFinal = colab.data_desligamento && colab.data_desligamento < hoje ? colab.data_desligamento : hoje;
  const ferias = await db.all(`SELECT * FROM rh_ferias WHERE colaborador_id = ? AND status IN ('solicitada','aprovada')`, colab.id);
  const faltas = await db.all(`SELECT data, COALESCE(dias, 1) AS dias FROM rh_ocorrencias WHERE colaborador_id = ? AND tipo = 'falta'`, colab.id);
  const out = [];
  for (let k = 0; k < 60; k++) {
    const inicio = addMeses(colab.data_admissao, 12 * k);
    if (inicio > limiteFinal) break;
    const fim = S.addDias(addMeses(colab.data_admissao, 12 * (k + 1)), -1);
    const completo = fim < limiteFinal;
    const nFaltas = faltas.filter((f) => f.data >= inicio && f.data <= fim).reduce((a, f) => a + Number(f.dias), 0);
    let direito = diasDeDireito(nFaltas);
    if (!completo) {
      // Proporcional: 2,5 dias por mês trabalhado (fração de 15 dias ou mais conta como mês).
      const meses = Math.floor(S.diasEntre(inicio, limiteFinal) / 30.42 + 0.5);
      direito = Math.min(direito, Math.floor((direito / 12) * meses));
    }
    const doPeriodo = ferias.filter((f) => f.aquisitivo_inicio === inicio);
    const aprovados = doPeriodo.filter((f) => f.status === 'aprovada').reduce((a, f) => a + f.dias + (f.abono_dias || 0), 0);
    const pendentes = doPeriodo.filter((f) => f.status === 'solicitada').reduce((a, f) => a + f.dias + (f.abono_dias || 0), 0);
    const limite = S.addDias(addMeses(fim, 12), 0);
    const saldo = direito - aprovados;
    let situacao = 'a_gozar';
    if (!completo) situacao = 'em_aquisicao';
    else if (saldo <= 0) situacao = 'gozadas';
    else if (hoje > limite) situacao = 'vencida';
    else if (S.diasEntre(hoje, limite) <= 60) situacao = 'vence_logo';
    out.push({ inicio, fim, completo, faltas: nFaltas, direito, usados: aprovados, pendentes, saldo, limite_concessivo: limite, situacao, programacoes: doPeriodo.length });
  }
  return out.reverse();
}

/**
 * Valida uma programação de férias pelas regras da CLT (art. 134 e 143):
 * até 3 períodos, um deles com pelo menos 14 dias e nenhum com menos de 5; abono de até 1/3 do direito.
 */
async function validarFerias(colab, { aquisitivo_inicio, inicio, dias, abono_dias = 0 }, ignorarId = null) {
  dias = Number(dias);
  abono_dias = Number(abono_dias) || 0;
  if (!inicio || !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new ErroNegocio('Informe a data de início das férias.');
  if (!(dias >= 5)) throw new ErroNegocio('Cada período de férias deve ter pelo menos 5 dias.');
  const periodos = await periodosFerias(colab);
  const p = aquisitivo_inicio ? periodos.find((x) => x.inicio === aquisitivo_inicio) : periodos.filter((x) => x.completo && x.saldo > 0).at(-1);
  if (!p) throw new ErroNegocio('Não há período aquisitivo com saldo de férias.');
  if (!p.completo) throw new ErroNegocio(`O período aquisitivo ${p.inicio.split('-').reverse().join('/')} ainda não terminou (termina em ${p.fim.split('-').reverse().join('/')}).`);
  const outras = (await db.all(`SELECT * FROM rh_ferias WHERE colaborador_id = ? AND aquisitivo_inicio = ? AND status IN ('solicitada','aprovada') AND id <> ?`,
    colab.id, p.inicio, ignorarId || 0));
  if (outras.length >= 3) throw new ErroNegocio('As férias de um período podem ser divididas em no máximo 3 partes.');
  const usado = outras.reduce((a, f) => a + f.dias + (f.abono_dias || 0), 0);
  if (usado + dias + abono_dias > p.direito) throw new ErroNegocio(`Saldo insuficiente: restam ${p.direito - usado} dias neste período.`);
  if (abono_dias > Math.floor(p.direito / 3)) throw new ErroNegocio(`O abono pecuniário é de no máximo ${Math.floor(p.direito / 3)} dias.`);
  const restante = p.direito - usado - dias - abono_dias;
  const partes = [...outras.map((f) => f.dias), dias];
  if (restante > 0 && restante < 5) throw new ErroNegocio(`Sobrariam ${restante} dias, e cada período precisa de pelo menos 5. Ajuste a quantidade de dias.`);
  // Se nenhuma parte tiver 14 dias, o que sobra precisa permitir uma parte de 14.
  if (!partes.some((d) => d >= 14) && restante < 14) throw new ErroNegocio('Um dos períodos de férias precisa ter pelo menos 14 dias.');
  if (partes.length === 3 && restante > 0) throw new ErroNegocio('Este seria o 3º período: ele precisa usar todo o saldo restante.');
  const fim = S.addDias(inicio, dias - 1);
  const conflito = await db.get(`SELECT id FROM rh_ferias WHERE colaborador_id = ? AND status IN ('solicitada','aprovada') AND id <> ? AND inicio <= ? AND fim >= ?`,
    colab.id, ignorarId || 0, fim, inicio);
  if (conflito) throw new ErroNegocio('Já existem férias programadas nesse intervalo.');
  return { aquisitivo_inicio: p.inicio, inicio, fim, dias, abono_dias };
}

async function saldoBancoHoras(colaboradorId) {
  return r2((await db.get(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'banco_credito' THEN horas WHEN tipo = 'banco_debito' THEN -horas ELSE 0 END), 0) AS s FROM rh_ocorrencias WHERE colaborador_id = ?`,
    colaboradorId,
  )).s);
}

const fimDoMes = (comp) => S.addDias(addMeses(`${comp}-01`, 1), -1);
const competenciaFechada = async (empresaId, comp) => !!(await db.get('SELECT 1 AS x FROM rh_fechamentos WHERE empresa_id = ? AND competencia = ?', empresaId, comp));

/**
 * Gera os eventos automáticos da competência: horas extras, faltas, atrasos e suspensões (pelas ocorrências),
 * comissões e lançamentos dos vendedores, e descontos de benefícios. Os manuais são mantidos.
 * Valores de hora usam o divisor 220 (jornada de 44 h semanais) e são estimativas para a contabilidade conferir.
 */
async function gerarEventos(empresaId, comp, usuarioId) {
  if (!/^\d{4}-\d{2}$/.test(comp)) throw new ErroNegocio('Competência inválida (AAAA-MM).');
  if (await competenciaFechada(empresaId, comp)) throw new ErroNegocio('Competência fechada. Reabra para gerar os eventos de novo.');
  const ini = `${comp}-01`;
  const fim = fimDoMes(comp);
  const colabs = await db.all(
    `SELECT c.*, u.id AS usuario_id FROM colaboradores c LEFT JOIN usuarios u ON u.colaborador_id = c.id
      WHERE COALESCE(c.empresa_id, ?) = ? AND (c.data_admissao IS NULL OR c.data_admissao <= ?) AND (c.data_desligamento IS NULL OR c.data_desligamento >= ?)`,
    empresaId, empresaId, fim, ini,
  );
  let n = 0;
  await db.tx(async () => {
    await db.run(`DELETE FROM rh_eventos WHERE empresa_id = ? AND competencia = ? AND origem <> 'manual'`, empresaId, comp);
    const add = async (c, tipo, evento, referencia, valor, origem, origemId, obs) => {
      if (!valor && valor !== 0) return;
      await db.insert('rh_eventos', { empresa_id: empresaId, colaborador_id: c.id, competencia: comp, tipo, evento, referencia, valor: r2(valor), origem, origem_id: origemId, observacao: obs, usuario_id: usuarioId }, null, { auditoria: false });
      n++;
    };
    for (const c of colabs) {
      const hora = c.salario ? c.salario / 220 : 0;
      const dia = c.salario ? c.salario / 30 : 0;
      const oc = await db.all(`SELECT tipo, COALESCE(SUM(horas),0) AS horas, COALESCE(SUM(COALESCE(dias,1)),0) AS dias, COUNT(*) AS n FROM rh_ocorrencias
        WHERE colaborador_id = ? AND data BETWEEN ? AND ? GROUP BY tipo`, c.id, ini, fim);
      const t = Object.fromEntries(oc.map((x) => [x.tipo, x]));
      const est = c.salario ? 'Estimativa pelo salário cadastrado (divisor 220)' : 'Sem salário cadastrado: informe o valor';
      if (t.hora_extra_50?.horas) await add(c, 'provento', 'Horas extras 50%', `${t.hora_extra_50.horas} h`, hora * 1.5 * t.hora_extra_50.horas, 'ocorrencia', null, est);
      if (t.hora_extra_100?.horas) await add(c, 'provento', 'Horas extras 100%', `${t.hora_extra_100.horas} h`, hora * 2 * t.hora_extra_100.horas, 'ocorrencia', null, est);
      if (t.falta?.dias) await add(c, 'desconto', 'Faltas injustificadas', `${t.falta.dias} dia(s)`, dia * t.falta.dias, 'ocorrencia', null, 'A contabilidade calcula o DSR perdido');
      if (t.suspensao?.dias) await add(c, 'desconto', 'Suspensão', `${t.suspensao.dias} dia(s)`, dia * t.suspensao.dias, 'ocorrencia', null, null);
      if (t.atraso?.horas) await add(c, 'desconto', 'Atrasos', `${t.atraso.horas} h`, hora * t.atraso.horas, 'ocorrencia', null, est);
      if (t.atestado?.dias) await add(c, 'provento', 'Dias de atestado (informativo)', `${t.atestado.dias} dia(s)`, 0, 'ocorrencia', null, 'Afastamento abonado; acima de 15 dias segue para o INSS');
      if (c.usuario_id) {
        const com = (await db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM comissoes WHERE usuario_id = ? AND periodo = ?`, c.usuario_id, comp)).v;
        if (com) await add(c, 'provento', 'Comissões sobre vendas', comp, com, 'comissao', null, 'Somadas das comissões do mês no sistema');
        for (const l of await db.all(`SELECT * FROM lancamentos_vendedor WHERE vendedor_id = ? AND periodo = ?`, c.usuario_id, comp)) {
          await add(c, l.tipo_ocorrencia === 'credito' ? 'provento' : 'desconto', l.tipo_ocorrencia === 'credito' ? 'Crédito ao vendedor' : 'Desconto ao vendedor', l.descricao, l.valor, 'comissao', l.id, null);
        }
      }
      for (const b of await db.all(`SELECT * FROM rh_beneficios WHERE colaborador_id = ? AND ativo = 1 AND COALESCE(valor_desconto,0) > 0
        AND (inicio IS NULL OR inicio <= ?) AND (fim IS NULL OR fim >= ?)`, c.id, fim, ini)) {
        await add(c, 'desconto', `Desconto ${TIPOS_BENEFICIO[b.tipo] || b.tipo}`, b.descricao, b.valor_desconto, 'beneficio', b.id, null);
      }
    }
  });
  return { eventos: n, colaboradores: colabs.length };
}

module.exports = {
  TIPOS_CONTRATO, TIPOS_OCORRENCIA, TIPOS_HISTORICO, TIPOS_BENEFICIO, TIPOS_EXAME, TIPOS_SOLICITACAO, TIPOS_DESLIGAMENTO,
  addMeses, diasDeDireito, periodosFerias, validarFerias, saldoBancoHoras, gerarEventos, competenciaFechada, fimDoMes,
};
