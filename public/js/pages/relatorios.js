// Relatórios: filtros, Gerar Relatório e Gerar Excel.
import { get, esc, fmt, titulo, campo, opcoes, lerForm, state, renderCell, baixar, tentar, erro, qs } from '../core.js';

const inicioMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

function filtrosDe(tipo) {
  const o = state.opcoes;
  const vend = () => campo('vendedor_id', 'Vendedor', { type: 'select', col: 'col-md-3', options: opcoes(o.usuarios.filter((u) => u.perfil === 'vendedor'), 'Todos') });
  const sup = () => campo('supervisor_id', 'Supervisor', { type: 'select', col: 'col-md-3', options: opcoes(o.usuarios.filter((u) => u.perfil === 'supervisor'), 'Todos') });
  const forma = () => campo('forma_id', 'Forma de pagamento', { type: 'select', col: 'col-md-3', options: opcoes(o.formas, 'Todas') });
  const banco = () => campo('banco_id', 'Banco', { type: 'select', col: 'col-md-3', options: opcoes(o.bancos, 'Todos') });
  const per = (pre, l) => campo(`${pre}_de`, `${l} de`, { type: 'date', col: 'col-md-3', value: inicioMes() }) + campo(`${pre}_ate`, 'até', { type: 'date', col: 'col-md-3', value: hoje() });
  const empresa = () => campo('empresa_id', 'Empresa', { type: 'select', col: 'col-md-3', options: opcoes(o.empresas, 'Empresa atual') });
  switch (tipo) {
    case 'contas-receber': return campo('venc_de', 'Vencimento de', { type: 'date', col: 'col-md-3' }) + campo('venc_ate', 'até', { type: 'date', col: 'col-md-3' }) + banco() + forma() + sup() + vend() + campo('agrupar_vendedor', 'Agrupar por vendedor', { type: 'checkbox', col: 'col-md-3' });
    case 'contas-recebidas': return per('baixa', 'Data de baixa') + banco() + forma() + sup() + vend();
    case 'vendas': return per('cad', 'Data de cadastro') + forma() + sup() + vend()
      + campo('etapa', 'Etapa', { type: 'select', col: 'col-md-3', options: [['', 'Todas'], ...Object.entries(state.me.etapas).map(([k, v]) => [k, v.label])] })
      + campo('equipe_id', 'Equipe', { type: 'select', col: 'col-md-3', options: opcoes(o.equipes, 'Todas') });
    case 'faturamento': return per('emissao', 'Emissão') + empresa();
    case 'vencidas': return campo('venc_de', 'Vencimento de', { type: 'date', col: 'col-md-3' }) + campo('venc_ate', 'até', { type: 'date', col: 'col-md-3' }) + sup() + vend()
      + campo('negativado', 'Cliente negativado', { type: 'select', col: 'col-md-3', options: [['', 'Todos'], ['sim', 'Sim'], ['nao', 'Não']] }) + forma() + banco();
    case 'historico-vendas': return per('emissao', 'Emissão') + empresa();
    case 'venda-produtos': return campo('tipo', 'Tipo de relatório', { type: 'select', col: 'col-md-3', options: [['sintetico', 'Sintético'], ['analitico', 'Analítico (por nota)']] })
      + per('emissao', 'Emissão') + campo('quantidade_min', 'Quantidade mínima', { type: 'number', col: 'col-md-2' })
      + campo('prazo_meses', 'Prazo em meses (substitui o período)', { type: 'number', col: 'col-md-3', attrs: 'min="1" max="60"' })
      + campo('sumarizacao', 'Sumarização', { type: 'select', col: 'col-md-3', options: [['produto', 'Produto'], ['grupo', 'Grupo'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['mes', 'Mês']] })
      + campo('por_embalagem', 'Por embalagem', { type: 'checkbox', col: 'col-md-2' });
    default: return '<div class="col-12 small text-muted">Este relatório não tem filtros.</div>';
  }
}

export default async function (conteudo, { params: [tipo] }) {
  const lista = await get('/api/relatorios');
  if (!tipo) {
    const pagina = titulo(conteudo, 'Relatórios', 'bi-bar-chart-line');
    pagina.innerHTML = `<div class="row g-3">${lista.map((r) => `<div class="col-md-4 col-xl-3"><a class="card h-100 text-decoration-none kpi-link" href="#/relatorios/${r.id}">
      <div class="card-body"><i class="bi bi-file-earmark-bar-graph fs-3 text-agro"></i><div class="fw-semibold mt-2">${esc(r.titulo)}</div></div></a></div>`).join('')}</div>`;
    return;
  }
  const def = lista.find((r) => r.id === tipo);
  if (!def) { conteudo.innerHTML = '<div class="vazio">Relatório não disponível para o seu perfil.</div>'; return; }
  const pagina = titulo(conteudo, def.titulo, 'bi-file-earmark-bar-graph', '<a href="#/relatorios" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left"></i> Relatórios</a>');
  pagina.innerHTML = `<div class="card mb-3 no-print"><div class="card-body"><form class="row g-2">${filtrosDe(tipo)}
    <div class="col-12 d-flex gap-2 mt-2"><button class="btn btn-success btn-sm" type="submit"><i class="bi bi-play-fill"></i> Gerar Relatório</button>
    <button class="btn btn-outline-success btn-sm" type="button" data-excel><i class="bi bi-file-earmark-excel"></i> Gerar Excel</button>
    <button class="btn btn-outline-secondary btn-sm d-none" type="button" data-print><i class="bi bi-printer"></i> Imprimir</button></div></form></div></div>
    <div id="rel-res"></div>`;
  const f = pagina.querySelector('form');
  const params = () => {
    const v = lerForm(f);
    if (v.agrupar_vendedor === 0) delete v.agrupar_vendedor;
    if (v.por_embalagem === 0) delete v.por_embalagem;
    return v;
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = pagina.querySelector('#rel-res');
    res.innerHTML = '<div class="vazio"><div class="spinner-border spinner-border-sm"></div> Gerando...</div>';
    try {
      const d = await get(`/api/relatorios/${tipo}` + qs(params()));
      res.innerHTML = desenhar(d);
      pagina.querySelector('[data-print]').classList.remove('d-none');
    } catch (err) { res.innerHTML = ''; erro(err); }
  });
  pagina.querySelector('[data-excel]').addEventListener('click', () => tentar(() => baixar(`/api/relatorios/${tipo}` + qs({ ...params(), export: 'xlsx' }), `${tipo}.xlsx`)));
  pagina.querySelector('[data-print]').addEventListener('click', () => window.print());
}

function desenhar(d) {
  if (!d.linhas.length) return '<div class="vazio">Nenhum registro para os filtros informados.</div>';
  const cols = d.colunas;
  const cel = (c, l) => `<td class="${c.t === 'money' ? 'num' : ''}">${renderCell({ ...c, t: c.t === 'money' ? 'money' : c.t }, l[c.k], l)}</td>`;
  const linhaTotal = (rot, linhas) => {
    const tot = {};
    for (const k of Object.keys(d.totais)) tot[k] = linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0);
    return `<tr class="table-light fw-semibold">${cols.map((c, i) => `<td class="${c.t === 'money' ? 'num' : ''}">${i === 0 ? esc(rot) : k(c, tot)}</td>`).join('')}</tr>`;
  };
  const k = (c, tot) => (c.k in tot ? (c.t === 'money' ? fmt.money(tot[c.k]) : fmt.num(tot[c.k])) : '');
  let corpo = '';
  if (d.agrupar) {
    const grupos = {};
    d.linhas.forEach((l) => (grupos[l[d.agrupar] ?? '—'] ||= []).push(l));
    for (const [g, ls] of Object.entries(grupos)) {
      corpo += `<tr class="table-success"><td colspan="${cols.length}" class="fw-semibold">${esc(g)} (${ls.length})</td></tr>`;
      corpo += ls.map((l) => `<tr>${cols.map((c) => cel(c, l)).join('')}</tr>`).join('');
      if (Object.keys(d.totais).length) corpo += linhaTotal(`Subtotal ${g}`, ls);
    }
  } else {
    corpo = d.linhas.map((l) => `<tr>${cols.map((c) => cel(c, l)).join('')}</tr>`).join('');
  }
  if (Object.keys(d.totais).length) corpo += linhaTotal(`TOTAL (${d.linhas.length} registros)`, d.linhas);
  return `<div class="card"><div class="card-header py-2 d-flex">${esc(d.titulo)} <small class="ms-auto text-muted">${esc(state.me.empresa.nome)} · gerado em ${fmt.datetime(d.gerado_em.replace('T', ' '))}</small></div>
    <div class="table-responsive"><table class="table table-sm table-striped mb-0 dt"><thead><tr>${cols.map((c) => `<th class="${c.t === 'money' ? 'num' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table></div></div>`;
}
