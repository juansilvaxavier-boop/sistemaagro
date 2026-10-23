# Manual do Agroterra Sistema

## Visão geral
O Agroterra Sistema é o ERP da empresa. Ele cobre vendas, financeiro, estoque, CRM, cobrança, RH e DP, e chamados internos. O menu fica à esquerda e cada pessoa só vê os itens que o seu perfil ou as suas permissões liberam. A busca global abre com Ctrl+K (ou ⌘K): ela procura telas, pedidos e clientes. O sino do topo mostra as mensagens dos setores. O chat interno fica na caixinha do canto inferior direito.

## Painel inicial
O Painel (#/dashboard) mostra os indicadores do setor da pessoa. No topo fica o filtro de **Período**: Este mês (padrão), Mês passado, 30 dias, 90 dias, Este ano ou Personalizado (de/até). Em **Mais filtros** dá para recortar por vendedor, equipe, forma de pagamento e UF de entrega. O período vale para vendas, faturamento, recebimentos, comissões e decisões; filas e saldos (a receber, vencido, pedidos em andamento) mostram a situação de hoje, respeitando os recortes. O filtro fica guardado durante a sessão, inclusive ao trocar de painel.

## Perfis e o que cada um vê
- **Vendedor**: cria pedidos e propostas, cuida dos próprios clientes no CRM. Vê só os dados que ele mesmo gerou: os seus pedidos, os seus clientes, as suas parcelas e as suas comissões.
- **Supervisor**: aprova os pedidos da equipe na fila do Supervisor. Vê os dados dos vendedores da equipe que supervisiona.
- **Analista**: análise de crédito, consulta Serasa e blacklist.
- **Diretoria** e **Administrador**: veem tudo.
- **Financeiro**: parcelas, cobrança, contas a pagar, comissões, devoluções e negativados.
- **Produção**, **Faturamento**, **Expedição**: as filas do seu setor, estoque e etiquetas.
- **RH / DP**: colaboradores, férias, ponto, solicitações e folha.

A abrangência dos dados ("Dados que pode ver") segue o perfil: o vendedor vê só os próprios dados, o supervisor vê os da equipe, e os outros perfis veem todos. Um administrador pode mudar isso em Cadastros → Usuários e Permissões, no campo "Dados que pode ver". Se alguém não encontra um pedido ou um cliente, o motivo provável é a abrangência ou a falta de permissão. Isso é ajustado por quem administra os usuários.

## Fluxo do pedido de venda
O pedido passa por filas, uma por etapa:
1. **Vendedor** (#/fila/venda): o vendedor cria o pedido em "Novo pedido" (#/pedido/novo), com cliente, itens, forma e condição de pagamento e endereço de entrega, e depois clica em "Enviar pedido". Ele também pode cancelar o pedido informando o motivo.
2. **Supervisor** (#/fila/supervisao): aprova, devolve ao vendedor ou cancela. Um pedido de vendedor sem supervisor vai direto para a Análise.
3. **Análise** (#/fila/analise): aprova ou reprova o crédito, ou devolve ao vendedor. Aqui o analista consulta Serasa e blacklist.
4. **Diretoria** (#/fila/diretoria): faz a aprovação final, devolve à análise ou reprova. As comissões são geradas nesta aprovação.
5. **Cobrança à vista** (#/fila/cobranca): só para pagamento à vista, que espera a confirmação do pagamento.
6. **Produção** (#/fila/producao): conclui a produção informando os lotes.
7. **Faturamento** (#/fila/faturamento): emite a nota fiscal, o que gera as parcelas a receber.
8. **Expedição** (#/fila/expedicao): registra o embarque com transportadora, volumes e rastreio, e imprime a etiqueta de envio.
9. **Trânsito** (#/fila/transito): confirma a entrega.
10. **Devolução** (#/fila/devolucao): trata as devoluções de mercadoria.

Toda fila tem o botão **Filtros** acima da tabela. Ele abre um painel com período (data do pedido, entrada na fila e as datas da etapa, como prazo de produção, embarque e entrega), com atalhos Hoje, 7 dias, 30 dias, Este mês, Mês passado e Este ano. Também filtra por faixa de valor, dias na fila, cliente, CPF/CNPJ, vendedor, supervisor, equipe, forma de pagamento, UF, cidade, tipo de entrega, transportadora, nota e blacklist. Os filtros ativos aparecem como etiquetas que podem ser removidas uma a uma, ficam guardados enquanto a sessão estiver aberta e valem também para Exportar para Excel e Imprimir.

As ações que exigem observação (devolver, cancelar, reprovar) pedem um motivo, que fica no histórico do pedido. Clicar num pedido de qualquer fila abre o detalhe com itens, histórico, comentários, arquivos e links de pagamento. Um pedido devolvido volta para a fila anterior com a observação visível.

## Propostas comerciais
Ficam em Comercial → Propostas Comerciais (#/propostas). Para criar uma, use "Nova proposta" (#/propostas/nova). Uma proposta aceita pode ser convertida em pedido.

## Clientes
- **Clientes** (#/clientes): cadastro com documento, endereços, telefones e referências. O vendedor só cadastra e vê os clientes da própria carteira.
- **Histórico de compra** (#/historico-compra): pedidos e parcelas de cada cliente.
- **Blacklist** (#/blacklist): clientes com bloqueio ou alerta. Incluir ou excluir alguém exige permissão.
- CPF, CNPJ, telefone e e-mail aparecem mascarados para quem não tem a permissão "Ver CPF/CNPJ, telefone e e-mail completos" (LGPD).

## CRM e cobrança
- **CRM** (#/crm): oportunidades por estágio, tarefas, interações e a visão 360° do cliente (#/crm/cliente/ID).
- **Cobrança** (#/cobranca): carteira de inadimplentes, agenda de contatos, registro de ações e acordos.

## Financeiro
- **Gestão de Parcelas** (#/financeiro/parcelas): dar baixa, prorrogar, mudar o status e negativar.
- **Descontos/Créditos** (#/financeiro/lancamentos): lançamentos para os vendedores.
- **Revisar Comissões** (#/financeiro/comissoes).
- **Desconto Devolução** (#/financeiro/devolucoes).
- **Clientes Negativados** (#/financeiro/negativados).
- **Nota Fiscal de Saída** (#/financeiro/notas).
- **Contas a Pagar** (#/pagar): contas dos fornecedores, com vencimento, baixa e anexos.

## Estoque e expedição
- **Controle de Estoque** (#/estoque): saldos, entradas, saídas, inventário e lotes.
- A etiqueta de envio é impressa no detalhe do pedido, na Expedição.

## Chamados internos
Ficam em Início → Chamados Internos (#/chamados). Qualquer setor pode abrir um chamado para outro setor, com prioridade (o prazo é calculado por ela). O chamado pode ser acompanhado, comentado e avaliado depois de resolvido.

## RH e DP
- **Meu RH** (#/meu-rh): cada colaborador vê os próprios dados, as férias (saldo e períodos), as ocorrências de ponto e os holerites e documentos. Ali ele também abre solicitações: férias, atestado, alteração cadastral, declaração, adiantamento e outras. Para pedir férias: Meu RH → "Nova solicitação" → tipo Férias → datas.
- **Painel do RH** (#/rh): alertas de férias vencendo, exames vencidos, aniversariantes e quadro por departamento.
- **Colaboradores** (#/rh/colaboradores): admissão, ficha completa (dados pessoais, contrato, salário, banco, dependentes, histórico, benefícios, exames e documentos) e desligamento. Salário e dados bancários só aparecem para quem gere o RH ou a folha.
- **Férias** (#/rh/ferias): programação dentro das regras da CLT. Os dias de direito dependem das faltas no período aquisitivo. As férias podem ser divididas em até 3 períodos: um deles com pelo menos 14 dias e nenhum com menos de 5. O abono pecuniário é de até 1/3, e o sistema avisa quando o período concessivo está vencendo.
- **Ponto e Ocorrências** (#/rh/ocorrencias): faltas, atestados, atrasos, horas extras (50% e 100%), banco de horas, advertências e suspensões.
- **Solicitações** (#/rh/solicitacoes): o RH aprova ou recusa os pedidos dos colaboradores. Um atestado aprovado vira ocorrência.
- **Folha** (#/rh/folha): gera os eventos do mês (horas extras, faltas, comissões, descontos de benefícios), permite ajustar à mão, fechar a competência e exportar em Excel para a contabilidade. INSS, IRRF e FGTS são calculados pela contabilidade. Depois que o mês é fechado, as ocorrências daquele mês ficam travadas. Reabrir exige permissão de gestão e um motivo.

## Relatórios
Ficam em #/relatorios: vendas, financeiro (contas a receber, a pagar e fluxo de caixa) e estoque. Os relatórios respeitam a abrangência de cada usuário e podem ser exportados.

## Cadastros
Produtos, formas de pagamento, transportadoras, fornecedores, colaboradores, usuários e permissões, equipes e empresas ficam no grupo Cadastros. As permissões podem ser liberadas individualmente para cada usuário, além das que vêm do perfil.

## Segurança e conta
- **Meu perfil** (#/perfil): foto, dados de contato, troca de senha e tema claro ou escuro.
- **Auditoria** (#/auditoria): quem fez o quê e quando.
- **Backups** (#/backups).
- **Importar dados** (#/importacao): carga da planilha do sistema anterior.
- **Privacidade (LGPD)** (#/privacidade).
- O login é bloqueado temporariamente depois de várias senhas erradas. Um administrador pode desbloquear o usuário em Cadastros → Usuários.
- Quando um pedido ou uma empresa pertence a outra unidade, troque a empresa no seletor do topo.

## Dúvidas frequentes
- **"Não vejo um pedido"**: confira a empresa selecionada no topo e se o pedido está na sua abrangência (vendedor: só os próprios; supervisor: a equipe).
- **"O pedido voltou para mim"**: abra o pedido e leia a observação no histórico. Corrija e envie de novo.
- **"Como cancelo um pedido?"**: na fila em que ele está, abra o pedido e use "Cancelar" (ou "Reprovar"), informando o motivo.
- **"Onde vejo minhas comissões?"**: no painel inicial e em Relatórios. O Financeiro revisa as comissões em Revisar Comissões.
- **"Como peço férias?"**: Meu RH → Nova solicitação → Férias.
- **"Como falo com outro setor?"**: pelo chat (canto inferior direito), pelas mensagens do pedido ou abrindo um chamado interno.
