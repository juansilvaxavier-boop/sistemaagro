// Metas mensais (empresa, equipes e vendedores), ranking e campanhas de vendas.
import { get, post, put, del, esc, fmt, titulo, modal, campo, opcoes, lerForm, toast, tentar, state, pode, confirmar, erro } from '../core.js';

const IND = ['valor', 'volume', 'pedidos', 'clientes_novos'];
const ROT = { valor: 'Valor vendido', volume: 'Volume (kg/L)', pedidos: 'Pedidos', clientes_novos: 'Clientes novos' };
const mesAtual = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 7);
const nomeMes = (p) => new Date(`${p}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const nomeMesTitulo = (p) => { const t = nomeMes(p); return t.charAt(0).toUpperCase() + t.slice(1); };
const somaMes = (p, n) => { const d = new Date(`${p}-15T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const vInd = (k, v) => (v == null ? '—' : k === 'valor' ? fmt.money(v) : fmt.num(v));
const corPct = (p) => (p == null ? 'secondary' : p >= 100 ? 'success' : p >= 70 ? 'warning' : 'danger');

function barra(pct, proj) {
  if (pct == null) return '<span class="text-muted small">sem meta</span>';
  const w = Math.min(100, pct);
  return `<div class="meta-barra" title="${fmt.num(pct)}% realizado${proj != null ? ` · projeção ${fmt.num(proj)}%` : ''}">
    <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar bg-${corPct(pct)}" style="width:${w}%"></div>
      ${proj != null && proj > pct ? `<div class="meta-proj" style="left:${Math.min(100, proj)}%"></div>` : ''}</div>
    <span class="small fw-semibold">${fmt.num(pct)}%</span></div>`;
}

export default async function (conteudo, { params }) {
  const aba = params?.[0];
  if (aba === 'campanhas') return campanhas(conteudo);
  if (aba === 'ranking') return ranking(conteudo);
  return metas(conteudo);
}

async function metas(conteudo, periodo = mesAtual()) {
  const d = await get(`/api/metas?periodo=${periodo}`);
  const pagina = titulo(conteudo, 'Metas', 'bi-bullseye', `
    <div class="input-group input-group-sm w-auto"><button class="btn btn-outline-secondary" data-mes="-1" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
      <span class="input-group-text" style="min-width:150px;justify-content:center">${nomeMesTitulo(periodo)}</span>
      <button class="btn btn-outline-secondary" data-mes="1" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button></div>
    ${d.pode_gerir ? '<button class="btn btn-sm btn-outline-secondary" data-copiar><i class="bi bi-copy"></i> Copiar do mês anterior</button><button class="btn btn-sm btn-success" data-editar><i class="bi bi-pencil"></i> Definir metas</button>' : ''}`);
  const fr = d.fracao_mes;
  const proj = (l, k) => (l.meta[k] && fr > 0 && fr < 1 ? (l.projecao[k] / l.meta[k]) * 100 : null);
  const grupos = [['empresa', 'Empresa'], ['equipe', 'Equipes'], ['vendedor', 'Vendedores']];
  pagina.innerHTML = `${fr > 0 && fr < 1 ? `<p class="small text-muted">${fmt.num(fr * 100)}% do mês decorrido. A marca na barra é a projeção de fechamento no ritmo atual.</p>` : ''}
    ${grupos.map(([g, rot]) => {
      const ls = d.linhas.filter((l) => l.escopo === g);
      if (!ls.length) return '';
      return `<div class="card mb-3"><div class="card-header">${rot}</div><div class="table-responsive"><table class="table table-sm align-middle mb-0 tabela-metas"><thead><tr><th>Nome</th>
        ${IND.map((k) => `<th>${ROT[k]}</th>`).join('')}</tr></thead><tbody>
        ${ls.map((l) => `<tr><td class="fw-semibold">${esc(l.nome)}${l.equipe ? `<div class="small text-muted fw-normal">${esc(l.equipe)}</div>` : ''}</td>
          ${IND.map((k) => `<td><div class="small">${vInd(k, l.realizado[k])}${l.meta[k] ? ` <span class="text-muted">de ${vInd(k, l.meta[k])}</span>` : ''}</div>${l.meta[k] ? barra(l.pct[k], proj(l, k)) : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
    }).join('') || '<div class="vazio"><i class="bi bi-bullseye"></i>Nenhuma meta para mostrar.</div>'}`;
  conteudo.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => metas(conteudo, somaMes(periodo, Number(b.dataset.mes))).catch(erro)));
  conteudo.querySelector('[data-copiar]')?.addEventListener('click', () => modal({
    title: `Copiar metas para ${nomeMes(periodo)}`, size: 'md',
    body: `<form class="row g-2">${campo('reajuste_pct', 'Reajuste sobre o mês anterior (%)', { type: 'number', col: 'col-12', value: 0, attrs: 'step="any"' })}
      <div class="col-12 small text-muted">Copia as metas de ${nomeMes(somaMes(periodo, -1))}. Metas já definidas neste mês ficam como estão.</div></form>`,
    buttons: [{ label: 'Copiar', onClick: async ({ body }) => {
      const r = await post('/api/metas/copiar', { de: somaMes(periodo, -1), para: periodo, reajuste_pct: lerForm(body.querySelector('form')).reajuste_pct });
      toast(`${r.copiadas} meta(s) copiada(s).`);
      metas(conteudo, periodo);
    } }],
  }));
  conteudo.querySelector('[data-editar]')?.addEventListener('click', () => editar(d, () => metas(conteudo, periodo)));
}

function editar(d, aoSalvar) {
  const linhas = d.linhas;
  modal({
    title: `Metas de ${nomeMes(d.periodo)}`, size: 'xl',
    body: `<p class="small text-muted">Deixe em branco para não ter meta. A meta da equipe é independente da soma dos vendedores.</p>
      <div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Nome</th>${IND.map((k) => `<th style="min-width:130px">${ROT[k]}</th>`).join('')}</tr></thead><tbody>
      ${linhas.map((l, i) => `<tr data-i="${i}"><td>${l.escopo === 'empresa' ? '<b>Empresa</b>' : l.escopo === 'equipe' ? `<b>${esc(l.nome)}</b> <span class="small text-muted">(equipe)</span>` : esc(l.nome)}</td>
        ${IND.map((k) => `<td><input type="number" class="form-control form-control-sm text-end" data-k="${k}" min="0" step="any" value="${l.meta[k] ?? ''}" aria-label="${ROT[k]} de ${esc(l.nome)}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`,
    buttons: [{ label: 'Salvar metas', onClick: async ({ body }) => {
      const lista = [];
      body.querySelectorAll('tr[data-i]').forEach((tr) => {
        const l = linhas[tr.dataset.i];
        tr.querySelectorAll('[data-k]').forEach((x) => {
          const atual = l.meta[x.dataset.k] ?? '';
          if (String(atual) !== x.value) lista.push({ escopo: l.escopo, alvo_id: l.alvo_id, indicador: x.dataset.k, meta: x.value });
        });
      });
      if (lista.length) await put('/api/metas', { periodo: d.periodo, metas: lista });
      toast('Metas salvas.');
      aoSalvar?.();
    } }],
  });
}

async function ranking(conteudo, periodo = mesAtual()) {
  const rows = await get(`/api/metas/ranking?periodo=${periodo}`);
  const pagina = titulo(conteudo, 'Ranking de vendas', 'bi-trophy', `
    <div class="input-group input-group-sm w-auto"><button class="btn btn-outline-secondary" data-mes="-1" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
      <span class="input-group-text" style="min-width:150px;justify-content:center">${nomeMesTitulo(periodo)}</span>
      <button class="btn btn-outline-secondary" data-mes="1" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button></div>`);
  const medalha = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : p);
  pagina.innerHTML = rows.length ? `<div class="card"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th style="width:60px">#</th><th>Vendedor</th><th>Equipe</th><th style="min-width:220px">Meta de valor</th><th class="num">Vendido</th><th class="num">Pedidos</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.eu ? 'table-success' : ''}"><td class="fs-5">${medalha(r.posicao)}</td><td class="fw-semibold">${esc(r.nome)}${r.eu ? ' <span class="badge text-bg-success">você</span>' : ''}</td>
      <td>${esc(r.equipe || '—')}</td><td>${barra(r.pct)}</td><td class="num">${r.valor == null ? '<span class="text-muted">—</span>' : fmt.money(r.valor)}</td><td class="num">${r.pedidos ?? '—'}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small text-muted mt-2">Ordenado pelo % da meta de valor do mês (sem meta, pelo valor vendido). Dos colegas fora da sua abrangência aparece só o percentual.</p>`
    : '<div class="vazio"><i class="bi bi-trophy"></i>Ainda não há vendas nem metas neste mês.</div>';
  conteudo.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => ranking(conteudo, somaMes(periodo, Number(b.dataset.mes))).catch(erro)));
}

async function campanhas(conteudo) {
  const lista = await get('/api/metas/campanhas');
  const gerir = pode('metas.gerir');
  const pagina = titulo(conteudo, 'Campanhas de vendas', 'bi-megaphone', gerir ? '<button class="btn btn-sm btn-success" data-nova><i class="bi bi-plus-lg"></i> Nova campanha</button>' : '');
  const SIT = { andamento: ['Em andamento', 'success'], futura: ['Começa em breve', 'info'], encerrada: ['Encerrada', 'secondary'] };
  pagina.innerHTML = lista.length ? `<div class="row g-3">${lista.map((c) => `<div class="col-lg-6"><div class="card h-100"><div class="card-header d-flex gap-2 align-items-start">
      <div class="flex-grow-1"><div class="fw-semibold">${esc(c.nome)}</div><div class="small text-muted">${fmt.date(c.inicio)} a ${fmt.date(c.fim)} · ${ROT[c.indicador]}${c.produto ? ` · ${esc(c.produto)}` : c.grupo ? ` · ${esc(c.grupo)}` : ''}${c.equipe ? ` · ${esc(c.equipe)}` : ''}</div></div>
      <span class="badge text-bg-${SIT[c.situacao][1]}">${SIT[c.situacao][0]}</span>
      ${gerir ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" data-ed="${c.id}" title="Editar"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger py-0 px-1" data-ex="${c.id}" title="Excluir"><i class="bi bi-trash"></i></button>` : ''}</div>
    <div class="card-body">
      ${c.descricao ? `<p class="small">${esc(c.descricao)}</p>` : ''}
      <div class="d-flex gap-3 small mb-2">${c.meta_individual ? `<span><i class="bi bi-flag"></i> Meta individual <b>${vInd(c.indicador, c.meta_individual)}</b></span>` : ''}${c.premio ? `<span><i class="bi bi-gift"></i> ${esc(c.premio)}</span>` : ''}</div>
      <table class="table table-sm mb-0"><tbody>${c.placar.slice(0, 10).map((p) => `<tr class="${p.eu ? 'table-success' : ''}"><td style="width:36px">${p.posicao}º</td><td>${esc(p.nome)}${p.atingiu ? ' <i class="bi bi-check-circle-fill text-success" title="Bateu a meta"></i>' : ''}</td>
        <td style="width:45%">${c.meta_individual ? barra(p.pct) : ''}</td><td class="num">${p.realizado == null ? '—' : vInd(c.indicador, p.realizado)}</td></tr>`).join('')}</tbody></table>
      ${c.placar.length > 10 ? `<div class="small text-muted">+ ${c.placar.length - 10} participantes</div>` : ''}
    </div></div></div>`).join('')}</div>` : '<div class="vazio"><i class="bi bi-megaphone"></i>Nenhuma campanha ativa.</div>';
  const recarregar = () => campanhas(conteudo);
  conteudo.querySelector('[data-nova]')?.addEventListener('click', () => formCampanha(null, recarregar));
  pagina.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => formCampanha(lista.find((c) => c.id === Number(b.dataset.ed)), recarregar)));
  pagina.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmar('Excluir esta campanha?', { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/metas/campanhas/${b.dataset.ex}`), 'Campanha excluída.')) recarregar();
  }));
}

function formCampanha(c, aoSalvar) {
  const o = state.opcoes;
  const hoje = new Date().toISOString().slice(0, 10);
  const v = c || { indicador: 'valor', inicio: hoje, fim: hoje };
  modal({
    title: c ? 'Editar campanha' : 'Nova campanha', size: 'lg',
    body: `<form class="row g-2">
      ${campo('nome', 'Nome', { col: 'col-md-8', required: true, value: v.nome || '' })}
      ${campo('indicador', 'Medir por', { type: 'select', col: 'col-md-4', value: v.indicador, options: IND.map((k) => [k, ROT[k]]) })}
      ${campo('inicio', 'Início', { type: 'date', col: 'col-md-3', required: true, value: v.inicio })}
      ${campo('fim', 'Fim', { type: 'date', col: 'col-md-3', required: true, value: v.fim })}
      ${campo('meta_individual', 'Meta por vendedor', { type: 'number', col: 'col-md-3', value: v.meta_individual || '', attrs: 'min="0" step="any"' })}
      ${campo('equipe_id', 'Só a equipe', { type: 'select', col: 'col-md-3', value: v.equipe_id || '', options: opcoes(o.equipes, 'Todas') })}
      ${campo('produto_id', 'Produto da campanha', { type: 'select', col: 'col-md-6', value: v.produto_id || '', options: opcoes(o.produtos, 'Todos os produtos') })}
      ${campo('grupo_id', 'ou grupo de produtos', { type: 'select', col: 'col-md-6', value: v.grupo_id || '', options: opcoes(o.grupos, 'Todos os grupos') })}
      ${campo('premio', 'Prêmio', { col: 'col-12', value: v.premio || '' })}
      ${campo('descricao', 'Regras e descrição', { type: 'textarea', col: 'col-12', value: v.descricao || '' })}</form>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const d = lerForm(body.querySelector('form'));
      if (c) await put(`/api/metas/campanhas/${c.id}`, d); else await post('/api/metas/campanhas', d);
      toast('Campanha salva.');
      aoSalvar?.();
    } }],
  });
}
