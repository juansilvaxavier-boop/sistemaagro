// Abrangência dos dados: quem vê o quê.
// - proprio: só o que a pessoa gerou (pedidos, propostas, clientes da carteira, parcelas desses pedidos)
// - equipe: o próprio e o dos vendedores das equipes que ela supervisiona
// - todos: tudo da empresa (setores que trabalham as filas, financeiro, diretoria)
// Cada usuário pode ter a abrangência definida no cadastro; sem definição, vale o padrão do perfil.
const PADRAO = { vendedor: 'proprio', supervisor: 'equipe' };
const NIVEIS = { proprio: 'Só os próprios dados', equipe: 'Dados da equipe que supervisiona', todos: 'Todos os dados da empresa' };

function abrangencia(user) {
  if (!user) return 'proprio';
  if (NIVEIS[user.abrangencia]) return user.abrangencia;
  return PADRAO[user.perfil] || 'todos';
}
const id = (user) => Number(user.id) || 0;

/** Ids dos vendedores que o usuário enxerga (subconsulta), ou null quando vê todos. */
function vendedoresSql(user) {
  const a = abrangencia(user);
  if (a === 'todos') return null;
  if (a === 'proprio') return `SELECT ${id(user)}`;
  return `SELECT u.id FROM usuarios u WHERE u.id = ${id(user)} OR u.equipe_id IN (SELECT e.id FROM equipes e WHERE e.supervisor_id = ${id(user)})`;
}

/** Pedidos (ou propostas, com semSupervisor) visíveis: alias.vendedor_id dentro da abrangência. */
function vendas(user, alias = 'p', { semSupervisor = false } = {}) {
  const v = vendedoresSql(user);
  if (!v) return 'TRUE';
  // O supervisor também vê o que passou por ele, mesmo que o vendedor tenha mudado de equipe depois.
  const sup = abrangencia(user) === 'equipe' && !semSupervisor ? ` OR ${alias}.supervisor_id = ${id(user)}` : '';
  return `(${alias}.vendedor_id IN (${v})${sup})`;
}

/** Clientes visíveis: os da carteira e os que compraram com quem está na abrangência. */
function clientes(user, alias = 'c') {
  const v = vendedoresSql(user);
  if (!v) return 'TRUE';
  return `(${alias}.vendedor_id IN (${v}) OR EXISTS (SELECT 1 FROM pedidos px WHERE px.cliente_id = ${alias}.id AND ${vendas(user, 'px')}))`;
}

/** Registros financeiros (parcelas, notas) ligados a pedido ou, sem pedido, ao cliente da carteira. */
function financeiro(user, alias = 'p') {
  const v = vendedoresSql(user);
  if (!v) return 'TRUE';
  return `(EXISTS (SELECT 1 FROM pedidos pq WHERE pq.id = ${alias}.pedido_id AND ${vendas(user, 'pq')})
    OR (${alias}.pedido_id IS NULL AND EXISTS (SELECT 1 FROM clientes cq WHERE cq.id = ${alias}.cliente_id AND cq.vendedor_id IN (${v}))))`;
}

/** Registros de uma pessoa (comissões, lançamentos do vendedor): alias.coluna dentro da abrangência. */
function pessoas(user, coluna) {
  const v = vendedoresSql(user);
  return v ? `(${coluna} IN (${v}))` : 'TRUE';
}

const veTudo = (user) => abrangencia(user) === 'todos';

module.exports = { NIVEIS, PADRAO, abrangencia, vendedoresSql, vendas, clientes, financeiro, pessoas, veTudo };
