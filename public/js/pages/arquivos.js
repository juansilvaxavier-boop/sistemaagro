// Arquivos e documentos vinculados ao cliente e ao pedido.
import { get, api, del, esc, fmt, titulo, DataTable, btnAcao, toast, erro, tentar, confirmar, baixar, modal, buscaCliente, state } from '../core.js';

let config;
const carregarConfig = async () => (config ||= await get('/api/arquivos/categorias'));
const tamanho = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const icone = (mime = '', nome = '') => (mime.includes('pdf') ? 'bi-file-earmark-pdf text-danger' : mime.startsWith('image/') ? 'bi-file-earmark-image text-primary'
  : /xls|sheet|csv/.test(mime + nome) ? 'bi-file-earmark-excel text-success' : /word|doc/.test(mime + nome) ? 'bi-file-earmark-word text-primary' : 'bi-file-earmark');

async function enviar(arquivos, vinculo, categoria, descricao) {
  const fd = new FormData();
  for (const f of arquivos) fd.append('arquivos', f);
  if (vinculo.cliente_id) fd.append('cliente_id', vinculo.cliente_id);
  if (vinculo.pedido_id) fd.append('pedido_id', vinculo.pedido_id);
  if (vinculo.pedido_numero) fd.append('pedido_numero', vinculo.pedido_numero);
  fd.append('categoria', categoria);
  if (descricao) fd.append('descricao', descricao);
  return api('/api/arquivos', { method: 'POST', body: fd });
}

function formUpload(cfg) {
  return `<div class="row g-2 mb-2">
    <div class="col-md-4"><label class="form-label">Categoria</label><select class="form-select form-select-sm" data-cat>${cfg.categorias.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="col-md-8"><label class="form-label">Descrição</label><input class="form-control form-control-sm" data-desc placeholder="Ex.: contrato de compra safra 26/27"></div></div>
    <label class="dropzone d-block" data-drop><i class="bi bi-cloud-arrow-up fs-3 d-block"></i>Arraste arquivos aqui ou clique para selecionar
      <div class="small">Até ${cfg.max_mb} MB · ${cfg.extensoes.join(' ')}</div><input type="file" multiple hidden data-file accept="${cfg.extensoes.join(',')}"></label>`;
}

function ligarUpload(el, obterVinculo, aoEnviar) {
  const drop = el.querySelector('[data-drop]');
  const input = el.querySelector('[data-file]');
  const subir = async (files) => {
    if (!files.length) return;
    const v = obterVinculo();
    if (!v) return;
    drop.classList.add('opacity-50');
    try {
      await enviar(files, v, el.querySelector('[data-cat]').value, el.querySelector('[data-desc]').value);
      toast(`${files.length} arquivo(s) enviado(s).`);
      el.querySelector('[data-desc]').value = '';
      aoEnviar?.();
    } catch (e) { erro(e); } finally { drop.classList.remove('opacity-50'); input.value = ''; }
  };
  input.addEventListener('change', () => subir([...input.files]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); subir([...e.dataTransfer.files]); });
}

const podeExcluir = (a) => a.usuario === state.me.usuario.nome || ['admin', 'diretoria'].includes(state.me.usuario.perfil);

function acoesArquivo(a) {
  const ver = /pdf|image/.test(a.mime || '') ? btnAcao('ver', 'bi-eye', 'Visualizar') : '';
  return `${ver} ${btnAcao('baixar', 'bi-download', 'Baixar')} ${podeExcluir(a) ? btnAcao('excluir', 'bi-trash', 'Excluir', 'outline-danger') : ''}`;
}
const acoesHandlers = (recarregar) => ({
  ver: (a) => window.open(`/api/arquivos/${a.id}/download?inline=1`, '_blank', 'noopener'),
  baixar: (a) => tentar(() => baixar(`/api/arquivos/${a.id}/download`, a.nome_original)),
  excluir: async (a) => {
    if (await confirmar(`Excluir o arquivo <b>${esc(a.nome_original)}</b>?`, { ok: 'Excluir', cls: 'btn-danger' }) && await tentar(() => del(`/api/arquivos/${a.id}`), 'Arquivo excluído.')) recarregar();
  },
});

/** Painel compacto para usar dentro das janelas de cliente e de pedido. */
export async function painelArquivos(el, vinculo) {
  const cfg = await carregarConfig();
  el.innerHTML = `${formUpload(cfg)}<div class="mt-3" data-lista></div>`;
  const listar = async () => {
    const d = await get(`/api/arquivos?all=1&${vinculo.pedido_id ? 'pedido_id=' + vinculo.pedido_id : 'cliente_id=' + vinculo.cliente_id}`);
    const box = el.querySelector('[data-lista]');
    box.innerHTML = d.rows.length ? `<ul class="list-group">${d.rows.map((a, i) => `<li class="list-group-item d-flex align-items-center gap-2 small" data-i="${i}">
      <i class="bi ${icone(a.mime, a.nome_original)} fs-5"></i><div class="flex-grow-1"><div class="fw-semibold">${esc(a.nome_original)}</div>
      <div class="text-muted">${esc(a.categoria)}${a.descricao ? ' · ' + esc(a.descricao) : ''}${a.pedido ? ' · Pedido ' + a.pedido : ''} · ${tamanho(a.tamanho)} · ${esc(a.usuario || '')} em ${fmt.datetime(a.created_at)}</div></div>
      <div class="text-nowrap">${acoesArquivo(a)}</div></li>`).join('')}</ul>` : '<div class="vazio py-3">Nenhum arquivo.</div>';
    const h = acoesHandlers(listar);
    box.querySelectorAll('li[data-i]').forEach((li) => li.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', () => h[b.dataset.acao](d.rows[li.dataset.i]))));
  };
  ligarUpload(el, () => vinculo, listar);
  listar();
}

export default async function (conteudo) {
  const pagina = titulo(conteudo, 'Arquivos e Documentos', 'bi-folder2-open', '<button class="btn btn-success btn-sm" id="btn-up"><i class="bi bi-cloud-arrow-up"></i> Enviar arquivo</button>');
  const cfg = await carregarConfig();
  const t = new DataTable(pagina, {
    url: '/api/arquivos', title: 'Arquivos', sort: 'created_at', dir: 'desc',
    columns: [
      { k: 'nome_original', l: 'Arquivo', render: (v, r) => `<i class="bi ${icone(r.mime, v)}"></i> ${esc(v)}` },
      { k: 'categoria', l: 'Categoria', filter: { options: cfg.categorias.map((c) => [c, c]) } }, { k: 'descricao', l: 'Descrição', cls: 'quebra' },
      { k: 'cliente', l: 'Cliente' }, { k: 'documento', l: 'CPF/CNPJ', t: 'doc' }, { k: 'pedido', l: 'Pedido' },
      { k: 'tamanho', l: 'Tamanho', render: (v) => tamanho(v), filter: false }, { k: 'usuario', l: 'Enviado por' }, { k: 'created_at', l: 'Data', t: 'datetime' },
    ],
    actions: acoesArquivo,
    onAction: acoesHandlers(() => t.reload()),
  });
  conteudo.querySelector('#btn-up').addEventListener('click', () => {
    let cliente = null;
    const m = modal({
      title: 'Enviar arquivo', size: 'lg',
      body: `<div class="row g-2 mb-2"><div class="col-md-8"><label class="form-label">Cliente *</label><input class="form-control form-control-sm" id="arq-cli" autocomplete="off"></div>
        <div class="col-md-4"><label class="form-label">Nº do pedido (opcional)</label><input class="form-control form-control-sm" id="arq-ped" type="number"></div></div>${formUpload(cfg)}`,
    });
    buscaCliente(m.body.querySelector('#arq-cli'), (c) => { cliente = c; });
    ligarUpload(m.body, () => {
      if (!cliente) { toast('Selecione o cliente.', 'warning'); return null; }
      const num = m.body.querySelector('#arq-ped').value;
      return { cliente_id: cliente.id, pedido_numero: num };
    }, () => { m.close(); t.reload(); });
  });
}
