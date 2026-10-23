// Regras do cadastro de colaborador, usadas por Cadastros → Colaboradores e pelo RH.
// Campos de escolha (vínculo, cargo, departamento, carga horária, escala) só aceitam opções cadastradas.
const db = require('./db');
const A = require('./auth');
const L = require('./listas');
const { ErroNegocio } = require('./services');

const VINCULOS = {
  clt: 'CLT', pj: 'PJ (pessoa jurídica)', autonomo: 'PF / Autônomo (RPA)', estagio: 'Estágio', temporario: 'Temporário',
  aprendiz: 'Jovem aprendiz', socio: 'Sócio / pró-labore', terceirizado: 'Terceirizado',
};
// Vínculos sem registro em carteira: não batem ponto por padrão e não têm férias CLT.
const SEM_CLT = ['pj', 'autonomo', 'socio', 'terceirizado'];
const CARGAS = [44, 42, 40, 36, 30, 25, 20, 16, 12];
const ESCALAS = { '5x2': '5x2 (segunda a sexta)', '6x1': '6x1', '12x36': '12x36', '4x3': '4x3', flexivel: 'Horário flexível / externo' };
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const OPCOES = {
  sexo: { F: 'Feminino', M: 'Masculino', O: 'Outro' },
  estado_civil: ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'],
  escolaridade: ['Fundamental incompleto', 'Fundamental', 'Médio incompleto', 'Médio', 'Técnico', 'Superior incompleto', 'Superior', 'Pós-graduação', 'Mestrado', 'Doutorado'],
  tipo_conta: { corrente: 'Conta corrente', poupanca: 'Poupança', pagamento: 'Conta de pagamento' },
  rg_orgao: ['SSP', 'PC', 'DETRAN', 'IFP', 'SDS', 'SESP', 'PM', 'Outro'],
};

const CAMPOS = [
  'nome', 'cpf', 'rg', 'rg_orgao', 'rg_uf', 'data_nascimento', 'sexo', 'estado_civil', 'escolaridade', 'nacionalidade', 'naturalidade', 'nome_mae',
  'email', 'telefone', 'celular', 'whatsapp', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'cargo', 'setor', 'departamento', 'tipo_contrato', 'jornada', 'carga_horaria', 'escala', 'bate_ponto', 'salario', 'data_admissao', 'experiencia_dias',
  'gestor_id', 'empresa_id', 'equipe_id', 'funcao_comercial', 'cnpj', 'razao_social', 'pis', 'ctps', 'cnh',
  'banco', 'agencia', 'conta', 'tipo_conta', 'chave_pix', 'contato_emergencia', 'telefone_emergencia', 'observacao', 'ativo',
];
const RESTRITOS = ['salario', 'banco', 'agencia', 'conta', 'tipo_conta', 'chave_pix'];

function opcoes() {
  return { vinculos: VINCULOS, sem_clt: SEM_CLT, cargas: CARGAS, escalas: ESCALAS, ufs: UFS, ...OPCOES, funcoes: L.FUNCOES };
}

const dig = (v) => String(v ?? '').replace(/\D/g, '');
const lista = (o) => (Array.isArray(o) ? o : Object.keys(o));
function escolha(d, k, permitidos, rotulo) {
  if (d[k] == null || d[k] === '') return;
  if (!lista(permitidos).map(String).includes(String(d[k]))) throw new ErroNegocio(`${rotulo}: escolha uma das opções.`);
}

/**
 * Valida e normaliza os dados do colaborador. `atual` = registro salvo (edição).
 * Regras: vínculo obrigatório; CLT/estágio/aprendiz/temporário exigem CPF; PJ exige CNPJ e razão social;
 * cargo e departamento vêm das listas; cargo de vendedor exige equipe.
 */
async function dados(b, user, atual = null) {
  const C = require('./routes/clientes');
  const d = Object.fromEntries(CAMPOS.filter((k) => b[k] !== undefined).map((k) => [k, b[k] === '' ? null : b[k]]));
  const valor = (k) => (d[k] !== undefined ? d[k] : atual?.[k]);
  if (!String(valor('nome') || '').trim()) throw new ErroNegocio('Informe o nome completo.');
  if (d.nome) d.nome = String(d.nome).trim().replace(/\s+/g, ' ');
  if (!atual && !d.tipo_contrato) d.tipo_contrato = 'clt';
  escolha(d, 'tipo_contrato', VINCULOS, 'Vínculo');
  escolha(d, 'escala', ESCALAS, 'Escala');
  escolha(d, 'sexo', OPCOES.sexo, 'Sexo');
  escolha(d, 'estado_civil', OPCOES.estado_civil, 'Estado civil');
  escolha(d, 'escolaridade', OPCOES.escolaridade, 'Escolaridade');
  escolha(d, 'tipo_conta', OPCOES.tipo_conta, 'Tipo de conta');
  escolha(d, 'rg_orgao', OPCOES.rg_orgao, 'Órgão emissor');
  for (const k of ['uf', 'rg_uf']) { if (d[k]) d[k] = String(d[k]).toUpperCase(); escolha(d, k, UFS, 'UF'); }
  if (d.carga_horaria != null) {
    d.carga_horaria = Number(d.carga_horaria);
    if (!CARGAS.includes(d.carga_horaria)) throw new ErroNegocio('Carga horária: escolha uma das opções.');
  }
  for (const k of ['bate_ponto', 'whatsapp', 'ativo']) if (d[k] != null) d[k] = d[k] && d[k] !== '0' ? 1 : 0;
  if (d.cpf) {
    d.cpf = dig(d.cpf);
    if (!C.validarCpf(d.cpf)) throw new ErroNegocio('CPF inválido.');
    if (await db.get('SELECT id FROM colaboradores WHERE cpf = ? AND id <> ?', d.cpf, atual?.id || 0)) throw new ErroNegocio('Já existe colaborador com este CPF.');
  }
  if (d.cnpj) {
    d.cnpj = dig(d.cnpj);
    if (!C.validarCnpj(d.cnpj)) throw new ErroNegocio('CNPJ inválido.');
  }
  for (const k of ['cep', 'pis', 'telefone', 'celular', 'telefone_emergencia']) if (d[k]) d[k] = dig(d[k]);
  if (d.email) d.email = String(d.email).trim().toLowerCase();
  if (d.salario != null && !(Number(d.salario) >= 0)) throw new ErroNegocio('Salário inválido.');

  const vinculo = valor('tipo_contrato') || 'clt';
  if (vinculo === 'pj') {
    if (!valor('cnpj')) throw new ErroNegocio('Colaborador PJ: informe o CNPJ da empresa dele.');
    if (!valor('razao_social')) throw new ErroNegocio('Colaborador PJ: informe a razão social.');
  }
  if (['clt', 'estagio', 'aprendiz', 'temporario'].includes(vinculo) && !valor('cpf') && A.can(user, 'lgpd.dados')) {
    throw new ErroNegocio(`Vínculo ${VINCULOS[vinculo]}: informe o CPF.`);
  }
  // Bate ponto: padrão pelo vínculo quando não informado.
  if (d.bate_ponto == null && !atual) d.bate_ponto = SEM_CLT.includes(vinculo) ? 0 : 1;

  if (d.cargo !== undefined) d.cargo = await L.exigir('cargo', d.cargo, { atual: atual?.cargo, rotulo: 'Cargo' });
  if (d.departamento !== undefined) d.departamento = await L.exigir('departamento', d.departamento, { atual: atual?.departamento, rotulo: 'Departamento' });
  // O cargo define a função comercial e sugere o departamento.
  const cargo = await L.cargo(valor('cargo'));
  if (cargo) {
    d.funcao_comercial = cargo.extra.funcao || null;
    if (!valor('departamento') && cargo.extra.departamento) d.departamento = cargo.extra.departamento;
  }
  if (d.departamento !== undefined) d.setor = d.departamento;
  if ((d.funcao_comercial ?? atual?.funcao_comercial) === 'vendedor') {
    const eq = valor('equipe_id');
    if (!eq) throw new ErroNegocio('Vendedor precisa estar em uma equipe. Escolha a equipe dele.');
    if (!(await db.get('SELECT id FROM equipes WHERE id = ?', Number(eq)))) throw new ErroNegocio('Equipe não encontrada.');
  }
  if (d.equipe_id) d.equipe_id = Number(d.equipe_id);
  const carga = valor('carga_horaria');
  const escala = valor('escala');
  if (carga || escala) d.jornada = [carga ? `${carga} h semanais` : null, escala ? ESCALAS[escala] : null].filter(Boolean).join(' · ');
  // Quem não vê os dados mascarados não pode sobrescrevê-los.
  if (!A.can(user, 'lgpd.dados')) { delete d.cpf; delete d.email; delete d.telefone; delete d.celular; }
  if (!A.can(user, 'rh.gerir')) for (const k of RESTRITOS) delete d[k];
  return d;
}

/** Depois de salvar: a equipe do colaborador vale para o usuário dele (vendedor/supervisor). */
async function sincronizarUsuario(colabId) {
  const c = await db.get('SELECT equipe_id, ativo FROM colaboradores WHERE id = ?', colabId);
  if (!c) return;
  if (c.equipe_id) await db.run(`UPDATE usuarios SET equipe_id = ? WHERE colaborador_id = ? AND perfil IN ('vendedor','supervisor')`, c.equipe_id, colabId);
  if (c.ativo === 0) await db.run('UPDATE usuarios SET ativo = 0 WHERE colaborador_id = ?', colabId);
}

module.exports = { CAMPOS, RESTRITOS, VINCULOS, SEM_CLT, CARGAS, ESCALAS, opcoes, dados, sincronizarUsuario };
