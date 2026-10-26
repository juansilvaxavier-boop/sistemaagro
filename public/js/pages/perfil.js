// Meu perfil: dados do usuário somente para leitura; a única alteração permitida é a foto.
import { get, api, esc, fmt, titulo, toast, erro, confirmar, state, avatar, modal } from '../core.js';

const LADO = 280; // área de enquadramento na tela
const SAIDA = 400; // tamanho final da foto

/** Lê a imagem já na orientação certa (fotos de celular trazem a rotação no EXIF). */
async function lerImagem(arquivo) {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) throw new Error('Use uma imagem PNG, JPG ou WEBP.');
  try { return await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); } catch {}
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(arquivo);
  });
}

/** Janela para enquadrar a foto: arrastar para posicionar, zoom e girar. Devolve a foto quadrada (JPEG) ou null. */
function enquadrarFoto(img) {
  return new Promise((resolve) => {
    let resultado = null;
    let girar = 0;
    let zoom = 1;
    let x = 0;
    let y = 0;
    const dims = () => (girar % 180 ? [img.height, img.width] : [img.width, img.height]);
    const base = () => { const [w, h] = dims(); return LADO / Math.min(w, h); };
    const limitar = () => {
      const [w, h] = dims();
      const e = base() * zoom;
      const mx = Math.max(0, (w * e - LADO) / 2);
      const my = Math.max(0, (h * e - LADO) / 2);
      x = Math.min(mx, Math.max(-mx, x));
      y = Math.min(my, Math.max(-my, y));
    };
    // Desenha a imagem centrada em (x, y), girada e na escala pedida, num quadrado de "lado" pixels.
    const desenhar = (ctx, lado) => {
      const f = lado / LADO;
      const e = base() * zoom * f;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, lado, lado);
      ctx.save();
      ctx.translate(lado / 2 + x * f, lado / 2 + y * f);
      ctx.rotate((girar * Math.PI) / 180);
      ctx.drawImage(img, (-img.width * e) / 2, (-img.height * e) / 2, img.width * e, img.height * e);
      ctx.restore();
    };
    modal({
      title: '<i class="bi bi-crop"></i> Ajustar a foto', size: 'md',
      body: `<div class="text-center"><div class="enquadrar"><canvas width="${LADO * 2}" height="${LADO * 2}" aria-label="Pré-visualização da foto"></canvas></div>
        <div class="d-flex align-items-center gap-2 mt-3 mx-auto" style="max-width:${LADO + 40}px"><i class="bi bi-zoom-out"></i>
          <input type="range" class="form-range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><i class="bi bi-zoom-in"></i>
          <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-girar title="Girar" aria-label="Girar a foto"><i class="bi bi-arrow-clockwise"></i></button></div>
        <div class="form-text">Arraste a foto para posicionar o rosto no círculo. Use o controle (ou a roda do mouse) para aproximar.</div></div>`,
      onShow: ({ body }) => {
        const cv = body.querySelector('canvas');
        const ctx = cv.getContext('2d');
        const zr = body.querySelector('input[type=range]');
        const pintar = () => { limitar(); desenhar(ctx, cv.width); };
        pintar();
        let arrasto = null;
        cv.addEventListener('pointerdown', (e) => { arrasto = { px: e.clientX, py: e.clientY, x, y }; cv.setPointerCapture(e.pointerId); });
        cv.addEventListener('pointermove', (e) => {
          if (!arrasto) return;
          const f = LADO / cv.getBoundingClientRect().width;
          x = arrasto.x + (e.clientX - arrasto.px) * f;
          y = arrasto.y + (e.clientY - arrasto.py) * f;
          pintar();
        });
        cv.addEventListener('pointerup', () => { arrasto = null; });
        cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 0.92))); zr.value = zoom; pintar(); }, { passive: false });
        zr.addEventListener('input', () => { zoom = Number(zr.value); pintar(); });
        body.querySelector('[data-girar]').addEventListener('click', () => { girar = (girar + 90) % 360; x = 0; y = 0; pintar(); });
      },
      onClose: () => resolve(resultado),
      buttons: [{ label: '<i class="bi bi-check-lg"></i> Usar esta foto', onClick: () => {
        const c = Object.assign(document.createElement('canvas'), { width: SAIDA, height: SAIDA });
        desenhar(c.getContext('2d'), SAIDA);
        resultado = c.toDataURL('image/jpeg', 0.88);
      } }],
    });
  });
}

const cpfParcial = (v) => (v ? `***.${String(v).slice(3, 6)}.${String(v).slice(6, 9)}-**` : '');

export default async function render(conteudo) {
  const p = await get('/api/auth/perfil');
  const pagina = titulo(conteudo, 'Meu perfil', 'bi-person-badge');
  const dado = (rotulo, valor) => `<div class="dado"><dt>${rotulo}</dt><dd>${valor || '<span class="text-body-secondary">—</span>'}</dd></div>`;
  pagina.innerHTML = `<div class="row g-3">
    <div class="col-lg-4">
      <div class="card"><div class="card-body text-center py-4">
        <div class="perfil-foto d-inline-block mb-3">${avatar({ ...p, id: p.id }, 'avatar-lg')}
          <label class="btn btn-primary shadow" title="Trocar foto" for="foto-input"><i class="bi bi-camera"></i></label>
          <input type="file" id="foto-input" accept="image/png,image/jpeg,image/webp" hidden>
        </div>
        <h3 class="h5 mb-0">${esc(p.nome)}</h3>
        <div class="text-body-secondary">${esc(p.cargo || p.perfil_label)}</div>
        <span class="badge text-bg-success mt-2">${esc(p.perfil_label)}</span>
        ${p.tem_foto ? '<div class="mt-3"><button class="btn btn-sm btn-outline-danger" id="foto-remover"><i class="bi bi-trash"></i> Remover foto</button></div>' : ''}
        <p class="small text-body-secondary mt-3 mb-0">A foto aparece no menu e no chat. JPG, PNG ou WEBP.</p>
      </div></div>
    </div>
    <div class="col-lg-8">
      <div class="alert alert-light border d-flex gap-2 align-items-start"><i class="bi bi-lock text-agro mt-1"></i>
        <div>Seus dados são mantidos pela administração e não podem ser alterados aqui. Encontrou algo errado? Fale com a administração.
        Para trocar a senha, use <a href="#/senha">Alterar minha senha</a>.</div></div>
      <div class="card mb-3"><div class="card-header">Dados do usuário</div><div class="card-body py-1"><dl class="mb-0">
        ${dado('Nome', esc(p.nome))}${dado('Login', `<code>${esc(p.login)}</code>`)}${dado('E-mail', esc(p.email || p.email_colaborador || ''))}
        ${dado('Perfil de acesso', esc(p.perfil_label))}${dado('Equipe', esc(p.equipe || ''))}${dado('Supervisor', esc(p.supervisor || ''))}
        ${dado('Empresas', p.empresas.map((e) => esc(e.nome)).join('<br>'))}${p.comissao_pct ? dado('Comissão padrão', fmt.pct(p.comissao_pct)) : ''}
        ${dado('Usuário desde', fmt.date(p.created_at))}${dado('Último acesso', fmt.datetime(p.ultimo_acesso))}
      </dl></div></div>
      <div class="card mb-3"><div class="card-header">Dados do colaborador</div><div class="card-body py-1"><dl class="mb-0">
        ${p.colaborador_nome ? `${dado('Cargo', esc(p.cargo || ''))}${dado('Setor', esc(p.setor || ''))}${dado('CPF', cpfParcial(p.cpf))}
          ${dado('Telefone', esc(p.telefone || ''))}${dado('Admissão', fmt.date(p.data_admissao))}` : '<div class="py-3 text-body-secondary">Usuário sem colaborador vinculado.</div>'}
      </dl></div></div>
      <div class="card"><div class="card-header">O que você pode acessar</div><div class="card-body"><div class="colunas-perm">
        ${p.permissoes.map(([g, itens]) => `<div class="permissao-grupo"><div class="fw-semibold small text-uppercase text-body-secondary mb-1">${esc(g)}</div>
          ${itens.map((i) => `<div class="small"><i class="bi bi-check2 text-agro"></i> ${esc(i)}</div>`).join('')}</div>`).join('')}
      </div></div></div>
    </div></div>`;

  pagina.querySelector('#foto-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    try {
      const imagem = await enquadrarFoto(await lerImagem(f));
      if (!imagem) return;
      await api('/api/auth/perfil/foto', { method: 'PUT', body: { imagem } });
      toast('Foto atualizada.');
      window.dispatchEvent(new CustomEvent('foto-atualizada'));
      state.fotoVersao = Date.now();
      render(conteudo);
    } catch (err) { erro(err); }
  });
  pagina.querySelector('#foto-remover')?.addEventListener('click', async () => {
    if (!(await confirmar('Remover sua foto de perfil?', { ok: 'Remover', cls: 'btn-danger' }))) return;
    await api('/api/auth/perfil/foto', { method: 'DELETE' }).catch(erro);
    window.dispatchEvent(new CustomEvent('foto-atualizada'));
    render(conteudo);
  });
}
