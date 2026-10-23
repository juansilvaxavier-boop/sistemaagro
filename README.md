# Agroterra Sistema

ERP web de venda, crédito, cobrança e logística para distribuição de fertilizantes e insumos agrícolas,
construído a partir do levantamento *Agroterra Sistema – Funcionalidades por Etapa*.

O centro do sistema é o **pedido de venda**, que passa por uma fila própria em cada setor até ser entregue.

## Como rodar

Requisitos: Node.js 22.5 ou superior (usa o SQLite nativo `node:sqlite`, sem dependências nativas).

```bash
npm install
npm start          # http://localhost:3000 (cria o banco com dados de demonstração na primeira vez)
npm run seed       # apaga e recria o banco de demonstração
npm test           # testes de ponta a ponta da API
```

Variáveis de ambiente opcionais: `PORT`, `DB_PATH` (padrão `data/agroterra.db`), `UPLOAD_DIR` (padrão `uploads/`),
`UPLOAD_MAX_MB` (padrão 20), `DIRETORIA_A_PARTIR_DE` (valor mínimo do pedido para passar pela Diretoria; padrão 0 = todos).

### Usuários de demonstração

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

## O que o sistema tem

**Acesso:** login, escolha da empresa (multiempresa) e menus liberados conforme o perfil do usuário.

**Padrão de tela:** toda lista tem filtro por coluna, ordenação, paginação e os botões *Limpar Filtros*,
*Exportar para Excel* (.xlsx real) e *Imprimir*. Cadastros e ações abrem em janelas com abas.

**Comunicação interna:** mensagens entre setores ou pessoas, vinculadas ao número do pedido, com aviso em
tempo real (Server-Sent Events) e *Marcar como lida*.

### Filas do pedido

Cada fila tem as abas **Pedidos** (o que está parado na etapa) e **Progressão dos Pedidos** (histórico geral com filtro por etapa).

| Etapa | Funcionalidades |
|---|---|
| Vendedor | Criar/editar pedido (cliente, forma e condição de pagamento, itens com grupo, produto, embalagem, valor de tabela, custo, valor unitário, brinde), cadastro de cliente com 6 abas, links de pagamento, resumo imprimível |
| Supervisor | Observação de supervisão, consulta Serasa, checagem de referência comercial, histórico do cliente, coluna Equipe |
| Análise | Serasa e restrição de crédito (com justificativa para nova consulta em 30 dias), checagem de referências comerciais e bancárias, cotação de frete (ou ignorar com motivo), troca de transportadora, posta restante / veículo próprio / retirada, comentários |
| Diretoria | Revisão de frete e referência bancária, definição das comissões, Serasa, histórico e comentários |
| Cobrança (à vista) | Confirmação do pagamento à vista antes da produção |
| Produção | Lote, fabricação e validade por item, prazo de produção, data de chegada |
| Faturamento | Ajuste do endereço de entrega e emissão da NF-e (gera parcelas e comissões) |
| Expedição | Data de embarque, entrega prevista, transportadora |
| Expedição – Trânsito | Abas *Pedidos em trânsito* e *Pedidos entregues*, registro da entrega |
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
  routes/         auth, cadastros, clientes, pedidos, mensagens, financeiro, cobranca, crm, arquivos, dashboards, relatorios
public/
  index.html, css/app.css
  js/core.js      API, formatação, modais, tabela padrão (DataTable) e editor de listas
  js/app.js       Login, menu por perfil, rotas e eventos em tempo real
  js/pages/       Uma página por módulo
test/             Testes de ponta a ponta (node:test)
```
