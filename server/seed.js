// Dados de demonstração. Uso: npm run seed (apaga e recria o banco).
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const A = require('./auth');
const S = require('./services');

function prng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = prng(20261023);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

function cpf() {
  const n = Array.from({ length: 9 }, () => int(0, 9));
  for (const t of [9, 10]) {
    const s = n.reduce((a, d, i) => a + d * (t + 1 - i), 0);
    n.push(((s * 10) % 11) % 10);
  }
  return n.join('');
}
function cnpj() {
  const n = [...Array.from({ length: 8 }, () => int(0, 9)), 0, 0, 0, 1];
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const r = pesos.reduce((a, p, i) => a + n[i] * p, 0) % 11;
    n.push(r < 2 ? 0 : 11 - r);
  }
  return n.join('');
}
const ts = (date, h = 9, m = 0) => `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

async function seed() {
  rnd = prng(20261023);
  const senha = A.hashSenha('agro123');
  return db.comUsuario({ semAuditoria: true }, () => db.tx(async () => {
    // ---------- Empresas ----------
    const emp1 = await db.insert('empresas', {
      nome: 'Agroterra Fertilizantes Ltda', cnpj: '12345678000195', uf: 'MG', endereco: 'Rodovia BR-365, km 412, Distrito Industrial', cidade: 'Patrocínio', cep: '38740000', telefone: '3438310000',
    });
    const emp2 = await db.insert('empresas', {
      nome: 'Agroterra Nutrição Vegetal Ltda', cnpj: '98765432000198', uf: 'SP', endereco: 'Av. das Indústrias, 1500', cidade: 'Franca', cep: '14400000', telefone: '1637220000',
    });

    // ---------- Usuários ----------
    const u = (nome, login, perfil, extra = {}) => db.insert('usuarios', { nome, login, perfil, senha_hash: login === 'admin' ? A.hashSenha('admin123') : senha, email: `${login}@agroterra.com.br`, ...extra });
    const admin = await u('Administrador', 'admin', 'admin');
    const diretor = await u('Juan Xavier', 'diretoria', 'diretoria');
    const sup1 = await u('Carlos Mendes', 'carlos', 'supervisor');
    const sup2 = await u('Fernanda Lima', 'fernanda', 'supervisor');
    await u('Marcos Andrade', 'gerente', 'gerente');
    const eq1 = await db.insert('equipes', { nome: 'Equipe Cerrado', supervisor_id: sup1 });
    const eq2 = await db.insert('equipes', { nome: 'Equipe Sul de Minas', supervisor_id: sup2 });
    const eq3 = await db.insert('equipes', { nome: 'Vendas diretas', supervisor_id: null });
    await db.run('UPDATE usuarios SET equipe_id = ? WHERE id = ?', eq1, sup1);
    await db.run('UPDATE usuarios SET equipe_id = ? WHERE id = ?', eq2, sup2);
    const vendedores = [
      await u('Ana Souza', 'ana', 'vendedor', { equipe_id: eq1 }),
      await u('Bruno Rocha', 'bruno', 'vendedor', { equipe_id: eq1 }),
      await u('Diego Martins', 'diego', 'vendedor', { equipe_id: eq1 }),
      await u('Elisa Campos', 'elisa', 'vendedor', { equipe_id: eq2 }),
      await u('Gabriel Alves', 'gabriel', 'vendedor', { equipe_id: eq2 }),
      await u('Helena Prado', 'helena', 'vendedor', { equipe_id: eq3 }), // equipe sem supervisor: pedidos pulam a supervisão
    ];
    const analista = await u('Igor Teixeira', 'analise', 'analista');
    const producao = await u('João Ferreira', 'producao', 'producao');
    const faturista = await u('Karina Duarte', 'faturamento', 'faturamento');
    const expedidor = await u('Lucas Pereira', 'expedicao', 'expedicao');
    const financeiro = await u('Marina Costa', 'financeiro', 'financeiro');
    const rhUser = await u('Patrícia Nunes', 'rh', 'rh');
    const comprador = await u('Rafael Moura', 'compras', 'compras');
    const todos = await db.all('SELECT id, perfil FROM usuarios');
    for (const x of todos) {
      await db.run('INSERT INTO usuario_empresas VALUES (?, ?)', x.id, emp1);
      if (['admin', 'diretoria', 'financeiro', 'faturamento', 'analista'].includes(x.perfil) || x.id === vendedores[3]) await db.run('INSERT INTO usuario_empresas VALUES (?, ?)', x.id, emp2);
    }

    // ---------- Cadastros ----------
    const gSolo = await db.insert('grupos_produto', { nome: 'Linha Solo' });
    const gFoliar = await db.insert('grupos_produto', { nome: 'Linha Foliar' });
    const listaBancos = [['001', 'Banco do Brasil'], ['237', 'Bradesco'], ['341', 'Itaú'], ['756', 'Sicoob'], ['748', 'Sicredi']];
    const bancos = [];
    for (const [codigo, nome] of listaBancos) bancos.push(await db.insert('bancos', { codigo, nome }));
    const transportadoras = [];
    for (const nome of ['TransAgro Logística', 'Rodocerrado Transportes', 'Expresso Mineiro', 'Via Campo Cargas']) {
      transportadoras.push(await db.insert('transportadoras', { nome, cnpj: cnpj(), telefone: `(34) 3${int(200, 999)}-${int(1000, 9999)}` }));
    }

    const formas = {};
    const condicoes = {};
    const mkForma = async (nome, tipo, tipo_baixa, conds, pens = []) => {
      const id = await db.insert('formas_pagamento', { nome, tipo, tipo_baixa });
      formas[nome] = id;
      condicoes[nome] = [];
      for (const [descricao, parcelas, intervalo_dias, carencia_dias, desconto_pct, valor_minimo] of conds) {
        condicoes[nome].push(await db.insert('condicoes_pagamento', { forma_id: id, descricao, parcelas, intervalo_dias, carencia_dias, desconto_pct, valor_minimo }));
      }
      for (const [dias_de, dias_ate, perda_pct] of pens) await db.insert('penalidades_comissao', { forma_id: id, dias_de, dias_ate, perda_pct });
    };
    const penPadrao = [[1, 15, 10], [16, 30, 25], [31, 60, 50], [61, 9999, 100]];
    await mkForma('PIX à vista', 'a_vista', 'PIX', [['À vista (5% desc.)', 1, 0, 0, 5, 0]]);
    await mkForma('Depósito/TED à vista', 'a_vista', 'TED', [['À vista (3% desc.)', 1, 0, 0, 3, 0]]);
    await mkForma('Boleto bancário', 'prazo', 'boleto', [['30 dias', 1, 30, 30, 0, 0], ['30/60/90', 3, 30, 30, 0, 1500], ['Safra (180 dias)', 1, 180, 180, 0, 5000]], penPadrao);
    await mkForma('Cartão de crédito', 'prazo', 'cartao', [['3x sem juros', 3, 30, 30, 0, 300], ['6x sem juros', 6, 30, 30, 0, 1000]], [[1, 9999, 0]]);
    await mkForma('Cheque pré-datado', 'prazo', 'cheque', [['30/60', 2, 30, 30, 0, 800], ['30/60/90/120', 4, 30, 30, 0, 2000]], penPadrao);

    const catalogo = [
      ['SOL-001', 'Organomineral NPK 04-14-08', gSolo, 'KG', '31059090', [['Saco 25 kg', 25, 'KG', 32], ['Big bag 1.000 kg', 1000, 'KG', 980]], 72, 2350],
      ['SOL-002', 'Organomineral NPK 10-10-10', gSolo, 'KG', '31059090', [['Saco 25 kg', 25, 'KG', 36], ['Big bag 1.000 kg', 1000, 'KG', 1080]], 79, 2650],
      ['SOL-003', 'Calcário Dolomítico Filler', gSolo, 'KG', '25210000', [['Saco 40 kg', 40, 'KG', 9], ['Tonelada a granel', 1000, 'KG', 150]], 19, 240],
      ['SOL-004', 'Gesso Agrícola', gSolo, 'KG', '25201011', [['Saco 40 kg', 40, 'KG', 8], ['Tonelada a granel', 1000, 'KG', 130]], 17, 210],
      ['SOL-005', 'Termofosfato Magnesiano', gSolo, 'KG', '31039000', [['Saco 25 kg', 25, 'KG', 40]], 95, null],
      ['SOL-006', 'Composto Orgânico Classe A', gSolo, 'KG', '31010000', [['Saco 30 kg', 30, 'KG', 12], ['Big bag 600 kg', 600, 'KG', 210]], 28, 390],
      ['SOL-007', 'Cloreto de Potássio Granulado', gSolo, 'KG', '31042010', [['Saco 50 kg', 50, 'KG', 145]], 210, null],
      ['SOL-008', 'Ureia Protegida 45% N', gSolo, 'KG', '31021010', [['Saco 50 kg', 50, 'KG', 138]], 198, null],
      ['FOL-001', 'Foliar Boro 10%', gFoliar, 'L', '31059019', [['Galão 5 L', 5, 'L', 48], ['Bombona 20 L', 20, 'L', 175]], 89, 330],
      ['FOL-002', 'Foliar Zinco + Manganês', gFoliar, 'L', '31059019', [['Galão 5 L', 5, 'L', 55], ['Bombona 20 L', 20, 'L', 198]], 98, 365],
      ['FOL-003', 'Aminoácidos Bioestimulante', gFoliar, 'L', '31059019', [['Frasco 1 L', 1, 'L', 22], ['Galão 5 L', 5, 'L', 96]], 46, 185],
      ['FOL-004', 'Cálcio + Boro Quelatizado', gFoliar, 'L', '31059019', [['Galão 5 L', 5, 'L', 52], ['Bombona 20 L', 20, 'L', 190]], 92, 345],
      ['FOL-005', 'Fosfito de Potássio 40-20', gFoliar, 'L', '31052000', [['Galão 5 L', 5, 'L', 61]], 112, null],
      ['FOL-006', 'Extrato de Algas Marinhas', gFoliar, 'L', '31010000', [['Frasco 1 L', 1, 'L', 30], ['Galão 5 L', 5, 'L', 128]], 64, 245],
      ['FOL-007', 'Molibdênio + Cobalto', gFoliar, 'L', '31059019', [['Frasco 1 L', 1, 'L', 35]], 75, null],
      ['FOL-008', 'Adjuvante Espalhante', gFoliar, 'L', '38089199', [['Frasco 1 L', 1, 'L', 12]], 29, null],
    ];
    const produtos = [];
    for (const [codigo, nome, grupo, unidade, ncm, embs, p1, p2] of catalogo) {
      const id = await db.insert('produtos', {
        codigo, nome, grupo_id: grupo, unidade, ncm, cst: '040', cfop: '5101', gtin: `789${int(1000000000, 9999999999)}`,
        reducao_bc: grupo === gSolo ? 30 : 0, perigoso: codigo === 'FOL-005' ? 1 : 0, origem: codigo.endsWith('7') || codigo.endsWith('8') ? 'adquirido' : 'nacional',
        qtd_ecommerce: embs[0][1], prazo_producao_dias: grupo === gSolo ? int(3, 7) : int(2, 4),
      });
      const embIds = [];
      for (const [descricao, quantidade, un, custo] of embs) embIds.push(await db.insert('produto_embalagens', { produto_id: id, descricao, quantidade, unidade: un, custo }));
      for (const [i, v] of [p1, p2].entries()) {
        if (!v || !embIds[i]) continue;
        await db.insert('produto_precos', { produto_id: id, embalagem_id: embIds[i], valor: v, vigencia_inicio: '2026-01-01' });
        await db.insert('produto_precos', { produto_id: id, embalagem_id: embIds[i], forma_id: formas['Boleto bancário'], valor: S.r2(v * 1.04), vigencia_inicio: '2026-01-01' });
      }
      produtos.push({ id, nome, grupo, embs: embIds.map((eid, i) => ({ id: eid, qtd: embs[i][1], un: embs[i][2], custo: embs[i][3], preco: i === 0 ? p1 : p2 })).filter((e) => e.preco) });
    }
    // Brinde: na compra de 40 sacos de NPK, ganha 1 galão de aminoácidos.
    await db.insert('produto_brindes', { produto_id: produtos[0].id, brinde_produto_id: produtos[10].id, qtd_minima: 40, qtd_brinde: 1, observacao: 'Promoção safra 26/27' });

    // ---------- Clientes ----------
    const nomes = ['José', 'Maria', 'Antônio', 'Francisca', 'João', 'Ana', 'Francisco', 'Luiza', 'Carlos', 'Paulo', 'Pedro', 'Lucas', 'Marcos', 'Rita', 'Sebastião', 'Raimundo', 'Geraldo', 'Aparecida', 'Valdir', 'Rosângela'];
    const sobrenomes = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Ribeiro', 'Carvalho', 'Almeida', 'Lopes', 'Barbosa', 'Moreira', 'Rezende', 'Borges', 'Queiroz', 'Machado'];
    const fazendas = ['Boa Vista', 'Santa Rita', 'São José', 'Bela Vista', 'Esperança', 'Três Irmãos', 'Água Limpa', 'Primavera', 'Santa Fé', 'Ouro Verde', 'Recanto', 'Cachoeira'];
    const cidades = [['Patrocínio', 'MG', '38740'], ['Uberlândia', 'MG', '38400'], ['Araxá', 'MG', '38180'], ['Patos de Minas', 'MG', '38700'], ['Varginha', 'MG', '37010'],
      ['Três Pontas', 'MG', '37190'], ['Franca', 'SP', '14400'], ['Rio Verde', 'GO', '75900'], ['Cristalina', 'GO', '73850'], ['Luís Eduardo Magalhães', 'BA', '47850'], ['Londrina', 'PR', '86000']];
    const culturas = ['Café', 'Soja', 'Milho', 'Cana-de-açúcar', 'Citros', 'Hortaliças', 'Feijão', 'Batata', 'Pastagem'];
    const clientes = [];
    for (let i = 0; i < 90; i++) {
      const pj = chance(0.25);
      const nome = pj ? `${pick(['Agropecuária', 'Fazendas Reunidas', 'Cafeicultura', 'Grãos'])} ${pick(sobrenomes)} ${pick(['Ltda', 'S/A', 'EIRELI'])}` : `${pick(nomes)} ${pick(sobrenomes)} ${pick(sobrenomes)}`;
      const vend = pick(vendedores);
      const id = await db.insert('clientes', {
        tipo_pessoa: pj ? 'J' : 'F', documento: pj ? cnpj() : cpf(), nome, nome_fantasia: pj ? nome.split(' ').slice(0, 2).join(' ') : null,
        inscricao_estadual: pj ? String(int(1000000000, 9999999999)) : null, inscricao_produtor: pj ? null : `PR${int(100000, 999999)}`,
        email: chance(0.7) ? `${nome.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}${int(1, 99)}@email.com` : null,
        vendedor_id: vend, limite_credito: pick([20000, 50000, 80000, 150000]),
        created_at: ts(S.addDias(S.hoje(), -int(380, 900))),
      });
      const [cidade, uf, cep] = pick(cidades);
      const rural = chance(0.8);
      await db.insert('cliente_enderecos', {
        cliente_id: id, tipo: 'Entrega', cep: `${cep}-${String(int(0, 999)).padStart(3, '0')}`, logradouro: rural ? `Fazenda ${pick(fazendas)}` : `Rua ${pick(sobrenomes)}`,
        numero: rural ? 'S/N' : String(int(10, 2000)), bairro: rural ? 'Zona Rural' : 'Centro', cidade, uf, zona_rural: rural ? 1 : 0,
        posta_restante: rural && chance(0.15) ? 1 : 0, como_chegar: rural ? `Rodovia ${pick(['MG-230', 'BR-365', 'BR-050', 'GO-174'])}, km ${int(5, 90)}, entrada à ${pick(['direita', 'esquerda'])} após a ponte, mais ${int(2, 15)} km de terra` : null, principal: 1,
      });
      await db.insert('cliente_telefones', { cliente_id: id, tipo: 'Celular', numero: `(${pick(['34', '35', '16', '64', '77', '43'])}) 9${int(8000, 9999)}-${int(1000, 9999)}`, contato: nome.split(' ')[0], whatsapp: 1 });
      if (chance(0.4)) await db.insert('cliente_telefones', { cliente_id: id, tipo: 'Fixo', numero: `(34) 3${int(200, 999)}-${int(1000, 9999)}` });
      for (let k = 0; k < int(1, 2); k++) {
        const cult = pick(culturas);
        await db.insert('cliente_areas', { cliente_id: id, tipo_cultivo: cult, qtd_pes: ['Café', 'Citros'].includes(cult) ? int(5, 400) * 1000 : null, area: int(10, 900), medida: pick(['ha', 'ha', 'alqueire']) });
      }
      await db.insert('cliente_ref_comerciais', { cliente_id: id, empresa: pick(['Cooxupé', 'Expocaccer', 'Casa do Adubo', 'Agro Amazônia', 'Coopadap']), contato: pick(nomes), telefone: `(34) 3${int(200, 999)}-${int(1000, 9999)}`, ultima_checagem: chance(0.6) ? S.addDias(S.hoje(), -int(10, 300)) : null, checada: chance(0.6) ? 1 : 0, positivo: chance(0.85) ? 1 : 0 });
      await db.insert('cliente_ref_bancarias', { cliente_id: id, banco: pick(['Banco do Brasil', 'Sicoob', 'Sicredi', 'Bradesco']), agencia: String(int(1000, 9999)), conta: `${int(10000, 99999)}-${int(0, 9)}`, gerente: pick(nomes), checada: chance(0.5) ? 1 : 0, positivo: 1 });
      clientes.push({ id, vend, end: (await db.get('SELECT id FROM cliente_enderecos WHERE cliente_id = ?', id)).id });
    }
    // Blacklist
    for (const c of clientes.slice(0, 4)) await db.insert('blacklist', { cliente_id: c.id, tipo: 'alerta', motivo: 'Histórico de atrasos recorrentes. Exigir garantia.', usuario_id: analista, data_inclusao: ts(S.addDias(S.hoje(), -int(20, 200))) });
    await db.insert('blacklist', { cliente_id: clientes[4].id, tipo: 'bloqueio', motivo: 'Cheques devolvidos e protesto em cartório.', usuario_id: financeiro, data_inclusao: ts(S.addDias(S.hoje(), -60)) });
    await db.insert('blacklist', { cliente_id: clientes[5].id, tipo: 'bloqueio', motivo: 'Fraude documental identificada.', usuario_id: diretor, data_inclusao: ts(S.addDias(S.hoje(), -300)), ativo: 0, motivo_exclusao: 'Situação regularizada judicialmente.', usuario_exclusao_id: diretor, data_exclusao: ts(S.addDias(S.hoje(), -100)) });

    // ---------- Pedidos ----------
    const supervisorDe = Object.fromEntries((await db.all('SELECT u.id, e.supervisor_id FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id')).map((x) => [x.id, x.supervisor_id]));
    const formaNomes = Object.keys(formas);
    const ordemEtapas = ['venda', 'supervisao', 'analise', 'diretoria', 'cobranca', 'producao', 'faturamento', 'expedicao', 'transito', 'entregue'];
    const hojeIso = S.hoje();

    for (let i = 0; i < 320; i++) {
      const idade = i < 40 ? int(0, 12) : int(5, 365);
      const data = S.addDias(hojeIso, -idade);
      const cli = pick(clientes.slice(5)); // clientes bloqueados não compram
      const formaNome = pick([...formaNomes, 'Boleto bancário', 'Boleto bancário', 'Cheque pré-datado']);
      const formaId = formas[formaNome];
      const condId = pick(condicoes[formaNome]);
      const forma = await db.get('SELECT * FROM formas_pagamento WHERE id = ?', formaId);
      const supervisorId = supervisorDe[cli.vend] || null;
      const tipoEntrega = chance(0.85) ? 'transportadora' : pick(['retirada', 'veiculo_proprio', 'posta_restante']);
      const numero = await db.nextSeq('pedido', 100001);
      const empresaId = cli.vend === vendedores[3] && chance(0.3) ? emp2 : emp1;
      const pid = await db.insert('pedidos', {
        numero, empresa_id: empresaId, cliente_id: cli.id, vendedor_id: cli.vend, supervisor_id: supervisorId, forma_id: formaId, condicao_id: condId,
        endereco_entrega_id: cli.end, tipo_entrega: tipoEntrega, created_at: ts(data, int(7, 17), int(0, 59)), etapa: 'venda',
      });
      const nItens = int(1, 4);
      const usados = new Set();
      for (let k = 0; k < nItens; k++) {
        const pr = pick(produtos);
        if (usados.has(pr.id)) continue;
        usados.add(pr.id);
        const emb = pick(pr.embs);
        const qtd = emb.qtd >= 600 ? int(2, 30) : int(10, 200);
        const preco = formaNome === 'Boleto bancário' ? S.r2(emb.preco * 1.04) : emb.preco;
        const unit = S.r2(preco * (1 - pick([0, 0, 0, 0.02, 0.05])));
        await db.insert('pedido_itens', { pedido_id: pid, produto_id: pr.id, embalagem_id: emb.id, quantidade: qtd, unidade: emb.un, valor_tabela: preco, custo_embalagem: emb.custo, valor_unitario: unit, valor_total: S.r2(qtd * unit) });
      }
      if (chance(0.15)) {
        const pr = produtos[10];
        await db.insert('pedido_itens', { pedido_id: pid, produto_id: pr.id, embalagem_id: pr.embs[0].id, quantidade: int(1, 3), unidade: 'L', valor_tabela: pr.embs[0].preco, custo_embalagem: pr.embs[0].custo, valor_unitario: 0, valor_total: 0, brinde: 1 });
      }
      await S.recalcularPedido(pid);
      let ped = await db.get('SELECT * FROM pedidos WHERE id = ?', pid);

      // Destino final do pedido conforme a idade.
      let final;
      if (idade <= 1) final = pick(['venda', 'supervisao', 'analise', 'analise', 'diretoria']);
      else if (idade <= 4) final = pick(['supervisao', 'analise', 'diretoria', 'producao', 'producao', 'faturamento', 'cobranca']);
      else if (idade <= 12) final = pick(['producao', 'faturamento', 'expedicao', 'expedicao', 'transito', 'transito', 'entregue']);
      else final = chance(0.06) ? 'cancelado' : chance(0.03) ? 'devolucao' : 'entregue';

      const caminho = ['venda'];
      if (supervisorId) caminho.push('supervisao');
      caminho.push('analise', 'diretoria');
      if (forma.tipo === 'a_vista') caminho.push('cobranca');
      caminho.push('producao', 'faturamento', 'expedicao', 'transito', 'entregue');
      let alvo = final;
      if (final === 'cancelado') alvo = pick(['analise', 'diretoria']);
      if (final === 'devolucao') alvo = 'entregue';
      if (!caminho.includes(alvo)) alvo = caminho[Math.min(caminho.length - 1, ordemEtapas.indexOf(alvo))] || 'producao';
      const passos = caminho.slice(0, caminho.indexOf(alvo) + 1);

      let quando = Date.parse(ped.created_at.replace(' ', 'T'));
      const avancar = () => {
        quando += int(1, 20) * 3600e3;
        return new Date(Math.min(quando, Date.now() - 60e3) - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 19).replace('T', ' ');
      };
      await db.insert('pedido_historico', { pedido_id: pid, etapa_destino: 'venda', acao: 'Pedido criado', usuario_id: cli.vend, created_at: ped.created_at });
      const responsavel = { venda: cli.vend, supervisao: supervisorId, analise: analista, diretoria: diretor, cobranca: financeiro, producao, faturamento: faturista, expedicao: expedidor, transito: expedidor };
      const acaoLabel = { venda: 'Enviar pedido', supervisao: 'Aprovar', analise: 'Aprovar crédito', diretoria: 'Aprovação final', cobranca: 'Confirmar pagamento', producao: 'Concluir produção', faturamento: 'Emitir nota fiscal', expedicao: 'Registrar embarque', transito: 'Confirmar entrega' };
      let dataFat = null;
      for (let k = 1; k < passos.length; k++) {
        const de = passos[k - 1];
        const para = passos[k];
        const em = avancar();
        await db.insert('pedido_historico', { pedido_id: pid, etapa_origem: de, etapa_destino: para, acao: acaoLabel[de], usuario_id: responsavel[de], created_at: em });
        const upd = { etapa: para, etapa_desde: em };
        if (de === 'analise') {
          await db.insert('consultas_serasa', { cliente_id: cli.id, pedido_id: pid, usuario_id: analista, ...S.simularSerasa(ped.created_at + cli.id), created_at: em });
          upd.analista_id = analista;
          if (tipoEntrega === 'transportadora') Object.assign(upd, { transportadora_id: pick(transportadoras), frete_codigo_cotacao: `COT${int(10000, 99999)}`, frete_prazo_dias: int(2, 8), frete_valor: int(250, 2400) });
        }
        if (de === 'cobranca') upd.pagamento_confirmado_em = em;
        if (para === 'producao') Object.assign(upd, { data_chegada_producao: em, prazo_producao: S.addDias(em, int(3, 7)) });
        if (de === 'producao') await db.run(`UPDATE pedido_itens SET lote = ?, fabricacao = ? WHERE pedido_id = ?`, `L${em.slice(2, 4)}${em.slice(5, 7)}-${int(100, 999)}`, em.slice(0, 10), pid);
        if (de === 'expedicao') Object.assign(upd, { data_embarque: em.slice(0, 10), data_entrega_prevista: S.addDias(em, int(2, 7)) });
        if (de === 'transito') upd.data_entrega = em.slice(0, 10);
        await db.update('pedidos', pid, upd);
        if (de === 'faturamento') dataFat = em;
        ped = await db.get('SELECT * FROM pedidos WHERE id = ?', pid);
        if (de === 'diretoria') await S.garantirComissoes(ped);
        if (de === 'faturamento') {
          const nota = await S.emitirNota(ped, faturista);
          const offset = S.diasEntre(hojeIso, em.slice(0, 10));
          await db.run('UPDATE notas_fiscais SET data_emissao = ? WHERE id = ?', em, nota.id);
          await db.run(`UPDATE parcelas SET vencimento = date(vencimento, ? || ' days'), vencimento_original = date(vencimento_original, ? || ' days'),
                   data_pagamento = CASE WHEN data_pagamento IS NOT NULL THEN ? END, created_at = ? WHERE nota_id = ?`, String(offset), String(offset), em.slice(0, 10), em, nota.id);
          await db.run('UPDATE comissoes SET periodo = ? WHERE pedido_id = ?', em.slice(0, 7), pid);
        }
      }
      if (final === 'cancelado') {
        const em = avancar();
        await db.insert('pedido_historico', { pedido_id: pid, etapa_origem: alvo, etapa_destino: 'cancelado', acao: alvo === 'analise' ? 'Reprovar crédito' : 'Reprovar', observacao: 'Score baixo e restrições ativas no Serasa.', usuario_id: alvo === 'analise' ? analista : diretor, created_at: em });
        await db.update('pedidos', pid, { etapa: 'cancelado', etapa_desde: em });
      }
      // Pedido em digitação devolvido para correção
      if (final === 'venda' && chance(0.3)) {
        await db.insert('pedido_comentarios', { pedido_id: pid, usuario_id: analista, etapa: 'analise', texto: '[Devolver ao vendedor] Confirmar inscrição de produtor do cliente.' });
      }
      if (dataFat) {
        // Pagamentos das parcelas já vencidas.
        for (const p of await db.all('SELECT * FROM parcelas WHERE pedido_id = ? AND status = ?', pid, 'a_pagar')) {
          if (p.vencimento >= hojeIso) continue;
          const r = rnd();
          if (r < 0.72) await S.baixarParcela(p.id, { data_pagamento: S.addDias(p.vencimento, int(-3, 2)), tipo_baixa: forma.tipo_baixa === 'cartao' ? 'outros' : pick(['boleto', 'PIX', 'boleto', 'TED']), banco_id: pick(bancos) }, financeiro);
          else if (r < 0.85) {
            const pg = S.addDias(p.vencimento, int(5, 50));
            if (pg < hojeIso) await S.baixarParcela(p.id, { data_pagamento: pg, juros: S.r2(p.valor * 0.01 * int(1, 3)), tipo_baixa: pick(['boleto', 'PIX']), banco_id: pick(bancos) }, financeiro);
          }
        }
        if (final === 'devolucao') {
          const nota = await db.get('SELECT * FROM notas_fiscais WHERE pedido_id = ?', pid);
          await S.registrarDevolucao({ nota_id: nota.id, motivo: 'Produto entregue com embalagem avariada', tipo: 'avaria', total: true, valor: nota.valor }, financeiro);
        }
      }
    }
    await db.run(`UPDATE comissoes SET status = 'paga' WHERE periodo < ?`, S.addDias(hojeIso, -60).slice(0, 7));
    await db.run(`UPDATE comissoes SET status = 'revisada' WHERE periodo = ?`, S.addDias(hojeIso, -30).slice(0, 7));

    // ---------- Negativações, cobrança e CRM ----------
    const vencidas = await db.all(`SELECT * FROM parcelas WHERE status = 'a_pagar' AND vencimento < date(?, '-30 days') ORDER BY vencimento`, hojeIso);
    for (const [idx, p] of vencidas.slice(0, 12).entries()) {
      const status = ['inclusao_solicitada', 'inclusao_aceita', 'inclusao_aceita', 'inclusao_rejeitada'][idx % 4];
      await db.insert('negativacoes', { parcela_id: p.id, cliente_id: p.cliente_id, valor: p.valor, status, protocolo: status === 'inclusao_aceita' ? `SER${int(100000, 999999)}` : null, motivo_rejeicao: status === 'inclusao_rejeitada' ? 'Endereço do devedor incompleto' : null, usuario_id: financeiro });
    }
    const devedores = [...new Set((await db.all(`SELECT DISTINCT cliente_id FROM parcelas WHERE status = 'a_pagar' AND vencimento < ?`, hojeIso)).map((x) => x.cliente_id))];
    for (const c of devedores) {
      for (let k = 0; k < int(1, 3); k++) {
        const tipo = pick(['ligacao', 'whatsapp', 'ligacao', 'email']);
        const resultado = pick(['contato_efetivo', 'sem_contato', 'promessa', 'sem_contato']);
        await db.insert('cobranca_acoes', {
          cliente_id: c, tipo, resultado, descricao: resultado === 'promessa' ? 'Cliente prometeu pagar após a colheita.' : resultado === 'sem_contato' ? 'Não atendeu.' : 'Cliente ciente do débito.',
          data_promessa: resultado === 'promessa' ? S.addDias(hojeIso, int(-5, 10)) : null, valor_promessa: resultado === 'promessa' ? int(1000, 9000) : null,
          proxima_acao: S.addDias(hojeIso, int(-2, 7)), usuario_id: financeiro, created_at: ts(S.addDias(hojeIso, -int(1, 25)), int(8, 17)),
        });
      }
    }
    const assuntos = [['visita', 'Visita técnica na lavoura'], ['ligacao', 'Apresentação da linha foliar'], ['whatsapp', 'Envio da tabela de preços'], ['pos_venda', 'Pós-venda: resultado da aplicação'], ['reuniao', 'Planejamento da safra 26/27']];
    for (const c of clientes) {
      for (let k = 0; k < int(0, 3); k++) {
        const [tipo, assunto] = pick(assuntos);
        await db.insert('crm_interacoes', { cliente_id: c.id, tipo, assunto, descricao: 'Registro de relacionamento com o produtor.', usuario_id: c.vend, data: ts(S.addDias(hojeIso, -int(1, 200)), int(8, 17)) });
      }
      if (chance(0.3)) {
        await db.insert('crm_oportunidades', {
          cliente_id: c.id, titulo: `${pick(['Adubação de plantio', 'Cobertura', 'Programa foliar', 'Correção de solo'])} - ${pick(culturas)}`, valor_estimado: int(8, 120) * 1000,
          estagio: pick(['prospeccao', 'qualificacao', 'proposta', 'negociacao', 'ganha', 'perdida']), previsao_fechamento: S.addDias(hojeIso, int(-30, 120)), safra: '26/27', responsavel_id: c.vend,
        });
      }
      if (chance(0.2)) await db.insert('crm_tarefas', { cliente_id: c.id, titulo: pick(['Retornar ligação', 'Levar amostra de solo', 'Enviar proposta', 'Agendar visita']), vencimento: S.addDias(hojeIso, int(-3, 15)), responsavel_id: c.vend });
    }
    await db.run(`UPDATE crm_oportunidades SET motivo_perda = 'Preço acima da concorrência' WHERE estagio = 'perdida'`);

    // ---------- Fornecedores ----------
    const fornecedores = {};
    for (const [razao, categoria, prazo] of [
      ['Mineração Cerrado Fosfatos S.A.', 'Matéria-prima', 28], ['Potássio do Brasil Comércio Ltda', 'Matéria-prima', 30], ['Embalagens Triângulo Ltda', 'Embalagem', 21],
      ['Química Foliar Insumos Ltda', 'Matéria-prima', 35], ['Transportes Rodominas Ltda', 'Frete', 15], ['Cemig Distribuição S.A.', 'Energia', 10],
      ['Imobiliária Alto Paranaíba', 'Aluguel', 5], ['TecnoAgro Manutenção Industrial', 'Manutenção', 20],
    ]) {
      fornecedores[categoria] = fornecedores[categoria] || [];
      fornecedores[categoria].push(await db.insert('fornecedores', {
        tipo_pessoa: 'J', documento: cnpj(), razao_social: razao, nome_fantasia: razao.split(' ').slice(0, 2).join(' '), categoria, prazo_pagamento_dias: prazo,
        email: `financeiro@${razao.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.com.br`, telefone: `34${int(30000000, 39999999)}`,
        contato: `${pick(nomes)} ${pick(sobrenomes)}`, cidade: pick(cidades)[0], uf: 'MG', chave_pix: chance(0.5) ? cnpj() : null,
      }));
    }

    // ---------- Estoque ----------
    // Saídas do faturamento já foram lançadas pelas notas; ajusta a data delas à da nota e cria as compras iniciais.
    await db.run(
      `UPDATE estoque_movimentos m SET created_at = nf.data_emissao FROM notas_fiscais nf
        WHERE nf.pedido_id = m.pedido_id AND m.origem = 'venda' AND nf.status <> 'cancelada'`,
    );
    for (const prod of produtos) {
      for (const e of prod.embs) {
        e.minimo = int(2, 8) * 10;
        await db.run('UPDATE produto_embalagens SET estoque_minimo = ?, peso_kg = ? WHERE id = ?', e.minimo, e.un === 'KG' ? e.qtd : S.r2(e.qtd * 1.2), e.id);
      }
    }
    for (const empEstoque of [emp1, emp2]) {
    const vendidos = Object.fromEntries((await db.all(
      `SELECT embalagem_id, -SUM(quantidade) AS q FROM estoque_movimentos WHERE empresa_id = ? GROUP BY embalagem_id`, empEstoque,
    )).map((x) => [x.embalagem_id, x.q]));
    // Pedidos ainda não faturados também precisam de saldo, para o "disponível" ficar realista.
    const reservados = Object.fromEntries((await db.all(
      `SELECT i.embalagem_id, SUM(i.quantidade) AS q FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.empresa_id = ? AND p.etapa IN ('supervisao','analise','diretoria','cobranca','producao','faturamento') GROUP BY i.embalagem_id`, empEstoque,
    )).map((x) => [x.embalagem_id, x.q]));
    let nEmb = 0;
    for (const prod of produtos) {
      for (const e of prod.embs) {
        const minimo = e.minimo;
        // Algumas embalagens ficam abaixo do mínimo para aparecer o alerta.
        const saldoFinal = nEmb++ % 5 === 2 ? int(0, minimo - 1) : minimo + (reservados[e.id] || 0) + int(10, 150);
        const total = (vendidos[e.id] || 0) + saldoFinal;
        const lotes = [Math.round(total * 0.6), total - Math.round(total * 0.6)].filter((q) => q > 0);
        for (const [k, q] of lotes.entries()) {
          const dt = S.addDias(hojeIso, k ? -60 : -200);
          await db.insert('estoque_movimentos', {
            empresa_id: empEstoque, produto_id: prod.id, embalagem_id: e.id, tipo: 'entrada', origem: prod.grupo === gSolo ? 'producao' : 'compra', quantidade: q,
            lote: `L${dt.slice(2, 4)}${dt.slice(5, 7)}-${String(prod.id).padStart(3, '0')}${k}`, validade: S.addDias(dt, 730), custo_unitario: e.custo,
            fornecedor_id: prod.grupo === gSolo ? null : fornecedores['Matéria-prima'][k % fornecedores['Matéria-prima'].length],
            documento: prod.grupo === gSolo ? 'Ordem de produção' : `NF ${int(10000, 99999)}`, usuario_id: producao, created_at: ts(dt, 10),
          });
        }
      }
    }
    }
    await db.insert('estoque_movimentos', {
      empresa_id: emp1, produto_id: produtos[1].id, embalagem_id: produtos[1].embs[0].id, tipo: 'saida', origem: 'perda', quantidade: -2,
      observacao: 'Sacos rasgados no manuseio', usuario_id: expedidor, created_at: ts(S.addDias(hojeIso, -12), 15),
    });
    await db.run(`UPDATE estoque_movimentos SET quantidade = quantidade + 2 WHERE id = (SELECT MIN(id) FROM estoque_movimentos WHERE embalagem_id = ? AND quantidade > 0)`, produtos[1].embs[0].id);

    // ---------- Envio: volumes e rastreio nos pedidos já embarcados ----------
    for (const p of await db.all(`SELECT id, tipo_entrega FROM pedidos WHERE etapa IN ('transito','entregue') AND empresa_id = ?`, emp1)) {
      const itens = (await db.get('SELECT COALESCE(SUM(i.quantidade),0) AS q, COALESCE(SUM(i.quantidade * e.peso_kg),0) AS kg FROM pedido_itens i LEFT JOIN produto_embalagens e ON e.id = i.embalagem_id WHERE i.pedido_id = ?', p.id));
      await db.run('UPDATE pedidos SET volumes = ?, peso_kg = ?, codigo_rastreio = ? WHERE id = ?', Math.max(1, Math.min(99, Math.round(itens.q))), S.r2(itens.kg),
        p.tipo_entrega === 'posta_restante' ? `AA${int(100000000, 999999999)}BR` : `CT${int(1000000, 9999999)}`, p.id);
    }

    // ---------- Contas a pagar ----------
    const contas = [
      ['Matéria-prima', 'Compra de MAP e KCl', 38000, 3], ['Matéria-prima', 'Compra de ureia granulada', 26500, 2], ['Embalagem', 'Sacaria 50 kg e big bags', 9200, 2],
      ['Matéria-prima', 'Insumos para linha foliar', 14800, 3], ['Frete', 'Fretes de transferência', 4300, 1], ['Energia', 'Energia elétrica da fábrica', 6900, 1],
      ['Aluguel', 'Aluguel do galpão', 12000, 1], ['Manutenção', 'Manutenção do misturador', 3500, 1],
    ];
    for (let mes = -2; mes <= 1; mes++) {
      for (const [cat, desc, base, parcelas] of contas) {
        if (parcelas > 1 && chance(0.4)) continue;
        const forn = pick(fornecedores[cat]);
        const grupo = parcelas > 1 ? require('node:crypto').randomUUID() : null;
        const emissao = S.addDias(hojeIso, mes * 30 - int(0, 10));
        for (let k = 1; k <= parcelas; k++) {
          const venc = S.addDias(emissao, (['Energia', 'Aluguel'].includes(cat) ? 10 : 28) * k);
          const valor = S.r2((base * (0.85 + rnd() * 0.3)) / parcelas);
          const paga = venc < S.addDias(hojeIso, -5) && chance(0.85);
          await db.insert('contas_pagar', {
            empresa_id: emp1, fornecedor_id: forn, descricao: parcelas > 1 ? `${desc} (${k}/${parcelas})` : desc, categoria: cat,
            documento: cat === 'Aluguel' ? 'Contrato' : `NF ${int(1000, 99999)}`, emissao, competencia: emissao.slice(0, 7), vencimento: venc, valor,
            valor_pago: paga ? valor : 0, data_pagamento: paga ? venc : null, status: paga ? 'pago' : 'a_pagar', forma_pagamento: paga ? pick(['Boleto', 'PIX', 'TED']) : null,
            parcela: k, total_parcelas: parcelas, grupo, usuario_id: financeiro, created_at: ts(emissao, 11),
          });
        }
      }
    }

    // ---------- Chamados internos ----------
    const chamadosDemo = [
      [vendedores[0], 'producao', 'alta', 'Produção', 'Prioridade na produção do pedido do Sr. José', 'Cliente vai começar o plantio na segunda, precisa do NPK até sexta.', 'em_andamento', producao],
      [faturista, 'admin', 'urgente', 'TI', 'Impressora de etiquetas não imprime', 'A impressora térmica da expedição parou depois da atualização do Windows.', 'aberto', null],
      [expedidor, 'faturamento', 'media', 'Logística', 'Corrigir endereço de entrega', 'O endereço do pedido está sem número e a transportadora recusou a coleta.', 'resolvido', faturista],
      [vendedores[1], 'financeiro', 'media', 'Financeiro', '2ª via de boleto para cliente', 'O cliente perdeu o boleto da parcela 2. Pode reenviar por e-mail?', 'resolvido', financeiro],
      [analista, 'vendedor', 'baixa', 'Comercial', 'Atualizar referências comerciais', 'Clientes novos estão chegando sem referência comercial. Reforçar com a equipe.', 'aguardando', null],
      [producao, 'expedicao', 'alta', 'Logística', 'Paletes acumulados na doca 2', 'Precisamos liberar espaço para a produção de amanhã.', 'aberto', null],
      [financeiro, 'diretoria', 'media', 'Financeiro', 'Aprovar pagamento de manutenção', 'Orçamento da TecnoAgro acima do previsto, preciso de aprovação.', 'fechado', diretor],
    ];
    for (const [k, [sol, setor, prio, cat, titulo, desc, status, resp]] of chamadosDemo.entries()) {
      const aberto = S.addDias(hojeIso, -int(1, 12));
      const numero = await db.nextSeq('chamado', 1001);
      const cid = await db.insert('chamados', {
        numero, empresa_id: emp1, titulo, descricao: desc, categoria: cat, setor_destino: setor, prioridade: prio, status, solicitante_id: sol, responsavel_id: resp,
        prazo: S.addDias(aberto, { urgente: 1, alta: 2, media: 5, baixa: 10 }[prio]), resolvido_em: ['resolvido', 'fechado'].includes(status) ? S.addDias(aberto, 1) : null,
        avaliacao: status === 'fechado' ? 5 : null, created_at: ts(aberto, 9 + k), updated_at: ts(aberto, 10 + k),
      });
      await db.insert('chamado_interacoes', { chamado_id: cid, usuario_id: sol, tipo: 'abertura', texto: 'Chamado aberto', created_at: ts(aberto, 9 + k) });
      if (resp) await db.insert('chamado_interacoes', { chamado_id: cid, usuario_id: resp, tipo: 'comentario', texto: 'Estou verificando e retorno em breve.', created_at: ts(aberto, 11 + k) });
      if (['resolvido', 'fechado'].includes(status)) {
        await db.insert('chamado_interacoes', { chamado_id: cid, usuario_id: resp, tipo: 'status', texto: 'Em andamento → Resolvido: Ajuste feito, pode conferir.', created_at: ts(S.addDias(aberto, 1), 15) });
      }
    }

    // ---------- Propostas comerciais ----------
    for (let k = 0; k < 10; k++) {
      const cli = pick(clientes);
      const formaNome = pick(['Boleto bancário', 'PIX à vista']);
      const status = ['rascunho', 'enviada', 'enviada', 'enviada', 'aceita', 'recusada', 'enviada', 'rascunho', 'recusada', 'enviada'][k];
      const criada = S.addDias(hojeIso, -int(1, 25));
      const numero = await db.nextSeq('proposta', 5001);
      const prid = await db.insert('propostas', {
        numero, empresa_id: emp1, cliente_id: cli.id, vendedor_id: cli.vend, forma_id: formas[formaNome], condicao_id: condicoes[formaNome][0], status,
        validade: S.addDias(criada, k === 6 ? 5 : 20), prazo_entrega: `${int(5, 15)} dias após aprovação do crédito`, tipo_entrega: 'transportadora',
        condicoes_comerciais: 'Preços válidos para pagamento na condição informada. Frete CIF para pedidos acima de 10 t.',
        enviada_em: status !== 'rascunho' ? S.addDias(criada, 1) : null, respondida_em: ['aceita', 'recusada'].includes(status) ? S.addDias(criada, 4) : null,
        motivo_recusa: status === 'recusada' ? pick(['Preço acima da concorrência', 'Cliente adiou o plantio']) : null,
        created_at: ts(criada, 10), updated_at: ts(criada, 10),
      });
      let soma = 0;
      for (const prod of [pick(produtos), pick(produtos)]) {
        const e = pick(prod.embs);
        const qtd = int(5, 80);
        const unit = S.r2(e.preco * (formaNome === 'Boleto bancário' ? 1.04 : 1) * (1 - int(0, 5) / 100));
        soma += qtd * unit;
        await db.insert('proposta_itens', {
          proposta_id: prid, produto_id: prod.id, embalagem_id: e.id, quantidade: qtd, unidade: e.un, valor_tabela: e.preco, custo_embalagem: e.custo,
          valor_unitario: unit, valor_total: S.r2(qtd * unit),
        });
      }
      const cond = await db.get('SELECT desconto_pct FROM condicoes_pagamento WHERE id = ?', condicoes[formaNome][0]);
      const desc = S.r2(soma * (cond.desconto_pct || 0) / 100);
      await db.run('UPDATE propostas SET valor_produtos = ?, valor_desconto = ?, valor_total = ? WHERE id = ?', S.r2(soma), desc, S.r2(soma - desc), prid);
    }

    // ---------- Compras ----------
    {
      const mp = fornecedores['Matéria-prima'];
      const prodA = produtos[0];
      const prodB = produtos[1];
      const sol = async (solicitante, departamento, urgencia, status, itens, dias, justificativa) => {
        const id = await db.insert('compra_solicitacoes', {
          numero: await db.nextSeq('compra_solicitacao', 1), empresa_id: emp1, solicitante_id: solicitante, departamento, urgencia, status, justificativa,
          necessidade_em: S.addDias(hojeIso, 7), created_at: ts(S.addDias(hojeIso, -dias), 9),
        });
        const ids = [];
        for (const it of itens) ids.push(await db.insert('compra_solicitacao_itens', { solicitacao_id: id, ...it }));
        return { id, itens: ids };
      };
      await sol(producao, 'Produção', 'urgente', 'aberta', [{ produto_id: prodA.id, embalagem_id: prodA.embs[0].id, descricao: `${prodA.nome} · reposição`, categoria: 'Matéria-prima', unidade: prodA.embs[0].un, quantidade: 200 }], 1,
        'Estoque abaixo do mínimo para a produção da semana.');
      const s2 = await sol(expedidor, 'Logística', 'normal', 'cotacao', [
        { descricao: 'Palete de madeira PBR 1,00 x 1,20 m', categoria: 'Material de consumo', unidade: 'UN', quantidade: 120 },
        { descricao: 'Filme stretch 500 mm x 25 micras', categoria: 'Embalagem', unidade: 'ROLO', quantidade: 40 },
      ], 3, 'Reposição de material da doca de expedição.');
      for (const [k, f] of [fornecedores['Embalagem'][0], fornecedores['Manutenção'][0]].entries()) {
        const precos = k === 0 ? [42.5, 31.9] : [45, 29.5];
        const q = await db.insert('compra_cotacoes', {
          solicitacao_id: s2.id, fornecedor_id: f, frete: k === 0 ? 180 : 0, prazo_entrega_dias: 5 + k * 3, parcelas: 1, prazo_pagamento_dias: 28,
          total: S.r2(120 * precos[0] + 40 * precos[1] + (k === 0 ? 180 : 0)), usuario_id: comprador,
        });
        for (const [i, item] of s2.itens.entries()) await db.insert('compra_cotacao_itens', { cotacao_id: q, item_id: item, preco_unitario: precos[i] });
      }
      const compra = async (status, fornecedor, itens, extra = {}) => {
        const valor = S.r2(itens.reduce((a, i) => a + i.quantidade * i.preco_unitario, 0));
        const id = await db.insert('compras', {
          numero: await db.nextSeq('compra', 1), empresa_id: emp1, fornecedor_id: fornecedor, status, comprador_id: comprador, categoria: 'Matéria-prima', parcelas: 2, prazo_pagamento_dias: 28,
          valor_itens: valor, valor_total: valor, created_at: ts(S.addDias(hojeIso, -int(2, 10)), 10), ...extra,
        });
        for (const i of itens) await db.insert('compra_itens', { compra_id: id, ...i });
        return id;
      };
      const itemMp = (prod, q, fator = 1) => ({ produto_id: prod.id, embalagem_id: prod.embs[0].id, descricao: `${prod.nome} · ${prod.embs[0].un}`, unidade: prod.embs[0].un, quantidade: q, preco_unitario: S.r2(prod.embs[0].custo * fator) });
      await compra('aprovacao', mp[0], [itemMp(prodA, 300), itemMp(prodB, 150)]);
      await compra('enviada', mp[1 % mp.length], [itemMp(prodB, 80, 0.98)], { aprovador_id: diretor, aprovado_em: ts(S.addDias(hojeIso, -6), 15), enviada_em: ts(S.addDias(hojeIso, -6), 16), previsao_entrega: S.addDias(hojeIso, -1) });
      await compra('rascunho', mp[0], [itemMp(prodA, 50, 1.02)]);
      // Histórico: compras recebidas nos últimos meses (para o painel de compras).
      for (let k = 1; k <= 8; k++) {
        const dia = S.addDias(hojeIso, -k * 21);
        const prod = pick(produtos);
        const forn = k % 3 === 0 ? fornecedores['Embalagem'][0] : pick(mp);
        const itens = [itemMp(prod, int(40, 200), 0.95 + k / 100)];
        const id = await compra('recebida', forn, itens.map((i) => ({ ...i, quantidade_recebida: i.quantidade })), {
          aprovador_id: diretor, aprovado_em: ts(S.addDias(dia, -5), 14), enviada_em: ts(S.addDias(dia, -5), 15), previsao_entrega: dia,
          categoria: k % 3 === 0 ? 'Embalagem' : 'Matéria-prima', created_at: ts(S.addDias(dia, -6), 10),
        });
        const valor = S.r2(itens[0].quantidade * itens[0].preco_unitario);
        await db.insert('compra_recebimentos', { compra_id: id, nota_fiscal: String(int(10000, 99999)), data: dia, valor, usuario_id: producao, created_at: ts(dia, 11) });
      }
    }

    // ---------- RH e DP ----------
    const DEPTO = { admin: 'TI', diretoria: 'Diretoria', supervisor: 'Comercial', gerente: 'Comercial', vendedor: 'Comercial', analista: 'Crédito', producao: 'Produção',
      faturamento: 'Faturamento', expedicao: 'Logística', financeiro: 'Financeiro', rh: 'RH', compras: 'Compras' };
    const CARGO = { admin: 'Analista de sistemas', diretoria: 'Diretor geral', supervisor: 'Supervisor de vendas', gerente: 'Gerente comercial', vendedor: 'Vendedor externo', analista: 'Analista de crédito',
      producao: 'Encarregado de produção', faturamento: 'Assistente de faturamento', expedicao: 'Encarregado de expedição', financeiro: 'Analista financeiro', rh: 'Analista de RH', compras: 'Comprador' };
    const SAL = { admin: 6200, diretoria: 18000, supervisor: 7200, gerente: 11000, vendedor: 3400, analista: 4600, producao: 3900, faturamento: 3100, expedicao: 3300, financeiro: 5200, rh: 4800, compras: 4400 };
    const colabDe = {};
    for (const x of await db.all('SELECT id, nome, perfil, email, equipe_id FROM usuarios ORDER BY id')) {
      const adm = S.addDias(hojeIso, -int(120, 2400));
      const cid = await db.insert('colaboradores', {
        nome: x.nome, cpf: cpf(), cargo: CARGO[x.perfil], setor: DEPTO[x.perfil], departamento: DEPTO[x.perfil], email: x.email, telefone: `34${int(988000000, 999999999)}`,
        data_admissao: adm, data_nascimento: S.addDias(hojeIso, -int(22, 55) * 365 - int(0, 364)), empresa_id: emp1, tipo_contrato: 'clt', jornada: '44 h semanais',
        salario: SAL[x.perfil], cidade: 'Patrocínio', uf: 'MG', pis: String(int(10000000000, 19999999999)), sexo: pick(['F', 'M']), estado_civil: pick(['Solteiro(a)', 'Casado(a)']),
        carga_horaria: 44, escala: '5x2', bate_ponto: ['diretoria', 'vendedor', 'gerente'].includes(x.perfil) ? 0 : 1, equipe_id: x.equipe_id,
        funcao_comercial: ['vendedor', 'supervisor', 'gerente'].includes(x.perfil) ? x.perfil : null, celular: `34${int(988000000, 999999999)}`,
      });
      await db.run('UPDATE usuarios SET colaborador_id = ? WHERE id = ?', cid, x.id);
      colabDe[x.perfil] ||= [];
      colabDe[x.perfil].push(cid);
      await db.insert('rh_historico', { colaborador_id: cid, data: adm, tipo: 'admissao', cargo: CARGO[x.perfil], departamento: DEPTO[x.perfil], salario: S.r2(SAL[x.perfil] * 0.9), descricao: 'Admissão' });
      if (S.diasEntre(adm, hojeIso) > 400) await db.insert('rh_historico', { colaborador_id: cid, data: S.addDias(adm, 365), tipo: 'reajuste', cargo: CARGO[x.perfil], departamento: DEPTO[x.perfil], salario: SAL[x.perfil], descricao: 'Reajuste anual (dissídio)' });
      await db.insert('rh_beneficios', { colaborador_id: cid, tipo: 'vale_refeicao', descricao: 'R$ 35/dia', valor_empresa: 770, valor_desconto: 0 });
      await db.insert('rh_beneficios', { colaborador_id: cid, tipo: 'plano_saude', descricao: 'Unimed enfermaria', valor_empresa: 420, valor_desconto: 90 });
      await db.insert('rh_exames', { colaborador_id: cid, tipo: 'periodico', data: S.addDias(hojeIso, -int(30, 380)), resultado: 'apto', clinica: 'Clínica Ocupacional Cerrado' });
    }
    // Operadores sem acesso ao sistema.
    const operadores = [];
    for (const [i, nome] of ['Raimundo Batista', 'Cleiton Souza', 'Fabiana Rocha', 'Wesley Martins', 'Sebastião Lima', 'Juliana Freitas'].entries()) {
      const adm = i === 5 ? S.addDias(hojeIso, -38) : S.addDias(hojeIso, -int(200, 1800));
      const cid = await db.insert('colaboradores', {
        nome, cpf: cpf(), cargo: i < 4 ? 'Operador de produção' : 'Auxiliar de expedição', setor: i < 4 ? 'Produção' : 'Logística', departamento: i < 4 ? 'Produção' : 'Logística',
        data_admissao: adm, data_nascimento: `${1975 + int(0, 25)}-${hojeIso.slice(5, 7)}-${String(int(1, 28)).padStart(2, '0')}`, empresa_id: emp1, tipo_contrato: 'clt',
        jornada: '44 h semanais (6x1)', carga_horaria: 44, escala: '6x1', bate_ponto: 1, salario: 2350 + int(0, 6) * 50, gestor_id: colabDe.producao[0], cidade: 'Patrocínio', uf: 'MG', experiencia_dias: 90,
      });
      operadores.push(cid);
      await db.insert('rh_historico', { colaborador_id: cid, data: adm, tipo: 'admissao', cargo: 'Operador de produção', salario: 2350, descricao: 'Admissão' });
      await db.insert('rh_beneficios', { colaborador_id: cid, tipo: 'vale_transporte', descricao: '2 conduções/dia', valor_empresa: 280, valor_desconto: 141 });
      await db.insert('rh_exames', { colaborador_id: cid, tipo: i === 2 ? 'periodico' : 'admissional', data: i === 2 ? S.addDias(hojeIso, -350) : adm, validade: i === 2 ? S.addDias(hojeIso, 15) : S.addDias(adm, 365), resultado: 'apto', clinica: 'Clínica Ocupacional Cerrado' });
    }
    const mesAtual = hojeIso.slice(0, 7);
    const dia = (n) => `${mesAtual}-${String(n).padStart(2, '0')}`;
    const ocorr = [
      [operadores[0], dia(3), 'hora_extra_50', 6, null, 'Carregamento de carreta'], [operadores[1], dia(5), 'falta', null, 1, 'Não compareceu'],
      [operadores[2], dia(8), 'atestado', null, 2, 'Atestado entregue'], [operadores[0], dia(10), 'banco_credito', 4, null, 'Sábado trabalhado'],
      [operadores[3], dia(12), 'atraso', 1.5, null, 'Chegou 1h30 depois'], [colabDe.expedicao[0], dia(9), 'hora_extra_50', 8, null, 'Embarque de pedidos atrasados'],
      [operadores[4], dia(2), 'advertencia', null, null, 'Não usou EPI na área de mistura'], [operadores[0], dia(14), 'banco_debito', 2, null, 'Saída para consulta'],
    ];
    for (const [cid, data, tipo, horas, dias, descricao] of ocorr) if (data <= hojeIso) await db.insert('rh_ocorrencias', { colaborador_id: cid, data, tipo, horas, dias, descricao, usuario_id: rhUser });
    // Férias: uma aprovada no próximo mês e uma solicitação aguardando o RH.
    const antigo = (await db.all(`SELECT * FROM colaboradores WHERE data_admissao < ? ORDER BY data_admissao`, S.addDias(hojeIso, -400)));
    if (antigo[0]) {
      const RH = require('./rh');
      const per = (await RH.periodosFerias(antigo[0])).filter((x) => x.completo && x.saldo > 0).at(-1);
      if (per) await db.insert('rh_ferias', { colaborador_id: antigo[0].id, aquisitivo_inicio: per.inicio, inicio: S.addDias(hojeIso, 20), fim: S.addDias(hojeIso, 39), dias: 20, abono_dias: 10, status: 'aprovada', aprovado_por: rhUser, solicitado_por: rhUser });
    }
    if (antigo[1]) {
      const RH = require('./rh');
      const per = (await RH.periodosFerias(antigo[1])).filter((x) => x.completo && x.saldo > 0).at(-1);
      if (per) {
        const fid = await db.insert('rh_ferias', { colaborador_id: antigo[1].id, aquisitivo_inicio: per.inicio, inicio: S.addDias(hojeIso, 45), fim: S.addDias(hojeIso, 74), dias: 30, status: 'solicitada', observacao: 'Viagem com a família' });
        await db.insert('rh_solicitacoes', { colaborador_id: antigo[1].id, tipo: 'ferias', descricao: 'Viagem com a família', data_inicio: S.addDias(hojeIso, 45), data_fim: S.addDias(hojeIso, 74), ferias_id: fid });
      }
    }
    await db.insert('rh_solicitacoes', { colaborador_id: colabDe.vendedor[0], tipo: 'documento', descricao: 'Declaração de vínculo para financiamento' });
    await db.insert('rh_solicitacoes', { colaborador_id: operadores[3], tipo: 'adiantamento', descricao: 'Adiantamento de 40% do salário', status: 'aprovada', resposta: 'Aprovado para o dia 20', respondido_por: rhUser, respondido_em: hojeIso });

    // ---------- Mensagens ----------
    const emAnalise = await db.all(`SELECT * FROM pedidos WHERE etapa IN ('analise','producao','faturamento') LIMIT 6`);
    for (const [idx, p] of emAnalise.entries()) {
      await db.insert('mensagens', { pedido_id: p.id, remetente_id: p.vendedor_id, setor_destino: idx % 2 ? 'producao' : 'analista', texto: idx % 2 ? 'Cliente pediu prioridade na produção, plantio começa semana que vem.' : 'Cliente já tem referência positiva na Cooxupé, pode ligar para confirmar.' });
    }
    await db.insert('mensagens', { remetente_id: diretor, texto: 'Bem-vindos ao novo Agroterra Sistema! Dúvidas, falem com a diretoria.' });
    await db.run(`UPDATE usuarios SET termo_aceito_em = datetime('now','localtime')`);
    return { admin, diretor };
  }));
}

// Dados de demonstração só para desenvolvimento e testes: nunca rode em produção.
// Uso: npm run seed:demo (recria o banco local em data/pglite).
if (require.main === module) {
  (async () => {
    if (process.env.DATABASE_URL && !process.argv.includes('--forcar')) {
      console.error('DATABASE_URL definida: o seed de demonstração não roda no banco de produção.');
      process.exit(1);
    }
    if (process.argv.includes('--reset')) fs.rmSync(path.join(__dirname, '..', 'data', 'pglite'), { recursive: true, force: true });
    await db.open();
    if (await db.get('SELECT id FROM usuarios LIMIT 1')) {
      console.log('Banco já possui dados. Use --reset para recriar.');
    } else {
      console.time('seed');
      await seed();
      console.timeEnd('seed');
      console.log('Dados de demonstração carregados. Usuários: admin/admin123, diretoria, ana, carlos, analise, producao, faturamento, expedicao, financeiro (senha agro123).');
    }
    await db.close();
  })();
}

module.exports = { seed };
