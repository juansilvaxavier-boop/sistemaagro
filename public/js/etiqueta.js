// Etiqueta de envio do pedido (Correios e transportadora): 10x15 cm térmica ou A4 com 4 por folha, uma por volume.
import { get, put, esc, fmt, modal, campo, lerForm, toast, ROTULOS } from './core.js';

// ---------- Código de barras Code 128 (conjunto B, com troca para C em sequências numéricas) ----------
const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Converte o texto em códigos Code 128; usa o conjunto C (pares de dígitos) quando o texto é só numérico e par. */
function codificar(texto) {
  const s = String(texto);
  const numerico = /^\d+$/.test(s) && s.length >= 4 && s.length % 2 === 0;
  const codigos = [];
  if (numerico) {
    codigos.push(105);
    for (let i = 0; i < s.length; i += 2) codigos.push(Number(s.slice(i, i + 2)));
  } else {
    codigos.push(104);
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      codigos.push(c >= 32 && c <= 127 ? c - 32 : 0);
    }
  }
  const soma = codigos.reduce((acc, c, i) => acc + c * (i || 1), 0);
  codigos.push(soma % 103, 106);
  return codigos;
}

/** SVG do código de barras (barras pretas, zona de silêncio de 10 módulos). */
export function code128(texto, { altura = 50, modulo = 2, legenda = true } = {}) {
  if (!texto) return '';
  const barras = [];
  let x = 10;
  for (const c of codificar(texto)) {
    const p = PADROES[c];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]) * modulo;
      if (i % 2 === 0) barras.push(`<rect x="${x}" y="0" width="${w}" height="${altura}"/>`);
      x += w;
    }
  }
  const largura = x + 10 * modulo;
  const h = altura + (legenda ? 16 : 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${h}" preserveAspectRatio="none" class="barcode">
    <g fill="#000">${barras.join('')}</g>${legenda ? `<text x="${largura / 2}" y="${h - 2}" font-family="monospace" font-size="13" text-anchor="middle">${esc(texto)}</text>` : ''}</svg>`;
}

const soNum = (v) => String(v || '').replace(/\D/g, '');
const cepFmt = (v) => { const d = soNum(v); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : v || ''; };
const telFmt = (v) => {
  const d = soNum(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
};

function htmlEtiqueta(d, vol, total, f) {
  const p = d.pedido;
  const dest = d.destinatario;
  const e = dest.endereco || {};
  const rem = d.remetente || {};
  const correios = p.tipo_entrega === 'posta_restante' || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(p.codigo_rastreio || '');
  const servico = correios ? 'CORREIOS' : p.tipo_entrega === 'transportadora' ? (d.transportadora?.nome || 'TRANSPORTADORA') : ROTULOS.tipo_entrega[p.tipo_entrega] || '';
  const peso = f.peso_kg ? `${fmt.num(f.peso_kg / total)} kg` : '';
  return `<section class="etq">
    <header><div class="servico">${esc(servico)}</div><div class="vol">VOLUME<br><b>${vol}/${total}</b></div></header>
    <div class="linha cods">
      <div>${code128(p.codigo_rastreio || `PED${p.numero}${String(vol).padStart(2, '0')}`, { altura: 46, modulo: 1.6 })}</div>
    </div>
    <div class="bloco dest">
      <div class="rot">DESTINATÁRIO</div>
      <div class="nome">${esc(dest.nome)}</div>
      ${dest.nome_fantasia ? `<div>${esc(dest.nome_fantasia)}</div>` : ''}
      <div>${esc([e.logradouro, e.numero || 'S/N'].filter(Boolean).join(', '))}${e.complemento ? ' - ' + esc(e.complemento) : ''}</div>
      <div>${esc(e.bairro || '')}${e.zona_rural ? ' (zona rural)' : ''}</div>
      <div class="cidade">${esc(e.cidade || '')} / ${esc(e.uf || '')}</div>
      <div class="cep">CEP <b>${esc(cepFmt(e.cep))}</b></div>
      ${dest.telefone ? `<div>Tel.: ${esc(telFmt(dest.telefone))}${dest.contato ? ' · ' + esc(dest.contato) : ''}</div>` : ''}
      ${e.como_chegar ? `<div class="obs">Como chegar: ${esc(e.como_chegar)}</div>` : ''}
      ${soNum(e.cep).length === 8 ? `<div class="cepbar">${code128(soNum(e.cep), { altura: 30, modulo: 1.4, legenda: false })}</div>` : ''}
    </div>
    <div class="linha info">
      <div><span class="rot">PEDIDO</span><b>${p.numero}</b></div>
      <div><span class="rot">NF-e</span><b>${d.nota ? `${d.nota.numero}/${d.nota.serie}` : '—'}</b></div>
      <div><span class="rot">PESO</span><b>${esc(peso || '—')}</b></div>
      <div><span class="rot">EMBARQUE</span><b>${fmt.date(p.data_embarque) || '—'}</b></div>
    </div>
    ${d.nota?.chave ? `<div class="chave">Chave NF-e: ${esc(d.nota.chave.replace(/(\d{4})/g, '$1 ').trim())}</div>` : ''}
    ${f.observacao ? `<div class="obs">${esc(f.observacao)}</div>` : ''}
    <div class="bloco rem">
      <div class="rot">REMETENTE</div>
      <div><b>${esc(rem.nome || '')}</b>${rem.cnpj ? ' · CNPJ ' + esc(fmt.doc(rem.cnpj)) : ''}</div>
      <div>${esc(rem.endereco || '')}</div>
      <div>${esc(rem.cidade || '')}${rem.uf ? ' / ' + esc(rem.uf) : ''}${rem.cep ? ' · CEP ' + esc(cepFmt(rem.cep)) : ''}${rem.telefone ? ' · ' + esc(telFmt(rem.telefone)) : ''}</div>
    </div>
  </section>`;
}

const CSS = `
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
  .etq{width:100mm;height:150mm;padding:4mm;border:1px dashed #bbb;display:flex;flex-direction:column;gap:2mm;overflow:hidden;page-break-after:always;break-after:page;font-size:9.5pt}
  .etq header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:2mm}
  .servico{font-size:15pt;font-weight:900;letter-spacing:.5px;max-width:70mm;line-height:1.05}
  .vol{border:2px solid #000;padding:1mm 3mm;text-align:center;font-size:7pt;line-height:1.1}.vol b{font-size:15pt}
  .cods svg{width:100%;height:17mm}.cepbar svg{width:55mm;height:9mm;margin-top:1mm}
  .bloco{border:1.5px solid #000;padding:2mm;border-radius:1.5mm}.dest{flex:1}.dest .nome{font-size:12.5pt;font-weight:800;line-height:1.15;margin:.5mm 0}
  .dest .cidade{font-size:12pt;font-weight:800;margin-top:.5mm}.cep{font-size:12pt;margin:.5mm 0}
  .rot{font-size:6.5pt;font-weight:700;letter-spacing:.6px;color:#333;display:block}
  .info{display:grid;grid-template-columns:repeat(4,1fr);gap:1mm;border:1.5px solid #000;border-radius:1.5mm;padding:1.5mm}.info b{font-size:10pt}
  .chave{font-family:monospace;font-size:7pt;text-align:center}.obs{font-size:8pt;font-style:italic}.rem{font-size:8pt}
  .a4{display:grid;grid-template-columns:repeat(2,100mm);gap:5mm;justify-content:center;padding:5mm}
  .a4 .etq{page-break-after:auto;break-after:auto;break-inside:avoid}
  @media print{.etq{border:none}.a4 .etq{border:1px dashed #999}}`;

function imprimir(d, f) {
  const total = Math.max(1, Number(f.volumes) || 1);
  const etiquetas = Array.from({ length: total }, (_, i) => htmlEtiqueta(d, i + 1, total, f)).join('');
  const a4 = f.formato === 'a4';
  const w = window.open('', '_blank');
  if (!w) return toast('Libere as janelas pop-up para imprimir a etiqueta.', 'warning');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta pedido ${d.pedido.numero}</title>
    <style>${CSS} @page{size:${a4 ? 'A4' : '100mm 150mm'};margin:${a4 ? '8mm' : '0'}}</style></head>
    <body>${a4 ? `<div class="a4">${etiquetas}</div>` : etiquetas}<script>onload=()=>setTimeout(()=>print(),150)<\/script></body></html>`);
  w.document.close();
}

/** Abre a janela para conferir volumes, peso e rastreio e imprimir as etiquetas do pedido. */
export async function abrirEtiqueta(pedidoId, aoSalvar) {
  const d = await get(`/api/pedidos/${pedidoId}/etiqueta`);
  const p = d.pedido;
  const e = d.destinatario.endereco || {};
  const semEndereco = !e.cidade || !soNum(e.cep);
  const semRemetente = !d.remetente?.endereco || !d.remetente?.cep;
  modal({
    title: `<i class="bi bi-upc-scan"></i> Etiqueta de envio · Pedido ${p.numero}`, size: 'lg',
    body: `${semEndereco ? '<div class="alert alert-warning py-2 small"><i class="bi bi-exclamation-triangle"></i> O endereço de entrega está sem CEP ou cidade. Ajuste o cadastro do cliente antes de despachar.</div>' : ''}
      ${semRemetente ? '<div class="alert alert-warning py-2 small"><i class="bi bi-building-exclamation"></i> Cadastre endereço e CEP da empresa em <b>Cadastros → Empresas</b> para sair no remetente.</div>' : ''}
      ${!d.nota ? '<div class="alert alert-info py-2 small"><i class="bi bi-info-circle"></i> Pedido ainda sem nota fiscal: a etiqueta sai sem o número da NF-e.</div>' : ''}
      <div class="row g-3"><div class="col-md-6 small">
        <div class="text-muted">Destinatário</div><div class="fw-semibold">${esc(d.destinatario.nome)}</div>
        <div>${esc([e.logradouro, e.numero].filter(Boolean).join(', '))} ${esc(e.bairro || '')}</div><div>${esc(e.cidade || '')}/${esc(e.uf || '')} · CEP ${esc(cepFmt(e.cep))}</div>
        <div class="mt-2 text-muted">Envio</div><div>${esc(ROTULOS.tipo_entrega[p.tipo_entrega] || p.tipo_entrega)}${d.transportadora ? ' · ' + esc(d.transportadora.nome) : ''}</div>
        <div class="mt-2 text-muted">Itens</div>${d.itens.map((i) => `<div>${fmt.num(i.quantidade)} × ${esc(i.produto)} ${esc(i.embalagem || '')}</div>`).join('')}
      </div><div class="col-md-6"><form class="row g-2">
        ${campo('volumes', 'Volumes (uma etiqueta cada)', { type: 'number', col: 'col-6', value: p.volumes || d.volumes_estimados, attrs: 'min="1" max="999"', required: true })}
        ${campo('peso_kg', 'Peso total (kg)', { type: 'number', col: 'col-6', value: p.peso_kg ?? d.peso_estimado, attrs: 'min="0" step="0.01"', help: `Estimado: ${fmt.num(d.peso_estimado)} kg` })}
        ${campo('codigo_rastreio', 'Código de rastreio / CT-e', { col: 'col-12', value: p.codigo_rastreio || '', help: 'Correios: 13 caracteres (ex.: AA123456789BR).' })}
        ${campo('formato', 'Formato', { type: 'select', col: 'col-12', options: [['termica', 'Etiqueta 10 × 15 cm (impressora térmica)'], ['a4', 'Folha A4 (4 etiquetas por folha)']] })}
        ${campo('observacao', 'Observação na etiqueta', { col: 'col-12', attrs: 'maxlength="120"' })}
      </form></div></div>
      <div class="border rounded mt-3 p-2 text-center bg-white" style="overflow:auto"><div class="small text-muted mb-1">Pré-visualização</div><div data-previa style="display:inline-block;transform:scale(.62);transform-origin:top center;height:360px"></div></div>`,
    onShow: ({ body }) => {
      const f = body.querySelector('form');
      const previa = () => {
        const v = lerForm(f);
        body.querySelector('[data-previa]').innerHTML = `<style>${CSS.replace(/body\{[^}]*\}/, '')}</style>${htmlEtiqueta({ ...d, pedido: { ...p, codigo_rastreio: v.codigo_rastreio ? String(v.codigo_rastreio).toUpperCase() : null } }, 1, Math.max(1, Number(v.volumes) || 1), v)}`;
      };
      f.addEventListener('input', previa);
      previa();
    },
    buttons: [{ label: '<i class="bi bi-printer"></i> Salvar e imprimir', onClick: async ({ body }) => {
      const v = lerForm(body.querySelector('form'));
      await put(`/api/pedidos/${pedidoId}/envio`, { volumes: v.volumes, peso_kg: v.peso_kg, codigo_rastreio: v.codigo_rastreio });
      imprimir({ ...d, pedido: { ...p, volumes: v.volumes, peso_kg: v.peso_kg, codigo_rastreio: v.codigo_rastreio ? String(v.codigo_rastreio).trim().toUpperCase() : null } }, v);
      aoSalvar?.();
    } }],
  });
}
