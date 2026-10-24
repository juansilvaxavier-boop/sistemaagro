// Tabelas de preço por região (UF) e safra: vigência, ajuste geral, preço por embalagem, reajuste e cópia.
import { get, post, put, del, esc, fmt, titulo, modal, campo, lerForm, toast, tentar, confirmar, erro, pedirTexto } from '../core.js';

let UFS = [];

export default async function tela(conteudo) {
  const d = await get('/api/precos/tabelas');
  UFS = d.ufs;
  const pagina = titulo(conteudo, 'Tabelas de preço', 'bi-tags', '<button class="btn btn-sm btn-success" data-nova><i class="bi bi-plus-lg"></i> Nova tabela</button>');
  pagina.innerHTML = `<p class="small text-muted">O pedido e a proposta usam a tabela vigente para a UF de entrega (a de maior prioridade). Itens sem preço próprio seguem o preço base do produto com o ajuste % da tabela. Sem tabela para a UF, vale o preço base.</p>
    ${d.tabelas.length ? `<div class="card"><div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0"><thead><tr><th>Tabela</th><th>Safra</th><th>Estados</th><th>Vigência</th><th class="num">Ajuste</th><th class="num">Preços próprios</th><th class="num">Prioridade</th><th>Situação</th><th></th></tr></thead>
    <tbody>${d.tabelas.map((t) => `<tr data-id="${t.id}" class="clicavel"><td class="fw-semibold">${esc(t.nome)}</td><td>${esc(t.safra || '—')}</td><td>${t.ufs ? esc(t.ufs.split(',').join(', ')) : 'Todo o Brasil'}</td>
      <td>${fmt.date(t.vigencia_inicio)} a ${t.vigencia_fim ? fmt.date(t.vigencia_fim) : 'sem fim'}</td><td class="num">${t.ajuste_pct > 0 ? '+' : ''}${fmt.num(t.ajuste_pct)}%</td><td class="num">${t.itens}</td><td class="num">${t.prioridade}</td>
      <td>${!t.ativa ? '<span class="badge text-bg-secondary">Inativa</span>' : t.vigente ? '<span class="badge text-bg-success">Vigente</span>' : '<span class="badge text-bg-info">Fora da vigência</span>'}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-outline-secondary py-0 px-1" data-copiar="${t.id}" title="Copiar para outra safra"><i class="bi bi-copy"></i></button>
        <button class="btn btn-sm btn-outline-danger py-0 px-1" data-ex="${t.id}" title="Excluir"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div></div>`
    : '<div class="vazio"><i class="bi bi-tags"></i>Nenhuma tabela regional. Todos os pedidos usam o preço base dos produtos.</div>'}`;
  const recarregar = () => tela(conteudo);
  conteudo.querySelector('[data-nova]').addEventListener('click', () => abrir(null, recarregar));
  pagina.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button')) abrir(Number(tr.dataset.id), recarregar); }));
  pagina.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => {
    const t = d.tabelas.find((x) => x.id === Number(b.dataset.copiar));
    modal({
      title: `Copiar "${esc(t.nome)}"`, size: 'md',
      body: `<form class="row g-2">${campo('nome', 'Nome da nova tabela', { col: 'col-12', required: true, value: `${t.nome} (nova safra)` })}
        ${campo('safra', 'Safra', { col: 'col-md-4', value: t.safra || '', attrs: 'placeholder="27/28" pattern="\\d{2}/\\d{2}"' })}
        ${campo('vigencia_inicio', 'Início da vigência', { type: 'date', col: 'col-md-4', required: true })}
        ${campo('reajuste_pct', 'Reajuste (%)', { type: 'number', col: 'col-md-4', value: 0, attrs: 'step="any"' })}</form>`,
      buttons: [{ label: 'Copiar', onClick: async ({ body }) => {
        const r = await post(`/api/precos/tabelas/${t.id}/copiar`, lerForm(body.querySelector('form')));
        toast('Tabela copiada.');
        abrir(r.id, recarregar);
      } }],
    });
  }));
  pagina.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Excluir esta tabela? Se já foi usada em pedidos, ela só é desativada.', { ok: 'Excluir', cls: 'btn-danger' }))) return;
    const r = await tentar(() => del(`/api/precos/tabelas/${b.dataset.ex}`));
    if (r) { toast(r.desativada ? 'Tabela usada em pedidos: foi desativada.' : 'Tabela excluída.'); recarregar(); }
  }));
}

async function abrir(id, aoSalvar) {
  const t = id ? await get(`/api/precos/tabelas/${id}`) : { nome: '', ufs: '', vigencia_inicio: new Date().toISOString().slice(0, 10), ajuste_pct: 0, prioridade: 0, ativa: 1, grade: (await get('/api/precos/tabelas/0')).grade };
  const ufsSel = new Set(String(t.ufs || '').split(',').filter(Boolean));
  const m = modal({
    title: id ? `Tabela ${esc(t.nome)}` : 'Nova tabela de preço', size: 'xl',
    body: `<form class="row g-2" data-cab>
      ${campo('nome', 'Nome', { col: 'col-md-5', required: true, value: t.nome })}
      ${campo('safra', 'Safra', { col: 'col-md-2', value: t.safra || '', attrs: 'placeholder="26/27" pattern="\\d{2}/\\d{2}"' })}
      ${campo('vigencia_inicio', 'Vigência de', { type: 'date', col: 'col-md-2', required: true, value: t.vigencia_inicio })}
      ${campo('vigencia_fim', 'até', { type: 'date', col: 'col-md-2', value: t.vigencia_fim || '' })}
      ${campo('prioridade', 'Prioridade', { type: 'number', col: 'col-md-1', value: t.prioridade, attrs: 'step="1"' })}
      <div class="col-12"><label class="form-label">Estados (nenhum marcado = todo o Brasil)</label><div class="d-flex flex-wrap gap-1" data-ufs>
        ${UFS.map((u) => `<input type="checkbox" class="btn-check" id="uf-${u}" value="${u}" ${ufsSel.has(u) ? 'checked' : ''}><label class="btn btn-sm btn-outline-secondary py-0" for="uf-${u}">${u}</label>`).join('')}</div></div>
      ${campo('ajuste_pct', 'Ajuste geral sobre o preço base (%)', { type: 'number', col: 'col-md-3', value: t.ajuste_pct, attrs: 'step="any"', help: 'Vale para os itens sem preço próprio.' })}
      ${campo('observacao', 'Observação', { col: 'col-md-7', value: t.observacao || '' })}
      <div class="col-md-2 d-flex align-items-end"><div class="form-check form-switch mb-1"><input class="form-check-input" type="checkbox" name="ativa" id="tp-ativa" ${t.ativa ? 'checked' : ''}><label class="form-check-label" for="tp-ativa">Ativa</label></div></div></form>
      <div class="d-flex align-items-center gap-2 mt-3 mb-1"><h6 class="mb-0">Preços por embalagem</h6>
        <input class="form-control form-control-sm w-auto ms-auto" data-busca placeholder="Filtrar produto">
        ${id ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-reajuste><i class="bi bi-percent"></i> Reajustar tudo</button>' : ''}</div>
      <div class="table-responsive" style="max-height:50vh"><table class="table table-sm align-middle"><thead class="sticky-top"><tr><th>Produto</th><th>Embalagem</th><th class="num">Custo</th><th class="num">Preço base</th>
        <th style="width:140px">Preço próprio</th><th class="num">Preço final</th><th class="num">Margem</th></tr></thead>
      <tbody>${(t.grade || []).map((g) => `<tr data-emb="${g.embalagem_id}" data-base="${g.base}" data-custo="${g.custo || 0}" data-nome="${esc(`${g.produto} ${g.grupo || ''}`.toLowerCase())}">
        <td>${esc(g.produto)}<div class="small text-muted">${esc(g.grupo || '')}</div></td><td>${esc(g.embalagem)}</td><td class="num">${fmt.money(g.custo)}</td><td class="num">${fmt.money(g.base)}</td>
        <td><input type="number" class="form-control form-control-sm text-end" min="0" step="any" value="${g.proprio ?? ''}" placeholder="pelo ajuste" aria-label="Preço próprio de ${esc(g.produto)} ${esc(g.embalagem)}"></td>
        <td class="num fw-semibold" data-final></td><td class="num" data-margem></td></tr>`).join('')}</tbody></table></div>`,
    onShow: ({ body }) => {
      const cab = body.querySelector('[data-cab]');
      const calc = () => {
        const aj = Number(cab.querySelector('[name=ajuste_pct]').value) || 0;
        body.querySelectorAll('tr[data-emb]').forEach((tr) => {
          const p = tr.querySelector('input').value;
          const fin = p !== '' ? Number(p) : Math.round(Number(tr.dataset.base) * (1 + aj / 100) * 100) / 100;
          const custo = Number(tr.dataset.custo);
          tr.querySelector('[data-final]').textContent = fmt.money(fin);
          const mg = fin > 0 && custo ? ((fin - custo) / fin) * 100 : null;
          tr.querySelector('[data-margem]').innerHTML = mg == null ? '—' : `<span class="${mg < 10 ? 'text-danger' : mg < 20 ? 'text-warning-emphasis' : 'text-success'}">${fmt.num(mg)}%</span>`;
        });
      };
      body.querySelectorAll('tr[data-emb] input, [name=ajuste_pct]').forEach((x) => x.addEventListener('input', calc));
      body.querySelector('[data-busca]').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        body.querySelectorAll('tr[data-emb]').forEach((tr) => { tr.hidden = q && !tr.dataset.nome.includes(q); });
      });
      body.querySelector('[data-reajuste]')?.addEventListener('click', async () => {
        const pct = await pedirTexto('Reajuste em % (use negativo para reduzir). Aplica nos preços próprios e no ajuste geral.', { titulo: 'Reajustar tabela' });
        if (pct && await tentar(() => post(`/api/precos/tabelas/${id}/reajustar`, { pct }), 'Tabela reajustada.')) { m.close(); abrir(id, aoSalvar); aoSalvar?.(); }
      });
      calc();
    },
    buttons: [{ label: 'Salvar tabela', onClick: async ({ body }) => {
      const cab = body.querySelector('[data-cab]');
      if (!cab.reportValidity()) return false;
      const dados = { ...lerForm(cab), ufs: [...body.querySelectorAll('[data-ufs] input:checked')].map((x) => x.value) };
      const originais = Object.fromEntries((t.grade || []).map((g) => [g.embalagem_id, g.proprio ?? '']));
      dados.itens = [...body.querySelectorAll('tr[data-emb]')].map((tr) => ({ embalagem_id: Number(tr.dataset.emb), valor: tr.querySelector('input').value }))
        .filter((x) => String(originais[x.embalagem_id] ?? '') !== x.valor);
      if (id) await put(`/api/precos/tabelas/${id}`, dados); else await post('/api/precos/tabelas', dados);
      toast('Tabela salva.');
      aoSalvar?.();
    } }],
  });
}
