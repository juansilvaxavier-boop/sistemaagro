// Produtividade: cobranças feitas, pedidos que passaram por cada setor, notas emitidas, vendas e o resultado de cada colaborador.
// Sem a permissão "produtividade" a tela mostra só o resultado da própria pessoa.
import { get, esc, fmt, titulo, kpi, modal, pode, qs, periodoAtalho, estiloGraficos, tabelaSimples, ROTULOS } from '../core.js';

const TIPOS_COB = ROTULOS.tipo_acao;
const RESULTADOS = { ...ROTULOS.resultado, sem_resultado: 'Sem resultado informado' };
const ATALHOS = [['mes', 'Este mês'], ['mes_ant', 'Mês passado'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias'], ['ano', 'Este ano']];
const horasTxt = (h) => (h == null ? '—' : h < 24 ? `${fmt.num(h)} h` : `${fmt.num(Math.round((h / 24) * 10) / 10)} dias`);
const rotulo = (mapa, v) => mapa[v] || String(v || '').replace(/_/g, ' ');
const pctTxt = (v) => (v == null ? '—' : `${fmt.num(v)}%`);
let grafico;

export default async function produtividade(conteudo, _ctx, filtro) {
  const todos = pode('produtividade');
  const [de0, ate0] = periodoAtalho('mes');
  const f = filtro || { de: de0, ate: ate0, atalho: 'mes', usuario_id: '' };
  const pagina = titulo(conteudo, todos ? 'Produtividade' : 'Meu resultado', 'bi-speedometer2', `
    <select class="form-select form-select-sm" style="max-width:11rem" id="pr-atalho" aria-label="Período">${ATALHOS.map(([v, l]) => `<option value="${v}" ${f.atalho === v ? 'selected' : ''}>${l}</option>`).join('')}<option value="" ${f.atalho ? '' : 'selected'}>Personalizado</option></select>
    <input type="date" class="form-control form-control-sm" style="max-width:9.5rem" id="pr-de" value="${f.de}" aria-label="De">
    <input type="date" class="form-control form-control-sm" style="max-width:9.5rem" id="pr-ate" value="${f.ate}" aria-label="Até">
    ${todos ? '<select class="form-select form-select-sm" style="max-width:13rem" id="pr-usuario" aria-label="Colaborador"><option value="">Todos os colaboradores</option></select>' : ''}`);
  const recarregar = (mudanca) => produtividade(conteudo, _ctx, { ...f, ...mudanca });
  conteudo.querySelector('#pr-atalho').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [de, ate] = periodoAtalho(e.target.value);
    recarregar({ de, ate, atalho: e.target.value });
  });
  for (const id of ['de', 'ate']) conteudo.querySelector(`#pr-${id}`).addEventListener('change', (e) => e.target.value && recarregar({ [id]: e.target.value, atalho: '' }));
  if (todos) {
    const sel = conteudo.querySelector('#pr-usuario');
    get('/api/produtividade/usuarios').then((us) => {
      sel.insertAdjacentHTML('beforeend', us.map((u) => `<option value="${u.id}" ${String(f.usuario_id) === String(u.id) ? 'selected' : ''}>${esc(u.nome)}</option>`).join(''));
    }).catch(() => {});
    sel.addEventListener('change', () => recarregar({ usuario_id: sel.value }));
  }

  const d = await get(`/api/produtividade${qs({ de: f.de, ate: f.ate, usuario_id: f.usuario_id || undefined })}`);
  const r = d.resumo;
  const umaPessoa = !todos || f.usuario_id;
  const eu = umaPessoa ? d.colaboradores[0] : null;

  pagina.innerHTML = `<div class="kpis mb-3">
      ${kpi('Cobranças feitas', fmt.num(r.cobrancas), { icone: 'bi-telephone-outbound', cor: 'primary', sub: `${fmt.num(r.clientes_cobrados)} clientes · ${fmt.num(r.promessas)} promessas (${fmt.money(r.promessas_valor)})` })}
      ${kpi('Pedidos analisados', fmt.num(r.analisados), { icone: 'bi-search', cor: 'info', sub: `${r.analise_aprovados} aprovados · ${r.analise_devolvidos} devolvidos · ${r.analise_reprovados} reprovados${r.analise_horas != null ? ` · ${horasTxt(r.analise_horas)} em média` : ''}` })}
      ${todos && !f.usuario_id ? kpi('Faturamento', fmt.money(r.faturado), { icone: 'bi-receipt', cor: 'success', sub: `${fmt.num(r.notas)} notas emitidas` }) : ''}
      ${kpi('Vendas lançadas', fmt.money(r.vendas_valor), { icone: 'bi-cart-check', cor: 'success', sub: `${fmt.num(r.vendas_qtd)} pedidos` })}
      ${kpi('Acordos fechados', fmt.num(r.acordos), { icone: 'bi-hand-thumbs-up', cor: 'secondary', sub: fmt.money(r.acordos_valor) })}
    </div>
    <h6 class="secao-titulo">Conversão da cobrança <span class="small text-body-secondary fw-normal">o que as ações de cobrança do período trouxeram de volta</span></h6>
    <div class="kpis mb-3">
      ${kpi('Taxa de conversão', pctTxt(r.conversao), { icone: 'bi-funnel', cor: 'success', sub: `${fmt.num(r.clientes_pagaram)} de ${fmt.num(r.clientes_cobrados)} clientes cobrados pagaram em até 30 dias`, dica: 'Clientes que pagaram uma parcela vencida em até 30 dias depois de uma ação de cobrança do período.' })}
      ${kpi('Valor recuperado', fmt.money(r.recuperado), { icone: 'bi-cash-coin', cor: 'success', sub: 'parcelas vencidas pagas após a cobrança', dica: 'Cada pagamento conta para o último analista que cobrou o cliente antes dele.' })}
      ${kpi('Promessas cumpridas', pctTxt(r.cumprimento), { icone: 'bi-calendar-check', cor: r.cumprimento != null && r.cumprimento < 50 ? 'warning' : 'info', sub: `${fmt.num(r.promessas_cumpridas)} cumpridas · ${fmt.num(r.promessas_quebradas)} quebradas · ${fmt.num(r.promessas_a_vencer)} a vencer`, dica: 'Cumprida: o cliente pagou entre a ação e 3 dias depois da data prometida.' })}
    </div>
    <div class="row g-3 mb-3">
      <div class="col-xl-8"><div class="card h-100"><div class="card-header">Atividade por dia</div><div class="card-body">
        ${d.serie.length ? '<div class="chart-box"><canvas id="pr-serie" role="img" aria-label="Pedidos movimentados e cobranças por dia"></canvas></div>'
    : '<div class="chart-box"><div class="grafico-vazio vazio"><i class="bi bi-graph-up"></i><b>Sem atividade no período</b>Mude o período para comparar.</div></div>'}</div></div></div>
      <div class="col-xl-4"><div class="card h-100"><div class="card-header">Cobrança por canal e resultado</div><div class="card-body small">
        ${Object.keys(d.cobranca.por_tipo).length ? `${barras(d.cobranca.por_tipo, TIPOS_COB)}<hr class="my-2">${barras(d.cobranca.por_resultado, RESULTADOS)}`
    : '<div class="vazio py-3"><i class="bi bi-telephone"></i>Nenhuma ação de cobrança no período.</div>'}</div></div></div>
    </div>
    <h6 class="secao-titulo">Por setor <span class="small text-body-secondary fw-normal">pedidos que cada etapa tratou no período</span></h6>
    ${d.setores.length ? `<div class="row g-3 mb-3">${d.setores.map(setorHtml).join('')}</div>` : '<div class="vazio mb-3"><i class="bi bi-diagram-3"></i>Nenhum pedido movimentado no período.</div>'}
    ${umaPessoa ? (eu ? detalheHtml(eu) : '<div class="vazio"><i class="bi bi-person"></i>Nenhuma atividade registrada no período.</div>') : `
    <h6 class="secao-titulo">Por colaborador <span class="small text-body-secondary fw-normal">clique para ver o detalhe</span></h6>
    <div class="card"><div class="card-body p-0">${tabelaColaboradores(d.colaboradores)}</div></div>`}`;

  pagina.querySelectorAll('[data-usuario]').forEach((tr) => {
    const abrir = () => {
      const x = d.colaboradores.find((c) => c.usuario_id === Number(tr.dataset.usuario));
      modal({ title: `<i class="bi bi-person"></i> ${esc(x.nome)} · ${fmt.date(d.de)} a ${fmt.date(d.ate)}`, size: 'xl', body: detalheHtml(x) });
    };
    tr.addEventListener('click', abrir);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
  });
  desenharSerie(pagina.querySelector('#pr-serie'), d);
}

/** Barras horizontais simples (HTML) para poucas categorias: valor escrito ao lado, sem depender de cor. */
function barras(obj, nomes) {
  const itens = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...itens.map(([, n]) => n), 1);
  return itens.map(([k, n]) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${esc(rotulo(nomes, k))}</span><b>${fmt.num(n)}</b></div>
    <div class="progress" style="height:6px" role="presentation"><div class="progress-bar bg-success" style="width:${(n / max) * 100}%"></div></div></div>`).join('');
}

function setorHtml(s) {
  const linha = (l, v, cls = '') => `<div class="d-flex justify-content-between py-1"><span class="text-body-secondary">${l}</span><b class="${cls}">${v}</b></div>`;
  return `<div class="col-md-6 col-xl-3"><div class="card h-100"><div class="card-header py-2 d-flex"><span>${esc(s.label)}</span><b class="ms-auto">${fmt.num(s.n)}</b></div>
    <div class="card-body small">
      ${linha(esc(s.avanco), fmt.num(s.avancado), 'text-success')}
      ${s.devolvido ? linha('Devolvidos', fmt.num(s.devolvido), 'text-warning') : ''}
      ${s.reprovado ? linha('Reprovados', fmt.num(s.reprovado), 'text-danger') : ''}
      ${s.cancelado ? linha('Cancelados', fmt.num(s.cancelado), 'text-danger') : ''}
      ${linha('Valor avançado', fmt.money(s.valor))}
      ${linha('Tempo médio na etapa', horasTxt(s.horas_medias))}
      ${s.pessoas.length ? `<hr class="my-2"><div class="text-body-secondary mb-1">Quem mais tratou</div>${s.pessoas.slice(0, 3).map((p) => linha(esc(p.nome), fmt.num(p.n))).join('')}` : ''}
    </div></div></div>`;
}

function tabelaColaboradores(lista) {
  if (!lista.length) return '<div class="vazio"><i class="bi bi-people"></i><b>Nenhuma atividade no período</b>Mude o período para comparar.</div>';
  const n = (v) => (v ? fmt.num(v) : '<span class="text-body-secondary">—</span>');
  return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0"><thead><tr>
    <th>Colaborador</th><th class="num">Vendas</th><th class="num">Pedidos tratados</th><th class="num">Devolvidos / reprovados</th><th class="num">Cobranças</th>
    <th class="num">Promessas</th><th class="num">Conversão</th><th class="num">Recuperado</th><th class="num">Acordos</th><th class="num">CRM</th><th class="num">Chamados</th><th class="num">Horas no ponto</th><th class="num">Total</th></tr></thead>
    <tbody>${lista.map((x) => `<tr role="button" tabindex="0" data-usuario="${x.usuario_id}">
      <td><b>${esc(x.nome)}</b><div class="small text-body-secondary">${esc(x.perfil_label || '')}${x.departamento ? ` · ${esc(x.departamento)}` : ''}</div></td>
      <td class="num">${x.vendas_qtd ? `${fmt.num(x.vendas_qtd)}<div class="small text-body-secondary">${fmt.money(x.vendas_valor)}</div>` : n(0)}</td>
      <td class="num">${n(x.movimentos)}</td><td class="num">${n(x.devolvidos + x.reprovados)}</td><td class="num">${n(x.cobrancas)}</td>
      <td class="num">${x.promessas ? `${fmt.num(x.promessas)}<div class="small text-body-secondary">${x.cumprimento != null ? `${pctTxt(x.cumprimento)} cumpridas` : fmt.money(x.promessas_valor)}</div>` : n(0)}</td>
      <td class="num">${x.conversao != null ? `${pctTxt(x.conversao)}<div class="small text-body-secondary">${x.clientes_pagaram}/${x.clientes_cobrados} clientes</div>` : n(0)}</td>
      <td class="num">${x.recuperado ? fmt.money(x.recuperado) : n(0)}</td>
      <td class="num">${n(x.acordos)}</td><td class="num">${n(x.interacoes + x.tarefas)}</td><td class="num">${n(x.chamados)}</td>
      <td class="num">${x.horas_ponto != null ? `${fmt.num(x.horas_ponto)} h` : n(0)}</td><td class="num"><b>${fmt.num(x.total)}</b></td></tr>`).join('')}</tbody></table></div>
    <div class="form-text px-3 pb-2">Total = vendas + movimentações de pedido + cobranças + acordos + CRM + chamados resolvidos.</div>`;
}

function detalheHtml(x) {
  const item = (l, v, sub = '') => `<div class="col-6 col-md-3"><div class="small text-body-secondary">${l}</div><div class="fs-5 fw-semibold">${v}</div>${sub ? `<div class="small text-body-secondary">${sub}</div>` : ''}</div>`;
  return `<div class="card mb-3"><div class="card-body"><div class="row g-3">
      ${item('Vendas lançadas', fmt.num(x.vendas_qtd), fmt.money(x.vendas_valor))}
      ${item('Pedidos tratados', fmt.num(x.movimentos), `${x.avancados} avançados · ${x.devolvidos} devolvidos · ${x.reprovados} reprovados`)}
      ${item('Cobranças', fmt.num(x.cobrancas), `${fmt.num(x.clientes_cobrados)} clientes`)}
      ${item('Promessas', fmt.num(x.promessas), `${fmt.money(x.promessas_valor)} · ${x.promessas_cumpridas} cumpridas · ${x.promessas_quebradas} quebradas`)}
      ${item('Conversão da cobrança', pctTxt(x.conversao), `${x.clientes_pagaram} de ${x.clientes_cobrados} clientes pagaram`)}
      ${item('Valor recuperado', fmt.money(x.recuperado), `${x.parcelas_recuperadas} parcelas vencidas`)}
      ${item('Acordos', fmt.num(x.acordos), fmt.money(x.acordos_valor))}
      ${item('CRM', fmt.num(x.interacoes), `${fmt.num(x.tarefas)} tarefas concluídas`)}
      ${item('Chamados resolvidos', fmt.num(x.chamados))}
      ${item('Horas no ponto', x.horas_ponto != null ? `${fmt.num(x.horas_ponto)} h` : '—')}
    </div></div></div>
    <div class="row g-3"><div class="col-lg-8"><div class="card h-100"><div class="card-header py-2">Pedidos por etapa</div><div class="card-body p-0">
      ${tabelaSimples([{ k: 'label', l: 'Etapa' }, { k: 'avancado', l: 'Avançados', t: 'num' }, { k: 'devolvido', l: 'Devolvidos', t: 'num' }, { k: 'reprovado', l: 'Reprovados', t: 'num' },
    { k: 'cancelado', l: 'Cancelados', t: 'num' }, { k: 'valor', l: 'Valor', t: 'money' }, { k: 'horas_medias', l: 'Tempo médio', render: (v) => horasTxt(v) }], x.por_etapa, { vazio: 'Nenhum pedido movimentado.' })}
    </div></div></div><div class="col-lg-4"><div class="card h-100"><div class="card-header py-2">Cobrança por canal</div><div class="card-body small">
      ${Object.keys(x.por_tipo_cobranca).length ? barras(x.por_tipo_cobranca, TIPOS_COB) : '<div class="text-body-secondary">Nenhuma ação de cobrança.</div>'}
    </div></div></div></div>`;
}

function desenharSerie(canvas, d) {
  grafico?.destroy();
  if (!canvas || !window.Chart) return;
  const est = estiloGraficos();
  const porDia = Object.fromEntries(d.serie.map((x) => [x.dia, x]));
  const dias = [];
  for (let t = Date.parse(`${d.de}T12:00:00Z`); t <= Date.parse(`${d.ate}T12:00:00Z`); t += 86400e3) dias.push(new Date(t).toISOString().slice(0, 10));
  const serie = (k) => dias.map((x) => porDia[x]?.[k] || 0);
  grafico = new Chart(canvas, {
    type: 'line',
    data: {
      labels: dias.map((x) => fmt.date(x).slice(0, 5)),
      datasets: [
        { label: 'Pedidos movimentados', data: serie('pedidos'), borderColor: est.cores[0], backgroundColor: est.cores[0], pointBackgroundColor: est.cores[0] },
        { label: 'Cobranças', data: serie('cobrancas'), borderColor: est.cores[1], backgroundColor: est.cores[1], pointBackgroundColor: est.cores[1] },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', align: 'end' } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { beginAtZero: true, grid: { color: est.grade }, border: { display: false }, ticks: { maxTicksLimit: 6, precision: 0 } },
      },
    },
  });
}
