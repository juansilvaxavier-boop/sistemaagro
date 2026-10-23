// Coordenadas dos municípios (pacote municipios-brasil, base IBGE) para o mapa de vendas.
let indice;
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function carregar() {
  if (indice) return indice;
  const { municipios } = require('municipios-brasil/dados');
  indice = new Map();
  for (const m of municipios) indice.set(`${normalizar(m.nome)}|${m.uf}`, { nome: m.nome, uf: m.uf, lat: m.latitude, lng: m.longitude, ibge: m.codigoIbge });
  return indice;
}

/** Município pelo nome e UF (tolerante a acentos e caixa); null se não achar. */
function municipio(cidade, uf) {
  if (!cidade || !uf) return null;
  return carregar().get(`${normalizar(cidade)}|${String(uf).toUpperCase()}`) || null;
}

module.exports = { municipio, normalizar };
