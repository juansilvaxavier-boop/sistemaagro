// Tesouraria: fluxo de caixa (realizado + previsto), resultado do mês (DRE gerencial) e conciliação bancária (OFX).
import {
  get, post, put, api, esc, fmt, titulo, DataTable, modal, campo, opcoes, lerForm, toast, tentar, state, pode, btnAcao, kpi, erro, pedirTexto, qs, estiloGraficos,
} from '../core.js';
import { CATEGORIAS } from './pagar.js';

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const graficos = new WeakMap();

function grafico(canvas, config) {
  graficos.get(canvas)?.destroy();
  estiloGraficos();
  const g = new Chart(canvas, { type: 'bar', ...config });
  graficos.set(canvas, g);
  return g;
}
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export default async function (conteudo, { params }) {
  const aba = params?.[0];
  if (aba === 'resultado') return resultado(conteudo);
  if (aba === 'conciliacao') return conciliacao(conteudo);
  return fluxo(conteudo);
}

// ---------- Fluxo de caixa ----------
async function fluxo(conteudo) {
  const f = { de: addDias(hoje(), -30), ate: addDias(hoje(), 90), agrupar: 'semana', atrasados: '0' };
  const pagina = titulo(conteudo, 'Fluxo de caixa', 'bi-graph-up', '<button class="btn btn-sm btn-outline-secondary" data-saldo><i class="bi bi-bank"></i> Saldo em conta</button>');
  pagina.innerHTML = `<form class="d-flex flex-wrap gap-2 align-items-end mb-3" data-f>
      <div><label class="form-label small">De</label><input type="date" class="form-control form-control-sm" name="de" value="${f.de}"></div>
      <div><label class="form-label small">Até</label><input type="date" class="form-control form-control-sm" name="ate" value="${f.ate}"></div>
      <div><label class="form-label small">Agrupar por</label><select class="form-select form-select-sm" name="agrupar"><option value="dia">Dia</option><option value="semana" selected>Semana</option><option value="mes">Mês</option></select></div>
      <div class="form-check form-switch mb-1"><input class="form-check-input" type="checkbox" id="fx-atr" name="atrasados"><label class="form-check-label small" for="fx-atr">Contar os vencidos em aberto como se entrassem/saíssem hoje</label></div>
    </form>
    <div class="kpis mb-3" data-kpis></div>
    <div class="card mb-3"><div class="card-body"><div style="height:300px"><canvas data-g aria-label="Gráfico do fluxo de caixa" role="img"></canvas></div></div></div>
    <div class="card"><div class="table-responsive" data-tab></div></div>`;
  const carregar = async () => {
    const form = pagina.querySelector('[data-f]');
    const p = lerForm(form);
    const d = await get(`/api/tesouraria/fluxo${qs({ de: p.de, ate: p.ate, agrupar: p.agrupar, atrasados: p.atrasados ? 1 : 0 })}`);
    const ini = d.saldo_inicial;
    const prevE = d.linhas.reduce((a, l) => a + l.entradas_previstas, 0);
    const prevS = d.linhas.reduce((a, l) => a + l.saidas_previstas, 0);
    pagina.querySelector('[data-kpis]').innerHTML = [
      kpi('Saldo de partida', fmt.money(d.saldo_partida), { icone: 'bi-bank', cor: 'primary', sub: ini.origem === 'nenhum' ? 'Sem saldo informado: o fluxo começa em zero. Informe o saldo ou importe um extrato.' : `${ini.origem === 'extrato' ? 'Extrato' : 'Informado'} de ${fmt.date(ini.data)}: ${fmt.money(ini.valor)}` }),
      kpi('A receber no período', fmt.money(prevE), { icone: 'bi-arrow-down-circle', cor: 'success', sub: `${fmt.money(d.atrasados.receber)} vencido em aberto` }),
      kpi('A pagar no período', fmt.money(prevS), { icone: 'bi-arrow-up-circle', cor: 'danger', sub: `${fmt.money(d.atrasados.pagar)} vencido em aberto` }),
      kpi('Saldo projetado no fim', fmt.money(d.saldo_final), { icone: 'bi-flag', cor: d.saldo_final < 0 ? 'danger' : 'success' }),
      kpi('Menor saldo', d.menor_saldo ? fmt.money(d.menor_saldo.saldo) : '—', { icone: 'bi-exclamation-triangle', cor: d.menor_saldo?.saldo < 0 ? 'danger' : 'secondary', sub: d.menor_saldo ? `em ${rot(d.menor_saldo.periodo, d.agrupar)}` : '' }),
    ].join('');
    grafico(pagina.querySelector('[data-g]'), {
      data: {
        labels: d.linhas.map((l) => rot(l.periodo, d.agrupar)),
        datasets: [
          { type: 'bar', label: 'Entradas', data: d.linhas.map((l) => l.entradas + l.entradas_previstas), backgroundColor: cor('--ok'), stack: 'e' },
          { type: 'bar', label: 'Saídas', data: d.linhas.map((l) => -(l.saidas + l.saidas_previstas)), backgroundColor: cor('--erro'), stack: 'e' },
          { type: 'line', label: 'Saldo', data: d.linhas.map((l) => l.saldo), borderColor: cor('--texto'), borderWidth: 2, yAxisID: 'y', order: 0 },
        ],
      },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.money(Math.abs(c.raw))}` } } }, scales: { y: { ticks: { callback: (v) => fmt.money(v) } } } },
    });
    pagina.querySelector('[data-tab]').innerHTML = `<table class="table table-sm mb-0"><thead><tr><th>${d.agrupar === 'mes' ? 'Mês' : d.agrupar === 'semana' ? 'Semana de' : 'Dia'}</th>
      <th class="num">Recebido</th><th class="num">A receber</th><th class="num">Pago</th><th class="num">A pagar</th><th class="num">Líquido</th><th class="num">Saldo</th></tr></thead>
      <tbody>${d.linhas.map((l) => `<tr class="${l.periodo <= d.hoje && d.agrupar === 'dia' ? '' : ''}"><td>${rot(l.periodo, d.agrupar)}</td><td class="num">${fmt.money(l.entradas)}</td><td class="num text-success">${fmt.money(l.entradas_previstas)}</td>
        <td class="num">${fmt.money(l.saidas)}</td><td class="num text-danger">${fmt.money(l.saidas_previstas)}</td><td class="num fw-semibold ${l.liquido < 0 ? 'text-danger' : ''}">${fmt.money(l.liquido)}</td>
        <td class="num fw-semibold ${l.saldo < 0 ? 'text-danger' : ''}">${fmt.money(l.saldo)}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Sem movimento no período.</td></tr>'}</tbody></table>`;
  };
  pagina.querySelector('[data-f]').addEventListener('change', () => carregar().catch(erro));
  conteudo.querySelector('[data-saldo]').addEventListener('click', () => modal({
    title: 'Saldo em conta', size: 'md',
    body: `<p class="small text-muted">Com extrato OFX importado, o saldo vem dele. Para começar sem extrato, informe o saldo somado das contas numa data.</p>
      <form class="row g-2">${campo('valor', 'Saldo (R$)', { type: 'number', col: 'col-md-6', attrs: 'step="0.01"' })}${campo('data', 'Em', { type: 'date', col: 'col-md-6', value: hoje() })}</form>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => { await put('/api/tesouraria/saldo', lerForm(body.querySelector('form'))); toast('Saldo salvo.'); carregar(); } }],
  }));
  await carregar();
}
const rot = (p, ag) => (ag === 'mes' ? new Date(`${p}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : fmt.date(p));

// ---------- Resultado do mês ----------
async function resultado(conteudo, ano = Number(hoje().slice(0, 4))) {
  const d = await get(`/api/tesouraria/resultado?ano=${ano}`);
  const pagina = titulo(conteudo, 'Resultado do mês', 'bi-clipboard-data', `
    <div class="input-group input-group-sm w-auto"><button class="btn btn-outline-secondary" data-ano="-1" aria-label="Ano anterior"><i class="bi bi-chevron-left"></i></button>
      <span class="input-group-text">${ano}</span><button class="btn btn-outline-secondary" data-ano="1" aria-label="Próximo ano"><i class="bi bi-chevron-right"></i></button></div>
    <button class="btn btn-sm btn-outline-secondary" data-imp><i class="bi bi-percent"></i> Impostos sobre a venda</button>`);
  const nomes = d.meses.map((m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }));
  const ultimo = d.meses.findLastIndex((m, i) => d.linhas[0].valores[i] || d.linhas.some((l) => l.despesa && l.valores[i]));
  pagina.innerHTML = `<div class="card mb-3"><div class="card-body"><div style="height:240px"><canvas data-g role="img" aria-label="Receita e resultado por mês"></canvas></div></div></div>
    <div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0 dre"><thead><tr><th style="min-width:230px"></th>${nomes.map((n) => `<th class="num text-capitalize">${n}</th>`).join('')}<th class="num">Ano</th></tr></thead>
    <tbody>${d.linhas.map((l) => `<tr class="${l.total ? 'fw-semibold table-light' : ''} ${l.final ? 'dre-final' : ''}"><td>${esc(l.rotulo)}</td>
      ${l.valores.map((v) => `<td class="num ${v < 0 && l.total ? 'text-danger' : ''}">${l.pct ? (v == null ? '—' : `${fmt.num(v)}%`) : v ? fmt.money(v) : '—'}</td>`).join('')}
      <td class="num">${l.pct ? '' : fmt.money(l.total_ano)}</td></tr>`).join('')}</tbody></table></div></div>
    <ul class="small text-muted mt-2">${d.observacoes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`;
  const res = d.linhas.find((l) => l.final);
  grafico(pagina.querySelector('[data-g]'), {
    data: { labels: nomes.slice(0, Math.max(ultimo + 1, 1)), datasets: [
      { type: 'bar', label: 'Receita bruta', data: d.linhas[0].valores.slice(0, ultimo + 1), backgroundColor: cor('--agro'), order: 1 },
      { type: 'line', label: 'Resultado operacional', data: res.valores.slice(0, ultimo + 1), borderColor: cor('--texto'), borderWidth: 2, order: 0 },
    ] },
    options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.money(c.raw)}` } } }, scales: { y: { ticks: { callback: (v) => fmt.money(v) } } } },
  });
  conteudo.querySelectorAll('[data-ano]').forEach((b) => b.addEventListener('click', () => resultado(conteudo, ano + Number(b.dataset.ano)).catch(erro)));
  conteudo.querySelector('[data-imp]').addEventListener('click', async () => {
    const v = await pedirTexto('Percentual de impostos sobre a venda (ICMS, PIS/COFINS...) para o resultado gerencial. Use 0 se a venda é isenta.', { titulo: 'Impostos sobre a venda', valor: String(d.impostos_pct ?? 0) });
    if (v != null && await tentar(() => put('/api/tesouraria/resultado/impostos', { pct: v }), 'Percentual salvo.')) resultado(conteudo, ano);
  });
}

// ---------- Conciliação bancária ----------
async function conciliacao(conteudo) {
  const pagina = titulo(conteudo, 'Conciliação bancária', 'bi-bank2', `
    <button class="btn btn-sm btn-outline-secondary" data-auto><i class="bi bi-magic"></i> Conciliar sugestões</button>
    <button class="btn btn-sm btn-success" data-importar><i class="bi bi-upload"></i> Importar extrato (OFX)</button>`);
  pagina.innerHTML = `<p class="small text-muted">Importe o extrato OFX do banco: os créditos são casados com as parcelas a receber e os débitos com as contas a pagar pelo valor e pela data.
      Quando há um único par seguro, a baixa é feita sozinha; o resto fica aqui para você confirmar, lançar como despesa ou ignorar.</p>
    <div data-extratos class="mb-3"></div><div data-t></div>`;
  const extratos = async () => {
    const l = await get('/api/tesouraria/extratos');
    pagina.querySelector('[data-extratos]').innerHTML = l.length ? `<div class="small d-flex flex-wrap gap-2">${l.slice(0, 6).map((e) => `<span class="badge text-bg-light border">
      <i class="bi bi-file-earmark-text"></i> ${esc(e.banco || 'Banco')} · ${fmt.date(e.inicio)}–${fmt.date(e.fim)} · ${e.lancamentos} lanç.${e.pendentes ? ` · <b class="text-warning-emphasis">${e.pendentes} pendentes</b>` : ''}${e.saldo_final != null ? ` · saldo ${fmt.money(e.saldo_final)}` : ''}</span>`).join('')}</div>` : '';
  };
  const t = new DataTable(pagina.querySelector('[data-t]'), {
    url: '/api/tesouraria/lancamentos', title: 'Lançamentos do extrato', sort: 'data', dir: 'desc', filtrosIniciais: { status: 'pendente' },
    columns: [
      { k: 'data', l: 'Data', t: 'date' }, { k: 'banco', l: 'Banco' }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'valor', l: 'Valor', t: 'money', render: (v) => `<span class="fw-semibold ${v < 0 ? 'text-danger' : 'text-success'}">${fmt.money(v)}</span>` },
      { k: 'tipo', l: 'Tipo', filter: { options: [['credito', 'Crédito'], ['debito', 'Débito']] }, render: (v) => (v === 'credito' ? 'Crédito' : 'Débito') },
      { k: 'status', l: 'Situação', filter: { options: [['pendente', 'Pendente'], ['conciliado', 'Conciliado'], ['ignorado', 'Ignorado']] },
        render: (v) => ({ pendente: '<span class="badge text-bg-warning">Pendente</span>', conciliado: '<span class="badge text-bg-success">Conciliado</span>', ignorado: '<span class="badge text-bg-secondary">Ignorado</span>' })[v] },
      { k: 'vinculo', l: 'Vínculo', render: (v, r) => esc(v || r.observacao || '') },
    ],
    actions: (r) => (r.status === 'pendente' ? btnAcao('conciliar', 'bi-link-45deg', 'Conciliar', 'outline-success') : btnAcao('desfazer', 'bi-arrow-counterclockwise', 'Desfazer')),
    onAction: {
      conciliar: (r) => conciliar(r, atualizar),
      desfazer: async (r) => { if (await tentar(() => post(`/api/tesouraria/lancamentos/${r.id}/desfazer`), 'Vínculo desfeito (a baixa continua na parcela/conta).')) atualizar(); },
    },
  });
  const atualizar = () => { t.reload(); extratos().catch(erro); };
  extratos().catch(erro);
  conteudo.querySelector('[data-auto]').addEventListener('click', async () => {
    const r = await tentar(() => post('/api/tesouraria/conciliar-automatico'));
    if (r) { toast(`${r.conciliados} lançamento(s) conciliado(s); ${r.pendentes} para conferir.`); atualizar(); }
  });
  conteudo.querySelector('[data-importar]').addEventListener('click', () => modal({
    title: 'Importar extrato OFX', size: 'md',
    body: `<form class="row g-2">${campo('banco_id', 'Banco', { type: 'select', col: 'col-12', options: opcoes(state.opcoes.bancos, 'Identificar pelo arquivo') })}
      <div class="col-12"><label class="form-label">Arquivo OFX</label><input type="file" class="form-control form-control-sm" name="arquivo" accept=".ofx,.OFX" required></div>
      <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" id="ofx-auto" checked><label class="form-check-label small" for="ofx-auto">Conciliar sozinho os pares seguros</label></div></div></form>`,
    buttons: [{ label: '<i class="bi bi-upload"></i> Importar', onClick: async ({ body }) => {
      const f = body.querySelector('form');
      if (!f.reportValidity()) return false;
      const fd = new FormData();
      fd.append('arquivo', f.querySelector('[name=arquivo]').files[0]);
      if (f.querySelector('[name=banco_id]').value) fd.append('banco_id', f.querySelector('[name=banco_id]').value);
      fd.append('conciliar', f.querySelector('#ofx-auto').checked ? '1' : '0');
      const r = await api('/api/tesouraria/extratos', { method: 'POST', body: fd });
      toast(`${r.novos} lançamento(s) novos${r.repetidos ? ` (${r.repetidos} já importados)` : ''}${r.automatico ? `; ${r.automatico.conciliados} conciliado(s) sozinhos` : ''}.`);
      atualizar();
    } }],
  }));
}

async function conciliar(l, aoMudar) {
  let amplo = false;
  const m = modal({
    title: `Conciliar ${fmt.money(l.valor)} de ${fmt.date(l.data)}`, size: 'lg',
    body: `<p class="small"><b>${esc(l.descricao || '')}</b>${l.documento ? ` · doc. ${esc(l.documento)}` : ''}</p><div data-sug><span class="esqueleto"></span></div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-amplo><i class="bi bi-search"></i> Buscar com valor e data aproximados</button>
        ${l.valor < 0 && pode('financeiro.pagar') ? '<button type="button" class="btn btn-sm btn-outline-primary" data-despesa><i class="bi bi-plus-lg"></i> Lançar como despesa paga</button>' : ''}
        <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" data-ignorar><i class="bi bi-eye-slash"></i> Ignorar</button></div>
      <form class="row g-2 mt-2 d-none" data-fdesp>${campo('descricao', 'Descrição', { col: 'col-md-6', value: l.descricao || '' })}
        ${campo('categoria', 'Categoria', { type: 'select', col: 'col-md-4', options: [['', 'Selecione...'], ...CATEGORIAS.map((c) => [c, c])] })}
        <div class="col-md-2 d-flex align-items-end"><button class="btn btn-sm btn-success w-100">Lançar</button></div></form>`,
  });
  const box = m.body.querySelector('[data-sug]');
  const carregar = async () => {
    const s = await get(`/api/tesouraria/lancamentos/${l.id}/sugestoes${amplo ? '?amplo=1' : ''}`);
    box.innerHTML = s.length ? `<div class="list-group">${s.map((x, i) => `<button type="button" class="list-group-item list-group-item-action d-flex gap-2 align-items-center" data-i="${i}">
        <span class="badge text-bg-${x.pontos >= 80 ? 'success' : x.pontos >= 50 ? 'warning' : 'secondary'}">${x.pontos}</span>
        <div class="flex-grow-1 text-start"><div class="fw-semibold">${esc(x.descricao)}</div><div class="small text-muted">${x.tipo === 'parcela' ? 'Parcela a receber' : 'Conta a pagar'} · ${x.ja_baixada ? `baixada em ${fmt.date(x.data)}` : `vence ${fmt.date(x.data)}`}</div></div>
        <span class="fw-semibold">${fmt.money(x.valor)}</span><span class="btn btn-sm btn-success py-0">${x.ja_baixada ? 'Ligar' : 'Baixar e ligar'}</span></button>`).join('')}</div>`
      : `<div class="vazio py-3">Nenhuma ${l.valor > 0 ? 'parcela' : 'conta'} com esse valor perto dessa data.</div>`;
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
      const x = s[b.dataset.i];
      if (await tentar(() => post(`/api/tesouraria/lancamentos/${l.id}/conciliar`, { tipo: x.tipo, id: x.id }), 'Conciliado.')) { m.close(); aoMudar?.(); }
    }));
  };
  m.body.querySelector('[data-amplo]').addEventListener('click', () => { amplo = true; carregar().catch(erro); });
  m.body.querySelector('[data-despesa]')?.addEventListener('click', () => m.body.querySelector('[data-fdesp]').classList.remove('d-none'));
  m.body.querySelector('[data-fdesp]').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await tentar(() => post(`/api/tesouraria/lancamentos/${l.id}/criar-conta`, lerForm(e.target)), 'Despesa lançada e conciliada.')) { m.close(); aoMudar?.(); }
  });
  m.body.querySelector('[data-ignorar]').addEventListener('click', async () => {
    const motivo = await pedirTexto('Por que ignorar? (ex.: transferência entre contas, aplicação, estorno)', { titulo: 'Ignorar lançamento' });
    if (motivo && await tentar(() => post(`/api/tesouraria/lancamentos/${l.id}/ignorar`, { motivo }), 'Lançamento ignorado.')) { m.close(); aoMudar?.(); }
  });
  carregar().catch(erro);
}
