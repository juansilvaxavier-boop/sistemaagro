# Design system do Acelera Fertilizantes

A interface usa Bootstrap 5.3 com uma camada própria em `public/css/app.css`. Os componentes compartilhados ficam em
`public/js/core.js`. Toda tela nova deve usar estes tokens e componentes, sem cores ou tamanhos soltos.

## Tokens (`:root` em `app.css`, com versão para o tema escuro)

| Grupo | Tokens | Uso |
|---|---|---|
| Marca | `--agro`, `--agro-forte`, `--agro-suave`, `--agro-texto` | Ação primária, item ativo do menu, foco |
| Neutros | `--fundo`, `--superficie`, `--superficie-2`, `--superficie-3`, `--borda`, `--borda-forte`, `--texto`, `--texto-2`, `--texto-3` | Fundo da página, cartões, textos principal, secundário e auxiliar |
| Semânticas | `--ok`, `--erro`, `--aviso`, `--info`, `--neutro`, cada uma com `-bg` e `-borda` | Tags, alertas, toasts, variações e linhas destacadas |
| Tipografia | `--fs-xs` (.72rem) a `--fs-titulo` (1.55rem), `--fs-valor` (1.6rem) | Auxiliar, corpo, títulos de cartão, título da página e valor de KPI |
| Forma | `--raio` (14px, cartões), `--raio-sm` (10px, campos), `--raio-xs` (8px, controles pequenos), `--raio-btn` (10px) | Cantos |
| Sombra | `--sombra`, `--sombra-media`, `--sombra-alta`, `--anel-foco` | Cartões, hover, modais e toasts, foco |

Para trocar a identidade visual, mude os valores dos tokens. Não altere as regras dos componentes.

## Significado das cores (vale para tags, alertas, toasts e variações)

- **Verde:** concluído, ok, dentro do limite.
- **Vermelho:** erro, bloqueio, vencido ou destrutivo.
- **Âmbar:** atenção, pendente ou depende de decisão.
- **Azul:** em andamento, informação.
- **Cinza:** neutro, rascunho ou cancelado.
- **Verde da marca:** ação primária e etapas de operação do pedido.

Em variações (`deltaHtml`), a cor indica se a mudança foi **boa ou ruim**, e não apenas se o valor subiu.
Por exemplo, mais notas canceladas aparece em vermelho.

## Componentes

| Componente | Onde | Regras |
|---|---|---|
| Botões | `.btn-success`/`.btn-primary` (primária, sólida), `.btn-outline-secondary` (secundária), `.btn-ghost`/`.btn-link` (discreta), `.btn-danger`/`.btn-outline-danger` (destrutiva) | No máximo uma ação primária por bloco. `.carregando` mostra o estado em processamento |
| Modal | `modal()` | Rodapé fixo: **Fechar/Cancelar** à esquerda, utilitários, depois as destrutivas e a principal à direita. Enquanto a ação roda, os botões ficam travados e o clicado mostra o indicador de carregamento |
| Confirmação | `confirmar()`, `pedirTexto()` | Toda exclusão ou ação irreversível passa por confirmação |
| Toast | `toast(msg, tipo, titulo)` | Superfície branca com faixa e ícone na cor do tipo. Em erro, mostra o título "Não foi possível concluir" e fica visível por 7 s |
| Tabela padrão | `DataTable` | Filtro por coluna, ordenação (`aria-sort`), paginação, Excel e impressão. Tem estados de carregando (esqueleto), sem dados, sem resultado para os filtros (com botão Limpar) e erro (com Tentar de novo). No celular, cada linha vira cartão, e há botão de filtros por coluna e seletor de ordenação |
| Tabela simples | `tabelaSimples()` | Somente leitura, com estado vazio |
| Indicador | `kpi(label, valor, { icone, cor, sub, link, comparacao, moeda })` | `comparacao` mostra a variação vs o período anterior, com o período por extenso e a dica com o valor anterior |
| Gráficos | `estiloGraficos()`, `coresGrafico()` | Paleta categórica validada (claro e escuro, sem vermelho, que fica reservado para status). Cada série mantém sempre a mesma cor. A rosca vem com uma tabela de legenda (valor e %). Categorias com nome usam barras horizontais. Gráfico sem dados mostra um estado vazio |
| Campo | `campo()` | Rótulo acima do campo, `*` vermelho nos obrigatórios e dica em `.form-text` |
| Página | `titulo()` | Título em caixa de frase, igual ao nome da aba do menu, com subtítulo e ações à direita |

## Checklist da auditoria (redesign de 2026-10)

Rotas auditadas no desktop (1440×900) e no celular (390×844), como administrador, com captura de tela, erros de
console, rolagem horizontal e botões primários concorrentes:

- [x] Acesso: login, escolha da empresa, troca de senha, termo
- [x] Início: painel, chamados internos, Meu RH
- [x] Pedidos: as 10 filas, mensagens, novo pedido, detalhe do pedido (modal)
- [x] Propostas: lista e nova proposta
- [x] Metas: metas, ranking, campanhas
- [x] Clientes: cadastro (modal), histórico de compra, blacklist, arquivos
- [x] CRM: funil, tarefas, automações, calendário da safra, cliente 360
- [x] Financeiro: parcelas, cobrança e cobrança do cliente, negativados, limites de crédito, contas a pagar
- [x] Tesouraria: fluxo de caixa, resultado do mês, conciliação
- [x] Notas: notas de saída, descontos de devolução
- [x] Comissões: revisão, descontos e créditos, regras
- [x] Operação: estoque (saldos, movimentações, validade e parados, inventário) e compras (solicitações, pedidos, receber, reposição)
- [x] Gestão: RH (painel, colaboradores, férias, ocorrências, solicitações, folha), relatórios e relatório aberto, análises (ABC, demanda, recompra)
- [x] Cadastros: usuários, equipes, produtos, tabelas de preço, formas, transportadoras, fornecedores, empresas, listas
- [x] Administração: auditoria, backups, importação, integrações
- [x] Conta: meu perfil, privacidade, alterar senha
- [x] Portal do cliente (`/portal.html`): convite, início, pedido, novo pedido, boletos, login
- [x] Estados: lista vazia, sem resultado com filtro, erro de carregamento, sem acesso, página não encontrada
- [x] Tema escuro: painel e detalhe do pedido
