// Importa a planilha de relatórios do sistema anterior (Vendas, Faturamento, Contas a Receber/Recebidas,
// Parcelas Vencidas/Liquidadas e Cadastros) para o banco do Agroterra Sistema.
//
// Pela tela Segurança → Importar dados, ou pela linha de comando:
//   node scripts/importar-planilha.js <arquivo.xlsx> [--empresa 1] [--relatorio saida.md]
//        [--sql pasta]      grava o SQL em arquivos (para aplicar por outra ferramenta)
//        [--aplicar]        executa no banco (DATABASE_URL ou PGLITE_DIR)
//        [--desfazer]       remove tudo o que esta importação criou
//
// O SQL é idempotente: cada registro importado leva uma "origem" única; reaplicar não duplica.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ORIGEM = 'planilha2026';
const ABAS = ['Vendas', 'Faturamento', 'Contas a Receber', 'Contas Recebidas', 'Parcelas Vencidas', 'Parcelas Liquidadas'];
const NAO_PESSOA = new Set(['VENDAS ADM', 'ADMINISTRADOR', 'SEM SUPERVISOR', 'SEM PEDIDO VINCULADO', '---', '']);
// Correções da tabela de padronização: o "nome padrão" de alguns vendedores tem erro de digitação.
const CORRECAO_NOME = { 'DIEGO CORREGIARI DOS REISS': 'DIEGO CORREGIARI DOS REIS' };
const ETAPA = {
  'Expedição (Entregue)': 'entregue', 'Expedição': 'expedicao', 'Devolução': 'devolucao', 'Produção': 'producao',
  'Supervisor': 'supervisao', 'Diretoria': 'diretoria', 'Vendedor': 'venda', '---': null,
};
const FORMAS = {
  BOLETO: { nome: 'Boleto bancário', tipo: 'prazo', baixa: 'boleto', cond: ['30 dias', 1, 30, 30] },
  DINHEIRO: { nome: 'Dinheiro', tipo: 'a_vista', baixa: 'dinheiro', cond: ['À vista', 1, 0, 0] },
  'CARTÃO DE CRÉDITO': { nome: 'Cartão de crédito', tipo: 'prazo', baixa: 'cartao', cond: ['1x', 1, 30, 30] },
};

// ---------- utilidades ----------
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Nome do cliente sem o CNPJ de MEI que alguns relatórios põem na frente ("61.669.007 FULANO"). */
const limparNome = (s) => String(s ?? '').replace(/^\s*\d{2}\.\d{3}\.\d{3}\s+/, '').replace(/\s+[\d.\/-]{11,18}\s*$/, '').replace(/\s+/g, ' ').trim();
/** Alguns relatórios trazem o CPF/CNPJ colado no fim do nome ("FULANO 77857496200"). */
const docNoNome = (s) => { const m = String(s ?? '').match(/\s([\d.\/-]{11,18})\s*$/); const d = m ? dig(m[1]) : ''; return d.length === 11 || d.length === 14 ? d : ''; };
const chaveNome = (s) => semAcento(limparNome(s)).toUpperCase().replace(/[^A-Z0-9& ]/g, '').replace(/\s+/g, ' ').trim();
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const PREP = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const titulo = (s) => String(s).toLowerCase().split(' ').filter(Boolean).map((p, i) => (i && PREP.has(p) ? p : p[0].toUpperCase() + p.slice(1))).join(' ')
  .replace(/\bAdm\b/, 'ADM');

function cpfOk(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function cnpjOk(c) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => {
    const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = p.reduce((a, w, i) => a + Number(c[i]) * w, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}
const docValido = (d) => (d.length === 11 ? cpfOk(d) : d.length === 14 ? cnpjOk(d) : false);

function valorCelula(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valorCelula(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}
const data = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const num = (v) => (typeof v === 'number' ? v : v === null || v === '' || v === '---' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));

/** O código do pedido do sistema anterior começa com ddmmaaaahhmmss: vira a data/hora de criação. */
function dataDoCodigo(cod, dataPedido) {
  const m = String(cod).match(/^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const [, d, mo, a, h, mi, s] = m;
    const iso = `${a}-${mo}-${d}`;
    if (iso === dataPedido && +h < 24 && +mi < 60 && +s < 60) return `${iso} ${h}:${mi}:${s}`;
  }
  return `${dataPedido} 08:00:00`;
}

// ---------- leitura ----------
/** Lê a planilha a partir do caminho do arquivo ou do conteúdo (Buffer) enviado pela tela. */
async function lerPlanilha(arquivo) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(arquivo)) await wb.xlsx.load(arquivo);
  else await wb.xlsx.readFile(arquivo);
  const out = {};
  for (const nome of ABAS) {
    const ws = wb.getWorksheet(nome);
    if (!ws) throw new Error(`A planilha não tem a aba "${nome}".`);
    let linhaCab = 0;
    // O cabeçalho é a primeira linha cujas células são todas textos curtos (depois do título e da instrução).
    for (let i = 1; i <= 10; i++) {
      const vals = ws.getRow(i).values.slice(1).map(valorCelula);
      if (vals.length > 5 && vals.every((x) => typeof x === 'string' && x.length < 40) && new Set(vals).size === vals.length) { linhaCab = i; break; }
    }
    if (!linhaCab) throw new Error(`Não achei o cabeçalho da aba "${nome}".`);
    const cab = ws.getRow(linhaCab).values.slice(1).map(valorCelula);
    const linhas = [];
    for (let i = linhaCab + 1; i <= ws.rowCount; i++) {
      const vals = ws.getRow(i).values.slice(1).map(valorCelula);
      if (vals.every((x) => x === null || x === '')) continue;
      linhas.push(Object.fromEntries(cab.map((h, j) => [h, vals[j] ?? null])));
    }
    out[nome] = linhas;
  }
  const cad = wb.getWorksheet('Cadastros');
  out.padronizacao = {};
  if (cad) {
    let ativo = false;
    for (let i = 1; i <= cad.rowCount; i++) {
      const [, a, b] = cad.getRow(i).values.map(valorCelula);
      if (a === 'Nome no relatório') { ativo = true; continue; }
      if (ativo && a && b) out.padronizacao[String(a).trim().toUpperCase()] = String(b).trim().toUpperCase();
    }
  }
  return out;
}

// ---------- transformação ----------
function transformar(p, { empresaId = 1 } = {}) {
  const avisos = [];
  const aviso = (tipo, texto, exemplos = []) => avisos.push({ tipo, texto, exemplos: exemplos.slice(0, 8) });
  const pad = (nome) => {
    const n = String(nome ?? '').trim().toUpperCase();
    const v = p.padronizacao[n] || n;
    return CORRECAO_NOME[v] || v;
  };
  const vendDe = (r) => pad(r['Vendedor padrão'] || r.Vendedor);
  const supDe = (r) => { const s = pad(r.Supervisor); return NAO_PESSOA.has(s) ? null : s; };

  // ---- Vendedores e supervisores ----
  const supervisores = new Set();
  const vendedores = new Map(); // nome -> { supervisores: Map(sup -> [qtd, ultimaData]) }
  const registrarVend = (r, dt) => {
    const v = vendDe(r);
    if (!v || NAO_PESSOA.has(v) && v !== 'VENDAS ADM') return;
    if (!vendedores.has(v)) vendedores.set(v, new Map());
    const s = supDe(r);
    if (s) {
      supervisores.add(s);
      const m = vendedores.get(v);
      const x = m.get(s) || [0, ''];
      m.set(s, [x[0] + 1, dt > x[1] ? dt : x[1]]);
    }
  };
  p.Vendas.forEach((r) => registrarVend(r, data(r['Data Pedido'])));
  p.Faturamento.forEach((r) => registrarVend(r, data(r['Data Emissão'])));
  p['Contas a Receber'].forEach((r) => registrarVend(r, ''));
  p['Contas Recebidas'].forEach((r) => registrarVend(r, data(r['Data Baixa'])));
  p['Parcelas Vencidas'].forEach((r) => registrarVend(r, ''));
  for (const s of supervisores) if (!vendedores.has(s)) vendedores.set(s, new Map());
  const usados = new Set(['admin']);
  const pessoas = [...vendedores.keys()].sort().map((nome) => {
    const partes = semAcento(nome).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((x) => x && !PREP.has(x));
    let login = partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : partes[0];
    for (let i = 1; usados.has(login); i++) login = partes.length > 2 && i === 1 ? `${partes[0]}.${partes[1]}.${partes[partes.length - 1]}` : `${partes[0]}.${partes[partes.length - 1]}${i}`;
    usados.add(login);
    // Equipe: o supervisor mais recente (e, no empate, o mais frequente) com quem o vendedor trabalhou.
    const sups = [...vendedores.get(nome)].sort((a, b) => (b[1][1].localeCompare(a[1][1])) || (b[1][0] - a[1][0]));
    const sup = supervisores.has(nome) ? nome : sups[0]?.[0] || null;
    return { nome, display: titulo(nome), login, perfil: supervisores.has(nome) ? 'supervisor' : 'vendedor', supervisor: sup, origem: `${ORIGEM}:usuario:${login}` };
  });
  const pessoaPorNome = new Map(pessoas.map((x) => [x.nome, x]));
  const refUsuario = (nome) => (nome === 'ADMINISTRADOR' ? '@admin' : pessoaPorNome.get(nome)?.origem || null);
  const multiplos = [...vendedores].filter(([, m]) => m.size > 1).map(([n]) => n);
  if (multiplos.length) aviso('info', `${multiplos.length} vendedores trabalharam com mais de um supervisor no ano; ficaram na equipe do supervisor mais recente.`, multiplos);

  // ---- Clientes (chave = CPF/CNPJ) ----
  const clientes = new Map(); // doc -> { nomes: Map(nome -> [qtd, ultData]), primeira, ultima, vend: [data, nome], cidade, uf, tel }
  const nomeParaDocs = new Map(); // chaveNome -> Map(doc -> qtd)
  const verCliente = (nome, docBruto, dt, vend) => {
    const doc = dig(docBruto);
    const kn = chaveNome(nome);
    if (!doc || !kn) return null;
    if (!clientes.has(doc)) clientes.set(doc, { doc, nomes: new Map(), primeira: dt || '9999', ultima: '', vend: ['', null] });
    const c = clientes.get(doc);
    const nm = limparNome(nome);
    const x = c.nomes.get(nm) || [0, ''];
    c.nomes.set(nm, [x[0] + 1, (dt || '') > x[1] ? dt : x[1]]);
    if (dt && dt < c.primeira) c.primeira = dt;
    if (dt && dt > c.ultima) c.ultima = dt;
    if (vend && (dt || '') >= c.vend[0]) c.vend = [dt || '', vend];
    if (!nomeParaDocs.has(kn)) nomeParaDocs.set(kn, new Map());
    nomeParaDocs.get(kn).set(doc, (nomeParaDocs.get(kn).get(doc) || 0) + 1);
    return c;
  };
  p.Faturamento.forEach((r) => verCliente(r.Cliente, r['CPF/CNPJ'], data(r['Data Emissão']), vendDe(r)));
  p['Contas Recebidas'].forEach((r) => verCliente(r.Cliente, r['CPF/CNPJ'], data(r['Data Baixa']), vendDe(r)));
  p['Parcelas Vencidas'].forEach((r) => {
    const c = verCliente(r.Cliente, r.Documento, data(r.Vencimento), vendDe(r));
    if (!c) return;
    const [cid, uf] = String(r['Cidade/UF'] || '').split('/');
    if (cid) { c.cidade = cid.trim(); c.uf = (uf || r.UF || '').trim().slice(0, 2); }
    if (dig(r.Telefone).length >= 10) c.tel = dig(r.Telefone);
  });
  /** Documento para um nome: o mais usado; nomes sem documento ganham um cadastro provisório. */
  const semDoc = new Map();
  const docDoNome = (nome) => {
    const embutido = docNoNome(nome);
    if (embutido && docValido(embutido)) {
      if (!clientes.has(embutido)) verCliente(nome, embutido, null, null);
      return embutido;
    }
    const m = nomeParaDocs.get(chaveNome(nome));
    if (m?.size) return [...m].sort((a, b) => b[1] - a[1])[0][0];
    const kn = chaveNome(nome);
    if (!kn) return null;
    if (!semDoc.has(kn)) semDoc.set(kn, { doc: `SEMDOC-${String(semDoc.size + 1).padStart(5, '0')}`, nome: limparNome(nome), nomes: new Map([[limparNome(nome), [1, '']]]), primeira: '9999', ultima: '', vend: ['', null], provisorio: true });
    return semDoc.get(kn).doc;
  };
  const ambiguos = [...nomeParaDocs].filter(([, m]) => m.size > 1);
  if (ambiguos.length) aviso('atencao', `${ambiguos.length} nomes de cliente aparecem com mais de um CPF/CNPJ (ex.: pessoa física e a empresa dela). Ficaram cadastros separados; pedidos só com o nome foram ligados ao documento mais usado.`, ambiguos.map(([n, m]) => `${n}: ${[...m.keys()].join(', ')}`));

  // ---- Notas fiscais (aba Faturamento) ----
  const vendasPorClienteValor = new Map();
  for (const r of p.Vendas) {
    const k = `${chaveNome(r.Cliente)}|${r2(r['Vlr. Líquido'])}`;
    if (!vendasPorClienteValor.has(k)) vendasPorClienteValor.set(k, []);
    vendasPorClienteValor.get(k).push(r);
  }
  const vistos = new Set();
  const fat = [];
  let duplicadas = 0;
  for (const r of p.Faturamento) {
    const k = `${r.Nota}|${chaveNome(r.Cliente)}|${r2(r.Valor)}|${data(r['Data Emissão'])}|${r['Natureza Operação']}`;
    if (vistos.has(k)) { duplicadas++; continue; }
    vistos.add(k);
    fat.push({ ...r });
  }
  if (duplicadas) aviso('info', `${duplicadas} linhas repetidas na aba Faturamento (coladas duas vezes) foram descartadas.`);
  const entradas = fat.filter((r) => ['Devolução', 'Outras entradas'].includes(r.Grupo));
  if (entradas.length) aviso('atencao', `${entradas.length} notas de entrada (devoluções e outras entradas, total R$ ${r2(entradas.reduce((a, r) => a + r.Valor, 0)).toLocaleString('pt-BR')}) não foram importadas como faturamento: a planilha não diz qual nota de venda cada uma devolve.`, entradas.slice(0, 8).map((r) => `NF ${r.Nota} ${r.Cliente} R$ ${r.Valor}`));
  const saidas = fat.filter((r) => !['Devolução', 'Outras entradas'].includes(r.Grupo));
  // Número de nota repetido para clientes diferentes: corrige pelo número que a aba Vendas mostra para o mesmo cliente e valor.
  const porNumero = new Map();
  saidas.forEach((r) => { if (!porNumero.has(r.Nota)) porNumero.set(r.Nota, []); porNumero.get(r.Nota).push(r); });
  const corrigidas = [];
  const descartadas = [];
  let copias = 0;
  for (const [n, lista] of porNumero) {
    if (new Set(lista.map((r) => dig(r['CPF/CNPJ']))).size === 1) continue;
    for (const r of lista) {
      const cand = (vendasPorClienteValor.get(`${chaveNome(r.Cliente)}|${r2(r.Valor)}`) || []).filter((v) => typeof num(v.NFE) === 'number');
      if (cand.some((v) => num(v.NFE) === n)) continue; // este é o dono legítimo do número
      const nums = cand.map((v) => num(v.NFE)).filter(Boolean);
      // O número certo já existe na aba para o mesmo cliente: esta linha é uma cópia com o número errado.
      if (nums.some((x) => (porNumero.get(x) || []).some((o) => o !== r && dig(o['CPF/CNPJ']) === dig(r['CPF/CNPJ'])))) { r._copia = true; copias++; continue; }
      const outro = nums.find((x) => !porNumero.has(x));
      if (outro) { corrigidas.push(`NF ${n} → ${outro} (${r.Cliente})`); r.Nota = outro; } else r._conflito = true;
    }
  }
  const finais = new Map();
  for (const r of saidas) {
    if (r._copia) continue;
    const k = r.Nota;
    if (finais.has(k) && dig(finais.get(k)['CPF/CNPJ']) !== dig(r['CPF/CNPJ'])) { descartadas.push(`NF ${k} ${r.Cliente} R$ ${r.Valor}`); continue; }
    if (finais.has(k)) {
      // Mesma nota em duas linhas (naturezas diferentes): soma os valores.
      const f = finais.get(k);
      f.Valor = r2(f.Valor + r.Valor);
      if (!String(f['Natureza Operação']).includes(r['Natureza Operação'])) f['Natureza Operação'] += ` + ${r['Natureza Operação']}`;
      continue;
    }
    finais.set(k, { ...r });
  }
  if (corrigidas.length) aviso('atencao', `${corrigidas.length} números de nota repetidos para clientes diferentes na aba Faturamento foram corrigidos pelo número que a aba Vendas mostra para o mesmo cliente e valor.`, corrigidas);
  if (copias) aviso('info', `${copias} linhas do Faturamento eram cópias de outra nota com o número trocado (ex.: a "nota 6053" repetida em vários meses) e foram descartadas.`);
  if (descartadas.length) aviso('erro', `${descartadas.length} notas com número repetido sem como corrigir ficaram de fora.`, descartadas);

  // ---- Pedidos (aba Vendas) ----
  const pedidos = [...p.Vendas]
    .filter((r, i, a) => a.findIndex((x) => x['Nº Pedido'] === r['Nº Pedido']) === i)
    .map((r) => ({ ...r, _dt: dataDoCodigo(r['Nº Pedido'], data(r['Data Pedido'])) }))
    .sort((a, b) => a._dt.localeCompare(b._dt) || String(a['Nº Pedido']).localeCompare(String(b['Nº Pedido'])));
  const ultimoMes = pedidos.map((r) => r._dt.slice(0, 7)).sort().pop();
  const notaPorNumero = new Map([...finais.values()].map((r) => [r.Nota, r]));
  let cancelados = 0;
  const pedidosSaida = pedidos.map((r, i) => {
    const nf = num(r.NFE);
    const nota = nf ? notaPorNumero.get(nf) : null;
    const doc = nota && chaveNome(nota.Cliente) === chaveNome(r.Cliente) ? dig(nota['CPF/CNPJ']) : docDoNome(r.Cliente);
    let etapa = ETAPA[r.Status];
    const obs = [`Importado do sistema anterior (pedido ${r['Nº Pedido']}, situação "${r.Status}")`];
    if (nf) obs.push(`NF ${nf}`);
    if (nf && (etapa === 'venda' || etapa === null)) etapa = 'entregue';
    if (!etapa) etapa = 'cancelado';
    if (etapa === 'venda' && r._dt.slice(0, 7) !== ultimoMes) {
      // Pedido parado no vendedor desde meses anteriores, sem nota: não volta para a fila.
      etapa = 'cancelado';
      cancelados++;
      obs.push('Sem nota fiscal e parado na etapa Vendedor no sistema anterior: importado como cancelado');
    }
    if (doc) {
      const c = clientes.get(doc) || [...semDoc.values()].find((x) => x.doc === doc);
      if (c) {
        if (r._dt.slice(0, 10) < c.primeira) c.primeira = r._dt.slice(0, 10);
        if (r._dt.slice(0, 10) >= c.vend[0]) c.vend = [r._dt.slice(0, 10), vendDe(r)];
      }
    }
    return {
      numero: 10001 + i, codigo: String(r['Nº Pedido']), doc, vend: refUsuario(vendDe(r)), sup: refUsuario(supDe(r) || ''), forma: FORMAS[r['Forma Pagamento']]?.nome || null,
      etapa, valor: r2(r['Vlr. Líquido']), criado: r._dt, nf, obs: obs.join('. '), origem: `${ORIGEM}:pedido:${r['Nº Pedido']}`,
    };
  });
  if (cancelados) aviso('atencao', `${cancelados} pedidos sem nota que estavam parados na etapa Vendedor desde antes de ${ultimoMes.split('-').reverse().join('/')} entraram como cancelados (os de ${ultimoMes.split('-').reverse().join('/')} ficaram na fila do vendedor).`);
  const pedidoPorCodigo = new Map(pedidosSaida.map((x) => [x.codigo, x]));
  const pedidoPorNF = new Map(pedidosSaida.filter((x) => x.nf).map((x) => [x.nf, x]));
  const nfSemLinha = pedidosSaida.filter((x) => x.nf && !notaPorNumero.has(x.nf));
  if (nfSemLinha.length) aviso('info', `${nfSemLinha.length} pedidos citam uma NF que não está na aba Faturamento (provavelmente emitida depois de 30/09). O número ficou registrado na observação do pedido.`, nfSemLinha.map((x) => `Pedido ${x.codigo} NF ${x.nf}`));

  const notas = [...finais.values()].map((r) => {
    const ped = pedidoPorNF.get(r.Nota);
    return {
      numero: r.Nota, doc: dig(r['CPF/CNPJ']), valor: r2(r.Valor), emissao: `${data(r['Data Emissão'])} 12:00:00`, natureza: r['Natureza Operação'],
      ped: ped && ped.doc === dig(r['CPF/CNPJ']) ? ped.origem : null, origem: `${ORIGEM}:nf:${empresaId}:1:${r.Nota}`,
    };
  });

  // ---- Parcelas em aberto (Contas a Receber + Parcelas Vencidas) ----
  const recebidas = p['Contas Recebidas'];
  const liquidadas = p['Parcelas Liquidadas'];
  const pagoChave = new Set(recebidas.map((r) => `${dig(r['CPF/CNPJ'])}|${data(r.Vencimento)}|${r2(r['Vlr. Título'])}`));
  const receber = new Map();
  for (const r of p['Contas a Receber']) {
    const k = `${chaveNome(r.Cliente)}|${data(r.Vencimento)}|${r2(r['Valor Título'])}`;
    if (!receber.has(k)) receber.set(k, []);
    receber.get(k).push(r);
  }
  const abertas = [];
  const usadosReceber = new Set();
  const parcelaNum = (s) => { const m = String(s ?? '').match(/(\d+)\s*\/\s*(\d+)/); return m ? [Number(m[1]), Number(m[2])] : [num(s) || null, null]; };
  const vistosPV = new Set();
  let pagasDepois = 0;
  for (const r of p['Parcelas Vencidas']) {
    const doc = dig(r.Documento);
    const venc = data(r.Vencimento);
    const valor = r2(r['Vlr. Título']);
    const kd = `${doc}|${r.Nota}|${r.Parcela}|${venc}|${valor}`;
    if (vistosPV.has(kd)) continue;
    vistosPV.add(kd);
    if (pagoChave.has(`${doc}|${venc}|${valor}`)) { pagasDepois++; continue; }
    const k = `${chaveNome(r.Cliente)}|${venc}|${valor}`;
    const par = (receber.get(k) || []).find((x) => !usadosReceber.has(x));
    if (par) usadosReceber.add(par);
    const [n, tot] = parcelaNum(par?.Parcela);
    const ped = par ? pedidoPorCodigo.get(String(par.Pedido)) : pedidoPorNF.get(num(r.Nota));
    abertas.push({
      doc, venc, valor, numero: num(r.Parcela) || n || 1, total: tot || (par ? num(par['Parcelas do pedido']) : null), nota: num(r.Nota),
      ped: ped?.origem || null, pedCodigo: par ? String(par.Pedido) : ped?.codigo || null, forma: FORMAS[par?.['Forma Pagamento']]?.baixa || 'boleto',
    });
  }
  for (const [, lista] of receber) {
    for (const r of lista) {
      if (usadosReceber.has(r)) continue;
      const doc = docDoNome(r.Cliente);
      const venc = data(r.Vencimento);
      const valor = r2(r['Valor Título']);
      if (pagoChave.has(`${doc}|${venc}|${valor}`)) { pagasDepois++; continue; }
      const [n, tot] = parcelaNum(r.Parcela);
      const ped = pedidoPorCodigo.get(String(r.Pedido));
      abertas.push({ doc, venc, valor, numero: n || 1, total: tot || num(r['Parcelas do pedido']), nota: ped?.nf || null, ped: ped?.origem || null, pedCodigo: String(r.Pedido), forma: FORMAS[r['Forma Pagamento']]?.baixa || 'boleto' });
    }
  }
  if (pagasDepois) aviso('info', `${pagasDepois} parcelas listadas como vencidas aparecem pagas em Contas Recebidas e entraram só como pagas.`);

  // ---- Parcelas pagas (Contas Recebidas, com o nº da nota da aba Parcelas Liquidadas na mesma linha) ----
  const pagas = recebidas.map((r, i) => {
    const l = liquidadas[i];
    const mesmo = l && data(l['Data Baixa']) === data(r['Data Baixa']) && dig(l['CPF/CNPJ']) === dig(r['CPF/CNPJ']) && r2(l['Vlr. Recebido']) === r2(r['Vlr. Recebido']);
    const titulo_ = r2(r['Vlr. Título']);
    const recebido = r2(r['Vlr. Recebido']);
    const ped = pedidoPorCodigo.get(String(r['Nº Pedido']));
    return {
      doc: dig(r['CPF/CNPJ']), venc: data(r.Vencimento), valor: titulo_, recebido, baixa: data(r['Data Baixa']), parcial: r.Quitação === 'PARCIAL',
      nota: mesmo ? num(l['Nº Nota']) : null, ped: ped?.origem || null, pedCodigo: String(r['Nº Pedido']), forma: FORMAS[r['Forma Pagamento']]?.baixa || 'boleto',
    };
  });
  // Pagamento parcial com saldo ainda em aberto: o título fica um só (valor original, já pago em parte).
  let parciaisUnidas = 0;
  for (const pg of pagas.filter((x) => x.parcial)) {
    const ab = abertas.find((a) => a.doc === pg.doc && a.venc === pg.venc && !a.pagoParcial);
    if (ab) { ab.pagoParcial = pg; pg.unida = true; parciaisUnidas++; }
  }
  const parciaisSoltas = pagas.filter((x) => x.parcial && !x.unida);
  if (parciaisSoltas.length) aviso('atencao', `${parciaisSoltas.length} baixas parciais não têm o saldo restante entre as parcelas em aberto (saldo total R$ ${r2(parciaisSoltas.reduce((a, x) => a + x.valor - x.recebido, 0)).toLocaleString('pt-BR')}). Entraram como parcelas em aberto com o valor já pago; confira se o saldo foi renegociado ou baixado.`, parciaisSoltas.map((x) => `${x.doc} venc. ${x.venc} título ${x.valor} pago ${x.recebido}`));
  if (parciaisUnidas) aviso('info', `${parciaisUnidas} baixas parciais foram unidas à parcela em aberto correspondente.`);

  // Numeração: parcelas abertas trazem "k / n"; as pagas recebem os números restantes pela ordem de vencimento.
  const porPedido = new Map();
  const grupo = (x) => x.pedCodigo || `${x.doc}|${x.nota || ''}`;
  for (const a of abertas) { if (!porPedido.has(grupo(a))) porPedido.set(grupo(a), { usados: new Set(), total: null, pagas: [] }); const g = porPedido.get(grupo(a)); g.usados.add(a.numero); g.total ||= a.total; }
  for (const pg of pagas.filter((x) => !x.unida)) { if (!porPedido.has(grupo(pg))) porPedido.set(grupo(pg), { usados: new Set(), total: null, pagas: [] }); porPedido.get(grupo(pg)).pagas.push(pg); }
  for (const g of porPedido.values()) {
    g.pagas.sort((a, b) => a.venc.localeCompare(b.venc) || a.baixa.localeCompare(b.baixa));
    let n = 1;
    for (const pg of g.pagas) { while (g.usados.has(n)) n++; pg.numero = n; g.usados.add(n); }
    const tot = g.total || null;
    for (const pg of g.pagas) pg.total = tot;
  }
  const contagem = new Map();
  const origemUnica = (base) => { const c = (contagem.get(base) || 0) + 1; contagem.set(base, c); return `${base}#${c}`; };
  const parcelas = [
    ...abertas.map((a) => ({
      ...a, status: 'a_pagar', valorPago: a.pagoParcial ? a.pagoParcial.recebido : 0, dataPg: a.pagoParcial ? a.pagoParcial.baixa : null, juros: 0, desconto: 0,
      obs: [a.nota ? `NF ${a.nota}` : null, a.pagoParcial ? `Pagamento parcial de R$ ${a.pagoParcial.recebido} em ${a.pagoParcial.baixa}` : null, 'Importada do sistema anterior'].filter(Boolean).join(' · '),
      origem: origemUnica(`${ORIGEM}:aberta:${a.doc}|${a.venc}|${a.valor}`),
    })),
    ...pagas.filter((x) => !x.unida).map((x) => ({
      ...x, status: x.parcial ? 'a_pagar' : 'liquidada', valorPago: x.recebido, dataPg: x.baixa,
      juros: !x.parcial && x.recebido > x.valor ? r2(x.recebido - x.valor) : 0, desconto: !x.parcial && x.recebido < x.valor ? r2(x.valor - x.recebido) : 0,
      obs: [x.nota ? `NF ${x.nota}` : null, `Pedido ${x.pedCodigo}`, x.total ? null : 'Nº da parcela estimado pela ordem de vencimento', 'Importada do sistema anterior'].filter(Boolean).join(' · '),
      origem: origemUnica(`${ORIGEM}:paga:${x.doc}|${x.venc}|${x.valor}|${x.baixa}|${x.recebido}`),
    })),
  ];
  for (const x of parcelas) if (!x.doc) x.doc = null;
  const semCliente = parcelas.filter((x) => !x.doc);
  if (semCliente.length) aviso('erro', `${semCliente.length} parcelas sem cliente identificável ficaram de fora.`);

  // ---- Clientes finais ----
  const docsUsados = new Set([...pedidosSaida.map((x) => x.doc), ...notas.map((x) => x.doc), ...parcelas.map((x) => x.doc)].filter(Boolean));
  const listaClientes = [...clientes.values(), ...semDoc.values()].filter((c) => docsUsados.has(c.doc)).map((c) => {
    const nome = [...c.nomes].sort((a, b) => (b[1][1] || '').localeCompare(a[1][1] || '') || b[1][0] - a[1][0])[0][0];
    const valido = c.provisorio ? false : docValido(c.doc);
    const obs = c.provisorio ? 'CPF/CNPJ não veio na importação do sistema anterior: complete o cadastro.' : !valido ? 'CPF/CNPJ do sistema anterior não passou na validação: confira.' : null;
    return {
      doc: c.doc, nome, tipo: c.doc.length === 14 ? 'J' : 'F', vend: refUsuario(c.vend[1]), criado: `${c.primeira === '9999' ? '2026-01-01' : c.primeira} 08:00:00`,
      obs, cidade: c.cidade || null, uf: c.uf || null, tel: c.tel || null, origem: `${ORIGEM}:cliente:${c.doc}`, valido, provisorio: !!c.provisorio,
    };
  });
  const prov = listaClientes.filter((c) => c.provisorio);
  if (prov.length) aviso('atencao', `${prov.length} clientes aparecem só pelo nome (nenhuma aba traz o CPF/CNPJ deles). Entraram com documento provisório "SEMDOC-..." e o aviso para completar o cadastro.`, prov.map((c) => c.nome));
  const inval = listaClientes.filter((c) => !c.provisorio && !c.valido);
  if (inval.length) aviso('atencao', `${inval.length} ${inval.length === 1 ? 'CPF/CNPJ não passou' : 'CPF/CNPJ não passaram'} na validação e ${inval.length === 1 ? 'foi mantido' : 'foram mantidos'} como veio.`, inval.map((c) => `${c.doc} ${c.nome}`));

  // ---- Totais para conferência ----
  const soma = (l, f) => r2(l.reduce((a, x) => a + (f(x) || 0), 0));
  const porMes = {};
  for (const x of pedidosSaida.filter((y) => y.etapa !== 'cancelado')) { const m = x.criado.slice(0, 7); porMes[m] ||= [0, 0]; porMes[m][0]++; porMes[m][1] = r2(porMes[m][1] + x.valor); }
  const totais = {
    colaboradores: pessoas.length, supervisores: pessoas.filter((x) => x.perfil === 'supervisor').length, clientes: listaClientes.length,
    clientes_sem_documento: prov.length, pedidos: pedidosSaida.length, pedidos_por_etapa: pedidosSaida.reduce((a, x) => ((a[x.etapa] = (a[x.etapa] || 0) + 1), a), {}),
    valor_pedidos: soma(pedidosSaida, (x) => x.valor), notas: notas.length, valor_notas: soma(notas, (x) => x.valor),
    parcelas_abertas: parcelas.filter((x) => x.status === 'a_pagar').length, saldo_aberto: soma(parcelas.filter((x) => x.status === 'a_pagar'), (x) => x.valor - x.valorPago),
    parcelas_pagas: parcelas.filter((x) => x.status === 'liquidada').length, valor_recebido: soma(pagas, (x) => x.recebido), vendas_por_mes: porMes,
    maior_nf: Math.max(...notas.map((x) => x.numero), ...pedidosSaida.map((x) => x.nf || 0)),
  };
  return { pessoas, clientes: listaClientes, pedidos: pedidosSaida, notas, parcelas: parcelas.filter((x) => x.doc), avisos, totais, empresaId };
}

// ---------- SQL ----------
function lotes(lista, tam) { const out = []; for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam)); return out; }
const valores = (linhas, f) => linhas.map((x) => `(${f(x).map(q).join(',')})`).join(',\n');
const USUARIO_REF = (col) => `(SELECT u.id FROM usuarios u WHERE u.origem = ${col} OR (${col} = '@admin' AND u.login = 'admin') ORDER BY u.id LIMIT 1)`;

function gerarSql(d) {
  const E = d.empresaId;
  const sql = [];
  // Mesmas colunas de controle do schema (caso o banco ainda não tenha recebido a versão nova).
  sql.push(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').split('-- ============ Importação do sistema anterior ============')[1].trim());

  // Formas de pagamento e uma condição padrão de cada.
  sql.push(`INSERT INTO formas_pagamento (nome, tipo, tipo_baixa, origem)
SELECT v.nome, v.tipo, v.baixa, v.origem FROM (VALUES ${valores(Object.values(FORMAS), (f) => [f.nome, f.tipo, f.baixa, `${ORIGEM}:forma:${f.baixa}`])}) v(nome, tipo, baixa, origem)
WHERE NOT EXISTS (SELECT 1 FROM formas_pagamento f WHERE upper(f.nome) = upper(v.nome)) ON CONFLICT DO NOTHING;
INSERT INTO condicoes_pagamento (forma_id, descricao, parcelas, intervalo_dias, carencia_dias)
SELECT f.id, v.descr, v.parc, v.intervalo, v.carencia FROM (VALUES ${valores(Object.values(FORMAS), (f) => [f.nome, ...f.cond])}) v(nome, descr, parc, intervalo, carencia)
JOIN formas_pagamento f ON upper(f.nome) = upper(v.nome)
WHERE NOT EXISTS (SELECT 1 FROM condicoes_pagamento c WHERE c.forma_id = f.id);`);

  // Colaboradores e usuários (sem acesso: o administrador libera e define a senha quando quiser).
  sql.push(`INSERT INTO colaboradores (nome, cargo, setor, empresa_id, observacao, origem)
SELECT v.nome, v.cargo, 'Comercial', ${E}, 'Importado do sistema anterior', v.origem FROM (VALUES ${valores(d.pessoas, (x) => [x.display, x.perfil === 'supervisor' ? 'Supervisor de vendas' : 'Vendedor', x.origem])}) v(nome, cargo, origem)
ON CONFLICT DO NOTHING;
INSERT INTO usuarios (nome, login, senha_hash, perfil, colaborador_id, ativo, trocar_senha, origem)
SELECT v.nome, CASE WHEN EXISTS (SELECT 1 FROM usuarios x WHERE x.login = v.login) THEN v.login || '.imp' ELSE v.login END, v.hash, v.perfil, c.id, 0, 1, v.origem
FROM (VALUES ${valores(d.pessoas, (x) => [x.display, x.login, `bloqueado:${crypto.randomBytes(24).toString('hex')}`, x.perfil, x.origem])}) v(nome, login, hash, perfil, origem)
JOIN colaboradores c ON c.origem = v.origem
WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.origem = v.origem) ON CONFLICT DO NOTHING;
INSERT INTO usuario_empresas (usuario_id, empresa_id) SELECT id, ${E} FROM usuarios WHERE origem LIKE '${ORIGEM}:%' ON CONFLICT DO NOTHING;`);
  const sups = d.pessoas.filter((x) => x.perfil === 'supervisor');
  if (sups.length) {
    sql.push(`INSERT INTO equipes (nome, supervisor_id, origem)
SELECT 'Equipe ' || u.nome, u.id, 'equipe:' || v.origem FROM (VALUES ${valores(sups, (x) => [x.origem])}) v(origem) JOIN usuarios u ON u.origem = v.origem
ON CONFLICT DO NOTHING;
UPDATE usuarios u SET equipe_id = e.id FROM (VALUES ${valores(d.pessoas.filter((x) => x.supervisor), (x) => [x.origem, d.pessoas.find((y) => y.nome === x.supervisor)?.origem])}) v(usuario, sup)
JOIN equipes e ON e.origem = 'equipe:' || v.sup WHERE u.origem = v.usuario AND u.equipe_id IS NULL;`);
  }

  // Clientes, endereço (cidade/UF) e telefone.
  for (const l of lotes(d.clientes, 400)) {
    sql.push(`INSERT INTO clientes (tipo_pessoa, documento, nome, vendedor_id, observacao, created_at, base_legal, origem)
SELECT v.tipo, v.doc, v.nome, ${USUARIO_REF('v.vend')}, v.obs, v.criado, 'execucao_contrato', v.origem
FROM (VALUES ${valores(l, (c) => [c.tipo, c.doc, c.nome, c.vend || '', c.obs, c.criado, c.origem])}) v(tipo, doc, nome, vend, obs, criado, origem)
ON CONFLICT DO NOTHING;`);
  }
  const comEnd = d.clientes.filter((c) => c.cidade);
  for (const l of lotes(comEnd, 500)) {
    sql.push(`INSERT INTO cliente_enderecos (cliente_id, tipo, cidade, uf, principal)
SELECT c.id, 'Entrega', v.cidade, v.uf, 1 FROM (VALUES ${valores(l, (c) => [c.doc, c.cidade, c.uf])}) v(doc, cidade, uf)
JOIN clientes c ON c.documento = v.doc WHERE NOT EXISTS (SELECT 1 FROM cliente_enderecos e WHERE e.cliente_id = c.id);`);
  }
  const comTel = d.clientes.filter((c) => c.tel);
  for (const l of lotes(comTel, 500)) {
    sql.push(`INSERT INTO cliente_telefones (cliente_id, tipo, numero, whatsapp)
SELECT c.id, CASE WHEN length(v.tel) = 11 THEN 'Celular' ELSE 'Fixo' END, v.tel, CASE WHEN length(v.tel) = 11 THEN 1 ELSE 0 END FROM (VALUES ${valores(l, (c) => [c.doc, c.tel])}) v(doc, tel)
JOIN clientes c ON c.documento = v.doc WHERE NOT EXISTS (SELECT 1 FROM cliente_telefones t WHERE t.cliente_id = c.id);`);
  }

  // Pedidos e o registro no histórico.
  for (const l of lotes(d.pedidos, 300)) {
    sql.push(`INSERT INTO pedidos (numero, empresa_id, cliente_id, vendedor_id, supervisor_id, forma_id, etapa, valor_produtos, valor_desconto, valor_total, observacao,
  endereco_entrega_id, created_at, updated_at, etapa_desde, codigo_origem, origem)
SELECT v.numero, ${E}, c.id, COALESCE(${USUARIO_REF('v.vend')}, (SELECT id FROM usuarios WHERE login = 'admin')), ${USUARIO_REF('v.sup')},
  (SELECT f.id FROM formas_pagamento f WHERE f.nome = v.forma ORDER BY f.id LIMIT 1), v.etapa, v.valor, 0, v.valor, v.obs,
  (SELECT e.id FROM cliente_enderecos e WHERE e.cliente_id = c.id ORDER BY e.principal DESC, e.id LIMIT 1), v.criado, v.criado, v.criado, v.codigo, v.origem
FROM (VALUES ${valores(l, (x) => [x.numero, x.doc, x.vend || '', x.sup || '', x.forma, x.etapa, x.valor, x.obs, x.criado, x.codigo, x.origem])})
  v(numero, doc, vend, sup, forma, etapa, valor, obs, criado, codigo, origem)
JOIN clientes c ON c.documento = v.doc
ON CONFLICT DO NOTHING;`);
  }
  sql.push(`INSERT INTO pedido_historico (pedido_id, etapa_origem, etapa_destino, acao, observacao, created_at)
SELECT p.id, NULL, p.etapa, 'Importado do sistema anterior', p.observacao, p.created_at FROM pedidos p
WHERE p.origem LIKE '${ORIGEM}:%' AND NOT EXISTS (SELECT 1 FROM pedido_historico h WHERE h.pedido_id = p.id);`);

  // Notas fiscais.
  for (const l of lotes(d.notas, 400)) {
    sql.push(`INSERT INTO notas_fiscais (numero, serie, empresa_id, pedido_id, cliente_id, valor, status, data_emissao, natureza, origem)
SELECT v.numero, 1, ${E}, (SELECT p.id FROM pedidos p WHERE p.origem = v.ped), c.id, v.valor, 'autorizada', v.emissao, v.natureza, v.origem
FROM (VALUES ${valores(l, (x) => [x.numero, x.doc, x.valor, x.emissao, x.natureza, x.ped || '', x.origem])}) v(numero, doc, valor, emissao, natureza, ped, origem)
JOIN clientes c ON c.documento = v.doc
ON CONFLICT DO NOTHING;`);
  }
  // Pedido entregue: data de embarque e entrega aproximadas pela emissão da nota (o relatório não traz as datas reais).
  sql.push(`UPDATE pedidos p SET data_embarque = substr(n.data_emissao, 1, 10)
FROM notas_fiscais n WHERE n.pedido_id = p.id AND p.origem LIKE '${ORIGEM}:%' AND p.etapa IN ('entregue','devolucao','expedicao') AND p.data_embarque IS NULL;`);

  // Parcelas.
  for (const l of lotes(d.parcelas, 400)) {
    sql.push(`INSERT INTO parcelas (pedido_id, nota_id, cliente_id, empresa_id, numero, total_parcelas, vencimento, vencimento_original, valor, juros, desconto,
  valor_pago, data_pagamento, status, tipo_baixa, observacao, created_at, origem)
SELECT (SELECT p.id FROM pedidos p WHERE p.origem = v.ped), (SELECT n.id FROM notas_fiscais n WHERE n.empresa_id = ${E} AND n.serie = 1 AND n.numero = v.nota AND n.cliente_id = c.id),
  c.id, ${E}, v.numero, NULLIF(v.total, -1), v.venc, v.venc, v.valor, v.juros, v.desconto, v.pago, v.dtpg, v.status, v.forma, v.obs, v.venc || ' 08:00:00', v.origem
FROM (VALUES ${valores(l, (x) => [x.ped || '', x.nota ?? -1, x.doc, x.numero, x.total ?? -1, x.venc, x.valor, x.juros, x.desconto, x.valorPago, x.dataPg, x.status, x.forma, x.obs, x.origem])})
  v(ped, nota, doc, numero, total, venc, valor, juros, desconto, pago, dtpg, status, forma, obs, origem)
JOIN clientes c ON c.documento = v.doc
ON CONFLICT DO NOTHING;`);
  }

  // Numeração da NF-e continua a partir da maior nota conhecida.
  sql.push(`INSERT INTO sequencias (nome, valor) VALUES ('nfe_${E}', ${d.totais.maior_nf}) ON CONFLICT (nome) DO UPDATE SET valor = GREATEST(sequencias.valor, EXCLUDED.valor);
INSERT INTO auditoria (usuario_nome, acao, entidade, entidade_id, depois, rota)
VALUES ('Importação', 'importacao', 'planilha', '${ORIGEM}', ${q(JSON.stringify(d.totais))}::jsonb, 'scripts/importar-planilha.js');`);
  return sql;
}

function sqlDesfazer() {
  const o = `'${ORIGEM}:%'`;
  return [`DELETE FROM parcela_eventos WHERE parcela_id IN (SELECT id FROM parcelas WHERE origem LIKE ${o});
DELETE FROM parcelas WHERE origem LIKE ${o};
UPDATE notas_fiscais SET pedido_id = NULL WHERE origem LIKE ${o};
DELETE FROM notas_fiscais WHERE origem LIKE ${o};
DELETE FROM pedidos WHERE origem LIKE ${o};
DELETE FROM clientes WHERE origem LIKE ${o};
UPDATE usuarios SET equipe_id = NULL WHERE equipe_id IN (SELECT id FROM equipes WHERE origem LIKE 'equipe:${ORIGEM}:%');
DELETE FROM equipes WHERE origem LIKE 'equipe:${ORIGEM}:%';
DELETE FROM usuarios WHERE origem LIKE ${o};
DELETE FROM colaboradores WHERE origem LIKE ${o};
DELETE FROM formas_pagamento f WHERE origem LIKE ${o} AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.forma_id = f.id);
INSERT INTO auditoria (usuario_nome, acao, entidade, entidade_id, rota) VALUES ('Importação', 'importacao_desfeita', 'planilha', '${ORIGEM}', 'scripts/importar-planilha.js');`];
}

// ---------- relatório ----------
function relatorio(d, arquivo) {
  const t = d.totais;
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const icone = { erro: '❌', atencao: '⚠️', info: 'ℹ️' };
  return `# Importação da planilha do sistema anterior

Arquivo: \`${path.basename(String(arquivo))}\` · gerado em ${new Date().toLocaleString('pt-BR')}

## O que será importado

| Item | Quantidade | Valor |
|---|---:|---:|
| Vendedores e supervisores (usuários sem acesso, colaboradores e equipes) | ${t.colaboradores} (${t.supervisores} supervisores) | |
| Clientes | ${t.clientes} (${t.clientes_sem_documento} sem CPF/CNPJ) | |
| Pedidos | ${t.pedidos} | ${brl(t.valor_pedidos)} |
| Notas fiscais de saída | ${t.notas} | ${brl(t.valor_notas)} |
| Parcelas em aberto | ${t.parcelas_abertas} | ${brl(t.saldo_aberto)} |
| Parcelas pagas | ${t.parcelas_pagas} | ${brl(t.valor_recebido)} recebidos |

Pedidos por etapa: ${Object.entries(t.pedidos_por_etapa).map(([k, v]) => `${k} ${v}`).join(' · ')}

Próxima NF-e: a numeração continua depois da nota **${t.maior_nf}** (confirme o número real no sistema anterior).

### Vendas por mês (sem cancelados)

| Mês | Pedidos | Valor |
|---|---:|---:|
${Object.entries(t.vendas_por_mes).sort().map(([m, [n, v]]) => `| ${m.split('-').reverse().join('/')} | ${n} | ${brl(v)} |`).join('\n')}

## Ajustes e pontos de atenção

${d.avisos.map((a) => `- ${icone[a.tipo]} ${a.texto}${a.exemplos.length ? `\n  - Exemplos: ${a.exemplos.map((e) => `\`${e}\``).join(', ')}` : ''}`).join('\n')}
`;
}

// ---------- execução ----------
/** Executa os blocos de SQL numa única transação: ou entra tudo, ou nada. */
async function executar(blocos) {
  const db = require('./db');
  const m = await db.open();
  await m.transacao(async (exec) => { for (const s of blocos) for (const st of dividir(s)) await exec(st, []); });
}

/** Quanto já existe no banco vindo desta importação (para conferir com os totais previstos). */
async function situacao() {
  const db = require('./db');
  const o = `LIKE '${ORIGEM}:%'`;
  return db.get(`SELECT
    (SELECT COUNT(*) FROM usuarios WHERE origem ${o}) AS colaboradores,
    (SELECT COUNT(*) FROM usuarios WHERE origem ${o} AND perfil = 'supervisor') AS supervisores,
    (SELECT COUNT(*) FROM clientes WHERE origem ${o}) AS clientes,
    (SELECT COUNT(*) FROM clientes WHERE origem ${o} AND documento LIKE 'SEMDOC-%') AS clientes_sem_documento,
    (SELECT COUNT(*) FROM pedidos WHERE origem ${o}) AS pedidos,
    (SELECT COALESCE(ROUND(SUM(valor_total)::numeric, 2), 0) FROM pedidos WHERE origem ${o}) AS valor_pedidos,
    (SELECT COUNT(*) FROM notas_fiscais WHERE origem ${o}) AS notas,
    (SELECT COALESCE(ROUND(SUM(valor)::numeric, 2), 0) FROM notas_fiscais WHERE origem ${o}) AS valor_notas,
    (SELECT COUNT(*) FROM parcelas WHERE origem ${o} AND status = 'a_pagar') AS parcelas_abertas,
    (SELECT COALESCE(ROUND(SUM(valor - valor_pago)::numeric, 2), 0) FROM parcelas WHERE origem ${o} AND status = 'a_pagar') AS saldo_aberto,
    (SELECT COUNT(*) FROM parcelas WHERE origem ${o} AND status = 'liquidada') AS parcelas_pagas,
    (SELECT COALESCE(ROUND(SUM(valor_pago)::numeric, 2), 0) FROM parcelas WHERE origem ${o}) AS valor_recebido`);
}

/** Compara o que está no banco com o que a planilha previu. */
function conferir(totais, banco) {
  return Object.keys(banco).map((k) => ({ item: k, previsto: totais[k], banco: banco[k], ok: Math.abs(Number(banco[k]) - Number(totais[k])) < 0.05 }));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const comValor = ['--empresa', '--relatorio', '--sql'];
  const arquivo = args.find((a, i) => !a.startsWith('--') && !comValor.includes(args[i - 1]));
  const db = require('./db');
  if (args.includes('--desfazer')) {
    await executar(sqlDesfazer());
    await db.close();
    console.log('Importação desfeita.');
    return;
  }
  if (!arquivo) { console.error('Uso: node scripts/importar-planilha.js <arquivo.xlsx> [--relatorio r.md] [--sql pasta] [--aplicar] [--desfazer]'); process.exit(1); }
  const dados = transformar(await lerPlanilha(arquivo), { empresaId: Number(opt('--empresa') || 1) });
  const rel = relatorio(dados, arquivo);
  if (opt('--relatorio')) fs.writeFileSync(opt('--relatorio'), rel);
  else console.log(rel);
  const sql = gerarSql(dados);
  if (opt('--sql')) {
    fs.mkdirSync(opt('--sql'), { recursive: true });
    sql.forEach((s, i) => fs.writeFileSync(path.join(opt('--sql'), `${String(i + 1).padStart(3, '0')}.sql`), s + '\n'));
    fs.writeFileSync(path.join(opt('--sql'), 'desfazer.sql'), sqlDesfazer().join('\n'));
    fs.writeFileSync(path.join(opt('--sql'), 'totais.json'), JSON.stringify(dados.totais, null, 2));
    console.error(`${sql.length} arquivos SQL gravados em ${opt('--sql')}`);
  }
  if (args.includes('--aplicar')) {
    const t0 = Date.now();
    await executar(sql);
    const c = conferir(dados.totais, await situacao());
    for (const x of c) console.error(`${x.ok ? 'OK ' : 'DIF'} ${x.item.padEnd(24)} banco=${x.banco} previsto=${x.previsto}`);
    console.error(`Importação aplicada em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  }
  await db.close();
}

/** Separa um bloco em comandos (o PGlite e o protocolo estendido do pg executam um por vez). */
function dividir(bloco) {
  const out = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < bloco.length; i++) {
    const ch = bloco[i];
    if (ch === "'") aspas = !aspas;
    if (ch === ';' && !aspas) { if (atual.trim()) out.push(atual.trim()); atual = ''; continue; }
    if (!aspas && ch === '-' && bloco[i + 1] === '-') { const fim = bloco.indexOf('\n', i); i = fim < 0 ? bloco.length : fim; atual += '\n'; continue; }
    atual += ch;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

module.exports = { ORIGEM, lerPlanilha, transformar, gerarSql, sqlDesfazer, relatorio, dividir, executar, situacao, conferir, main };
