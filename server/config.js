// Configurações do sistema guardadas no banco (regras de comissão e afins), com valores padrão.
const db = require('./db');
// Carregado sob demanda: services também usa este módulo.
const { ErroNegocio } = new Proxy({}, { get: (_, k) => require('./services')[k] });

const PADROES = {
  'comissao.gerente_pct': { valor: 3, rotulo: 'Gerente comercial: % sobre toda venda', tipo: 'pct' },
  'comissao.supervisor_pct': { valor: 3, rotulo: 'Supervisor: % sobre as vendas da equipe', tipo: 'pct' },
  'comissao.vendedor_pct': { valor: 25, rotulo: 'Vendedor: % quando o pedido está dentro da política', tipo: 'pct' },
  'comissao.vendedor_fora_pct': { valor: 0, rotulo: 'Vendedor: % sugerido quando o pedido está fora da política (a Diretoria decide)', tipo: 'pct' },
  'comissao.tolerancia_desconto_pct': { valor: 0, rotulo: 'Desconto máximo sobre a tabela para o pedido ficar dentro da política (%)', tipo: 'pct' },
  'comissao.gerentes': { valor: [], rotulo: 'Gerentes que recebem sobre toda venda (vazio = todos os usuários com perfil Gerente)', tipo: 'usuarios' },
  'credito.dias_atraso_bloqueio': { valor: 15, rotulo: 'Bloquear venda a prazo quando o cliente tiver parcela vencida há mais de (dias; 0 = não bloqueia)', tipo: 'valor' },
  'credito.sem_limite': { valor: 'liberar', rotulo: 'Cliente sem limite definido', tipo: 'opcao', opcoes: [['liberar', 'Liberar (só alerta)'], ['bloquear', 'Bloquear a venda a prazo']] },
  'credito.meses_cobertura': { valor: 3, rotulo: 'Limite sugerido: meses de compra média que o limite cobre', tipo: 'valor' },
  'dre.impostos_pct': { valor: 0, rotulo: 'Impostos sobre a venda (% da receita bruta) no resultado do mês', tipo: 'pct' },
  'compras.aprovacao_acima': { valor: 5000, rotulo: 'Pedido de compra acima deste valor precisa de aprovação (R$; 0 = todos precisam)', tipo: 'valor' },
};

async function obter(chave) {
  const p = PADROES[chave];
  const r = await db.get('SELECT valor FROM configuracoes WHERE chave = ?', chave);
  if (!r || r.valor == null) return p?.valor ?? null;
  try { return JSON.parse(r.valor); } catch { return r.valor; }
}

async function todas(prefixo = '') {
  const salvas = Object.fromEntries((await db.all('SELECT chave, valor FROM configuracoes')).map((x) => [x.chave, x.valor]));
  return Object.entries(PADROES).filter(([chave]) => chave.startsWith(prefixo)).map(([chave, p]) => {
    let valor = p.valor;
    if (salvas[chave] != null) { try { valor = JSON.parse(salvas[chave]); } catch { valor = salvas[chave]; } }
    return { chave, rotulo: p.rotulo, tipo: p.tipo, opcoes: p.opcoes, valor, padrao: p.valor };
  });
}

async function definir(chave, valor, usuarioId) {
  const p = PADROES[chave];
  if (!p) throw new ErroNegocio(`Configuração desconhecida: ${chave}`);
  let v = valor;
  if (p.tipo === 'pct') {
    v = Number(String(valor).replace(',', '.'));
    if (!(v >= 0 && v <= 100)) throw new ErroNegocio(`${p.rotulo}: informe um percentual entre 0 e 100.`);
  }
  if (p.tipo === 'valor') {
    v = Number(String(valor).replace(',', '.'));
    if (!(v >= 0)) throw new ErroNegocio(`${p.rotulo}: informe um valor maior ou igual a zero.`);
  }
  if (p.tipo === 'opcao' && !p.opcoes.some(([o]) => o === valor)) throw new ErroNegocio(`${p.rotulo}: opção inválida.`);
  if (p.tipo === 'valor_opcional') {
    v = valor === '' || valor == null ? null : Number(String(valor).replace(',', '.'));
    if (v !== null && !Number.isFinite(v)) throw new ErroNegocio(`${p.rotulo}: valor inválido.`);
  }
  if (p.tipo === 'texto') v = valor ? String(valor).slice(0, 200) : null;
  if (p.tipo === 'usuarios') v = [...new Set((Array.isArray(valor) ? valor : []).map(Number).filter((n) => n > 0))];
  await db.run(
    `INSERT INTO configuracoes (chave, valor, updated_at, updated_by) VALUES (?, ?, datetime('now','localtime'), ?)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    chave, JSON.stringify(v), usuarioId || null,
  );
  return v;
}

module.exports = { PADROES, obter, todas, definir };
