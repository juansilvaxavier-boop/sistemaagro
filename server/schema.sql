PRAGMA foreign_keys = ON;

-- ============ Acesso ============
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  uf TEXT
);

CREATE TABLE IF NOT EXISTS equipes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  supervisor_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  email TEXT,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL,
  equipe_id INTEGER REFERENCES equipes(id),
  comissao_pct REAL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS usuario_empresas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id INTEGER REFERENCES empresas(id),
  expira_em TEXT NOT NULL
);

-- ============ Clientes ============
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  tipo_pessoa TEXT NOT NULL DEFAULT 'F',          -- F ou J
  documento TEXT NOT NULL UNIQUE,                  -- CPF/CNPJ apenas dígitos
  nome TEXT NOT NULL,
  nome_fantasia TEXT,
  inscricao_estadual TEXT,
  inscricao_produtor TEXT,
  email TEXT,
  data_nascimento TEXT,
  vendedor_id INTEGER REFERENCES usuarios(id),
  limite_credito REAL DEFAULT 0,
  observacao TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cliente_enderecos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT DEFAULT 'Entrega',
  cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT,
  cidade TEXT, uf TEXT,
  zona_rural INTEGER DEFAULT 0,
  posta_restante INTEGER DEFAULT 0,
  como_chegar TEXT,
  principal INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cliente_telefones (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT DEFAULT 'Celular',
  numero TEXT NOT NULL,
  contato TEXT,
  whatsapp INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cliente_areas (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo_cultivo TEXT NOT NULL,
  qtd_pes INTEGER,
  area REAL,
  medida TEXT DEFAULT 'ha'                          -- ha, alqueire, m2, tarefa
);

CREATE TABLE IF NOT EXISTS cliente_ref_comerciais (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  empresa TEXT NOT NULL,
  contato TEXT, telefone TEXT,
  ultima_checagem TEXT,
  checada INTEGER DEFAULT 0,
  positivo INTEGER DEFAULT 0,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS cliente_ref_bancarias (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  banco TEXT NOT NULL,
  agencia TEXT, conta TEXT, gerente TEXT, telefone TEXT,
  data_checagem TEXT,
  checada INTEGER DEFAULT 0,
  positivo INTEGER DEFAULT 0,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                               -- alerta | bloqueio
  motivo TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  data_inclusao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ativo INTEGER NOT NULL DEFAULT 1,
  motivo_exclusao TEXT,
  usuario_exclusao_id INTEGER REFERENCES usuarios(id),
  data_exclusao TEXT
);

CREATE TABLE IF NOT EXISTS consultas_serasa (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  pedido_id INTEGER REFERENCES pedidos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  tipo TEXT DEFAULT 'serasa',                       -- serasa | restricao
  score INTEGER,
  restricoes INTEGER,
  valor_restricoes REAL,
  resultado TEXT,
  justificativa TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ Cadastros ============
CREATE TABLE IF NOT EXISTS grupos_produto (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  codigo TEXT UNIQUE,
  nome TEXT NOT NULL,
  grupo_id INTEGER REFERENCES grupos_produto(id),
  unidade TEXT DEFAULT 'KG',
  ncm TEXT, cst TEXT, cfop TEXT, gtin TEXT,
  reducao_bc REAL DEFAULT 0,
  perigoso INTEGER DEFAULT 0,
  origem TEXT DEFAULT 'nacional',                   -- nacional | adquirido
  qtd_ecommerce REAL,
  prazo_producao_dias INTEGER DEFAULT 3,
  ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produto_embalagens (
  id INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  unidade TEXT DEFAULT 'KG',
  custo REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS produto_brindes (
  id INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  brinde_produto_id INTEGER NOT NULL REFERENCES produtos(id),
  qtd_minima REAL NOT NULL,
  qtd_brinde REAL NOT NULL,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS produto_precos (
  id INTEGER PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  embalagem_id INTEGER REFERENCES produto_embalagens(id) ON DELETE CASCADE,
  forma_id INTEGER REFERENCES formas_pagamento(id),
  valor REAL NOT NULL,
  vigencia_inicio TEXT
);

CREATE TABLE IF NOT EXISTS formas_pagamento (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'prazo',               -- a_vista | prazo
  tipo_baixa TEXT DEFAULT 'boleto',
  ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS condicoes_pagamento (
  id INTEGER PRIMARY KEY,
  forma_id INTEGER NOT NULL REFERENCES formas_pagamento(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  parcelas INTEGER NOT NULL DEFAULT 1,
  intervalo_dias INTEGER NOT NULL DEFAULT 30,
  carencia_dias INTEGER NOT NULL DEFAULT 30,
  desconto_pct REAL DEFAULT 0,
  valor_minimo REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS penalidades_comissao (
  id INTEGER PRIMARY KEY,
  forma_id INTEGER NOT NULL REFERENCES formas_pagamento(id) ON DELETE CASCADE,
  dias_de INTEGER NOT NULL,
  dias_ate INTEGER NOT NULL,
  perda_pct REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transportadoras (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT, telefone TEXT, email TEXT,
  ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bancos (
  id INTEGER PRIMARY KEY,
  codigo TEXT, nome TEXT NOT NULL
);

-- ============ Pedidos ============
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
  supervisor_id INTEGER REFERENCES usuarios(id),
  analista_id INTEGER REFERENCES usuarios(id),
  forma_id INTEGER REFERENCES formas_pagamento(id),
  condicao_id INTEGER REFERENCES condicoes_pagamento(id),
  etapa TEXT NOT NULL DEFAULT 'venda',
  valor_produtos REAL DEFAULT 0,
  valor_desconto REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  observacao TEXT,
  observacao_supervisor TEXT,
  endereco_entrega_id INTEGER REFERENCES cliente_enderecos(id),
  tipo_entrega TEXT DEFAULT 'transportadora',       -- transportadora | posta_restante | veiculo_proprio | retirada
  transportadora_id INTEGER REFERENCES transportadoras(id),
  frete_codigo_cotacao TEXT,
  frete_prazo_dias INTEGER,
  frete_valor REAL,
  frete_ignorado INTEGER DEFAULT 0,
  frete_motivo_ignorar TEXT,
  prazo_producao TEXT,
  data_chegada_producao TEXT,
  pagamento_confirmado_em TEXT,
  data_embarque TEXT,
  data_entrega_prevista TEXT,
  data_entrega TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  etapa_desde TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pedidos_etapa ON pedidos(etapa);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  embalagem_id INTEGER REFERENCES produto_embalagens(id),
  quantidade REAL NOT NULL,
  unidade TEXT,
  valor_tabela REAL DEFAULT 0,
  custo_embalagem REAL DEFAULT 0,
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  brinde INTEGER DEFAULT 0,
  lote TEXT,
  fabricacao TEXT,
  validade TEXT
);

CREATE TABLE IF NOT EXISTS pedido_historico (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  etapa_origem TEXT,
  etapa_destino TEXT,
  acao TEXT NOT NULL,
  observacao TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_hist_pedido ON pedido_historico(pedido_id);

CREATE TABLE IF NOT EXISTS pedido_comentarios (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id),
  etapa TEXT,
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pedido_comissoes (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  papel TEXT,
  percentual REAL NOT NULL,
  valor REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pedido_links_pagamento (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  valor REAL NOT NULL,
  meio TEXT DEFAULT 'PIX',
  status TEXT DEFAULT 'pendente',                   -- pendente | pago | expirado
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ Comunicação ============
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  remetente_id INTEGER NOT NULL REFERENCES usuarios(id),
  destinatario_id INTEGER REFERENCES usuarios(id),
  setor_destino TEXT,
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS mensagem_leituras (
  mensagem_id INTEGER NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lida_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (mensagem_id, usuario_id)
);

-- ============ Financeiro ============
CREATE TABLE IF NOT EXISTS notas_fiscais (
  id INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL,
  serie INTEGER NOT NULL DEFAULT 1,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  valor REAL NOT NULL,
  chave TEXT,
  status TEXT NOT NULL DEFAULT 'autorizada',        -- autorizada | cancelada | devolvida | devolvida_parcial
  data_emissao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  motivo_cancelamento TEXT,
  data_cancelamento TEXT,
  UNIQUE (empresa_id, serie, numero)
);

CREATE TABLE IF NOT EXISTS cartas_correcao (
  id INTEGER PRIMARY KEY,
  nota_id INTEGER NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  sequencia INTEGER NOT NULL,
  texto TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS parcelas (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id),
  nota_id INTEGER REFERENCES notas_fiscais(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  empresa_id INTEGER REFERENCES empresas(id),
  numero INTEGER NOT NULL,
  total_parcelas INTEGER,
  vencimento TEXT NOT NULL,
  vencimento_original TEXT,
  valor REAL NOT NULL,
  juros REAL DEFAULT 0,
  desconto REAL DEFAULT 0,
  valor_pago REAL DEFAULT 0,
  data_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'a_pagar',           -- a_pagar | liquidada | negociada | acordo_judicial | cancelada | devolvida
  tipo_baixa TEXT,                                  -- PIX | boleto | TED | dinheiro | cheque | outros
  banco_id INTEGER REFERENCES bancos(id),
  nosso_numero TEXT,
  prorrogacoes INTEGER DEFAULT 0,
  observacao TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_parcelas_cliente ON parcelas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_venc ON parcelas(vencimento);

CREATE TABLE IF NOT EXISTS parcela_eventos (
  id INTEGER PRIMARY KEY,
  parcela_id INTEGER NOT NULL REFERENCES parcelas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lancamentos_vendedor (
  id INTEGER PRIMARY KEY,
  vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
  periodo TEXT NOT NULL,                            -- YYYY-MM
  tipo_ocorrencia TEXT NOT NULL,                    -- desconto | credito | desconto_brinde
  valor REAL NOT NULL,
  descricao TEXT,
  pedido_id INTEGER REFERENCES pedidos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS comissoes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  periodo TEXT NOT NULL,
  perfil TEXT,
  tipo_comissao TEXT,                               -- venda | supervisao | recebimento
  empresa_id INTEGER REFERENCES empresas(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  parcela_id INTEGER REFERENCES parcelas(id),
  valor_base REAL DEFAULT 0,
  percentual REAL DEFAULT 0,
  perda_pct REAL DEFAULT 0,
  valor REAL DEFAULT 0,
  status TEXT DEFAULT 'aberta',                     -- aberta | revisada | paga
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS devolucoes (
  id INTEGER PRIMARY KEY,
  nota_id INTEGER NOT NULL REFERENCES notas_fiscais(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  motivo TEXT NOT NULL,
  tipo TEXT DEFAULT 'mercadoria',                   -- mercadoria | avaria | desacordo | outros
  valor REAL NOT NULL,
  frete REAL DEFAULT 0,
  total INTEGER DEFAULT 0,
  baixa_parcelas INTEGER DEFAULT 1,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS negativacoes (
  id INTEGER PRIMARY KEY,
  parcela_id INTEGER NOT NULL REFERENCES parcelas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  valor REAL,
  status TEXT NOT NULL DEFAULT 'inclusao_solicitada',
  -- inclusao_solicitada -> inclusao_aceita | inclusao_rejeitada -> baixa_solicitada -> baixa_aceita | baixa_rejeitada
  protocolo TEXT,
  motivo_rejeicao TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============ Cobrança / CRM / Arquivos ============
CREATE TABLE IF NOT EXISTS cobranca_acoes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  parcela_id INTEGER REFERENCES parcelas(id),
  tipo TEXT NOT NULL,                               -- ligacao | whatsapp | email | sms | visita | carta | promessa | acordo
  resultado TEXT,                                   -- contato_efetivo | sem_contato | promessa | recusa | numero_invalido
  descricao TEXT,
  data_promessa TEXT,
  valor_promessa REAL,
  proxima_acao TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS acordos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  valor_original REAL NOT NULL,
  desconto REAL DEFAULT 0,
  valor_acordo REAL NOT NULL,
  parcelas INTEGER NOT NULL,
  primeiro_vencimento TEXT NOT NULL,
  judicial INTEGER DEFAULT 0,
  observacao TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS crm_interacoes (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  pedido_id INTEGER REFERENCES pedidos(id),
  tipo TEXT NOT NULL,                               -- ligacao | visita | whatsapp | email | reuniao | pos_venda | reclamacao
  assunto TEXT NOT NULL,
  descricao TEXT,
  data TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS crm_oportunidades (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  valor_estimado REAL DEFAULT 0,
  estagio TEXT NOT NULL DEFAULT 'prospeccao',       -- prospeccao | qualificacao | proposta | negociacao | ganha | perdida
  previsao_fechamento TEXT,
  safra TEXT,
  responsavel_id INTEGER REFERENCES usuarios(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  motivo_perda TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS crm_tarefas (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  vencimento TEXT,
  concluida INTEGER DEFAULT 0,
  responsavel_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS arquivos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  categoria TEXT DEFAULT 'Outros',                  -- Contrato | Documento pessoal | Comprovante | Nota fiscal | Outros
  descricao TEXT,
  nome_original TEXT NOT NULL,
  caminho TEXT NOT NULL,
  mime TEXT,
  tamanho INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sequencias (
  nome TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
