// Listas de cadastro: as opções que aparecem nos campos de escolha (cargo, departamento, cultura, origem da venda).
// Na primeira leitura, cada lista vazia recebe as opções padrão e os valores que já existem nos cadastros.
const db = require('./db');
// Carregado sob demanda: services também usa este módulo.
const { ErroNegocio } = new Proxy({}, { get: (_, k) => require('./services')[k] });

const TIPOS = {
  cargo: 'Cargos',
  departamento: 'Departamentos',
  cultura: 'Culturas',
  origem_venda: 'Origens da venda',
};
// Função comercial do cargo: define comissão e exige equipe para vendedor.
const FUNCOES = { vendedor: 'Vendedor', supervisor: 'Supervisor', gerente: 'Gerente comercial' };

const CARGOS = [
  ['Vendedor externo', 'Comercial', 'vendedor'], ['Vendedor interno', 'Comercial', 'vendedor'], ['Consultor de vendas', 'Comercial', 'vendedor'],
  ['Representante comercial', 'Comercial', 'vendedor'], ['Supervisor de vendas', 'Comercial', 'supervisor'], ['Gerente comercial', 'Comercial', 'gerente'],
  ['Assistente comercial', 'Comercial'], ['Diretor geral', 'Diretoria'], ['Diretor comercial', 'Diretoria'], ['Diretor financeiro', 'Diretoria'],
  ['Analista de crédito', 'Crédito'], ['Analista financeiro', 'Financeiro'], ['Assistente financeiro', 'Financeiro'], ['Agente de cobrança', 'Financeiro'],
  ['Assistente de faturamento', 'Faturamento'], ['Analista fiscal', 'Faturamento'], ['Encarregado de produção', 'Produção'], ['Operador de produção', 'Produção'],
  ['Auxiliar de produção', 'Produção'], ['Técnico de qualidade', 'Produção'], ['Encarregado de expedição', 'Logística'], ['Auxiliar de expedição', 'Logística'],
  ['Conferente', 'Logística'], ['Motorista', 'Logística'], ['Engenheiro agrônomo', 'Agronomia'], ['Técnico agrícola', 'Agronomia'],
  ['Comprador', 'Compras'], ['Assistente de compras', 'Compras'], ['Assistente administrativo', 'Administrativo'], ['Recepcionista', 'Administrativo'], ['Analista de sistemas', 'TI'], ['Analista de RH', 'RH'], ['Assistente de DP', 'RH'],
  ['Estagiário', 'Administrativo'], ['Jovem aprendiz', 'Administrativo'],
];
const PADROES = {
  departamento: ['Comercial', 'Diretoria', 'Crédito', 'Financeiro', 'Faturamento', 'Produção', 'Logística', 'Compras', 'Agronomia', 'Administrativo', 'RH', 'TI'],
  cultura: ['Soja', 'Milho', 'Café', 'Cana-de-açúcar', 'Algodão', 'Feijão', 'Trigo', 'Arroz', 'Sorgo', 'Citros', 'Batata', 'Tomate', 'Hortaliças', 'Frutas',
    'Banana', 'Uva', 'Cacau', 'Mandioca', 'Eucalipto', 'Pastagem', 'Outras'],
  origem_venda: ['Cliente da carteira (recompra)', 'Prospecção ativa do vendedor', 'Prospecção automática (campanha/CRM)', 'Tráfego pago (Google/Meta)',
    'Redes sociais (orgânico)', 'Site / formulário', 'WhatsApp', 'Indicação de cliente', 'Indicação de parceiro/revenda', 'Feira / evento / dia de campo',
    'Visita técnica', 'Telemarketing', 'Proposta comercial convertida'],
};
// Onde cada lista é usada (para renomear sem perder os registros).
const USOS = {
  cargo: [['colaboradores', 'cargo']],
  departamento: [['colaboradores', 'departamento'], ['colaboradores', 'setor']],
  cultura: [['pedidos', 'cultura'], ['propostas', 'cultura'], ['cliente_areas', 'tipo_cultivo']],
  origem_venda: [['pedidos', 'origem_venda'], ['propostas', 'origem_venda'], ['clientes', 'origem_lead']],
};

let pronto;
async function garantirPadroes() {
  pronto ||= (async () => {
    const existentes = Object.fromEntries((await db.all('SELECT tipo, COUNT(*) AS n FROM listas GROUP BY tipo')).map((x) => [x.tipo, x.n]));
    const inserir = (tipo, valor, ordem, extra) => db.run(
      'INSERT INTO listas (tipo, valor, ordem, extra) VALUES (?, ?, ?, ?) ON CONFLICT (tipo, valor) DO NOTHING', tipo, valor, ordem, extra ? JSON.stringify(extra) : null,
    );
    if (!existentes.cargo) {
      let i = 0;
      for (const [nome, departamento, funcao] of CARGOS) await inserir('cargo', nome, i++, { departamento, funcao: funcao || null });
      for (const x of await db.all(`SELECT DISTINCT cargo, COALESCE(departamento, setor) AS d FROM colaboradores WHERE cargo IS NOT NULL AND cargo <> ''`)) {
        await inserir('cargo', x.cargo, 900, { departamento: x.d || null, funcao: /vended|consultor|represent/i.test(x.cargo) ? 'vendedor' : /supervis/i.test(x.cargo) ? 'supervisor' : /gerente/i.test(x.cargo) ? 'gerente' : null });
      }
    }
    if (!existentes.departamento) {
      let i = 0;
      for (const v of PADROES.departamento) await inserir('departamento', v, i++);
      for (const x of await db.all(`SELECT DISTINCT COALESCE(departamento, setor) AS d FROM colaboradores WHERE COALESCE(departamento, setor) IS NOT NULL`)) await inserir('departamento', x.d, 900);
    }
    for (const tipo of ['cultura', 'origem_venda']) {
      if (existentes[tipo]) continue;
      let i = 0;
      for (const v of PADROES[tipo]) await inserir(tipo, v, i++);
    }
    if (!existentes.cultura) {
      for (const x of await db.all(`SELECT DISTINCT tipo_cultivo AS v FROM cliente_areas WHERE tipo_cultivo IS NOT NULL AND tipo_cultivo <> ''`)) await inserir('cultura', x.v, 900);
    }
  })().catch((e) => { pronto = null; throw e; });
  return pronto;
}

const ler = (x) => ({ ...x, extra: x.extra ? JSON.parse(x.extra) : {} });

/** Todas as listas: { cargo: [{ id, valor, extra, ativo }], ... } (inativas só com incluirInativos). */
async function todas({ incluirInativos = false } = {}) {
  await garantirPadroes();
  const rows = await db.all(`SELECT * FROM listas ${incluirInativos ? '' : 'WHERE ativo = 1'} ORDER BY tipo, ordem, valor`);
  const out = Object.fromEntries(Object.keys(TIPOS).map((t) => [t, []]));
  for (const x of rows) (out[x.tipo] ||= []).push(ler(x));
  return out;
}

/** Valor precisa existir (ativo) na lista; aceita o valor que o registro já tinha. */
async function exigir(tipo, valor, { atual, rotulo } = {}) {
  if (valor == null || valor === '') return null;
  if (atual != null && String(atual) === String(valor)) return valor;
  await garantirPadroes();
  const ok = await db.get('SELECT extra FROM listas WHERE tipo = ? AND valor = ? AND ativo = 1', tipo, String(valor));
  if (!ok) throw new ErroNegocio(`${rotulo || TIPOS[tipo]}: escolha uma opção da lista (“${valor}” não está cadastrado).`);
  return valor;
}

async function cargo(valor) {
  if (!valor) return null;
  await garantirPadroes();
  const x = await db.get(`SELECT * FROM listas WHERE tipo = 'cargo' AND valor = ?`, valor);
  return x ? ler(x) : null;
}

async function salvar(id, b) {
  const tipo = b.tipo;
  if (!id && !TIPOS[tipo]) throw new ErroNegocio('Tipo de lista inválido.');
  const valor = String(b.valor ?? '').trim();
  if (!id && !valor) throw new ErroNegocio('Informe o nome da opção.');
  const extra = b.extra && typeof b.extra === 'object' ? b.extra : null;
  if (extra?.funcao && !FUNCOES[extra.funcao]) throw new ErroNegocio('Função comercial inválida.');
  if (!id) {
    if (await db.get('SELECT id FROM listas WHERE tipo = ? AND lower(valor) = lower(?)', tipo, valor)) throw new ErroNegocio('Essa opção já existe.');
    const ordem = (await db.get('SELECT COALESCE(MAX(ordem),0) + 1 AS o FROM listas WHERE tipo = ?', tipo)).o;
    return db.insert('listas', { tipo, valor, ordem, extra: extra ? JSON.stringify(extra) : null, ativo: 1 });
  }
  const atual = await db.get('SELECT * FROM listas WHERE id = ?', Number(id));
  if (!atual) throw new ErroNegocio('Opção não encontrada.', 404);
  await db.tx(async () => {
    if (valor && valor !== atual.valor) {
      if (await db.get('SELECT id FROM listas WHERE tipo = ? AND lower(valor) = lower(?) AND id <> ?', atual.tipo, valor, atual.id)) throw new ErroNegocio('Essa opção já existe.');
      // Renomear atualiza os cadastros que usavam o nome antigo.
      for (const [tabela, col] of USOS[atual.tipo] || []) await db.run(`UPDATE ${tabela} SET ${col} = ? WHERE ${col} = ?`, valor, atual.valor);
    }
    await db.run('UPDATE listas SET valor = ?, ativo = ?, extra = ?, ordem = COALESCE(?, ordem) WHERE id = ?',
      valor || atual.valor, b.ativo == null ? atual.ativo : (b.ativo ? 1 : 0), extra ? JSON.stringify(extra) : atual.extra, b.ordem ?? null, atual.id);
  });
  return atual.id;
}

module.exports = { TIPOS, FUNCOES, todas, exigir, cargo, salvar, garantirPadroes, _reiniciar: () => { pronto = null; } };
