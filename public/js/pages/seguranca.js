// Auditoria (quem alterou o quê), backups do banco e política de privacidade.
import { get, post, put, esc, fmt, titulo, DataTable, modal, toast, tentar, baixar, pode, confirmar, pedirTexto, kpi, erro, state } from '../core.js';
import { TEXTO_TERMO } from '../privacidade.js';

const ACOES = {
  criar: ['Inclusão', 'success'], alterar: ['Alteração', 'primary'], excluir: ['Exclusão', 'danger'], login: ['Login', 'secondary'],
  login_falhou: ['Login recusado', 'warning'], visualizar: ['Visualização', 'light'], trocar_senha: ['Troca de senha', 'info'],
  aceitar_termo: ['Aceite do termo', 'info'], alterar_foto: ['Foto de perfil', 'light'], baixar_arquivo: ['Download de arquivo', 'light'],
  lgpd_exportar: ['LGPD: exportação', 'warning'], lgpd_anonimizar: ['LGPD: anonimização', 'danger'], backup_manual: ['Backup manual', 'info'],
  backup_download: ['Download de backup', 'warning'], importacao: ['Importação de dados', 'primary'], importacao_desfeita: ['Importação desfeita', 'danger'],
};
const ENTIDADES = {
  clientes: 'Cliente', pedidos: 'Pedido', pedido_itens: 'Item do pedido', usuarios: 'Usuário', colaboradores: 'Colaborador', produtos: 'Produto',
  parcelas: 'Parcela', notas_fiscais: 'Nota fiscal', blacklist: 'Blacklist', comissoes: 'Comissão', formas_pagamento: 'Forma de pagamento',
  transportadoras: 'Transportadora', arquivos: 'Arquivo', crm_interacoes: 'Interação CRM', cobranca_acoes: 'Ação de cobrança',
  chat_mensagem: 'Mensagem do chat', chat_conversas: 'Conversa do chat',
};

export default async function (conteudo, { params: [tela] }) {
  if (tela === 'auditoria') return auditoria(conteudo);
  if (tela === 'backups') return backups(conteudo);
  if (tela === 'importacao') return importar(conteudo);
  if (tela === 'chat-lgpd') return chatLgpd(conteudo);
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
  const pagina = titulo(conteudo, 'Backups', 'bi-database-check', '<button class="btn btn-primary btn-sm" id="btn-backup"><i class="bi bi-cloud-arrow-up"></i> Fazer backup agora</button>');
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

// ---------- Importação da planilha do sistema anterior ----------
const ITENS = {
  colaboradores: ['Vendedores e supervisores', 'n'], supervisores: ['Supervisores', 'n'], clientes: ['Clientes', 'n'], clientes_sem_documento: ['Clientes sem CPF/CNPJ', 'n'],
  pedidos: ['Pedidos', 'n'], valor_pedidos: ['Valor dos pedidos', 'm'], notas: ['Notas fiscais', 'n'], valor_notas: ['Valor das notas', 'm'],
  parcelas_abertas: ['Parcelas em aberto', 'n'], saldo_aberto: ['Saldo em aberto', 'm'], parcelas_pagas: ['Parcelas pagas', 'n'], valor_recebido: ['Valor recebido', 'm'],
};
const fmtItem = (k, v) => (ITENS[k]?.[1] === 'm' ? fmt.money(v) : fmt.num(v));
const ICONE_AVISO = { erro: ['bi-x-octagon', 'danger'], atencao: ['bi-exclamation-triangle', 'warning'], info: ['bi-info-circle', 'info'] };

async function importar(conteudo) {
  const pagina = titulo(conteudo, 'Importar dados', 'bi-cloud-upload');
  const sit = await get('/api/admin/importacao');
  const jaTem = sit.importado.pedidos > 0 || sit.importado.clientes > 0;
  pagina.innerHTML = `<p class="text-body-secondary mt-n2">Envie a planilha de relatórios do sistema anterior (abas Vendas, Faturamento, Contas a Receber, Contas Recebidas, Parcelas Vencidas e Parcelas Liquidadas).
    Primeiro o sistema mostra o que vai entrar; nada é gravado até você confirmar. Antes de gravar é feito um backup automático, e enviar a mesma planilha de novo não duplica registros.</p>
    ${jaTem ? `<div class="alert alert-success d-flex align-items-center gap-2"><i class="bi bi-check-circle"></i><div>Já importado: <b>${fmt.num(sit.importado.clientes)}</b> clientes, <b>${fmt.num(sit.importado.pedidos)}</b> pedidos,
      <b>${fmt.num(sit.importado.notas)}</b> notas e <b>${fmt.num(sit.importado.parcelas_abertas + sit.importado.parcelas_pagas)}</b> parcelas.</div>
      ${pode('importacao') ? '<button class="btn btn-sm btn-outline-danger ms-auto" data-desfazer><i class="bi bi-arrow-counterclockwise"></i> Desfazer importação</button>' : ''}</div>` : ''}
    <div class="card mb-3"><div class="card-body"><form class="row g-2 align-items-end" data-form>
      <div class="col-md-8"><label class="form-label">Planilha (.xlsx)</label><input type="file" class="form-control" name="arquivo" accept=".xlsx" required></div>
      <div class="col-md-4"><button class="btn btn-success w-100" type="submit"><span class="spinner-border spinner-border-sm d-none"></span> <i class="bi bi-search"></i> Analisar planilha</button></div>
    </form></div></div><div data-resultado></div>`;
  const form = pagina.querySelector('[data-form]');
  const res = pagina.querySelector('[data-resultado]');
  const enviar = async (aplicar) => {
    const arquivo = form.arquivo.files[0];
    if (!arquivo) { toast('Escolha a planilha.', 'warning'); return null; }
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    if (aplicar) fd.append('aplicar', '1');
    return post('/api/admin/importacao', fd);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const spin = form.querySelector('.spinner-border');
    spin.classList.remove('d-none');
    res.innerHTML = '<div class="vazio"><div class="spinner-border spinner-border-sm"></div> Lendo a planilha...</div>';
    try {
      const d = await enviar(false);
      if (d) mostrarPrevia(res, d, () => aplicar());
    } catch (err) { res.innerHTML = ''; erro(err); } finally { spin.classList.add('d-none'); }
  });
  async function aplicar() {
    if (!await confirmar('Gravar os dados da planilha no sistema? Um backup é feito antes. Registros que já existem não são duplicados.', { ok: 'Importar agora' })) return;
    res.innerHTML = '<div class="vazio"><div class="spinner-border spinner-border-sm"></div> Importando... pode levar até um minuto.</div>';
    try {
      const d = await enviar(true);
      const ok = d.conferencia.every((c) => c.ok);
      res.innerHTML = `<div class="alert alert-${ok ? 'success' : 'warning'}"><i class="bi bi-${ok ? 'check-circle' : 'exclamation-triangle'}"></i>
        ${ok ? 'Importação concluída e conferida: tudo o que a planilha previa está no banco.' : 'Importação concluída, mas alguns totais não bateram. Confira abaixo.'}
        Backup feito antes: nº ${d.backup_id} (em <a href="#/backups">Backups</a>).</div>
        <div class="card"><div class="card-header py-2">Conferência</div><div class="card-body p-0"><table class="table table-sm mb-0"><thead><tr><th>Item</th><th class="num">Previsto</th><th class="num">No banco</th><th></th></tr></thead><tbody>
        ${d.conferencia.map((c) => `<tr><td>${esc(ITENS[c.item]?.[0] || c.item)}</td><td class="num">${fmtItem(c.item, c.previsto)}</td><td class="num">${fmtItem(c.item, c.banco)}</td>
          <td>${c.ok ? '<i class="bi bi-check-lg text-success"></i>' : '<i class="bi bi-x-lg text-danger"></i>'}</td></tr>`).join('')}</tbody></table></div></div>`;
      window.atualizarContadores?.();
    } catch (err) { res.innerHTML = ''; erro(err); }
  }
  pagina.querySelector('[data-desfazer]')?.addEventListener('click', async () => {
    const txt = await pedirTexto('Isso apaga todos os clientes, pedidos, notas, parcelas, vendedores e equipes que vieram da importação (um backup é feito antes). Digite <b>DESFAZER</b> para confirmar.', { titulo: 'Desfazer importação', ok: 'Desfazer' });
    if (txt === null) return;
    if (await tentar(() => post('/api/admin/importacao/desfazer', { confirmacao: txt }), 'Importação desfeita.')) importar(conteudo);
  });
}

function mostrarPrevia(el, d, aoAplicar) {
  const t = d.totais;
  el.innerHTML = `<div class="kpis mb-3">
      ${kpi('Clientes', fmt.num(t.clientes), { icone: 'bi-people', sub: `${fmt.num(t.clientes_sem_documento)} sem CPF/CNPJ` })}
      ${kpi('Pedidos', fmt.num(t.pedidos), { icone: 'bi-cart3', cor: 'info', sub: fmt.money(t.valor_pedidos) })}
      ${kpi('Notas fiscais', fmt.num(t.notas), { icone: 'bi-receipt', cor: 'success', sub: fmt.money(t.valor_notas) })}
      ${kpi('Parcelas em aberto', fmt.num(t.parcelas_abertas), { icone: 'bi-hourglass-split', cor: 'warning', sub: fmt.money(t.saldo_aberto) })}
      ${kpi('Parcelas pagas', fmt.num(t.parcelas_pagas), { icone: 'bi-cash-coin', cor: 'success', sub: `${fmt.money(t.valor_recebido)} recebidos` })}
      ${kpi('Vendedores e supervisores', fmt.num(t.colaboradores), { icone: 'bi-person-badge', cor: 'secondary', sub: `${t.supervisores} supervisores · entram sem acesso` })}
    </div>
    <div class="row g-3"><div class="col-lg-8"><div class="card"><div class="card-header py-2">Ajustes e pontos de atenção</div><div class="card-body">
      ${d.avisos.map((a) => { const [i, c] = ICONE_AVISO[a.tipo]; return `<div class="d-flex gap-2 mb-3"><i class="bi ${i} text-${c} fs-5"></i><div><div>${esc(a.texto)}</div>
        ${a.exemplos.length ? `<div class="small text-body-secondary mt-1">Ex.: ${a.exemplos.map(esc).join(' · ')}</div>` : ''}</div></div>`; }).join('')}
    </div></div></div><div class="col-lg-4"><div class="card mb-3"><div class="card-header py-2">Vendas por mês</div><div class="card-body p-0"><table class="table table-sm mb-0">
      ${Object.entries(t.vendas_por_mes).sort().map(([m, [n, v]]) => `<tr><td>${m.split('-').reverse().join('/')}</td><td class="num">${fmt.num(n)}</td><td class="num">${fmt.money(v)}</td></tr>`).join('')}</table></div></div>
      <div class="card"><div class="card-body small">Pedidos por etapa: ${Object.entries(t.pedidos_por_etapa).map(([k, v]) => `${esc(state.me.etapas[k]?.label || k)} <b>${fmt.num(v)}</b>`).join(' · ')}
        <div class="mt-2">A numeração da NF-e continua depois da nota <b>${t.maior_nf}</b>.</div></div></div></div></div>
    <div class="d-flex gap-2 justify-content-end mt-3"><button class="btn btn-success" data-aplicar><i class="bi bi-cloud-upload"></i> Importar agora</button></div>`;
  el.querySelector('[data-aplicar]').addEventListener('click', aoAplicar);
}

// ---------- Chat: prazo de guarda e exportação de conversas ----------
const PRAZOS = [[0, 'Sem limite'], [180, '6 meses'], [365, '1 ano'], [730, '2 anos'], [1825, '5 anos']];
async function chatLgpd(conteudo, filtro = '') {
  const pagina = titulo(conteudo, 'Chat: guarda e exportação', 'bi-chat-square-text');
  const [cfg, lista] = await Promise.all([get('/api/chat/admin/config'), get(`/api/chat/admin/conversas${filtro ? `?usuario_id=${filtro}` : ''}`)]);
  const usuarios = state.opcoes?.usuarios || [];
  pagina.innerHTML = `<div class="row g-3 mb-3"><div class="col-lg-5"><div class="card h-100"><div class="card-header">Prazo de guarda das mensagens</div><div class="card-body">
      <p class="small text-body-secondary">Mensagens e anexos mais antigos que o prazo são apagados todo dia pela rotina automática. Use o prazo da política de privacidade da empresa.</p>
      <div class="d-flex gap-2"><select class="form-select form-select-sm" id="cl-prazo" aria-label="Prazo de guarda">${PRAZOS.map(([v, l]) => `<option value="${v}" ${cfg.retencao_dias === v ? 'selected' : ''}>${l}</option>`).join('')}
        ${PRAZOS.some(([v]) => v === cfg.retencao_dias) ? '' : `<option value="${cfg.retencao_dias}" selected>${cfg.retencao_dias} dias</option>`}</select>
        <button class="btn btn-sm btn-success" id="cl-salvar">Salvar</button></div></div></div></div>
    <div class="col-lg-7"><div class="card h-100"><div class="card-header">Como funciona</div><div class="card-body small vstack gap-2">
      <div><i class="bi bi-file-earmark-excel text-agro"></i> <b>Exportar</b> gera a planilha da conversa inteira (autor, data, texto, anexos, edições e mensagens apagadas). Cada exportação fica na auditoria.</div>
      <div><i class="bi bi-trash text-agro"></i> Mensagem <b>apagada para todos</b> sai da conversa; o texto original vai para a auditoria.</div>
      <div><i class="bi bi-person-x text-agro"></i> Quando um usuário é <b>desativado ou desligado</b>, ele sai dos grupos e para de receber notificações. As conversas ficam no histórico.</div>
    </div></div></div></div>
    <div class="card"><div class="card-header d-flex align-items-center gap-2 flex-wrap"><span>Conversas</span>
      <select class="form-select form-select-sm ms-auto" style="max-width:16rem" id="cl-usuario" aria-label="Participante"><option value="">Todas as pessoas</option>
        ${usuarios.map((u) => `<option value="${u.id}" ${String(filtro) === String(u.id) ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></div>
    <div class="card-body p-0">${lista.length ? `<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Conversa</th><th>Participantes</th><th class="num">Mensagens</th><th>Última atividade</th><th></th></tr></thead>
      <tbody>${lista.map((c) => `<tr><td>${c.tipo === 'grupo' ? `<i class="bi bi-people"></i> <b>${esc(c.nome)}</b>` : '<i class="bi bi-person"></i> Conversa direta'}</td>
        <td class="small">${esc(c.participantes || '')}</td><td class="num">${fmt.num(c.mensagens)}</td><td>${fmt.datetime(c.atualizada_em)}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-success py-0" data-exportar="${c.id}"><i class="bi bi-file-earmark-excel"></i> Exportar</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="vazio"><i class="bi bi-chat"></i>Nenhuma conversa.</div>'}</div></div>`;
  pagina.querySelector('#cl-salvar').addEventListener('click', () => tentar(async () => {
    const r = await put('/api/chat/admin/config', { retencao_dias: Number(pagina.querySelector('#cl-prazo').value) });
    return r;
  }, 'Prazo de guarda salvo.'));
  pagina.querySelector('#cl-usuario').addEventListener('change', (e) => chatLgpd(conteudo, e.target.value));
  pagina.querySelectorAll('[data-exportar]').forEach((b) => b.addEventListener('click', () => tentar(() => baixar(`/api/chat/admin/conversas/${b.dataset.exportar}/exportar`, `conversa_${b.dataset.exportar}.xlsx`))));
}
