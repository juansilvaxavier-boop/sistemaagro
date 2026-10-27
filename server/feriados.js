// Feriados: nacionais calculados (fixos e móveis pela Páscoa) + cadastrados pela empresa (estaduais, municipais, da empresa).
// A empresa decide se folga ou trabalha em cada um; o ponto não cobra horas em dia de folga e não manda lembrete.
const db = require('./db');
const S = require('./services');

const { ErroNegocio } = S;
const TIPOS = { nacional: 'Nacional', facultativo: 'Ponto facultativo', estadual: 'Estadual', municipal: 'Municipal', empresa: 'Da empresa' };

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais do ano. Facultativos vêm sem folga (a empresa decide). */
function nacionais(ano) {
  const p = pascoa(ano);
  const fixo = (md, nome) => ({ data: `${ano}-${md}`, nome, tipo: 'nacional', folga: true });
  const movel = (dias, nome, tipo = 'facultativo') => ({ data: S.addDias(p, dias), nome, tipo, folga: tipo === 'nacional' });
  return [
    fixo('01-01', 'Confraternização Universal'),
    movel(-48, 'Carnaval (segunda-feira)'),
    movel(-47, 'Carnaval (terça-feira)'),
    movel(-46, 'Quarta-feira de Cinzas (até as 14h)'),
    movel(-2, 'Sexta-feira Santa', 'nacional'),
    fixo('04-21', 'Tiradentes'),
    fixo('05-01', 'Dia do Trabalho'),
    movel(60, 'Corpus Christi'),
    fixo('09-07', 'Independência do Brasil'),
    fixo('10-12', 'Nossa Senhora Aparecida'),
    fixo('11-02', 'Finados'),
    fixo('11-15', 'Proclamação da República'),
    ...(ano >= 2024 ? [fixo('11-20', 'Dia Nacional de Zumbi e da Consciência Negra')] : []),
    fixo('12-25', 'Natal'),
  ];
}

/**
 * Feriados efetivos de uma empresa nos anos pedidos: nacionais + cadastrados (anuais repetem todo ano).
 * Um cadastro na mesma data de um nacional/facultativo é a decisão da empresa sobre ele (folga ou trabalha).
 */
async function doAno(empresaId, ano) {
  const linhas = await db.all(`SELECT f.*, u.nome AS cadastrado_por FROM rh_feriados f LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE (f.empresa_id IS NULL OR f.empresa_id IN (?)) AND (f.anual = 1 OR substr(f.data, 1, 4) = ?) ORDER BY f.empresa_id NULLS FIRST, f.id`,
  Number(empresaId) || 0, String(ano));
  const porData = new Map(nacionais(ano).map((n) => [n.data, { ...n, origem: 'sistema' }]));
  for (const f of linhas) {
    const data = f.anual ? `${ano}${f.data.slice(4)}` : f.data;
    const base = porData.get(data);
    porData.set(data, {
      id: f.id, data, nome: f.nome || base?.nome, tipo: base && base.origem === 'sistema' ? base.tipo : f.tipo, folga: !!f.folga,
      anual: !!f.anual, empresa_id: f.empresa_id, origem: base?.origem === 'sistema' ? 'ajuste' : 'cadastro', cadastrado_por: f.cadastrado_por,
    });
  }
  return [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/** Dias de folga por feriado no período: Map data → nome. */
async function folgas(empresaId, de, ate) {
  const mapa = new Map();
  for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++) {
    for (const f of await doAno(empresaId, ano)) if (f.folga && f.data >= de && f.data <= ate) mapa.set(f.data, f.nome);
  }
  return mapa;
}

function dados(b) {
  const data = String(b.data || '');
  const nome = String(b.nome || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroNegocio('Informe a data.');
  if (nome.length < 3) throw new ErroNegocio('Informe o nome do feriado.');
  if (!['estadual', 'municipal', 'empresa', 'facultativo'].includes(b.tipo)) throw new ErroNegocio('Escolha o tipo.');
  return { data, nome: nome.slice(0, 100), tipo: b.tipo, anual: b.anual ? 1 : 0, folga: b.folga === undefined ? 1 : b.folga ? 1 : 0 };
}

async function exigirAberta(empresaId, data, anual) {
  if (anual) return;
  if (await require('./rh').competenciaFechada(empresaId, data.slice(0, 7))) throw new ErroNegocio('A competência dessa data já foi fechada na folha. Reabra para mudar o feriado.');
}

module.exports = { TIPOS, pascoa, nacionais, doAno, folgas, dados, exigirAberta };
