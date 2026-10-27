// RH → Feriados: nacionais calculados pelo sistema e os cadastrados pela empresa (estaduais, municipais, da empresa).
// Em cada um a empresa decide se é folga ou dia normal; o ponto não cobra horas nos dias de folga.
import { get, post, put, del, esc, fmt, titulo, modal, campo, lerForm, toast, tentar, pode, confirmar } from '../core.js';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const COR = { nacional: 'success', facultativo: 'warning', estadual: 'primary', municipal: 'info', empresa: 'secondary' };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

export default async function feriados(conteudo, { ano } = {}) {
  const gere = pode('rh.gerir');
  const a = ano || Number(hoje().slice(0, 4));
  const pagina = titulo(conteudo, 'Feriados', 'bi-calendar-event', `<div class="btn-group btn-group-sm" role="group" aria-label="Ano">
      <button class="btn btn-outline-secondary" data-ano="${a - 1}" aria-label="Ano anterior"><i class="bi bi-chevron-left"></i></button>
      <span class="btn btn-outline-secondary disabled fw-semibold" aria-live="polite">${a}</span>
      <button class="btn btn-outline-secondary" data-ano="${a + 1}" aria-label="Próximo ano"><i class="bi bi-chevron-right"></i></button></div>
    ${gere ? '<button class="btn btn-sm btn-success" id="fe-novo"><i class="bi bi-plus-lg"></i> Adicionar feriado</button>' : ''}`);
  const d = await get(`/api/rh/feriados?ano=${a}`);
  const lista = d.feriados;
  const folgas = lista.filter((f) => f.folga && new Date(`${f.data}T12:00:00Z`).getUTCDay() % 6 !== 0).length;
  const h = hoje();
  const proximo = lista.find((f) => f.folga && f.data >= h);
  pagina.innerHTML = `<div class="alert alert-light border small d-flex gap-2 align-items-start"><i class="bi bi-info-circle"></i><div>
      Os <b>nacionais</b> já vêm do sistema (incluindo Carnaval, Sexta-feira Santa e Corpus Christi, que mudam de data todo ano). Cadastre os <b>estaduais</b> e
      <b>municipais</b> da cidade da empresa. Em cada feriado, marque se é <b>folga</b>: nesses dias o ponto não cobra horas, o que for trabalhado vira crédito
      no banco de horas e ninguém recebe lembrete de marcação.</div></div>
    <div class="d-flex gap-3 flex-wrap small text-body-secondary mb-2"><span><b class="text-body">${folgas}</b> folgas em dias úteis em ${a}</span>
      ${proximo ? `<span>Próxima folga: <b class="text-body">${fmt.date(proximo.data)} · ${esc(proximo.nome)}</b></span>` : ''}</div>
    <div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr><th>Data</th><th>Dia</th><th>Feriado</th><th>Tipo</th><th>Folga</th><th></th></tr></thead>
      <tbody>${lista.map((f) => {
        const dow = new Date(`${f.data}T12:00:00Z`).getUTCDay();
        const passado = f.data < h;
        return `<tr class="${passado ? 'text-body-secondary' : ''}">
          <td class="text-nowrap">${fmt.date(f.data)}</td><td>${DIAS[dow]}${dow % 6 === 0 ? ' <span class="badge text-bg-light">fim de semana</span>' : ''}</td>
          <td>${esc(f.nome)}${f.anual ? ' <i class="bi bi-arrow-repeat text-body-secondary" title="Repete todo ano"></i>' : ''}${f.empresa_id === null && f.origem === 'cadastro' ? ' <span class="badge text-bg-light">todas as empresas</span>' : ''}</td>
          <td><span class="badge text-bg-${COR[f.tipo] || 'secondary'}">${esc(d.tipos[f.tipo] || f.tipo)}</span>${f.origem === 'ajuste' ? ' <span class="badge text-bg-light" title="A empresa mudou a regra padrão">ajustado</span>' : ''}</td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" data-folga="${f.data}" data-id="${f.origem === 'cadastro' ? f.id : ''}"
            ${f.folga ? 'checked' : ''} ${gere ? '' : 'disabled'} aria-label="Folga em ${esc(f.nome)}"></div></td>
          <td class="text-end text-nowrap">${gere && f.origem === 'cadastro' ? `<button class="btn btn-sm btn-outline-secondary py-0" data-editar="${f.id}" aria-label="Editar ${esc(f.nome)}"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-danger py-0" data-remover="${f.id}" aria-label="Remover ${esc(f.nome)}"><i class="bi bi-trash"></i></button>` : ''}
            ${gere && f.origem === 'ajuste' ? `<button class="btn btn-sm btn-link py-0" data-remover="${f.id}" title="Voltar à regra padrão">desfazer</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div></div></div>`;

  const recarregar = () => feriados(conteudo, { ano: a });
  conteudo.querySelectorAll('[data-ano]').forEach((b) => b.addEventListener('click', () => feriados(conteudo, { ano: Number(b.dataset.ano) })));
  conteudo.querySelector('#fe-novo')?.addEventListener('click', () => editar(null, a, recarregar));
  pagina.querySelectorAll('[data-folga]').forEach((sw) => sw.addEventListener('change', async () => {
    const f = lista.find((x) => x.data === sw.dataset.folga);
    const ok = await tentar(() => (f.origem === 'cadastro' ? put(`/api/rh/feriados/${f.id}`, { folga: sw.checked }) : post('/api/rh/feriados/decisao', { data: f.data, folga: sw.checked })),
      sw.checked ? `${f.nome}: dia de folga.` : `${f.nome}: dia normal de trabalho.`);
    if (!ok) sw.checked = !sw.checked;
    recarregar();
  }));
  pagina.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editar(lista.find((x) => x.id === Number(b.dataset.editar) && x.origem === 'cadastro'), a, recarregar)));
  pagina.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Remover este feriado? O espelho de ponto do dia volta a cobrar as horas normais.', { titulo: 'Remover feriado', ok: 'Remover', cls: 'btn-danger' }))) return;
    if (await tentar(() => del(`/api/rh/feriados/${b.dataset.remover}`), 'Feriado removido.')) recarregar();
  }));
}

function editar(f, ano, aoSalvar) {
  modal({
    title: `<i class="bi bi-calendar-event"></i> ${f ? 'Editar feriado' : 'Adicionar feriado'}`, size: 'md',
    body: `<form class="row g-2">
      ${campo('data', 'Data', { type: 'date', col: 'col-6', required: true, value: f?.data || `${ano}-01-01` })}
      ${campo('tipo', 'Tipo', { type: 'select', col: 'col-6', required: true, value: f?.tipo || 'municipal',
    options: [['municipal', 'Municipal'], ['estadual', 'Estadual'], ['empresa', 'Da empresa (ex.: aniversário da empresa)'], ['facultativo', 'Ponto facultativo']] })}
      ${campo('nome', 'Nome', { col: 'col-12', required: true, value: f?.nome || '', attrs: 'maxlength="100" placeholder="Ex.: Aniversário de Rio Verde"' })}
      ${campo('anual', 'Repete todo ano na mesma data', { type: 'checkbox', col: 'col-12', value: f ? f.anual : 1 })}
      ${campo('folga', 'É dia de folga (o ponto não cobra horas)', { type: 'checkbox', col: 'col-12', value: f ? f.folga : 1 })}
      ${f ? '' : campo('todas_empresas', 'Vale para todas as empresas do grupo', { type: 'checkbox', col: 'col-12' })}</form>
      <div class="form-text">Feriado que muda de data todo ano (ex.: padroeira em dia móvel) deve ser cadastrado sem "repete todo ano".</div>`,
    buttons: [{ label: 'Salvar', onClick: async ({ body }) => {
      const b = lerForm(body.querySelector('form'));
      if (f) await put(`/api/rh/feriados/${f.id}`, b);
      else await post('/api/rh/feriados', b);
      toast('Feriado salvo.');
      aoSalvar?.();
    } }],
  });
}
