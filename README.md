# Agroterra Sistema

ERP web de venda, crédito, cobrança e logística para distribuição de fertilizantes e insumos agrícolas,
construído a partir do levantamento *Agroterra Sistema – Funcionalidades por Etapa*.

O centro do sistema é o **pedido de venda**, que passa por uma fila própria em cada setor até ser entregue.

## Como rodar

Requisitos: Node.js 22.5 ou superior.

```bash
npm install
npm run demo       # http://localhost:3000 com dados de demonstração (banco local PGlite em data/pglite)
npm start          # sem dados de demonstração: cria só a empresa e o usuário admin
npm run seed:demo  # recria o banco local de demonstração
npm test           # testes de ponta a ponta (PGlite em memória)
TEST_DATABASE_URL=postgresql://... npm test   # mesmos testes num PostgreSQL de verdade (rodam em série)
```

### Banco de dados

- **Produção:** PostgreSQL do Supabase (projeto `agroterra-sistema`, São Paulo), schema próprio `agroterra`, acessado pelo papel
  `agroterra_app` via pooler (`DATABASE_URL`). O schema é aplicado automaticamente na inicialização quando muda (`server/schema.sql`).
- **Desenvolvimento e testes:** PGlite (PostgreSQL embutido), sem instalar nada.
- **Backup:** automático todo dia às 03:00 (Vercel Cron → `/api/cron/backup`, protegido por `CRON_SECRET`), guardando os 30 mais recentes,
  e manual em *Segurança → Backups*, com download do arquivo `.json.gz`.

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL (sem ela, usa o PGlite local) |
| `SESSION_SECRET` | Assina as sessões (obrigatória com várias instâncias) |
| `ADMIN_SENHA_INICIAL` | Senha provisória do usuário `admin` criado no primeiro início |
| `ADMIN_LOGIN`, `EMPRESA_NOME`, `EMPRESA_CNPJ` | Dados iniciais opcionais |
| `CRON_SECRET` | Protege a rota do backup agendado |
| `UPLOAD_MAX_MB` | Tamanho máximo dos anexos (padrão 4) |
| `ESTOQUE_BLOQUEAR` | `1` impede emitir NF-e sem saldo em estoque (padrão: permite e mostra alerta) |
| `ANTHROPIC_API_KEY` | Liga o assistente de IA (sem ela, o assistente responde pelo manual) |
| `ASSISTENTE_MODELO`, `ASSISTENTE_ESFORCO` | Modelo (padrão `claude-opus-5-5`) e esforço (padrão `low`) do assistente |
| `ASSISTENTE_LIMITE_HORA` | Perguntas por usuário por hora (padrão 40) |

### Primeiro acesso em produção

Não há dados nem senhas de demonstração em produção. O sistema cria a empresa e o usuário `admin` com a senha provisória de
`ADMIN_SENHA_INICIAL`. No primeiro login o administrador troca a senha e aceita o termo de privacidade. Depois:

1. **Cadastros → Empresas:** ajuste nome e CNPJ.
2. **Cadastros → Colaboradores:** cadastre as pessoas.
3. **Cadastros → Usuários e Permissões:** crie o acesso de cada colaborador, com perfil e, se quiser, permissões individuais.
   A senha definida é provisória e a pessoa troca no primeiro acesso.
4. Cadastre produtos (com peso e estoque mínimo nas embalagens), formas de pagamento, transportadoras, fornecedores e equipes.
   Preencha endereço e CEP da empresa: eles saem como remetente nas etiquetas.

### Usuários de demonstração (só com `npm run demo`)

| Login | Perfil | Senha |
|---|---|---|
| `admin` | Administrador | `admin123` |
| `diretoria` | Diretoria (acesso a tudo, duas empresas) | `agro123` |
| `ana`, `bruno`, `diego` | Vendedor (Equipe Cerrado) | `agro123` |
| `elisa`, `gabriel` | Vendedor (Equipe Sul de Minas) | `agro123` |
| `helena` | Vendedor sem equipe (pedidos pulam a supervisão) | `agro123` |
| `carlos`, `fernanda` | Supervisor | `agro123` |
| `analise` | Análise de crédito | `agro123` |
| `producao`, `faturamento`, `expedicao`, `financeiro` | Setores | `agro123` |
| `rh` | RH / DP | `agro123` |
| `compras` | Compras (comprador) | `agro123` |
| `gerente` | Gerente comercial (automações do CRM) | `agro123` |

### Importar dados do sistema anterior

Em **Segurança → Importar dados**, envie a planilha de relatórios do sistema anterior (abas Vendas, Faturamento, Contas a Receber,
Contas Recebidas, Parcelas Vencidas, Parcelas Liquidadas e Cadastros). O sistema mostra a prévia com totais e pontos de atenção e só grava
depois da confirmação, com backup automático antes. Cada registro importado guarda a origem: reenviar a planilha (por exemplo, com um mês a mais)
não duplica nada, e o botão *Desfazer importação* remove tudo o que veio dela.

O que entra: vendedores e supervisores (como colaboradores, usuários **sem acesso** e equipes), clientes com CPF/CNPJ, cidade e telefone,
pedidos (com o número antigo pesquisável na busca), notas fiscais de saída e parcelas pagas e em aberto. A numeração da NF-e continua
depois da maior nota encontrada. Também pela linha de comando: `node scripts/importar-planilha.js planilha.xlsx --aplicar`.

## Segurança, LGPD e auditoria

- Senha com no mínimo 8 caracteres (letras e números), troca obrigatória da senha provisória e bloqueio por 15 minutos após 5 tentativas erradas.
- Termo de uso e política de privacidade aceitos no primeiro acesso (*Segurança → Privacidade*).
- Permissões por usuário: o perfil traz um padrão e o administrador pode personalizar item a item.
- CPF/CNPJ, telefone e e-mail aparecem mascarados para quem não tem a permissão *Ver dados completos*, e não podem ser sobrescritos por ele.
- Auditoria (*Segurança → Auditoria*): inclusões, alterações (antes e depois), exclusões, logins, acessos a cadastros de clientes,
  downloads, exportações e backups, com usuário, data e IP.
- Direitos do titular: na aba *LGPD* do cliente, exportar todos os dados (JSON) ou anonimizar o cadastro, mantendo os registros fiscais.
- Abrangência dos dados (*Dados que pode ver*, em *Usuários e Permissões*): o vendedor vê só o que gerou (pedidos, clientes da carteira,
  propostas, parcelas, comissões, mensagens, arquivos e relatórios); o supervisor vê a equipe que supervisiona; os demais perfis veem tudo.
  O administrador pode mudar o nível de cada usuário. A regra fica em `server/escopo.js` e vale para listas, detalhes, relatórios e para o assistente.
- Painel: cada usuário vê o painel do seu setor (vendedor, as próprias vendas; supervisor, a equipe). Só quem tem *Ver o painel de qualquer setor* troca de painel.

## Recursos da interface

**Painel com filtro:** período (este mês, mês passado, 30 e 90 dias, este ano ou personalizado) e recortes por vendedor, equipe,
forma de pagamento e UF de entrega, em todos os painéis. O período vale para os indicadores de movimento; filas e saldos mostram
a situação atual com os recortes. API: `/api/dashboard?de=&ate=&vendedores=&equipes=&formas=&ufs=`.

Tema claro e escuro, menu recolhível, busca global (**Ctrl+K**) por pedido, cliente ou tela, caixinha fixa no canto inferior
direito com o **chat interno** (leitura, quem está online, contador de não lidas) e o **assistente de IA**, *Meu perfil* com foto, avisos do navegador para mensagens e pedidos, e instalação como
aplicativo (PWA) no computador ou no celular.

**Todas as empresas:** quem tem acesso a mais de uma empresa pode escolher *Todas as empresas* na tela de escolha da
empresa ou no seletor do menu. Painel, filas, listas e relatórios passam a somar as empresas liberadas para o usuário.
Pedidos, parcelas, notas e contas a pagar ganham a coluna *Empresa*, com filtro. A visão é só para consulta: lançar ou
alterar pede que se escolha uma empresa (a API responde 409 `somente_consulta`). Nessa sessão, o banco troca
`empresa_id = ?` pela lista de empresas do usuário nas consultas (`paraTodasEmpresas` em `server/db.js`).

**Design system:** tokens de cor, tipografia, espaço, raios e sombras, mais os componentes compartilhados (botões, modal,
toast, tabela padrão com modo cartão no celular, indicadores com variação vs período anterior e estilo único de gráficos).
As regras estão em [`docs/design-system.md`](docs/design-system.md).

## O que o sistema tem

**Acesso:** login, escolha da empresa (multiempresa) e menus liberados conforme o perfil do usuário.

**Menu por áreas:** o menu lateral mostra só as áreas (Início, Comercial, Financeiro, Operação, Gestão). As telas
relacionadas ficam em abas no topo de cada área — por exemplo, *Pedidos* reúne todas as filas (Vendedor → Devolução)
com o contador de cada uma, *Clientes* reúne Cadastro, Histórico de compra, Blacklist e Arquivos, e *Comissões* reúne
Revisar, Descontos e créditos e Regras. A diretoria vê 17 itens no menu (antes eram 50); vendedor e faturamento veem 8.
A área lembra a última aba usada, e a busca (Ctrl+K) continua encontrando qualquer tela pelo nome.

**Padrão de tela:** toda lista tem filtro por coluna, ordenação, paginação e os botões *Limpar Filtros*,
*Exportar para Excel* (.xlsx real) e *Imprimir*. Cadastros e ações abrem em janelas com abas.

**Comunicação interna:** mensagens entre setores ou pessoas, vinculadas ao número do pedido, com aviso em
tempo real (Server-Sent Events) e *Marcar como lida*.

### Filas do pedido

Cada fila (e a aba *Progressão dos Pedidos*) tem um painel **Filtros**: períodos com atalhos (hoje, 7 e 30 dias, este mês,
mês passado, este ano), faixa de valor e de dias na fila, cliente, CPF/CNPJ, vendedor, supervisor, equipe, forma de pagamento,
UF, cidade, tipo de entrega, transportadora, nota e blacklist. Os filtros aparecem como etiquetas removíveis, ficam salvos na
sessão e valem para a exportação e a impressão. No servidor, as listas aceitam `de_<coluna>`, `ate_<coluna>` e `em_<coluna>=a,b`.

Cada fila tem as abas **Pedidos** (o que está parado na etapa) e **Progressão dos Pedidos** (histórico geral com filtro por etapa).

| Etapa | Funcionalidades |
|---|---|
| Vendedor | Criar/editar pedido (cliente, forma e condição de pagamento, itens com grupo, produto, embalagem, valor de tabela, custo, valor unitário, brinde), cadastro de cliente com 6 abas, links de pagamento, resumo imprimível |
| Supervisor | Observação de supervisão, consulta Serasa, checagem de referência comercial, histórico do cliente, coluna Equipe |
| Análise | Serasa e restrição de crédito (com justificativa para nova consulta em 30 dias), checagem de referências comerciais e bancárias, cotação de frete (ou ignorar com motivo), troca de transportadora, posta restante / veículo próprio / retirada, comentários |
| Diretoria | Revisão de frete e referência bancária, definição das comissões, Serasa, histórico e comentários |
| Pagamento à vista | Confirmação do pagamento à vista antes da produção |
| Produção | Lote, fabricação e validade por item, prazo de produção, data de chegada |
| Faturamento | Ajuste do endereço de entrega e emissão da NF-e (gera parcelas e comissões) |
| Expedição | Data de embarque, entrega prevista, transportadora |
| Em trânsito | Abas *Pedidos em trânsito* e *Pedidos entregues*, registro da entrega |
| Devolução | Pedidos com devolução total |

Telas de apoio: **Histórico de Compra de Cliente** (por CPF/CNPJ) e **Cliente (Blacklist)** com os tipos
*só alerta para o analista* e *bloqueio de pedidos novos e em andamento*; inclusão e exclusão registram data, usuário e motivo.

### Cadastros, Financeiro e Relatórios

- **Registro:** Produto (abas Geral, Embalagem, Brinde e Tabela de Preço; dados fiscais NCM/CST/GTIN/redução de BC; perigoso; nacional/adquirido; quantidade para e-commerce), Forma de Pagamento (condições com parcelas, intervalo, carência, desconto e valor mínimo; penalidades de comissão por faixa de atraso), Transportadoras, Usuários, Equipes, Empresas, Alterar Minha Senha.
- **Financeiro:** Gestão de Parcelas (baixa total/parcial, juros, prorrogação, status, tipo de baixa, banco, envio ao Serasa e à blacklist), Lançar Descontos/Créditos, Revisar Comissões (ordens e resumo por colaborador), Lançar Desconto Devolução (com baixa automática das parcelas), Clientes Negativados (ciclo inclusão → aceita/rejeitada → pedido de baixa → aceita/rejeitada), Nota Fiscal de Saída (cancelar, CC-e, devolução).
- **Relatórios** (Gerar Relatório e Gerar Excel): Contas a Receber, Contas Recebidas, Vendas, Faturamento, Vencidas, Histórico de Vendas, Venda de Produtos, Vendedores por Supervisor — com os filtros do levantamento.

### As quatro funcionalidades novas

| Funcionalidade | Onde |
|---|---|
| **Cobrança completa** | Menu *Cobrança*: saldo por faixa de atraso, carteira de inadimplentes por cliente, agenda de promessas e próximas ações, registro de ações (ligação, WhatsApp, e-mail, visita...), acordos que substituem parcelas, atalhos para baixa, prorrogação, Serasa e blacklist |
| **CRM integrado** | Menu *CRM*: visão 360º do cliente com linha do tempo de tudo (interações, pedidos, notas, pagamentos, cobrança, Serasa, blacklist, arquivos), funil de oportunidades em kanban, tarefas e clientes sem compra para reativação |
| **Dashboards por perfil** | *Painel*: indicadores e gráficos de Vendedor, Supervisor, Análise, Diretoria, Produção, Faturamento, Expedição e Financeiro; a Diretoria pode ver o painel de qualquer perfil |
| **Arquivos e documentos** | Menu *Arquivos* e aba *Arquivos* no cliente e no pedido: envio por arrastar e soltar, categorias (contrato, comprovante...), visualização e download com controle de acesso |

### Estoque, expedição, compras e atendimento interno

| Módulo | Onde | O que faz |
|---|---|---|
| **Controle de estoque** | *Estoque → Controle de Estoque* | Saldo por produto e embalagem, com lote, validade, custo médio, quantidade em pedidos e disponível; estoque mínimo com alerta; entradas (compra, produção, devolução) e saídas (perda, consumo, amostra); inventário com folha de contagem e ajuste automático. A NF-e emitida baixa o estoque e o cancelamento ou a devolução total estornam. Com `ESTOQUE_BLOQUEAR=1` o faturamento sem saldo é bloqueado. |
| **Etiqueta de envio** | Botão *Etiqueta* no pedido e nas filas de Faturamento, Expedição e Trânsito | Etiqueta 10 × 15 cm (impressora térmica) ou A4 com 4 por folha, uma por volume: destinatário, CEP com código de barras, remetente, NF-e e chave, peso, volume X/N e código de rastreio (Correios ou CT-e) em Code 128. |
| **Contas a pagar** | *Financeiro → Contas a Pagar* | Lançamento único, parcelado ou recorrente; baixa total ou parcial com juros e desconto; estorno; cancelamento (também das parcelas seguintes); indicadores de vencido, vence hoje e próximos 7 dias. |
| **Fornecedores** | *Cadastros → Fornecedores* | Dados cadastrais com validação de CNPJ/CPF, endereço, dados bancários e PIX, categoria e prazo de pagamento padrão (preenche o vencimento). |
| **Chamados internos** | *Início → Chamados Internos* e botão *Chamado* no pedido | Abertura para um setor, prioridade com prazo (urgente 1 dia, alta 2, média 5, baixa 10), atribuição, comentários, pedido de informação, solução, avaliação de 1 a 5 e aviso em tempo real. |
| **Proposta comercial** | *Vendas → Propostas Comerciais* | Orçamento com preço de tabela por forma de pagamento, desconto por item, frete e condições comerciais; impressão em PDF para o cliente; enviada → aceita/recusada (com motivo) → *Gerar pedido* com os mesmos itens e preços; duplicar; atualiza a oportunidade do CRM. |

### Compras

Menu *Operação → Compras*, com as abas abaixo. Perfil novo **Compras** (comprador) e permissões *Solicitar compras*, *Cotar e emitir
pedidos de compra*, *Aprovar pedidos de compra* e *Receber mercadoria*. Produção, Expedição, Faturamento, Financeiro, RH, Supervisor
e Gerente já vêm com *Solicitar*; a Diretoria aprova.

| Aba | O que faz |
|---|---|
| **Solicitações** | Qualquer setor pede: departamento e itens da lista (produto do estoque ou item avulso com categoria e unidade), urgência, prazo e justificativa. O comprador lança as cotações de cada fornecedor e vê o comparativo (menor preço destacado); *Comprar* gera o pedido de compra com a cotação escolhida. |
| **Pedidos de compra** | Rascunho → aprovação → aprovado → enviado → recebido. Acima do limite (`compras.aprovacao_acima`, padrão R$ 5.000) vai para aprovação; abaixo é aprovado na hora. Devolução com motivo, cancelamento, impressão para o fornecedor e compra direta sem solicitação. |
| **Receber mercadoria** | Conferência com a NF do fornecedor, total ou parcial, com lote e validade: entrada no estoque com o custo do pedido (frete e desconto rateados) e lançamento da conta a pagar nas parcelas combinadas. |
| **Reposição de estoque** | Itens com disponível abaixo do mínimo, descontando o que já está em compra ou solicitado; sugere repor até o dobro do mínimo, com último custo e fornecedor, e gera a solicitação. |

Avisos em tempo real para comprador, aprovador, recebedor, solicitante e Financeiro; painel do perfil Compras e card de compras para
aprovar no painel da Diretoria.

### Automações do CRM

*CRM → Automações* (permissão *Configurar automações do CRM*): regras que criam tarefas sozinhas, todo dia às 6h30 (Vercel Cron
`/api/cron/crm`, protegido por `CRON_SECRET`) e, como reserva, na primeira consulta de tarefas do dia. Gatilhos: cliente sem comprar,
pós-venda após a entrega, primeira compra, recompra da safra, oportunidade parada, fechamento previsto, proposta sem retorno, parcela
vencida e aniversário. Cada regra tem dias, título com variáveis, prazo, prioridade, responsável (vendedor, supervisor ou usuário fixo),
equipe, valor mínimo e limite por dia; *Simular* mostra o resultado sem criar. Uma chave única por regra impede tarefa repetida. Na aba
*Tarefas*, concluir uma tarefa pode registrar a interação na linha do tempo do cliente. Regras em `server/crm-automacoes.js`.

### Gestão comercial e financeira

| Função | Onde | O que faz |
|---|---|---|
| **Metas e campanhas** | *Comercial → Metas e campanhas* | Metas do mês por empresa, equipe e vendedor (valor, volume, pedidos e clientes novos) com realizado, % e projeção de fechamento; copiar do mês anterior com reajuste; ranking mensal; campanhas por período, produto/grupo e equipe, com meta individual, prêmio e placar. Card "Meta do mês" no painel. Permissões *Ver metas* e *Definir metas*. |
| **Tabelas de preço por região e safra** | *Gestão → Cadastros → Tabelas de preço* | Tabela por UF (ou Brasil inteiro) e safra, com vigência, prioridade, ajuste % sobre o preço base e preço próprio por embalagem (com margem sobre o custo); reajuste em lote e cópia para a próxima safra. O pedido e a proposta usam a tabela vigente para a UF de entrega, e a política comercial compara com ela. Regras em `server/precos.js`. |
| **Limite de crédito automático** | *Financeiro → Contas a receber → Limites de crédito* | Exposição = parcelas em aberto + pedidos em andamento. Venda a prazo acima do limite ou de cliente com parcela vencida há mais de 15 dias (ajustável em *Regras de bloqueio*) não passa da Análise sem liberação da Diretoria, com justificativa no histórico. Limite sugerido (média mensal comprada × meses de cobertura, ajustado por score Serasa e atrasos; zero com blacklist ou negativação), aplicação em lote e limite automático recalculado todo dia. Regras em `server/credito.js`. |
| **Tesouraria** | *Financeiro → Tesouraria* | **Fluxo de caixa** realizado + previsto por dia, semana ou mês, com saldo de partida do extrato ou informado e menor saldo do período. **Resultado do mês** (DRE gerencial): receita das notas, devoluções, impostos (% configurável), custo dos produtos, comissões, fretes e despesas por categoria. **Conciliação bancária**: importação de OFX sem duplicar, casamento com parcelas e contas a pagar pelo valor e pela data, baixa automática dos pares seguros, lançamento de tarifas como despesa e ignorar com motivo. Regras em `server/tesouraria.js`. |
| **Calendário da safra** | *CRM → Calendário da safra* | Janelas de plantio e adubação por cultura (e UF), já preenchidas e ajustáveis, cruzadas com as áreas de cultivo dos clientes. Nova automação do CRM "Calendário da safra" cria a tarefa para o vendedor dentro da antecedência, se o cliente ainda não comprou para a janela. |
| **Rastreio automático** | Aba *Rastreio* do pedido e botão *Atualizar rastreios* na fila Em trânsito | Consulta o código de rastreio nos Correios (pela integração; também em modo simulação), grava os eventos e, quando a entrega é confirmada, conclui o pedido sozinho. Roda todo dia. Transportadoras sem API de rastreio continuam com a entrega manual. |
| **Análises** | *Gestão → Análises* | **Curva ABC** de clientes e produtos por faturamento ou margem (3 a 24 meses); **previsão de demanda** por embalagem (sazonalidade do ano anterior com tendência + média recente) comparada com disponível e compras, gerando a solicitação de compra; **recompra atrasada**: clientes que passaram do intervalo habitual entre compras. |

| **Portal do cliente** | `/portal` (link de acesso no *CRM → cliente → Portal do cliente*) | O produtor entra com CPF/CNPJ e senha e acompanha os pedidos (situação em 6 passos, itens, entrega e rastreio), boletos em aberto (linha digitável, PIX e PDF), notas, extrato de 12 meses e faz pedido pela tabela de preço da região dele; o pedido entra na etapa do vendedor da carteira (origem "Portal do cliente"), que confere e envia. Acesso por convite de 7 dias (só o hash fica no banco), senha forte, bloqueio após 5 erros, sessão própria (cookie `agt_portal` restrito a `/api/portal`) e desativação na hora. Rotas em `server/routes/portal.js`. |
| **Validade e produto parado** | *Operação → Estoque → Validade e parados* | Lotes vencidos e vencendo (prazo configurável, padrão 90 dias) com valor em risco, e produtos sem saída há mais de N dias (padrão 120) com o capital parado. Ações: criar campanha para girar o item (vai para *Metas e campanhas*) e baixar o lote como perda. Lote vencido bloqueia *Concluir produção* e *Emitir nota fiscal* (ou só avisa, pela regra). A aba Produção do pedido sugere os lotes em ordem de vencimento (FEFO) e preenche a validade. Card "Lotes vencendo" no painel da Produção, Expedição, Faturamento e Diretoria. |
| **Comissão paga com a folha** | *Gestão → RH e DP → Folha do mês* | As comissões revisadas pelo Financeiro (e os créditos/descontos do vendedor) ainda não pagas entram como evento na folha de quem é CLT; para PJ, autônomo, sócio, terceirizado ou quem não tem cadastro de colaborador, o fechamento da competência lança a conta a pagar (categoria *Comissões*, vencimento no dia configurado do mês seguinte). Fechar marca as comissões como pagas; reabrir devolve para "revisada" e cancela as contas ainda não pagas. Regras em `server/comissao-folha.js`. |

A rotina diária (`/api/cron/crm`, Vercel Cron às 06h30, protegida por `CRON_SECRET`) roda as automações do CRM, recalcula os limites
automáticos, consulta os rastreios e os boletos em aberto.

### RH e DP

| Tela | O que faz |
|---|---|
| **Meu RH** (todos) | Dados do contrato, saldo de férias por período aquisitivo, ponto, benefícios, documentos e solicitações ao RH (férias, atestado com anexo, alteração cadastral, declaração, adiantamento). |
| **Painel do RH** | Ativos, turnover, solicitações, férias vencendo ou vencidas, exames vencidos, aniversariantes, quadro por departamento e custo mensal. |
| **Colaboradores** | Admissão e ficha com dados pessoais, contrato, salário, banco, dependentes, histórico (reajustes, promoções), benefícios, exames (ASO) e documentos; desligamento (desativa o acesso). Salário e banco só com *Gerir RH* ou *Folha*. |
| **Férias** | Programação validada pela CLT: dias de direito pelas faltas (art. 130), até 3 períodos (um ≥ 14 dias, nenhum < 5), abono de até 1/3 e alerta do período concessivo. |
| **Ponto e Ocorrências** | Faltas, atestados, atrasos, horas extras 50%/100%, banco de horas, advertências, suspensões e elogios. |
| **Folha** | Gera os eventos do mês (horas extras, faltas, comissões revisadas ainda não pagas, descontos de benefícios e lançamentos), mostra as comissões que a folha vai pagar e as que aguardam revisão, ajuste manual, fechamento da competência (trava as ocorrências) e exportação para a contabilidade. INSS, IRRF e FGTS ficam com a contabilidade. |

### Automação e cadastros

- **CEP e CNPJ:** em qualquer janela de cadastro, o CEP preenche o endereço e o CNPJ busca os dados da Receita (BrasilAPI, com ViaCEP de reserva), via `/api/consulta/cep/:cep` e `/api/consulta/cnpj/:cnpj`.
- **Listas de opções** (*Cadastros → Listas de opções*): cargos (com departamento e função comercial), departamentos, culturas e origens da venda. Os campos de escolha só aceitam essas opções.
- **Colaborador completo:** vínculo (CLT, PJ, PF/autônomo, estágio, temporário, aprendiz, sócio, terceirizado), cargo e departamento da lista, equipe (obrigatória para vendedor), carga horária, escala, ponto, documentos pessoais, endereço, dados bancários e contrato assinado. Regras em `server/colaborador.js`.
- **Regras de comissão** (*Cadastros → Regras de comissão*): gerente 3% sobre toda venda, supervisor 3% e vendedor 25% quando o pedido está dentro da política (nenhum item abaixo da tabela além da tolerância); fora dela a Diretoria define. Perfil *Gerente comercial* e gerente por equipe.
- **Pedido:** cultura, área (ha) e origem da venda obrigatórias para enviar, sugeridas a partir do cliente; o pedido atualiza a área e a origem no cadastro do cliente.
- **Chat:** imagens, prints (Ctrl+V), PDFs e documentos, até 5 por mensagem; imagens grandes são reduzidas no navegador.
- **Mapa de vendas** no Painel: estados (coroplético) e cidades (bolhas), com o período e os recortes do painel. Desenho do mapa: [@svg-maps/brazil](https://github.com/VictorCazanave/svg-maps) (CC BY 4.0); coordenadas das cidades: [municipios-brasil](https://github.com/gusnips/municipios-brasil) (MIT, base IBGE).

### Assistente de IA

Botão *Assistente* no canto inferior direito. Explica como usar o sistema (a partir de `server/assistente-manual.md`) e consulta,
só para leitura, os pedidos, clientes, pendências e férias do usuário, sempre dentro das permissões e da abrangência dele. Ele não
aprova, altera nem cria nada. Usa a API da Anthropic (`ANTHROPIC_API_KEY`), com limite de perguntas por hora e registro de uso na
tabela `assistente_uso`. Sem a chave, ou se a API falhar, responde buscando no manual.

Relatórios novos: Contas a Pagar, Fluxo de Caixa Previsto (a receber × a pagar), Posição de Estoque e Movimentação de Estoque.

## Regras de passagem entre etapas

O levantamento não mostra as regras de desvio, então elas ficam centralizadas em `server/workflow.js` (`REGRAS` e `ACOES`)
para ajuste com quem usa o sistema. Padrão adotado:

1. Vendedor → Supervisor (ou direto para Análise quando o vendedor não tem supervisor).
2. Análise só aprova com consulta Serasa dos últimos 30 dias e cotação de frete registrada (ou ignorada com motivo).
3. Diretoria → Cobrança quando a forma é à vista; senão → Produção. Sem comissões definidas, aplica o % do cadastro de cada usuário.
4. Produção só conclui com lote em todos os itens. Faturamento emite a NF-e e gera as parcelas pela condição de pagamento.
5. Cliente com **bloqueio** na blacklist não recebe pedido novo nem avança pedidos em andamento; **alerta** só avisa.
6. Etapas podem devolver o pedido (com motivo) ou cancelar/reprovar.

## Integrações simuladas

Para funcionar sem contratos externos, três integrações são simuladas e isoladas para troca futura:

- **Serasa** (`services.simularSerasa`): resultado determinístico a partir do documento.
- **NF-e**: numeração por empresa e chave de acesso de 44 dígitos com dígito verificador, sem transmissão à SEFAZ.
- **Links de pagamento**: código gerado e marcação manual de pago.

## Arquitetura

```
server/
  index.js        Express, segurança (CSRF por cabeçalho, headers), rotas e erros
  db.js           SQLite (node:sqlite), helpers e paginação com filtro por coluna
  schema.sql      Modelo de dados
  auth.js         Perfis, permissões, sessões (cookie HttpOnly) e senhas (scrypt)
  workflow.js     Etapas, ações e validações do fluxo do pedido
  services.js     Regras: Serasa, NF-e, parcelas, baixa, penalidade, devolução
  sse.js          Notificações em tempo real
  lista.js        Resposta de lista e exportação Excel (exceljs)
  seed.js         Dados de demonstração
  routes/         auth, cadastros, clientes, pedidos, mensagens, financeiro, cobranca, crm, arquivos, dashboards, relatorios,
                  estoque, pagar, chamados, propostas, chat, admin
public/
  index.html, css/app.css
  js/core.js      API, formatação, modais, tabela padrão (DataTable) e editor de listas
  js/app.js       Login, menu por perfil, rotas e eventos em tempo real
  js/pages/       Uma página por módulo
test/             Testes de ponta a ponta (node:test)
```
