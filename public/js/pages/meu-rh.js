// Meu RH: o colaborador consulta os próprios dados de trabalho e faz pedidos ao RH (férias, atestado, documentos...).
import { get, post, esc, fmt, titulo, abas, modal, campo, toast, tabelaSimples, kpi } from '../core.js';

const SIT = { em_aquisicao: ['Em aquisição', 'secondary'], a_gozar: ['A gozar', 'primary'], vence_logo: ['Vence em breve', 'warning'], vencida: ['Vencida', 'danger'], gozadas: ['Gozadas', 'success'] };
const ST = { aberta: ['Aguardando o RH', 'warning'], aprovada: ['Aprovada', 'success'], recusada: ['Recusada', 'danger'], concluida: ['Concluída', 'secondary'], solicitada: ['Aguardando o RH', 'warning'], cancelada: ['Cancelada', 'secondary'] };
const OC = { falta: 'Falta', falta_justificada: 'Falta justificada', atestado: 'Atestado', atraso: 'Atraso', hora_extra_50: 'Hora extra 50%', hora_extra_100: 'Hora extra 100%', banco_credito: 'Banco de horas (+)', banco_debito: 'Banco de horas (−)', elogio: 'Elogio', outro: 'Outro' };
const BEN = { vale_transporte: 'Vale-transporte', vale_refeicao: 'Vale-refeição', vale_alimentacao: 'Vale-alimentação', plano_saude: 'Plano de saúde', plano_odonto: 'Plano odontológico', seguro_vida: 'Seguro de vida', outro: 'Outro' };
const bdg = (m, v) => { const [l, c] = m[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; };

export default async function meuRh(conteudo) {
  const pagina = titulo(conteudo, 'Meu RH', 'bi-person-badge', '<button class="btn btn-sm btn-success d-none" id="btn-pedir"><i class="bi bi-send"></i> Fazer uma solicitação</button>');
  const d = await get('/api/rh/meu');
  if (!d.vinculado) {
    pagina.innerHTML = '<div class="vazio"><i class="bi bi-person-x"></i>Seu usuário ainda não está ligado a um colaborador. Peça ao RH para fazer o vínculo.</div>';
    return;
  }
  const c = d.colaborador;
  const saldo = d.periodos.filter((p) => p.completo).reduce((a, p) => a + Math.max(0, p.saldo), 0);
  const prox = d.ferias.filter((f) => f.status === 'aprovada' && f.fim >= new Date().toISOString().slice(0, 10)).at(-1);
  pagina.innerHTML = `<div class="kpis mb-3">
      ${kpi('Férias disponíveis', `${saldo} dias`, { icone: 'bi-sun', cor: saldo ? 'success' : 'secondary', sub: prox ? `Próximas: ${fmt.date(prox.inicio)} a ${fmt.date(prox.fim)}` : 'Nenhuma programada' })}
      ${kpi('Banco de horas', `${fmt.num(d.banco_horas)} h`, { icone: 'bi-clock', cor: d.banco_horas < 0 ? 'danger' : 'info', link: '#/ponto', sub: 'Ver meu ponto' })}
      ${kpi('Tempo de casa', c.data_admissao ? `${Math.floor((Date.now() - Date.parse(c.data_admissao)) / 31557600000)} anos` : '—', { icone: 'bi-award', sub: c.data_admissao ? `desde ${fmt.date(c.data_admissao)}` : '' })}
      ${kpi('Solicitações em aberto', d.solicitacoes.filter((s) => s.status === 'aberta').length, { icone: 'bi-inbox', cor: 'warning' })}
    </div>${abas([
      { id: 'dados', label: '<i class="bi bi-person"></i> Meus dados', html: `<div class="row g-3">
        ${[['Cargo', c.cargo], ['Departamento', c.departamento], ['Contrato', c.tipo_contrato], ['Jornada', c.jornada], ['Ponto', c.bate_ponto === 0 ? 'Não registra' : 'Registra'], ['Gestor', c.gestor], ['Admissão', fmt.date(c.data_admissao)],
          ['Salário base', c.salario != null ? fmt.money(c.salario) : null], ['E-mail', c.email], ['Telefone', c.telefone], ['Cidade', [c.cidade, c.uf].filter(Boolean).join('/')]]
          .map(([l, v]) => `<div class="col-md-3 col-6"><div class="small text-body-secondary">${l}</div><div>${esc(v || '—')}</div></div>`).join('')}</div>
        <div class="form-text mt-3">Algum dado errado? Use <b>Fazer uma solicitação → Alteração de dados cadastrais</b>.</div>` },
      { id: 'ferias', label: '<i class="bi bi-sun"></i> Minhas férias', html: `${tabelaSimples([{ k: 'inicio', l: 'Período aquisitivo', render: (v, r) => `${fmt.date(v)} a ${fmt.date(r.fim)}` },
          { k: 'direito', l: 'Direito', t: 'num' }, { k: 'usados', l: 'Usados', t: 'num' }, { k: 'saldo', l: 'Saldo', t: 'num' }, { k: 'limite_concessivo', l: 'Gozar até', t: 'date' }, { k: 'situacao', l: 'Situação', render: (v) => bdg(SIT, v) }], d.periodos)}
        <h6 class="mt-3">Programadas e pedidas</h6>${tabelaSimples([{ k: 'inicio', l: 'Início', t: 'date' }, { k: 'fim', l: 'Fim', t: 'date' }, { k: 'dias', l: 'Dias', t: 'num' }, { k: 'abono_dias', l: 'Vendidos', t: 'num' },
          { k: 'status', l: 'Situação', render: (v) => bdg(ST, v) }, { k: 'resposta', l: 'Resposta do RH' }], d.ferias, { vazio: 'Nenhuma.' })}` },
      { id: 'pedidos', label: '<i class="bi bi-inbox"></i> Minhas solicitações', html: tabelaSimples([{ k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'tipo', l: 'Tipo', render: (v) => esc(d.tipos[v] || v) },
        { k: 'descricao', l: 'Descrição', cls: 'quebra' }, { k: 'status', l: 'Situação', render: (v) => bdg(ST, v) }, { k: 'resposta', l: 'Resposta do RH', cls: 'quebra' }, { k: 'respondido_em', l: 'Respondida em', t: 'date' }], d.solicitacoes, { vazio: 'Nenhuma solicitação.' }) },
      { id: 'ponto', label: '<i class="bi bi-clock"></i> Ponto', html: tabelaSimples([{ k: 'data', l: 'Data', t: 'date' }, { k: 'tipo', l: 'Ocorrência', render: (v) => esc(OC[v] || v) }, { k: 'horas', l: 'Horas', t: 'num' }, { k: 'dias', l: 'Dias', t: 'num' }, { k: 'descricao', l: 'Descrição' }], d.ocorrencias, { vazio: 'Nada registrado.' }) },
      { id: 'beneficios', label: '<i class="bi bi-gift"></i> Benefícios', html: tabelaSimples([{ k: 'tipo', l: 'Benefício', render: (v) => esc(BEN[v] || v) }, { k: 'descricao', l: 'Descrição' }, { k: 'valor_desconto', l: 'Meu desconto mensal', t: 'money' }], d.beneficios, { vazio: 'Nenhum benefício cadastrado.' })
        + `<h6 class="mt-3">Exames ocupacionais</h6>${tabelaSimples([{ k: 'tipo', l: 'Tipo' }, { k: 'data', l: 'Data', t: 'date' }, { k: 'validade', l: 'Validade', t: 'date' }, { k: 'resultado', l: 'Resultado' }], d.exames, { vazio: 'Nenhum exame registrado.' })}` },
    ], 'meurh')}`;
  const btn = conteudo.querySelector('#btn-pedir');
  btn.classList.remove('d-none');
  btn.addEventListener('click', () => pedir(d, () => meuRh(conteudo)));
}

function pedir(d, aoEnviar) {
  modal({
    title: '<i class="bi bi-send"></i> Solicitação ao RH', size: 'lg',
    body: `<form class="row g-2">${campo('tipo', 'O que você precisa?', { type: 'select', col: 'col-md-6', options: Object.entries(d.tipos) })}
      <div class="col-md-6"></div>
      <div class="col-md-3" data-so="ferias atestado"><label class="form-label" data-rot-ini>Início</label><input type="date" class="form-control form-control-sm" name="data_inicio"></div>
      <div class="col-md-3" data-so="atestado"><label class="form-label">Até</label><input type="date" class="form-control form-control-sm" name="data_fim"></div>
      <div class="col-md-3" data-so="ferias"><label class="form-label">Dias de férias</label><input type="number" class="form-control form-control-sm" name="dias" value="30" min="5" max="30"></div>
      <div class="col-md-3" data-so="ferias"><label class="form-label">Vender dias (abono)</label><input type="number" class="form-control form-control-sm" name="abono_dias" value="0" min="0" max="10"></div>
      ${campo('descricao', 'Descreva', { type: 'textarea', col: 'col-12' })}
      <div class="col-12" data-so="atestado documento alteracao_dados outro"><label class="form-label">Anexo (atestado, comprovante...)</label><input type="file" class="form-control form-control-sm" name="arquivo" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"></div></form>
      <div class="form-text" data-dica></div>`,
    onShow: ({ body }) => {
      const f = body.querySelector('form');
      const dicas = {
        ferias: 'O RH confere o saldo e as regras (mínimo de 5 dias por período, um deles com 14) e responde por aqui.',
        atestado: 'Anexe o atestado. Atestado é dado de saúde: só o RH tem acesso a ele.',
        documento: 'Ex.: declaração de vínculo, informe de rendimentos, cópia do contrato.',
      };
      const atualizar = () => {
        const t = f.tipo.value;
        f.querySelectorAll('[data-so]').forEach((el) => { el.classList.toggle('d-none', !el.dataset.so.split(' ').includes(t)); });
        body.querySelector('[data-dica]').textContent = dicas[t] || '';
      };
      f.tipo.addEventListener('change', atualizar);
      atualizar();
    },
    buttons: [{ label: 'Enviar', onClick: async ({ body }) => {
      const fd = new FormData(body.querySelector('form'));
      if (!fd.get('arquivo')?.size) fd.delete('arquivo');
      await post('/api/rh/meu/solicitacoes', fd);
      toast('Solicitação enviada ao RH.');
      aoEnviar?.();
    } }],
  });
}
