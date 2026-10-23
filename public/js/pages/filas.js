import { DataTable, state, titulo, abas, pode, fmt, esc } from '../core.js';
import { abrirPedido } from './pedido-detalhe.js';

const C = {
  numero: { k: 'numero', l: 'Nº Pedido' },
  data: { k: 'data', l: 'Data', t: 'datetime' },
  documento: { k: 'documento', l: 'Documento', t: 'doc' },
  cliente: { k: 'cliente', l: 'Cliente', render: (v, r) => `${esc(v)}${r.blacklist ? ` <i class="bi bi-shield-exclamation text-${r.blacklist === 'bloqueio' ? 'danger' : 'warning'}" title="Blacklist: ${r.blacklist}"></i>` : ''}${r.mensagens ? ` <i class="bi bi-chat-dots text-primary" title="${r.mensagens} mensagens"></i>` : ''}` },
  forma: { k: 'forma', l: 'Forma Pgto' },
  condicao: { k: 'condicao', l: 'Condição' },
  valor: { k: 'valor', l: 'Valor', t: 'money' },
  vendedor: { k: 'vendedor', l: 'Vendedor' },
  supervisor: { k: 'supervisor', l: 'Supervisor' },
  analista: { k: 'analista', l: 'Analista' },
  equipe: { k: 'equipe', l: 'Equipe' },
  uf: { k: 'uf', l: 'UF' },
  cidade: { k: 'cidade', l: 'Cidade' },
  nota: { k: 'nota', l: 'Nº Nota' },
  dias: { k: 'dias_etapa', l: 'Dias na fila', t: 'num', render: (v) => `<span class="badge text-bg-${v > 3 ? 'danger' : v > 1 ? 'warning' : 'light'}">${v}</span>` },
  chegada: { k: 'data_chegada_producao', l: 'Chegou na produção', t: 'datetime' },
  prazo: { k: 'prazo_producao', l: 'Prazo produção', t: 'date', render: (v) => (v && v < new Date().toISOString().slice(0, 10) ? `<span class="text-danger fw-semibold">${fmt.date(v)}</span>` : fmt.date(v)) },
  transportadora: { k: 'transportadora', l: 'Transportadora' },
  embarque: { k: 'data_embarque', l: 'Embarque', t: 'date' },
  prevista: { k: 'data_entrega_prevista', l: 'Entrega prevista', t: 'date' },
  entrega: { k: 'data_entrega', l: 'Entregue em', t: 'date' },
  etapa: { k: 'etapa', l: 'Etapa', t: 'etapa' },
  desde: { k: 'etapa_desde', l: 'Na etapa desde', t: 'datetime' },
};

const COLUNAS = {
  venda: ['numero', 'data', 'documento', 'cliente', 'forma', 'condicao', 'valor', 'vendedor', 'analista', 'dias'],
  supervisao: ['numero', 'data', 'documento', 'cliente', 'forma', 'condicao', 'valor', 'vendedor', 'equipe', 'analista', 'dias'],
  analise: ['numero', 'data', 'documento', 'cliente', 'uf', 'forma', 'condicao', 'valor', 'vendedor', 'supervisor', 'analista', 'dias'],
  diretoria: ['numero', 'data', 'documento', 'cliente', 'uf', 'forma', 'condicao', 'valor', 'vendedor', 'supervisor', 'analista', 'dias'],
  cobranca: ['numero', 'data', 'documento', 'cliente', 'forma', 'condicao', 'valor', 'vendedor', 'dias'],
  producao: ['numero', 'documento', 'cliente', 'uf', 'vendedor', 'chegada', 'prazo', 'dias'],
  faturamento: ['numero', 'data', 'documento', 'cliente', 'cidade', 'uf', 'forma', 'valor', 'vendedor', 'nota', 'dias'],
  expedicao: ['numero', 'nota', 'cliente', 'cidade', 'uf', 'prazo', 'supervisor', 'transportadora', 'embarque', 'prevista', 'dias'],
  transito: ['numero', 'nota', 'cliente', 'cidade', 'uf', 'transportadora', 'embarque', 'prevista', 'entrega'],
  devolucao: ['numero', 'nota', 'cliente', 'valor', 'vendedor', 'desde'],
};
const PROGRESSAO = ['numero', 'data', 'documento', 'cliente', 'valor', 'vendedor', 'supervisor', 'etapa', 'desde', 'nota'];

export default async function (conteudo, { params: [etapa] }) {
  const info = state.me.etapas[etapa];
  if (!info) { conteudo.innerHTML = '<div class="vazio">Etapa inválida.</div>'; return; }
  const extra = etapa === 'venda' && pode('pedido.criar') ? '<a href="#/pedido/novo" class="btn btn-success btn-sm"><i class="bi bi-plus-lg"></i> Novo pedido</a>' : '';
  const pagina = titulo(conteudo, info.label, info.icone, extra);
  const listaAbas = etapa === 'transito'
    ? [{ id: 'pedidos', label: 'Pedidos em trânsito', html: '<div id="t-pedidos"></div>' }, { id: 'entregues', label: 'Pedidos entregues', html: '<div id="t-entregues"></div>' }]
    : [{ id: 'pedidos', label: 'Pedidos', html: '<div id="t-pedidos"></div>' }];
  listaAbas.push({ id: 'prog', label: 'Progressão dos Pedidos', html: '<div id="t-prog"></div>' });
  pagina.innerHTML = abas(listaAbas, 'fila');

  const tabelas = [];
  const abrir = (r) => abrirPedido(r.id, () => tabelas.forEach((t) => t.reload()));
  const cols = (COLUNAS[etapa] || COLUNAS.venda).map((k) => C[k]);
  tabelas.push(new DataTable(pagina.querySelector('#t-pedidos'), {
    url: `/api/pedidos/fila/${etapa}`, columns: cols, rowClick: abrir, title: `Fila ${info.label}`, sort: 'etapa_desde', dir: 'asc',
  }));
  if (etapa === 'transito') {
    tabelas.push(new DataTable(pagina.querySelector('#t-entregues'), {
      url: '/api/pedidos/fila/transito?aba=entregues', columns: cols, rowClick: abrir, title: 'Pedidos entregues', sort: 'data_entrega', dir: 'desc',
    }));
  }
  const etapas = Object.entries(state.me.etapas).map(([k, v]) => [k, v.label]);
  tabelas.push(new DataTable(pagina.querySelector('#t-prog'), {
    url: '/api/pedidos/progressao',
    columns: PROGRESSAO.map((k) => (k === 'etapa' ? { ...C.etapa, filter: { options: etapas } } : C[k])),
    rowClick: abrir, title: 'Progressão dos Pedidos', sort: 'numero', dir: 'desc',
  }));

  const onAtualizar = () => { if (document.body.contains(pagina)) tabelas.forEach((t) => t.reload()); else window.removeEventListener('pedido-atualizado', onAtualizar); };
  window.addEventListener('pedido-atualizado', onAtualizar);

  const abrirId = new URLSearchParams(location.hash.split('?')[1] || '').get('abrir');
  if (abrirId) abrir({ id: Number(abrirId) });
}
