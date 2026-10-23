// Auditoria (quem alterou o quê), backups do banco e política de privacidade.
import { get, post, esc, fmt, titulo, DataTable, modal, toast, tentar, baixar, pode, confirmar } from '../core.js';
import { TEXTO_TERMO } from '../privacidade.js';

const ACOES = {
  criar: ['Inclusão', 'success'], alterar: ['Alteração', 'primary'], excluir: ['Exclusão', 'danger'], login: ['Login', 'secondary'],
  login_falhou: ['Login recusado', 'warning'], visualizar: ['Visualização', 'light'], trocar_senha: ['Troca de senha', 'info'],
  aceitar_termo: ['Aceite do termo', 'info'], alterar_foto: ['Foto de perfil', 'light'], baixar_arquivo: ['Download de arquivo', 'light'],
  lgpd_exportar: ['LGPD: exportação', 'warning'], lgpd_anonimizar: ['LGPD: anonimização', 'danger'], backup_manual: ['Backup manual', 'info'],
  backup_download: ['Download de backup', 'warning'],
};
const ENTIDADES = {
  clientes: 'Cliente', pedidos: 'Pedido', pedido_itens: 'Item do pedido', usuarios: 'Usuário', colaboradores: 'Colaborador', produtos: 'Produto',
  parcelas: 'Parcela', notas_fiscais: 'Nota fiscal', blacklist: 'Blacklist', comissoes: 'Comissão', formas_pagamento: 'Forma de pagamento',
  transportadoras: 'Transportadora', arquivos: 'Arquivo', crm_interacoes: 'Interação CRM', cobranca_acoes: 'Ação de cobrança',
};

export default async function (conteudo, { params: [tela] }) {
  if (tela === 'auditoria') return auditoria(conteudo);
  if (tela === 'backups') return backups(conteudo);
  return privacidade(conteudo);
}

function auditoria(conteudo) {
  const pagina = titulo(conteudo, 'Auditoria', 'bi-journal-text');
  pagina.insertAdjacentHTML('beforebegin', '<p class="text-body-secondary mt-n2 mb-3">Registro de inclusões, alterações, exclusões, acessos e exportações, com usuário, data e IP. Clique numa linha para ver o antes e o depois.</p>');
  new DataTable(pagina, {
    url: '/api/admin/auditoria', title: 'Auditoria', sort: 'id', dir: 'desc', pageSize: 50,
    columns: [
      { k: 'created_at', l: 'Data', t: 'datetime' }, { k: 'usuario_nome', l: 'Usuário' },
      { k: 'acao', l: 'Ação', filter: { options: Object.entries(ACOES).map(([k, [l]]) => [k, l]) }, render: (v) => { const [l, c] = ACOES[v] || [v, 'secondary']; return `<span class="badge text-bg-${c}">${esc(l)}</span>`; } },
      { k: 'entidade', l: 'Registro', filter: { options: Object.entries(ENTIDADES) }, render: (v, r) => `${esc(ENTIDADES[v] || v || '')}${r.entidade_id ? ` <span class="text-body-secondary">#${esc(r.entidade_id)}</span>` : ''}` },
      { k: 'depois', l: 'Campos', filter: false, render: (v, r) => esc(Object.keys(JSON.parse(r.depois || r.antes || '{}')).slice(0, 5).join(', ')) },
      { k: 'ip', l: 'IP' }, { k: 'rota', l: 'Origem' },
    ],
    rowClick: (r) => detalhe(r),
  });
}

function detalhe(r) {
  const antes = JSON.parse(r.antes || 'null') || {};
  const depois = JSON.parse(r.depois || 'null') || {};
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];
  const fmtv = (v) => (v == null ? '<span class="text-body-secondary">vazio</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : String(v)));
  modal({
    title: `${esc(ACOES[r.acao]?.[0] || r.acao)} · ${esc(ENTIDADES[r.entidade] || r.entidade || '')} ${r.entidade_id ? '#' + esc(r.entidade_id) : ''}`, size: 'lg',
    body: `<div class="small mb-3">${fmt.datetime(r.created_at)} · <strong>${esc(r.usuario_nome || 'Sistema')}</strong> · IP ${esc(r.ip || '-')} · ${esc(r.rota || '')}</div>
      ${campos.length ? `<div class="table-responsive"><table class="table table-sm diff"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
      ${campos.map((k) => `<tr><td>${esc(k)}</td><td class="${k in antes ? 'antes' : ''}">${k in antes ? fmtv(antes[k]) : ''}</td><td class="${k in depois ? 'depois' : ''}">${k in depois ? fmtv(depois[k]) : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="vazio py-3">Sem detalhes de campos.</div>'}`,
  });
}

async function backups(conteudo) {
  const pagina = titulo(conteudo, 'Backups do banco', 'bi-database-check', '<button class="btn btn-primary btn-sm" id="btn-backup"><i class="bi bi-cloud-arrow-up"></i> Fazer backup agora</button>');
  const carregar = async () => {
    const lista = await get('/api/admin/backups');
    const tam = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
    pagina.innerHTML = `<div class="row g-3 mb-3">
      <div class="col-md-4"><div class="card kpi cor-success h-100"><div class="card-body d-flex gap-3 align-items-center"><span class="icone"><i class="bi bi-clock-history"></i></span>
        <div><div class="rotulo">Último backup</div><div class="valor fs-5">${lista[0] ? fmt.datetime(lista[0].created_at) : 'nenhum'}</div></div></div></div></div>
      <div class="col-md-4"><div class="card kpi cor-info h-100"><div class="card-body d-flex gap-3 align-items-center"><span class="icone"><i class="bi bi-calendar-check"></i></span>
        <div><div class="rotulo">Backup automático</div><div class="valor fs-6">Todo dia às 03:00</div><div class="sub">Mantém os 30 mais recentes</div></div></div></div></div>
      <div class="col-md-4"><div class="card kpi cor-primary h-100"><div class="card-body d-flex gap-3 align-items-center"><span class="icone"><i class="bi bi-hdd-stack"></i></span>
        <div><div class="rotulo">Backups guardados</div><div class="valor fs-5">${lista.length}</div></div></div></div></div></div>
      <div class="card"><div class="table-responsive"><table class="table table-sm dt mb-0"><thead><tr><th>Data</th><th>Tipo</th><th>Feito por</th><th class="num">Tabelas</th><th class="num">Registros</th><th class="num">Tamanho</th><th></th></tr></thead><tbody>
      ${lista.map((b) => `<tr><td>${fmt.datetime(b.created_at)}</td><td>${b.origem === 'automatico' ? '<span class="badge text-bg-info">Automático</span>' : '<span class="badge text-bg-secondary">Manual</span>'}</td>
        <td>${esc(b.usuario || 'Agendador')}</td><td class="num">${b.tabelas}</td><td class="num">${fmt.num(b.registros)}</td><td class="num">${tam(b.tamanho)}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-baixar="${b.id}"><i class="bi bi-download"></i> Baixar</button></td></tr>`).join('')
        || '<tr><td colspan="7" class="vazio">Nenhum backup ainda.</td></tr>'}</tbody></table></div></div>
      <p class="small text-body-secondary mt-3">O arquivo baixado (.json.gz) contém todas as tabelas, incluindo os arquivos anexados. Guarde-o em local seguro: ele tem dados pessoais (LGPD).</p>`;
    pagina.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmar('O backup contém dados pessoais de clientes e colaboradores. O download fica registrado na auditoria. Continuar?', { ok: 'Baixar' })) {
        tentar(() => baixar(`/api/admin/backups/${b.dataset.baixar}/download`, 'backup.json.gz'));
      }
    }));
  };
  await carregar();
  conteudo.querySelector('#btn-backup').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const r = await tentar(() => post('/api/admin/backups'));
    e.target.disabled = false;
    if (r) { toast(`Backup feito: ${fmt.num(r.registros)} registros.`); carregar(); }
  });
}

function privacidade(conteudo) {
  const pagina = titulo(conteudo, 'Privacidade (LGPD)', 'bi-shield-lock');
  pagina.innerHTML = `<div class="row g-3"><div class="col-lg-8"><div class="card"><div class="card-body termo" style="max-height:none;border:0;background:transparent">${TEXTO_TERMO}</div></div></div>
    <div class="col-lg-4"><div class="card"><div class="card-header">Como o sistema protege os dados</div><div class="card-body small vstack gap-2">
      <div><i class="bi bi-eye-slash text-agro"></i> CPF/CNPJ, telefone e e-mail aparecem mascarados para quem não tem a permissão “dados completos”.</div>
      <div><i class="bi bi-journal-text text-agro"></i> Acessos a cadastros, alterações, exportações e logins ficam na auditoria.</div>
      <div><i class="bi bi-lock text-agro"></i> Senhas criptografadas, troca obrigatória da senha provisória e bloqueio após 5 tentativas.</div>
      <div><i class="bi bi-database-check text-agro"></i> Backup diário automático do banco.</div>
      ${pode('lgpd.titular') ? '<div><i class="bi bi-person-x text-agro"></i> Pedidos do titular: abra o cliente e use a aba <b>LGPD</b> para exportar ou anonimizar os dados.</div>' : ''}
    </div></div></div></div>`;
}
