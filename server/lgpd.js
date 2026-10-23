// LGPD: mascaramento de dados pessoais para quem não tem a permissão "lgpd.dados".
const { can } = require('./auth');

const CAMPOS = { documento: 'doc', cpf: 'doc', telefone: 'tel', numero_telefone: 'tel', email: 'email' };

function mascarar(valor, tipo) {
  if (valor == null || valor === '') return valor;
  const v = String(valor);
  if (tipo === 'doc') {
    const d = v.replace(/\D/g, '');
    if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
    if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`;
    return '***';
  }
  if (tipo === 'tel') return v.replace(/\d(?=\d{4})/g, '*');
  if (tipo === 'email') {
    const [u, dom] = v.split('@');
    return dom ? `${u.slice(0, 2)}***@${dom}` : '***';
  }
  return v;
}

function mascararLinhas(user, linhas) {
  if (!user || can(user, 'lgpd.dados') || !Array.isArray(linhas)) return linhas;
  for (const l of linhas) for (const [k, t] of Object.entries(CAMPOS)) if (k in l) l[k] = mascarar(l[k], t);
  return linhas;
}

const mascararObjeto = (user, obj) => (obj ? mascararLinhas(user, [obj])[0] : obj);

module.exports = { mascarar, mascararLinhas, mascararObjeto };
