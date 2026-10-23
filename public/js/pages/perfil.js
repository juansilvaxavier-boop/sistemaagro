// Meu perfil: dados do usuário somente para leitura; a única alteração permitida é a foto.
import { get, api, esc, fmt, titulo, toast, erro, confirmar, state, avatar } from '../core.js';

/** Recorta a imagem no centro (quadrado) e reduz para 320px, para não guardar fotos enormes. */
function prepararFoto(arquivo) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return reject(new Error('Use uma imagem PNG, JPG ou WEBP.'));
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 320;
      c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 320, 320);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = URL.createObjectURL(arquivo);
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
    try {
      const imagem = await prepararFoto(f);
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
