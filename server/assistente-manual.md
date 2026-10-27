# Manual do sistema Acelera Fertilizantes

## Visão geral
O sistema Acelera Fertilizantes é o ERP da empresa. Ele cobre vendas, financeiro, estoque, compras, CRM, cobrança, RH e DP, e chamados internos. O menu fica à esquerda, organizado em áreas (Início, Comercial, Financeiro, Operação, Gestão). Cada área agrupa telas relacionadas em abas, mostradas no topo da tela: por exemplo, **Pedidos** reúne todas as filas (Vendedor, Supervisor, Análise, Diretoria, Pagamento à vista, Produção, Faturamento, Expedição, Em trânsito, Devolução) e as mensagens; **Clientes** reúne cadastro, histórico de compra, blacklist e arquivos; **Contas a receber** reúne parcelas, cobrança e negativados; **Comissões** reúne a revisão, os descontos e créditos e as regras; **Compras** reúne solicitações, pedidos de compra, receber mercadoria e reposição de estoque. Cada pessoa só vê as áreas e abas que o seu perfil libera, e o menu lembra a última aba usada em cada área. A busca global abre com Ctrl+K (ou ⌘K): ela procura telas, pedidos e clientes. O sino do topo mostra as mensagens dos setores. O chat interno fica na caixinha do canto inferior direito.

## Todas as empresas
Quem acessa mais de uma empresa pode escolher "Todas as empresas", na tela de escolha da empresa ou no seletor do menu, no alto à esquerda. O painel, as filas, as listas e os relatórios mostram as empresas somadas, e as listas de pedidos, parcelas, notas e contas a pagar trazem a coluna Empresa. Essa visão é só para consulta: para lançar, aprovar ou alterar, escolha uma empresa (o aviso azul "Todas as empresas · só consulta", no topo, abre a escolha).

## Painel inicial
O Painel (#/dashboard) mostra os indicadores do setor da pessoa. No topo fica o filtro de **Período**: Este mês (padrão), Mês passado, 30 dias, 90 dias, Este ano ou Personalizado (de/até). Abaixo dos gráficos fica o mapa **Vendas pelo Brasil** (estados ou cidades, por valor ou nº de pedidos). Em **Mais filtros** dá para recortar por vendedor, equipe, forma de pagamento e UF de entrega. O período vale para vendas, faturamento, recebimentos, comissões e decisões; filas e saldos (a receber, vencido, pedidos em andamento) mostram a situação de hoje, respeitando os recortes. O filtro fica guardado durante a sessão, inclusive ao trocar de painel.

## Perfis e o que cada um vê
- **Vendedor**: cria pedidos e propostas, cuida dos próprios clientes no CRM. Vê só os dados que ele mesmo gerou: os seus pedidos, os seus clientes, as suas parcelas e as suas comissões.
- **Supervisor**: aprova os pedidos da equipe na fila do Supervisor. Vê os dados dos vendedores da equipe que supervisiona.
- **Analista**: análise de crédito, consulta Serasa e blacklist.
- **Diretoria** e **Administrador**: veem tudo.
- **Financeiro**: parcelas, cobrança, contas a pagar, comissões, devoluções e negativados.
- **Produção**, **Faturamento**, **Expedição**: as filas do seu setor, estoque e etiquetas.
- **RH / DP**: colaboradores, férias, ponto, solicitações e folha.
- **Compras**: atende as solicitações de compra, cota com fornecedores, emite os pedidos de compra e recebe a mercadoria.
- Quase todos os setores podem **solicitar compras**; a Diretoria aprova os pedidos de compra acima do limite.

A abrangência dos dados ("Dados que pode ver") segue o perfil: o vendedor vê só os próprios dados, o supervisor vê os da equipe, e os outros perfis veem todos. Um administrador pode mudar isso em Cadastros → Usuários e Permissões, no campo "Dados que pode ver". Se alguém não encontra um pedido ou um cliente, o motivo provável é a abrangência ou a falta de permissão. Isso é ajustado por quem administra os usuários.

## Fluxo do pedido de venda
O pedido passa por filas, uma por etapa:
1. **Vendedor** (#/fila/venda): o vendedor cria o pedido em "Novo pedido" (#/pedido/novo), com cliente, itens, forma e condição de pagamento e endereço de entrega, e depois clica em "Enviar pedido". Ele também pode cancelar o pedido informando o motivo.
2. **Supervisor** (#/fila/supervisao): aprova, devolve ao vendedor ou cancela. Um pedido de vendedor sem supervisor vai direto para a Análise.
3. **Análise** (#/fila/analise): aprova ou reprova o crédito, ou devolve ao vendedor. Aqui o analista consulta Serasa e blacklist.
4. **Diretoria** (#/fila/diretoria): faz a aprovação final, devolve à análise ou reprova. As comissões são geradas nesta aprovação.
5. **Pagamento à vista** (#/fila/cobranca): só para pagamento à vista, que espera a confirmação do pagamento.
6. **Produção** (#/fila/producao): conclui a produção informando os lotes.
7. **Faturamento** (#/fila/faturamento): emite a nota fiscal, o que gera as parcelas a receber.
8. **Expedição** (#/fila/expedicao): registra o embarque com transportadora, volumes e rastreio, e imprime a etiqueta de envio.
9. **Em trânsito** (#/fila/transito): confirma a entrega.
10. **Devolução** (#/fila/devolucao): trata as devoluções de mercadoria.

Toda fila tem o botão **Filtros** acima da tabela. Ele abre um painel com período (data do pedido, entrada na fila e as datas da etapa, como prazo de produção, embarque e entrega), com atalhos Hoje, 7 dias, 30 dias, Este mês, Mês passado e Este ano. Também filtra por faixa de valor, dias na fila, cliente, CPF/CNPJ, vendedor, supervisor, equipe, forma de pagamento, UF, cidade, tipo de entrega, transportadora, nota e blacklist. Os filtros ativos aparecem como etiquetas que podem ser removidas uma a uma, ficam guardados enquanto a sessão estiver aberta e valem também para Exportar para Excel e Imprimir.

Ao lançar o pedido, informe também a **cultura do cliente**, a **área em hectares** e **de onde veio a venda** (tráfego pago, prospecção ativa, prospecção automática, indicação, recompra da carteira etc.). Sem eles o pedido não pode ser enviado. Ao escolher o cliente, o sistema já sugere esses dados a partir do cadastro e do último pedido, e a área informada fica guardada no cadastro do cliente.

**Política comercial e comissão:** pedido com algum item abaixo do preço de tabela (além do desconto máximo permitido) fica marcado como "Fora da política". A regra padrão é: gerente comercial 3% sobre toda venda, supervisor 3% sobre a equipe e vendedor 25% quando o pedido está dentro da política. Fora da política, a Diretoria define a comissão do vendedor. As regras ficam em Cadastros → Regras de comissão.

As ações que exigem observação (devolver, cancelar, reprovar) pedem um motivo, que fica no histórico do pedido. Clicar num pedido de qualquer fila abre o detalhe com itens, histórico, comentários, arquivos e links de pagamento. Um pedido devolvido volta para a fila anterior com a observação visível.

## Propostas comerciais
Ficam em Comercial → Propostas Comerciais (#/propostas). Para criar uma, use "Nova proposta" (#/propostas/nova). Uma proposta aceita pode ser convertida em pedido.

## Clientes
- **Clientes** (#/clientes): cadastro com documento, endereços, telefones e referências. O vendedor só cadastra e vê os clientes da própria carteira.
- **Histórico de compra** (#/historico-compra): pedidos e parcelas de cada cliente.
- **Blacklist** (#/blacklist): clientes com bloqueio ou alerta. Incluir ou excluir alguém exige permissão.
- CPF, CNPJ, telefone e e-mail aparecem mascarados para quem não tem a permissão "Ver CPF/CNPJ, telefone e e-mail completos" (LGPD).

## Portal do cliente
- O cliente acessa em /portal com o CPF/CNPJ e uma senha. Ali ele vê os pedidos e a situação de cada um (Recebido, Em análise, Em separação, Faturando, Em transporte, Entregue), o rastreio, os boletos em aberto (copia a linha digitável ou o PIX), as notas, o extrato e faz pedido pela tabela de preço da região dele.
- Para liberar o acesso: CRM → abrir o cliente → card "Portal do cliente" → "Gerar link de acesso" e enviar o link por WhatsApp. O link vale 7 dias; o cliente cria a senha nele. Esqueceu a senha: gere um novo link ("Link para nova senha"). "Desativar" corta o acesso na hora.
- Pedido feito no portal cai na etapa Vendedor, na carteira do vendedor do cliente, com origem "Portal do cliente". O vendedor recebe o aviso, confere frete, prazo e condição e envia normalmente.
- Após 5 senhas erradas o acesso fica bloqueado por 15 minutos.

## CRM e cobrança
- **CRM** (#/crm): oportunidades por estágio, tarefas, interações e a visão 360° do cliente (#/crm/cliente/ID).
- **Tarefas do CRM** (#/crm/tarefas): as tarefas da pessoa, manuais e automáticas. Filtros Abertas, Para hoje, Automáticas e Concluídas; supervisor e gerente podem ver as da equipe. Ao concluir uma tarefa com cliente, dá para registrar a interação (ligação, visita, WhatsApp...) que vai para a linha do tempo do cliente. "Reagendar" muda a data e a prioridade.
- **Calendário da safra** (#/crm/safra): quando cada cliente vai plantar ou adubar, pelas áreas de cultivo do cadastro e pelo calendário de cada cultura (ajustável em "Ajustar calendário"). A automação "Calendário da safra" cria a tarefa para o vendedor antes da janela.
- **Automações do CRM** (#/crm/automacoes, permissão "Configurar automações do CRM"; Gerente, Diretoria e Administrador): regras que criam tarefas sozinhas todo dia de manhã. Gatilhos: cliente sem comprar há N dias, pós-venda N dias após a entrega, primeira compra (boas-vindas), recompra da safra (1 ano da última compra), oportunidade parada, fechamento previsto chegando, proposta sem retorno, cliente com parcela vencida e aniversário do cliente. Cada regra define os dias, o título da tarefa com variáveis ({cliente}, {pedido}, {valor}, {data}...), o prazo, a prioridade, quem recebe (vendedor do cliente, supervisor da equipe ou um usuário fixo), a equipe, o valor mínimo e o máximo de tarefas por dia. "Simular" mostra quantas tarefas seriam criadas sem criar; "Executar" roda na hora. A mesma situação nunca gera tarefa repetida. Parcela vencida e aniversário começam desligadas.
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
- **Controle de Estoque** (#/estoque): saldos, entradas, saídas, inventário e lotes. O botão "Repor estoque" leva à sugestão de compra.
- **Validade e parados** (aba do Estoque): lotes vencidos e que vencem nos próximos dias (padrão 90) com o valor em risco, e produtos sem saída há mais de N dias (padrão 120). Em cada linha: "Criar campanha" (vira campanha em Metas e campanhas para os vendedores girarem o item) e "Baixar como perda". O botão "Regras" ajusta os prazos e se o lote vencido bloqueia ou só avisa.
- Lote vencido no pedido bloqueia "Concluir produção" e "Emitir nota fiscal": troque o lote. Na aba Produção do pedido, o campo Lote sugere os lotes do estoque na ordem de vencimento (o que vence primeiro sai primeiro) e preenche a validade.

## Metas, preços e crédito
- **Metas** (#/metas): metas do mês por empresa, equipe e vendedor (valor vendido, volume, pedidos e clientes novos), com realizado, % e projeção. Quem tem "Definir metas" (Gerente, Diretoria) usa "Definir metas" e "Copiar do mês anterior". O vendedor vê a própria meta; o supervisor, a equipe. O painel mostra o card "Meta do mês".
- **Ranking** (#/metas/ranking): posição dos vendedores pelo % da meta de valor. Dos colegas fora da abrangência aparece só o percentual.
- **Campanhas** (#/metas/campanhas): período, produto ou grupo, equipe, meta individual e prêmio, com placar.
- **Tabelas de preço** (#/tabelas-preco, Cadastros): preço por estado (UF) e safra. O pedido e a proposta usam a tabela vigente para a UF de entrega; itens sem preço próprio seguem o preço base com o ajuste %. "Reajustar tudo" aplica um % e "Copiar" cria a tabela da próxima safra.
- **Limites de crédito** (#/credito, Contas a receber): limite, exposição (parcelas em aberto + pedidos em andamento), disponível, situação e limite sugerido. Venda a prazo acima do limite, ou de cliente com parcela vencida há mais de 15 dias, é barrada na Análise; só a Diretoria libera, com justificativa, pelo botão "Liberar crédito deste pedido". "Aplicar limite sugerido aos sem limite" e o limite automático (recalculado todo dia) poupam o cadastro manual.

## Tesouraria
- **Fluxo de caixa** (#/tesouraria): realizado e previsto por dia, semana ou mês. O saldo de partida vem do último extrato importado ou do "Saldo em conta" informado.
- **Resultado do mês** (#/tesouraria/resultado): receita, devoluções, impostos, custo, comissões, fretes, despesas por categoria e resultado operacional de cada mês do ano.
- **Conciliação bancária** (#/tesouraria/conciliacao): "Importar extrato (OFX)" do banco. Créditos casam com parcelas a receber e débitos com contas a pagar; pares seguros são baixados sozinhos. Nos pendentes: "Conciliar" (escolher a sugestão), "Lançar como despesa paga" (tarifas) ou "Ignorar" (transferências entre contas).

## Análises
- **Curva ABC** (#/analises): clientes ou produtos que fazem 80% (A), 15% (B) e 5% (C) do faturamento ou da margem.
- **Previsão de demanda** (#/analises/demanda): previsão dos próximos meses por produto, cobertura do estoque e quanto comprar; "Solicitar compra dos marcados" gera a solicitação.
- **Recompra atrasada** (#/analises/recompra): clientes que passaram do tempo normal entre compras.

## Compras
- **Solicitações** (#/compras): qualquer setor com permissão pede a compra em "Nova solicitação": departamento, urgência, data de necessidade, justificativa e os itens (produto do estoque ou outro item com descrição, categoria e unidade). Quem solicita vê só as próprias solicitações e é avisado quando ela vira pedido de compra ou é recusada.
- **Cotação**: o comprador abre a solicitação, lança a cotação de cada fornecedor (preço por item, frete, prazo de entrega, parcelas e 1º vencimento) e vê o comparativo com o menor preço destacado. "Comprar" gera o pedido de compra com a cotação escolhida; também dá para comprar direto informando os preços.
- **Pedidos de compra** (#/compras/pedidos): rascunho → enviar para aprovação → aprovado → enviado ao fornecedor → recebido. Pedidos acima do limite de aprovação (padrão R$ 5.000, ajustável por quem aprova no botão "Aprovação acima de") vão para a Diretoria; abaixo, são aprovados na hora. Quem aprova pode "Devolver" com o motivo. O pedido de compra pode ser impresso para enviar ao fornecedor. "Compra direta" cria um pedido sem solicitação.
- **Receber mercadoria** (#/compras/receber): com a nota fiscal do fornecedor, informa a quantidade recebida (pode ser parcial), lote e validade. Os produtos de estoque entram no estoque com o custo do pedido (frete e desconto rateados) e a conta a pagar é lançada nas parcelas do pedido, com o 1º vencimento N dias após o recebimento. O Financeiro é avisado.
- **Reposição de estoque** (#/compras/reposicao): itens com disponível abaixo do estoque mínimo, já descontando o que está em compra ou solicitado; sugere repor até o dobro do mínimo, mostra o último custo e fornecedor e gera a solicitação de compra.
- A etiqueta de envio é impressa no detalhe do pedido, na Expedição.

## Chamados internos
Ficam em Início → Chamados Internos (#/chamados). Qualquer setor pode abrir um chamado para outro setor, com prioridade (o prazo é calculado por ela). O chamado pode ser acompanhado, comentado e avaliado depois de resolvido.

## RH e DP
- **Meu RH** (#/meu-rh): cada colaborador vê os próprios dados, as férias (saldo e períodos), as ocorrências de ponto e os holerites e documentos. Ali ele também abre solicitações: férias, atestado, alteração cadastral, declaração, adiantamento e outras. Para pedir férias: Meu RH → "Nova solicitação" → tipo Férias → datas.
- **Painel do RH** (#/rh): alertas de férias vencendo, exames vencidos, aniversariantes e quadro por departamento.
- **Colaboradores** (#/rh/colaboradores): admissão, ficha completa (dados pessoais, contrato, salário, banco, dependentes, histórico, benefícios, exames e documentos) e desligamento. Salário e dados bancários só aparecem para quem gere o RH ou a folha.
- **Férias** (#/rh/ferias): programação dentro das regras da CLT. Os dias de direito dependem das faltas no período aquisitivo. As férias podem ser divididas em até 3 períodos: um deles com pelo menos 14 dias e nenhum com menos de 5. O abono pecuniário é de até 1/3, e o sistema avisa quando o período concessivo está vencendo.
- **Meu ponto** (#/ponto): o colaborador bate o ponto pelo navegador (entrada, saída para intervalo, volta e saída). A localização do aparelho é registrada automaticamente, com endereço aproximado e link para o mapa; é preciso permitir a localização no navegador. A hora que vale é a do servidor. Ali ele vê as marcações do dia, o espelho do mês e o banco de horas.
- **Ponto** (#/rh/ponto): o RH vê quem está trabalhando agora, o saldo do mês, o banco de horas e as pendências de cada colaborador; abre o espelho com o local de cada marcação, lança marcação esquecida (com justificativa), anula marcação errada e exporta o espelho em Excel. Regras: previsto do dia pela carga horária e escala, tolerância de 10 minutos por dia, férias e atestado não geram débito, dia com marcação ímpar fica incompleto até ser corrigido. Banco de horas = saldo do ponto até ontem + créditos e débitos lançados nas ocorrências.
- **Locais, foto e horário do ponto**: em RH → Ponto → "Locais e regras" o RH cadastra os locais da empresa (cercas com raio), decide se marcação fora da cerca é recusada ou só sinalizada, se a foto é obrigatória e os minutos dos lembretes. No espelho do colaborador, "Horário de trabalho" define entrada, intervalo e saída de cada dia (com modelos e aplicar a vários) e "trabalho externo". Com horário, o espelho mostra atraso e saída antecipada, e o colaborador recebe lembrete quando esquece a entrada, o intervalo ou a saída (no celular, se ativou "Receber lembretes neste aparelho" em Meu ponto; no iPhone é preciso instalar o sistema na tela de início).
- **Feriados** (#/rh/feriados): os nacionais já vêm prontos para qualquer ano, inclusive Carnaval, Sexta-feira Santa e Corpus Christi (Carnaval, Quarta de Cinzas e Corpus Christi são ponto facultativo e vêm como dia normal). O RH cadastra os estaduais, municipais e da empresa e liga ou desliga a **Folga** de cada um. Em feriado de folga o ponto não cobra horas, o que for trabalhado vira crédito no banco de horas e não há lembrete de marcação. O Meu ponto mostra o próximo feriado.
- **Ocorrências** (#/rh/ocorrencias): faltas, atestados, atrasos, horas extras (50% e 100%), créditos e débitos manuais no banco de horas, advertências e suspensões.
- **Solicitações** (#/rh/solicitacoes): o RH aprova ou recusa os pedidos dos colaboradores. Um atestado aprovado vira ocorrência.
- **Comissão na folha**: as comissões revisadas pelo Financeiro e ainda não pagas aparecem no card "Comissões que esta folha vai pagar". Para CLT, entram como evento ao "Gerar eventos automáticos"; para PJ, autônomo ou vendedor sem cadastro de colaborador, o fechamento lança uma conta a pagar (categoria Comissões, vence no dia configurado do mês seguinte, padrão 10). Fechar a competência marca as comissões como pagas; reabrir desfaz (se a conta de comissão já foi paga, estorne antes). Comissão ainda em revisão fica para a folha seguinte.
- **Folha** (#/rh/folha): gera os eventos do mês (horas extras, faltas, comissões, descontos de benefícios), permite ajustar à mão, fechar a competência e exportar em Excel para a contabilidade. INSS, IRRF e FGTS são calculados pela contabilidade. Depois que o mês é fechado, as ocorrências daquele mês ficam travadas. Reabrir exige permissão de gestão e um motivo.

## Produtividade
Em #/produtividade: cobranças feitas por cada analista (canal, resultado, promessas, acordos), pedidos que passaram por cada setor (aprovados, devolvidos, reprovados, valor e tempo médio na etapa), notas emitidas, vendas lançadas, CRM, chamados e horas no ponto, com uma linha por colaborador. A conversão da cobrança mostra quantos clientes cobrados pagaram uma parcela vencida em até 30 dias, o valor recuperado (atribuído ao último analista que cobrou) e a taxa de promessas cumpridas (pagamento até 3 dias depois da data prometida). Quem tem a permissão "Painel de produtividade" vê todos; os demais veem só o próprio resultado.

## Relatórios
Ficam em #/relatorios: vendas, financeiro (contas a receber, a pagar e fluxo de caixa) e estoque. Os relatórios respeitam a abrangência de cada usuário e podem ser exportados.

## Cadastros
**CEP e CNPJ automáticos:** em qualquer cadastro, digitar o CEP preenche rua, bairro, cidade e UF; digitar um CNPJ completo busca na Receita a razão social, o nome fantasia, o telefone e o endereço (só nos campos vazios).

**Colaboradores** (Cadastros → Colaboradores ou RH → Colaboradores): dados pessoais (CPF, RG com órgão e UF, nascimento, estado civil, escolaridade, nome da mãe, PIS, CTPS, CNH), contato e endereço, vínculo (CLT, PJ, PF/autônomo, estágio, temporário, jovem aprendiz, sócio, terceirizado), cargo e departamento escolhidos em lista, equipe, gestor, carga horária, escala, se bate ponto, salário e dados bancários (só para quem gere o RH) e documentos. Cargo de vendedor exige a equipe; PJ exige CNPJ e razão social. Para vendedor, anexe o contrato assinado na aba Documentos.

**Listas de opções** (Cadastros → Listas de opções): cargos (com departamento e função comercial), departamentos, culturas e origens da venda. Renomear atualiza os cadastros que usam a opção; desativar tira da lista sem apagar o histórico.

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
- **"Como funciona o chat?"**: na caixinha do canto inferior direito ficam as conversas. Para falar com alguém, digite o nome na busca e clique na pessoa. Para criar um **grupo**, use o ícone de pessoas no topo do chat: dê um nome, marque os membros (ou escolha um setor inteiro em "+ Setor inteiro"). No grupo, digite **@** para **mencionar** alguém (ou @todos); a pessoa mencionada é avisada mesmo se silenciou o grupo. Passe o mouse (ou toque) numa mensagem para **responder**, **reagir** ou abrir **mais opções**: copiar, **fixar**, **editar** (só as suas) e **apagar para todos**. O microfone grava um **áudio** de até 5 minutos. A lupa busca mensagens por palavra, pessoa e período. Escrevendo **#** e o número do pedido (ex.: #100025), aparece um cartão com cliente, etapa e valor que abre o pedido. No menu ⋮ da conversa: membros, mensagens fixadas, **silenciar** e sair do grupo. O botão de tela cheia aumenta o chat. Para receber mensagens no celular com o sistema fechado: menu do usuário → *Ativar avisos no navegador*.
- **"Por quanto tempo as mensagens ficam guardadas?"**: quem tem a permissão de LGPD define o prazo em Administração → Chat: guarda e exportação, e ali exporta uma conversa em Excel quando o jurídico ou o RH precisar (a exportação fica na auditoria). Usuário desligado sai dos grupos automaticamente; o histórico fica.
- **"Como mando um print no chat?"**: abra a conversa e cole com Ctrl+V na caixa de mensagem, arraste o arquivo para a conversa ou clique no clipe. Dá para enviar até 5 arquivos (imagens, PDF, planilhas, documentos) de até 4 MB; imagens grandes são reduzidas sozinhas.
- **"Por que a Análise não consegue aprovar o pedido?"**: o crédito do cliente está bloqueado (acima do limite ou com parcela vencida). A Diretoria libera no próprio pedido, ou ajuste o limite em Limites de crédito.
- **"Por que o preço de tabela mudou?"**: o pedido usa a tabela de preço da UF de entrega e da safra vigente (Cadastros → Tabelas de preço).
- **"Como sei se o pedido foi entregue?"**: aba Rastreio do pedido. Com a integração dos Correios ligada, a entrega é confirmada sozinha.
- **"Como peço uma compra?"**: Operação → Compras → Nova solicitação. Acompanhe a situação na mesma tela.
- **"Por que meu pedido de compra não foi aprovado direto?"**: ele passou do limite de aprovação; a Diretoria aprova em Compras → Pedidos de compra.
- **"De onde vieram essas tarefas no CRM?"**: das automações do CRM (o nome da regra aparece na tarefa). Quem tem a permissão ajusta ou desliga em CRM → Automações.
- **"Onde vejo as vendas por cidade?"**: no Painel, no card "Vendas pelo Brasil": Estados mostra o mapa colorido por estado e Cidades mostra bolhas por cidade, com ranking ao lado. Segue o período e os filtros do painel.
