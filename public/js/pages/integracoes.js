// Administração → Integrações: credenciais de APIs externas (consulta de NF-e, cotação de frete, boleto).
import { get, put, post, esc, titulo, campo, lerForm, toast, erro } from '../core.js';

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Integrações', 'bi-plug');
  const itens = await get('/api/integracoes');
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  pagina.innerHTML = `<div class="vstack gap-3">${grupos.map((g) => `
    <div><h6 class="text-body-secondary text-uppercase small mb-2">${esc(g)}</h6>
      <div class="row g-3">${itens.filter((i) => i.grupo === g).map(cartao).join('')}</div></div>`).join('')}</div>`;

  for (const item of itens) {
    const card = pagina.querySelector(`[data-card="${item.chave}"]`);
    const form = card.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = lerForm(form);
      const valores = Object.fromEntries(item.campos.map((f) => [f.nome, dados[f.nome]]));
      try {
        const atualizado = await put(`/api/integracoes/${item.chave}`, { ativo: !!dados.ativo, ambiente: dados.ambiente, valores });
        toast('Integração salva.');
        atualizarStatus(card, atualizado);
      } catch (err) { erro(err); }
    });
    card.querySelector('[data-testar]').addEventListener('click', async () => {
      try {
        const r = await post(`/api/integracoes/${item.chave}/testar`, {});
        toast(r.mensagem);
      } catch (err) { erro(err); }
    });
  }
}

function cartao(item) {
  return `<div class="col-lg-6"><div class="card h-100" data-card="${item.chave}"><div class="card-header d-flex align-items-center gap-2">
      <i class="bi bi-cloud-arrow-down-fill"></i> <span class="flex-grow-1">${esc(item.nome)}</span>
      ${badgeStatus(item)}</div>
    <div class="card-body">
      <p class="small text-body-secondary">${esc(item.descricao)}</p>
      <form class="vstack gap-2">
        <div class="row g-2">
          ${campo('ativo', 'Ativa', { type: 'checkbox', col: 'col-6', value: item.ativo })}
          ${campo('ambiente', 'Ambiente', { type: 'select', col: 'col-6', options: [['homologacao', 'Homologação'], ['producao', 'Produção']], value: item.ambiente })}
        </div>
        <div class="row g-2">
          ${item.campos.map((f) => campo(f.nome, f.rotulo, {
            type: f.tipo === 'senha' ? 'password' : f.tipo === 'texto_longo' ? 'textarea' : 'text',
            col: 'col-12', value: item.valores[f.nome] || '', attrs: f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
          })).join('')}
        </div>
        <div class="d-flex gap-2 pt-2">
          <button class="btn btn-sm btn-success"><i class="bi bi-check2"></i> Salvar</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-testar><i class="bi bi-plug"></i> Testar conexão</button>
        </div>
        ${item.status_mensagem ? `<div class="form-text" data-status-msg>${esc(item.status_mensagem)}</div>` : ''}
      </form>
    </div></div></div>`;
}

function badgeStatus(item) {
  if (!item.ativo) return '<span class="badge text-bg-secondary">Inativa</span>';
  if (item.status === 'ok') return '<span class="badge text-bg-success">Conectada</span>';
  if (item.status === 'erro') return '<span class="badge text-bg-danger">Erro</span>';
  return '<span class="badge text-bg-warning">Pendente</span>';
}

function atualizarStatus(card, item) {
  card.querySelector('.card-header').lastElementChild.outerHTML = badgeStatus(item);
}
