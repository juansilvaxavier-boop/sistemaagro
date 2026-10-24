// Análises: curva ABC (clientes e produtos), previsão de demanda por produto e clientes atrasando a recompra.
import { get, post, esc, fmt, titulo, DataTable, kpi, toast, tentar, pode, erro, qs, state } from '../core.js';

const CLASSE = { A: 'success', B: 'warning', C: 'secondary' };
const classe = (v) => `<span class="badge text-bg-${CLASSE[v]}">${v}</span>`;

export default async function (conteudo, { params }) {
  const aba = params?.[0];
  if (aba === 'demanda') return demanda(conteudo);
  if (aba === 'recompra') return recompra(conteudo);
  return abc(conteudo);
}

function abc(conteudo) {
  let tipo = 'clientes';
  let metrica = 'valor';
  let meses = 12;
  const pagina = titulo(conteudo, 'Curva ABC', 'bi-bar-chart-steps');
  pagina.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-3">
      <div class="painel-periodos" role="group" aria-label="Analisar"><button type="button" class="ativo" data-tipo="clientes">Clientes</button><button type="button" data-tipo="produtos">Produtos</button></div>
      <div class="painel-periodos" role="group" aria-label="Medida"><button type="button" class="ativo" data-met="valor">Faturamento</button><button type="button" data-met="margem">Margem</button></div>
      <select class="form-select form-select-sm w-auto" data-meses aria-label="Período"><option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12" selected>Últimos 12 meses</option><option value="24">Últimos 24 meses</option></select>
    </div><div class="kpis mb-3" data-kpis></div><div data-t></div>
    <p class="small text-muted mt-2">A = itens que somam os primeiros 80% do total; B = os 15% seguintes; C = os 5% finais. Margem = venda − custo da embalagem gravado no pedido.</p>`;
  let t;
  const colunas = () => (tipo === 'clientes'
    ? [{ k: 'posicao', l: '#', t: 'num' }, { k: 'classe', l: 'Classe', filter: { options: [['A', 'A'], ['B', 'B'], ['C', 'C']] }, render: classe }, { k: 'cliente', l: 'Cliente' }, { k: 'vendedor', l: 'Vendedor' },
      { k: 'valor', l: 'Faturamento', t: 'money' }, { k: 'margem', l: 'Margem', t: 'money' }, { k: 'pct', l: '% do total', t: 'num', render: (v) => `${fmt.num(v)}%` },
      { k: 'acumulado', l: '% acumulado', t: 'num', render: (v) => `${fmt.num(v)}%` }, { k: 'pedidos', l: 'Pedidos', t: 'num' }, { k: 'ticket_medio', l: 'Ticket médio', t: 'money' }, { k: 'ultima_compra', l: 'Última compra', t: 'date' }]
    : [{ k: 'posicao', l: '#', t: 'num' }, { k: 'classe', l: 'Classe', filter: { options: [['A', 'A'], ['B', 'B'], ['C', 'C']] }, render: classe }, { k: 'produto', l: 'Produto' }, { k: 'grupo', l: 'Grupo' },
      { k: 'valor', l: 'Faturamento', t: 'money' }, { k: 'margem', l: 'Margem', t: 'money' }, { k: 'margem_pct', l: 'Margem %', t: 'num', render: (v) => (v == null ? '—' : `${fmt.num(v)}%`) },
      { k: 'pct', l: '% do total', t: 'num', render: (v) => `${fmt.num(v)}%` }, { k: 'acumulado', l: '% acumulado', t: 'num', render: (v) => `${fmt.num(v)}%` },
      { k: 'clientes', l: 'Clientes', t: 'num' }, { k: 'pedidos', l: 'Pedidos', t: 'num' }]);
  const url = () => `/api/analises/abc${qs({ tipo, metrica, meses })}`;
  const montar = async () => {
    const r = await get(`${url()}&resumo=1`);
    const tot = Object.values(r.resumo).reduce((a, x) => a + x.valor, 0) || 1;
    pagina.querySelector('[data-kpis]').innerHTML = ['A', 'B', 'C'].map((c) => kpi(`Classe ${c}`, `${r.resumo[c].itens} ${tipo}`, {
      icone: c === 'A' ? 'bi-star-fill' : c === 'B' ? 'bi-star-half' : 'bi-star', cor: CLASSE[c], sub: `${fmt.money(r.resumo[c].valor)} · ${fmt.num((r.resumo[c].valor / tot) * 100)}% do ${metrica === 'valor' ? 'faturamento' : 'margem'}`,
    })).join('');
    t = new DataTable(pagina.querySelector('[data-t]'), {
      url, title: `Curva ABC de ${tipo}`, sort: metrica, dir: 'desc', columns: colunas(),
      rowClick: tipo === 'clientes' ? (row) => { location.hash = `#/crm/cliente/${row.id}`; } : undefined,
    });
  };
  pagina.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    tipo = b.dataset.tipo;
    pagina.querySelectorAll('[data-tipo]').forEach((x) => x.classList.toggle('ativo', x === b));
    montar().catch(erro);
  }));
  pagina.querySelectorAll('[data-met]').forEach((b) => b.addEventListener('click', () => {
    metrica = b.dataset.met;
    pagina.querySelectorAll('[data-met]').forEach((x) => x.classList.toggle('ativo', x === b));
    montar().catch(erro);
  }));
  pagina.querySelector('[data-meses]').addEventListener('change', (e) => { meses = e.target.value; montar().catch(erro); });
  montar().catch(erro);
}

async function demanda(conteudo, horizonte = 3) {
  const d = await get(`/api/analises/demanda?horizonte=${horizonte}`);
  const comprar = pode('compras.solicitar');
  const pagina = titulo(conteudo, 'Previsão de demanda', 'bi-graph-up-arrow', `
    <select class="form-select form-select-sm w-auto" data-hz aria-label="Horizonte">${[1, 2, 3, 4, 6].map((n) => `<option value="${n}" ${n === horizonte ? 'selected' : ''}>Próximos ${n} ${n === 1 ? 'mês' : 'meses'}</option>`).join('')}</select>
    ${comprar ? '<button class="btn btn-sm btn-success" data-solicitar><i class="bi bi-inbox"></i> Solicitar compra dos marcados</button>' : ''}`);
  const nomes = d.meses.map((m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
  const spark = (h) => {
    const max = Math.max(1, ...h);
    return `<svg width="84" height="22" viewBox="0 0 84 22" aria-hidden="true">${h.map((v, i) => `<rect x="${i * 7}" y="${22 - (v / max) * 20}" width="5" height="${Math.max(1, (v / max) * 20)}" rx="1" fill="currentColor" opacity="${i === h.length - 1 ? 1 : 0.45}"></rect>`).join('')}</svg>`;
  };
  pagina.innerHTML = `<p class="small text-muted">Previsão por produto e embalagem: metade pelo mesmo mês do ano passado (corrigido pela tendência dos últimos 12 meses) e metade pela média dos últimos 3 meses.
      "Comprar" = previsão do período − disponível em estoque − o que já está em pedido de compra.</p>
    ${d.linhas.length ? `<div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>
      ${comprar ? '<th style="width:30px"><input type="checkbox" class="form-check-input" data-todos aria-label="Marcar todos"></th>' : ''}
      <th>Produto</th><th>Últimos 12 meses</th><th class="num">Tendência</th>${nomes.map((n) => `<th class="num text-capitalize">${n}</th>`).join('')}
      <th class="num">Disponível</th><th class="num">Em compra</th><th class="num">Cobertura</th><th class="num">Comprar</th></tr></thead>
    <tbody>${d.linhas.map((l, i) => `<tr class="${l.comprar > 0 ? 'table-warning' : ''}">
      ${comprar ? `<td><input type="checkbox" class="form-check-input" data-sel="${i}" ${l.comprar > 0 ? 'checked' : ''} aria-label="Marcar ${esc(l.produto)}"></td>` : ''}
      <td>${esc(l.produto)}<div class="small text-muted">${esc(l.embalagem)}${l.grupo ? ` · ${esc(l.grupo)}` : ''}</div></td>
      <td class="text-success" title="${l.historico.map(fmt.num).join(' · ')}">${spark(l.historico)} <span class="small text-body">${fmt.num(l.vendido_12m)}</span></td>
      <td class="num ${l.tendencia_pct > 0 ? 'text-success' : l.tendencia_pct < 0 ? 'text-danger' : ''}">${l.tendencia_pct > 0 ? '+' : ''}${fmt.num(l.tendencia_pct)}%</td>
      ${l.previsao.map((v) => `<td class="num">${fmt.num(v)}</td>`).join('')}
      <td class="num ${l.disponivel < 0 ? 'text-danger' : ''}">${fmt.num(l.disponivel)}</td><td class="num">${fmt.num(l.em_compra)}</td>
      <td class="num">${l.cobertura_meses == null ? '—' : `${fmt.num(l.cobertura_meses)} mês(es)`}</td>
      <td class="num fw-semibold">${comprar ? `<input type="number" class="form-control form-control-sm text-end ms-auto" style="width:90px" data-q="${i}" min="0" step="1" value="${l.comprar}">` : fmt.num(l.comprar)}</td></tr>`).join('')}</tbody></table></div></div>`
      : '<div class="vazio"><i class="bi bi-graph-up"></i>Sem histórico de vendas para prever.</div>'}`;
  conteudo.querySelector('[data-hz]').addEventListener('change', (e) => demanda(conteudo, Number(e.target.value)).catch(erro));
  pagina.querySelector('[data-todos]')?.addEventListener('change', (e) => pagina.querySelectorAll('[data-sel]').forEach((x) => { x.checked = e.target.checked; }));
  conteudo.querySelector('[data-solicitar]')?.addEventListener('click', async () => {
    const itens = [...pagina.querySelectorAll('[data-sel]:checked')].map((x) => ({ embalagem_id: d.linhas[x.dataset.sel].embalagem_id, quantidade: Number(pagina.querySelector(`[data-q="${x.dataset.sel}"]`).value) }))
      .filter((x) => x.quantidade > 0);
    if (!itens.length) return toast('Marque ao menos um item com quantidade.', 'warning');
    const r = await tentar(() => post('/api/compras/reposicao/solicitar', { itens, departamento: state.opcoes.listas?.departamento?.some((x) => x.valor === 'Compras') ? 'Compras' : 'Produção', justificativa: `Previsão de demanda dos próximos ${horizonte} mês(es).` }));
    if (r) toast(`Solicitação de compra ${r.numero} criada com ${itens.length} item(ns).`);
  });
}

function recompra(conteudo) {
  const pagina = titulo(conteudo, 'Clientes atrasando a recompra', 'bi-arrow-repeat');
  pagina.innerHTML = `<p class="small text-muted">Clientes com pelo menos duas compras cujo tempo desde a última passou de 1,2× o intervalo habitual entre elas. Ordenado pelo ticket médio: os primeiros valem mais uma ligação.</p><div data-t></div>`;
  new DataTable(pagina.querySelector('[data-t]'), {
    url: '/api/analises/recompra', title: 'Clientes atrasando a recompra', sort: 'ticket_medio', dir: 'desc',
    columns: [
      { k: 'cliente', l: 'Cliente' }, { k: 'vendedor', l: 'Vendedor' }, { k: 'telefone', l: 'Telefone' }, { k: 'compras', l: 'Compras (3 anos)', t: 'num' },
      { k: 'intervalo_medio', l: 'Compra a cada (dias)', t: 'num' }, { k: 'ultima_compra', l: 'Última compra', t: 'date' }, { k: 'previsto_em', l: 'Deveria ter comprado em', t: 'date' },
      { k: 'atraso_dias', l: 'Atraso (dias)', t: 'num', render: (v) => `<span class="fw-semibold ${v > 60 ? 'text-danger' : 'text-warning-emphasis'}">${fmt.num(v)}</span>` },
      { k: 'ticket_medio', l: 'Ticket médio', t: 'money' }, { k: 'valor_total', l: 'Total comprado', t: 'money' },
    ],
    rowClick: (r) => { location.hash = `#/crm/cliente/${r.cliente_id}`; },
  });
}
