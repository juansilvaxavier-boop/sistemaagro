// Ajuda de cada tela e de cada etapa do pedido: o botão "?" ao lado do título mostra o resumo ao passar o mouse
// e a explicação completa ao clicar. Chave = rota (números trocados por :id) ou "etapa:<etapa do pedido>".
// Texto: **negrito** é aceito.

const FILTROS_FILA = ['O botão **Filtros**, acima da tabela, abre período (data do pedido, entrada na fila e datas da etapa), faixa de valor, dias na fila, cliente, vendedor, equipe, forma de pagamento, UF, cidade, transportadora e outros. Os filtros ativos viram etiquetas que podem ser removidas uma a uma.',
  'Também dá para filtrar digitando na linha abaixo do cabeçalho de cada coluna, e ordenar clicando no nome da coluna.',
  '**Excel** e **Imprimir** levam a lista com os filtros aplicados.',
  'Clique em qualquer pedido para abrir o detalhe: itens, histórico, comentários, mensagens, arquivos e as ações da etapa.'];

const ETAPAS = {
  venda: {
    t: 'Etapa Vendedor', r: 'Pedidos em digitação ou devolvidos para correção. Aqui o vendedor monta o pedido e envia para aprovação.',
    s: [
      ['Para que serve', ['É a primeira etapa do pedido. Ficam aqui os pedidos ainda não enviados, os devolvidos por Supervisor ou Análise e os feitos pelo cliente no Portal do cliente.']],
      ['Como usar', ['**Novo pedido**: escolha o cliente, os itens (produto, embalagem e quantidade), a forma e a condição de pagamento, o tipo de entrega e o endereço.',
        'Informe também a **cultura**, a **área em hectares** e a **origem da venda**. O sistema sugere esses dados pelo cadastro e pelo último pedido do cliente.',
        'O preço de tabela vem da tabela regional vigente para a UF de entrega. Dá para dar desconto, mas abaixo da tabela o pedido fica **fora da política** e a comissão do vendedor passa a ser decidida pela Diretoria.',
        'Clique em **Enviar pedido**. Se o vendedor tem supervisor, vai para a fila do Supervisor; senão, vai direto para a Análise.',
        '**Cancelar pedido** pede o motivo, que fica no histórico.']],
      ['Regras', ['Sem itens, forma e condição de pagamento, endereço de entrega (exceto retirada), cultura, área e origem, o pedido não pode ser enviado.',
        'A condição de pagamento pode ter valor mínimo; abaixo dele o envio é recusado.',
        'Pedido devolvido mostra a observação no histórico: corrija e envie de novo.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  supervisao: {
    t: 'Etapa Supervisor', r: 'Pedidos da equipe esperando a aprovação do supervisor: aprovar, devolver ao vendedor ou cancelar.',
    s: [
      ['Para que serve', ['O supervisor confere os pedidos dos vendedores da equipe antes da análise de crédito: preços, condições, cliente e endereço.']],
      ['Ações', ['**Aprovar**: o pedido segue para a Análise.', '**Devolver ao vendedor**: volta para a etapa Vendedor com o motivo (obrigatório).', '**Cancelar**: encerra o pedido com o motivo.']],
      ['Dicas', ['Na aba Pedido dá para ajustar observações da supervisão. O histórico mostra quem fez cada ação e quando.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  analise: {
    t: 'Etapa Análise de crédito', r: 'Análise de crédito do cliente: Serasa, blacklist, limite e histórico. Aprovar, reprovar ou devolver ao vendedor.',
    s: [
      ['Para que serve', ['O analista decide se o cliente pode comprar nessas condições.']],
      ['Como analisar', ['Na aba **Serasa**, faça a consulta (obrigatória nos últimos 30 dias para aprovar).',
        'Confira **blacklist**, **referências** comerciais e bancárias, o histórico de pagamentos e o **limite de crédito** (exposição = parcelas em aberto + pedidos em andamento).',
        'Na aba **Frete e entrega**, registre a cotação de frete ou ignore informando o motivo (exigido para entrega por transportadora).']],
      ['Ações', ['**Aprovar crédito**: segue para a Diretoria (ou, conforme a regra, direto para Produção ou Pagamento à vista).', '**Reprovar crédito**: cancela o pedido com o motivo.', '**Devolver ao vendedor**: volta para correção com o motivo.']],
      ['Regras de crédito', ['Venda a prazo acima do limite, ou de cliente com parcela vencida há mais dias que o permitido, fica **bloqueada**. Só a Diretoria libera, no próprio pedido, com justificativa ("Liberar crédito deste pedido").']],
      ['Lista', FILTROS_FILA],
    ],
  },
  diretoria: {
    t: 'Etapa Diretoria', r: 'Aprovação final do pedido, com visão de valor, desconto, comissão, crédito e Serasa. Aqui a Diretoria define a comissão.',
    s: [
      ['Para que serve', ['Última aprovação antes de produzir. A aba **Visão da diretoria** reúne valor, desconto sobre a tabela, comissão, crédito do cliente, em aberto e vencido, e Serasa.']],
      ['Comissão do pedido', ['A lista vem pela regra (vendedor, supervisor e gerente). A Diretoria pode trocar pessoas e papéis, mudar % ou valor e incluir indicação. Clique em **Salvar comissão**; a mudança fica no histórico.',
        'Pedido **fora da política** (item abaixo da tabela) usa o % de fora da política para o vendedor: confirme ou ajuste.']],
      ['Ações', ['**Aprovação final**: fixa a comissão e segue para Produção (ou Pagamento à vista, se a forma for à vista).', '**Devolver à análise** e **Reprovar** pedem o motivo.',
        'Se o crédito estiver bloqueado, use **Liberar crédito deste pedido** com justificativa.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  cobranca: {
    t: 'Etapa Pagamento à vista', r: 'Pedidos à vista esperando a confirmação do pagamento (PIX/TED) para seguir para a Produção.',
    s: [
      ['Para que serve', ['Pedido com forma de pagamento à vista só vai para a produção depois que o Financeiro confirma o recebimento.']],
      ['Ações', ['**Confirmar pagamento**: registra a data e libera para a Produção.', '**Cancelar (sem pagamento)**: encerra o pedido com o motivo.', 'Na aba Pedido dá para gerar um **link de pagamento** e marcá-lo como pago.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  producao: {
    t: 'Etapa Produção', r: 'Pedidos aprovados para produzir. Informe o prazo e os lotes de cada item e conclua a produção.',
    s: [
      ['Como usar', ['Na aba **Produção**, informe o prazo e, para cada item, o **lote**, a fabricação e a validade. Clique em **Salvar lotes**.',
        'O campo Lote sugere os lotes do estoque **na ordem de vencimento** (o que vence primeiro sai primeiro) e preenche a validade. Um link mostra o lote que vence primeiro.',
        '**Concluir produção** envia para o Faturamento.']],
      ['Regras', ['Todo item precisa de lote.', 'Lote **vencido** bloqueia a conclusão (ou só avisa, conforme a regra em Estoque → Validade e parados → Regras).']],
      ['Lista', ['A coluna Prazo produção fica vermelha quando atrasa.', ...FILTROS_FILA]],
    ],
  },
  faturamento: {
    t: 'Etapa Faturamento', r: 'Emissão da nota fiscal: gera as parcelas a receber, as comissões e baixa o estoque.',
    s: [
      ['Como usar', ['Na aba **Faturamento**, confira e ajuste o endereço de entrega.', 'Clique em **Emitir nota fiscal**.']],
      ['O que acontece ao emitir', ['A NF-e é gerada, as **parcelas** são criadas pela condição de pagamento, as **comissões** entram em revisão no Financeiro e o **estoque** é baixado.', 'O pedido segue para a Expedição.']],
      ['Outras ações', ['**Devolver à produção** (com motivo), quando algo precisa ser refeito.']],
      ['Regras', ['Sem endereço de entrega (exceto retirada) ou com lote vencido, a emissão é recusada.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  expedicao: {
    t: 'Etapa Expedição', r: 'Embarque do pedido: transportadora, volumes, datas, código de rastreio e etiqueta de envio.',
    s: [
      ['Como usar', ['Na aba **Embarque**, informe transportadora, volumes, data de embarque, entrega prevista e o código de rastreio.',
        'Imprima a **etiqueta de envio** pelo ícone da linha ou pelo detalhe do pedido.', 'Clique em **Registrar embarque**: o pedido passa para Em trânsito.']],
      ['Regras', ['Data de embarque e data de entrega prevista são obrigatórias.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  transito: {
    t: 'Etapa Em trânsito', r: 'Pedidos a caminho do cliente. Confirme a entrega ou deixe o rastreio dos Correios confirmar sozinho.',
    s: [
      ['Como usar', ['Abra o pedido, informe a **data de entrega** e clique em **Confirmar entrega**.',
        '**Atualizar rastreios** consulta os Correios; com a entrega confirmada no rastreio, o pedido é concluído sozinho (isso também roda todo dia).']],
      ['Abas', ['**Pedidos em trânsito**, **Pedidos entregues** e **Progressão dos pedidos**.']],
      ['Lista', FILTROS_FILA],
    ],
  },
  devolucao: {
    t: 'Etapa Devolução', r: 'Pedidos com devolução de mercadoria e os ajustes financeiros e de estoque.',
    s: [
      ['Para que serve', ['Acompanha os pedidos devolvidos pelo cliente. A devolução é registrada na nota fiscal (Notas fiscais → Registrar devolução).']],
      ['O que a devolução faz', ['Abate o valor das parcelas em aberto, reduz a comissão na proporção do valor devolvido e, na devolução total, devolve os itens ao estoque.']],
      ['Lista', FILTROS_FILA],
    ],
  },
};

const DT = ['Filtre digitando na linha abaixo do cabeçalho de cada coluna; ordene clicando no nome da coluna.', '**Limpar filtros**, **Excel** e **Imprimir** ficam acima da tabela e respeitam os filtros.', 'No celular, cada linha vira um cartão; o funil abre os filtros e "Ordenar" escolhe a ordem.'];

export const AJUDA = {
  ...Object.fromEntries(Object.entries(ETAPAS).map(([k, v]) => [`#/fila/${k}`, v])),
  ...Object.fromEntries(Object.entries(ETAPAS).map(([k, v]) => [`etapa:${k}`, v])),

  '#/dashboard': {
    t: 'Painel', r: 'Indicadores do seu setor no período escolhido, com comparação com o período anterior, gráficos e mapa de vendas.',
    s: [
      ['Período e filtros', ['Escolha **Este mês**, **Mês passado**, 30 ou 90 dias, **Este ano** ou **Personalizado**.', '**Mais filtros** recorta por vendedor, equipe, forma de pagamento e UF de entrega.',
        'O período vale para vendas, faturamento, recebimentos, comissões e decisões. Filas e saldos (a receber, vencido, em andamento) mostram a situação de hoje.']],
      ['Indicadores', ['Os cards de movimento mostram a **variação** contra o período anterior equivalente (ex.: 01 a 26 deste mês contra 01 a 26 do mês passado). Verde = melhorou, vermelho = piorou; passe o mouse para ver o valor anterior.',
        'Cards com seta ↗ abrem a tela correspondente.']],
      ['Gráficos e mapa', ['Passe o mouse nos gráficos para ver os valores. **Vendas pelo Brasil** mostra estados ou cidades, por valor ou pedidos, com ranking.']],
      ['Outros painéis', ['Quem tem permissão escolhe o painel de outro setor no seletor do canto superior direito.']],
    ],
  },
  '#/chamados': {
    t: 'Chamados internos', r: 'Pedidos de ajuda entre setores, com prioridade, prazo, comentários e avaliação.',
    s: [
      ['Como usar', ['**Abrir chamado**: título, descrição, setor de destino, categoria, prioridade e, se for o caso, o nº do pedido.', 'A **prioridade** define o prazo de atendimento. Chamado fora do prazo fica destacado.',
        'Abra o chamado para comentar, mudar a situação (aberto, em andamento, aguardando, resolvido) e, depois de resolvido, avaliar o atendimento.']],
      ['Filtros', ['Abas: todos que posso ver, para o meu setor, atribuídos a mim e abertos por mim. "Só em aberto" esconde os encerrados.']],
      ['Lista', DT],
    ],
  },
  '#/meu-rh': {
    t: 'Meu RH', r: 'Seus dados de contrato, férias, ponto, benefícios e documentos, e os pedidos ao RH.',
    s: [
      ['O que você vê', ['Contrato, jornada, salário, saldo de **férias** por período aquisitivo, banco de horas, ocorrências de ponto, benefícios e documentos.',
        'Para bater o ponto e ver o espelho do mês, use **Meu ponto** no menu.']],
      ['Pedidos ao RH', ['**Fazer uma solicitação**: férias, atestado (com anexo), alteração cadastral, declaração, adiantamento e outros. Acompanhe a resposta em Minhas solicitações.',
        'Para pedir férias: tipo Férias e as datas. O RH aprova ou recusa.']],
      ['Dados errados?', ['Peça a correção por uma solicitação de alteração cadastral.']],
    ],
  },
  '#/ponto': {
    t: 'Meu ponto', r: 'Registre entrada, saída para o intervalo, volta e saída pelo navegador. A localização do aparelho vai junto com cada marcação.',
    s: [
      ['Como marcar', ['Clique em **Registrar** (o botão já diz qual é a próxima: entrada, intervalo, volta ou saída).',
        'O navegador pede permissão de **localização** na primeira vez: permita. O sistema grava o ponto no mapa e o endereço aproximado.',
        'A hora que vale é a do **servidor** (horário de Brasília), não a do celular. Não dá para marcar duas vezes no mesmo minuto.',
        'Sem localização (permissão negada, GPS desligado) dá para marcar mesmo assim, mas a marcação vai para o RH **sinalizada**, a menos que a empresa recuse marcação fora dos locais cadastrados.',
        'Se a empresa exigir **foto**, a câmera frontal abre na hora: enquadre o rosto e toque em Tirar foto e registrar.',
        'Fora dos locais da empresa (cercas), a marcação aparece para o RH com a distância, ou é recusada se a empresa configurou assim. Quem tem trabalho externo marca de qualquer lugar.']],
      ['Lembretes', ['Com o horário cadastrado pelo RH, o sistema avisa quando você esquece a entrada, o intervalo ou a saída.',
        'Toque em **Receber lembretes neste aparelho** para receber a notificação no celular mesmo com o sistema fechado. No iPhone, instale o sistema na tela de início antes (Compartilhar → Adicionar à Tela de Início).']],
      ['Espelho e banco de horas', ['O **espelho do mês** mostra cada dia: marcações, horas trabalhadas, previstas (pela sua carga horária e escala) e o saldo.',
        'Diferença de até **10 minutos** no dia não conta (CLT, art. 58).',
        'O **banco de horas** soma o saldo dos dias fechados (até ontem) com os créditos e débitos lançados pelo RH. Hoje só entra amanhã.',
        'Dia com número ímpar de marcações fica **incompleto** e não entra no saldo: avise o RH para lançar a marcação que faltou.',
        'Férias, atestado e falta justificada não geram débito.']],
    ],
  },
  '#/produtividade': {
    t: 'Produtividade', r: 'O que cada setor e cada colaborador fez no período: cobranças, pedidos analisados, notas emitidas, vendas, CRM e chamados.',
    s: [
      ['Números do topo', ['**Cobranças feitas**: ações registradas na Cobrança (ligação, WhatsApp, e-mail...), clientes cobrados e promessas de pagamento.',
        '**Pedidos analisados**: pedidos que saíram da Análise de crédito no período, separados em aprovados, devolvidos e reprovados, com o tempo médio que ficaram na fila.',
        '**Faturamento**: notas autorizadas no período. **Vendas lançadas**: pedidos criados no período (sem os cancelados).']],
      ['Conversão da cobrança', ['**Taxa de conversão**: dos clientes cobrados no período, quantos pagaram uma parcela que já estava vencida em até 30 dias depois da ação.',
        '**Valor recuperado**: soma desses pagamentos. Cada pagamento conta para o **último analista** que cobrou o cliente antes dele.',
        '**Promessas cumpridas**: o cliente pagou entre a ação e 3 dias depois da data prometida. Quebrada: a data passou sem pagamento. A taxa considera só as já resolvidas.']],
      ['Por setor', ['Cada cartão é uma etapa do pedido: quantos pedidos ela tratou, quantos avançaram, voltaram ou foram reprovados, o valor e o **tempo médio na etapa** (da chegada até a saída).',
        'Embaixo aparece quem mais tratou pedidos naquela etapa.']],
      ['Por colaborador', ['Uma linha por pessoa com tudo o que ela fez no período e as **horas no ponto**. Clique para ver o detalhe por etapa e por canal de cobrança.',
        'Use o filtro de colaborador no topo para ver uma pessoa só.']],
      ['Quem vê o quê', ['Com a permissão **Painel de produtividade**, a pessoa vê todos. Sem ela, a tela mostra só o **próprio resultado**.']],
    ],
  },
  '#/mensagens': {
    t: 'Mensagens', r: 'Avisos entre os setores sobre os pedidos. O sino do topo mostra as não lidas.',
    s: [
      ['Como usar', ['**Nova mensagem**: escolha o setor ou a pessoa, informe o nº do pedido (opcional) e escreva.', 'Mensagens recebidas não lidas ficam destacadas; **Marcar todas como lidas** limpa o contador.']],
      ['Dica', ['Para conversas rápidas, use o chat no canto inferior direito.']],
    ],
  },
  '#/pedido/novo': {
    t: 'Novo pedido', r: 'Montagem do pedido: cliente, itens, pagamento, entrega e dados da lavoura.',
    s: [
      ['Passo a passo', ['Busque o **cliente** por nome ou CPF/CNPJ.', 'Escolha **forma** e **condição** de pagamento, **vendedor**, **tipo de entrega** e **endereço**.',
        'Informe **cultura**, **área (ha)** e **origem da venda** (obrigatórios para enviar).', 'Inclua os **itens**: produto, embalagem e quantidade. O preço de tabela vem da tabela regional da UF de entrega; dá para mudar o valor unitário ou marcar brinde.',
        '**Salvar** guarda como rascunho; **Salvar e enviar** manda para a aprovação.']],
      ['Política comercial', ['Item abaixo da tabela, além do desconto tolerado, deixa o pedido **fora da política**: a comissão do vendedor passa a ser decidida pela Diretoria.']],
      ['Crédito', ['Venda a prazo acima do limite do cliente aparece em alerta e será barrada na Análise, a não ser que a Diretoria libere.']],
    ],
  },
  '#/pedido/:id/editar': { ref: '#/pedido/novo' },
  '#/propostas': {
    t: 'Propostas comerciais', r: 'Orçamentos para o cliente, com validade, impressão e conversão em pedido.',
    s: [
      ['Como usar', ['**Nova proposta**: cliente, condições, validade, itens e observações. **Salvar e marcar como enviada** registra o envio.',
        'Imprima a proposta para mandar ao cliente. Atualize a situação: aceita, recusada ou expirada.', 'Proposta **aceita** pode virar pedido com um clique.']],
      ['Indicadores', ['Aguardando o cliente, vencendo em até 3 dias, ganhas, recusadas e expiradas.']],
      ['Lista', DT],
    ],
  },
  '#/propostas/nova': { ref: '#/propostas' },
  '#/propostas/:id/editar': { ref: '#/propostas' },
  '#/metas': {
    t: 'Metas', r: 'Metas do mês por empresa, equipe e vendedor, com realizado, % atingido e projeção de fechamento.',
    s: [
      ['Como ler', ['Cada linha mostra meta, realizado e % de valor vendido, volume (kg/L), pedidos e clientes novos.', 'A barra mostra o % atingido; a marca vertical é a **projeção** de fechamento no ritmo atual.']],
      ['Definir metas', ['Quem tem a permissão usa **Definir metas** (empresa, equipes e vendedores) ou **Copiar do mês anterior**, com reajuste em %.', 'Use as setas para trocar o mês.']],
      ['Quem vê o quê', ['O vendedor vê a própria meta; o supervisor, a equipe; gerente e diretoria, tudo.']],
    ],
  },
  '#/metas/ranking': {
    t: 'Ranking de vendas', r: 'Posição de cada vendedor no mês pelo % da meta de valor.',
    s: [['Como ler', ['Ordenado pelo % da meta de valor. Sem meta, vale o valor vendido.', 'Dos colegas fora da sua abrangência aparece só o percentual.']]],
  },
  '#/metas/campanhas': {
    t: 'Campanhas de vendas', r: 'Campanhas com período, produto ou grupo, meta individual, prêmio e placar.',
    s: [
      ['Como usar', ['**Nova campanha**: nome, início e fim, indicador (valor, volume ou pedidos), produto ou grupo, equipe, meta individual e prêmio.', 'O placar mostra cada vendedor e o % atingido.']],
      ['Dica', ['Em Estoque → Validade e parados dá para criar uma campanha direto para girar um produto parado ou perto de vencer.']],
    ],
  },
  '#/clientes': {
    t: 'Clientes', r: 'Cadastro completo do cliente: documentos, endereços, telefones, áreas de cultivo e referências.',
    s: [
      ['Como usar', ['**Novo cliente**: CPF/CNPJ e nome são obrigatórios. Digitando um **CNPJ**, o sistema busca a razão social e o endereço na Receita; digitando o **CEP**, preenche o endereço.',
        'Abas: Geral, Endereços, Telefones, Área de cultivo (usada no calendário da safra), Referências comerciais e bancárias.']],
      ['Ações na linha', ['Abrir no CRM (visão 360°), ver histórico de compras e editar.']],
      ['LGPD', ['CPF/CNPJ, telefone e e-mail aparecem mascarados para quem não tem a permissão de ver dados completos.']],
      ['Lista', DT],
    ],
  },
  '#/historico-compra': {
    t: 'Histórico de compra', r: 'Pedidos, notas e parcelas de um cliente.',
    s: [['Como usar', ['Busque pelo CPF/CNPJ ou pelo nome e clique em **Buscar**. Aparecem os pedidos, as notas e as parcelas com a situação de cada uma.']]],
  },
  '#/blacklist': {
    t: 'Blacklist', r: 'Clientes com alerta ou bloqueio para novas vendas.',
    s: [
      ['Tipos', ['**Alerta**: avisa no pedido e na análise, mas permite vender.', '**Bloqueio**: impede novos pedidos para o cliente.']],
      ['Como usar', ['**Incluir cliente**: tipo e motivo. **Excluir da blacklist** encerra o registro (fica no histórico). Exige permissão.']],
      ['Lista', DT],
    ],
  },
  '#/arquivos': {
    t: 'Arquivos e documentos', r: 'Documentos anexados a clientes e pedidos.',
    s: [['Como usar', ['**Enviar arquivo**: categoria, descrição e o vínculo com cliente ou pedido. Também dá para anexar pelo detalhe do pedido ou pela visão 360° do cliente.', 'Até 4 MB por arquivo.']], ['Lista', DT]],
  },
  '#/crm': {
    t: 'CRM', r: 'Funil de oportunidades, interações, tarefas, clientes, recompra, calendário da safra e automações.',
    s: [
      ['Funil', ['Arraste os cartões entre as colunas (Prospecção → Qualificação → Proposta → Negociação → Ganha/Perdida). **Oportunidade** cria uma nova.']],
      ['Interações', ['**Registrar interação**: ligação, visita, WhatsApp, e-mail, reunião etc., com resultado. Tudo vai para a linha do tempo do cliente.']],
      ['Outras abas', ['Tarefas, Clientes, Sem compra (reativação), Calendário da safra e Automações.']],
      ['Visão 360°', ['Clique no nome do cliente para ver indicadores, contatos, áreas, produtos comprados, tarefas, linha do tempo, arquivos e o acesso ao Portal do cliente.']],
    ],
  },
  '#/crm/tarefas': {
    t: 'Tarefas do CRM', r: 'Suas tarefas, manuais e as criadas pelas automações.',
    s: [['Como usar', ['Crie tarefas com cliente e data. Filtros: Abertas, Para hoje, Automáticas e Concluídas; supervisor e gerente podem ver as da equipe.',
      'Ao concluir uma tarefa de cliente, registre a interação. **Reagendar** muda data e prioridade.', 'Tarefas automáticas mostram o nome da regra que as criou.']]],
  },
  '#/crm/automacoes': {
    t: 'Automações do CRM', r: 'Regras que criam tarefas sozinhas todo dia de manhã.',
    s: [
      ['Gatilhos', ['Cliente sem comprar há N dias, pós-venda após a entrega, primeira compra, recompra da safra, oportunidade parada, fechamento previsto chegando, proposta sem retorno, parcela vencida, aniversário e calendário da safra.']],
      ['Configuração', ['Dias, título com variáveis ({cliente}, {pedido}, {valor}, {data}...), prazo, prioridade, quem recebe (vendedor do cliente, supervisor ou usuário fixo), equipe, valor mínimo e limite por dia.']],
      ['Testar', ['**Simular** mostra quantas tarefas seriam criadas sem criar. **Executar** roda na hora. A mesma situação nunca gera tarefa repetida.']],
    ],
  },
  '#/crm/safra': {
    t: 'Calendário da safra', r: 'Quando cada cliente vai plantar ou adubar, pelas áreas cadastradas e pelo calendário de cada cultura.',
    s: [['Como usar', ['A lista mostra as janelas de plantio e adubação dos próximos dias. "Janela aberta" = hora de oferecer.', '**Ajustar calendário** muda os meses de cada cultura (e por UF).',
      'A automação "Calendário da safra" cria a tarefa para o vendedor antes da janela, se o cliente ainda não comprou.']]],
  },
  '#/crm/cliente/:id': {
    t: 'Cliente 360°', r: 'Tudo do cliente em uma tela: compras, financeiro, contatos, áreas, tarefas, linha do tempo e portal.',
    s: [
      ['O que tem', ['Indicadores (pedidos, total comprado, ticket, última compra, em aberto e vencido), contato, áreas de cultivo, produtos mais comprados, oportunidades, tarefas e arquivos.',
        'A **linha do tempo** junta interações, pedidos, notas, pagamentos, cobrança, Serasa, blacklist e arquivos; use os filtros para ver só um tipo.']],
      ['Portal do cliente', ['**Gerar link de acesso** cria o convite (vale 7 dias) para o cliente criar a senha; envie pelo WhatsApp. **Desativar** corta o acesso na hora.']],
      ['Ações', ['Interação, Oportunidade, Cadastro e Novo pedido.']],
    ],
  },
  '#/financeiro/parcelas': {
    t: 'Parcelas a receber', r: 'Parcelas dos clientes: baixa, prorrogação, estorno e envio ao Serasa.',
    s: [
      ['Ações na linha', ['**Baixar**: valor pago, data, juros/desconto e forma. Pagamento em atraso pode reduzir a comissão, conforme as faixas da forma de pagamento.',
        '**Prorrogar**: nova data de vencimento (conta as prorrogações).', '**Estornar pagamento** desfaz a baixa.', '**Enviar ao Serasa** inicia a negativação.', '**Detalhes e eventos** mostra o histórico da parcela.']],
      ['Situações', ['A pagar, vencida, liquidada, negociada, acordo judicial, cancelada e devolvida.']],
      ['Lista', DT],
    ],
  },
  '#/cobranca': {
    t: 'Cobrança', r: 'Carteira em atraso por faixa de dias, agenda de contatos, ações e acordos.',
    s: [
      ['Indicadores', ['A vencer, atraso 1-30, 31-60, 61-90 e mais de 90 dias; promessas para hoje e quebradas; ações do dia e recuperado no mês.']],
      ['Como usar', ['Abra o cliente para ver as parcelas em aberto, **Registrar ação** (ligação, WhatsApp, promessa, acordo...) e **Fazer acordo com selecionadas**.', 'Abas: Carteira em atraso, Agenda (próximos 7 dias) e Ações registradas.']],
      ['Lista', DT],
    ],
  },
  '#/cobranca/cliente/:id': {
    t: 'Cobrança do cliente', r: 'Parcelas em aberto do cliente, histórico de cobrança e acordos.',
    s: [['Como usar', ['Selecione parcelas e clique em **Fazer acordo com selecionadas** para renegociar (novas parcelas e vencimentos).',
      '**Registrar ação** guarda cada contato com resultado e promessa de pagamento.', '**Enviar à blacklist** marca o cliente como alerta ou bloqueio.']]],
  },
  '#/financeiro/negativados': {
    t: 'Clientes negativados', r: 'Negativações no Serasa: pedido de inclusão, aceite, baixa.',
    s: [['Ciclo', ['Pedido de inclusão → aceita ou rejeitada → pedido de baixa → aceita ou rejeitada.', 'A baixa é pedida sozinha quando a parcela é liquidada.',
      'Use os botões da linha para registrar cada resposta e o protocolo.']], ['Lista', DT]],
  },
  '#/credito': {
    t: 'Limites de crédito', r: 'Limite, exposição e situação de crédito de cada cliente, com limite sugerido e automático.',
    s: [
      ['Como ler', ['**Exposição** = parcelas em aberto + pedidos em andamento. **Disponível** = limite − exposição.',
        'Situação: dentro do limite, acima do limite, bloqueado por atraso ou sem limite.', '**Sugerido** = média de compras × meses de cobertura, ajustado por score e atrasos (passe o mouse para ver o cálculo).']],
      ['Ações', ['**Definir limite** manual ou **automático** (segue o sugerido e é recalculado todo dia).', '**Aplicar limite sugerido aos sem limite** preenche em lote.',
        '**Regras de bloqueio**: dias de atraso que bloqueiam, o que fazer com cliente sem limite e meses de cobertura.']],
      ['Na prática', ['Venda a prazo bloqueada não passa da Análise; só a Diretoria libera no pedido, com justificativa.']],
    ],
  },
  '#/pagar': {
    t: 'Contas a pagar', r: 'Contas de fornecedores e despesas: vencimento, pagamento, anexos e categorias.',
    s: [
      ['Como usar', ['**Nova conta**: fornecedor, descrição, categoria, documento, valor, vencimento e parcelamento. Anexe o boleto ou a nota.',
        '**Pagar** registra o pagamento (valor, data, banco, juros/desconto). **Ajustar** e **Excluir** ficam na linha.']],
      ['Indicadores', ['Vencido, vence hoje, próximos 7 dias, total em aberto e pago no mês. O quadro **Em aberto por categoria** mostra para onde vai o dinheiro.']],
      ['Origem automática', ['Recebimento de mercadoria (Compras) e comissões de PJ/autônomos (fechamento da folha) também lançam contas aqui.']],
      ['Lista', DT],
    ],
  },
  '#/tesouraria': {
    t: 'Fluxo de caixa', r: 'Saldo realizado e previsto por dia, semana ou mês, com o menor saldo do período.',
    s: [['Como usar', ['Escolha o período e o agrupamento (dia, semana, mês). Entradas = parcelas a receber; saídas = contas a pagar.',
      'O saldo de partida vem do último extrato importado ou do **Saldo em conta** informado.', 'Fique de olho no **menor saldo**: é quando o caixa aperta.']]],
  },
  '#/tesouraria/resultado': {
    t: 'Resultado do mês', r: 'Resultado gerencial (DRE) de cada mês: receita, impostos, custo, comissões, fretes e despesas.',
    s: [['Como ler', ['Receita das notas, menos devoluções e **impostos** (% configurável em "Impostos sobre a venda"), menos custo dos produtos, comissões, fretes e despesas por categoria = resultado operacional.',
      'O gráfico compara receita e resultado mês a mês.']]],
  },
  '#/tesouraria/conciliacao': {
    t: 'Conciliação bancária', r: 'Extrato do banco (OFX) casado com as parcelas e as contas a pagar.',
    s: [['Como usar', ['**Importar extrato (OFX)** do banco (não duplica lançamentos já importados).', 'Créditos casam com parcelas a receber e débitos com contas a pagar, pelo valor e pela data; os pares seguros são baixados sozinhos.',
      'Nos pendentes: **Conciliar** (escolher a sugestão), **Lançar como despesa paga** (tarifas) ou **Ignorar** (transferências entre contas).']]],
  },
  '#/financeiro/notas': {
    t: 'Notas fiscais de saída', r: 'Notas emitidas, canceladas, cartas de correção e devoluções.',
    s: [['Ações na linha', ['**Cancelar nota** (justificativa de 15+ caracteres); fora do prazo, pede o cancelamento extemporâneo. Cancelar apaga as comissões ainda abertas do pedido.',
      '**Carta de correção** (texto de 15+ caracteres).', '**Registrar devolução**: abate as parcelas, ajusta a comissão e, se total, devolve ao estoque.']], ['Lista', DT]],
  },
  '#/financeiro/devolucoes': {
    t: 'Descontos de devolução', r: 'Descontos aplicados por devolução de mercadoria.',
    s: [['Como usar', ['**Nova devolução**: nota, valor e motivo. O valor é abatido das parcelas em aberto e da comissão do pedido.']], ['Lista', DT]],
  },
  '#/financeiro/comissoes': {
    t: 'Revisar comissões', r: 'Comissões geradas na emissão das notas: conferir, ajustar e marcar como revisadas.',
    s: [
      ['De onde vêm', ['A lista de quem recebe é definida no pedido (regra + ajuste da Diretoria). Ao **emitir a nota**, cada pessoa ganha uma comissão **aberta** no mês.',
        'Atraso no pagamento pode reduzir o valor (faixas da forma de pagamento); devolução reduz proporcionalmente; nota cancelada apaga as abertas.']],
      ['Como usar', ['Confira e ajuste (**Editar**). Selecione e use **Marcar revisadas**.', 'Revisadas e ainda não pagas entram na **folha do mês** (CLT) ou viram conta a pagar no fechamento (PJ/autônomo). Fechar a folha marca como pagas.',
        '**Resumo por colaborador** soma comissões, créditos e descontos do período.']],
      ['Lista', DT],
    ],
  },
  '#/financeiro/lancamentos': {
    t: 'Descontos e créditos', r: 'Valores avulsos para os vendedores: adiantamentos a descontar ou bônus.',
    s: [['Como usar', ['**Novo lançamento**: vendedor, período, tipo (crédito ou desconto), valor e descrição.', 'Entram com as comissões na folha do mês (ou na conta a pagar de PJ) e ficam marcados quando a folha fecha.']], ['Lista', DT]],
  },
  '#/cadastros/comissao': {
    t: 'Regras de comissão', r: 'Percentuais de gerente, supervisor e vendedor, política comercial e dia de pagamento de PJ.',
    s: [
      ['Regras', ['**Gerente**: % sobre toda venda (o gerente da equipe do vendedor; sem ele, os marcados aqui ou todos com perfil Gerente).', '**Supervisor**: % sobre as vendas da equipe.',
        '**Vendedor**: % quando o pedido está **dentro da política**; um % individual no cadastro do usuário substitui este.', '**Fora da política**: % sugerido ao vendedor; a Diretoria decide.',
        '**Desconto máximo** sobre a tabela para o pedido continuar dentro da política.', '**Dia do mês seguinte** para pagar a comissão de PJ/autônomo.']],
      ['Importante', ['Tudo é calculado sobre o **valor total do pedido**. As mudanças valem para pedidos que ainda não tiveram a comissão definida pela Diretoria.']],
    ],
  },
  '#/estoque': {
    t: 'Estoque', r: 'Saldos por produto e embalagem, lotes, movimentações, validade, produtos parados e inventário.',
    s: [
      ['Saldos', ['Saldo, em pedidos (reservado), disponível, mínimo, custo médio e valor. Linha vermelha = sem saldo; amarela = abaixo do mínimo.', 'Na linha: lotes, entrada, saída e estoque mínimo/peso.']],
      ['Entradas e saídas', ['**Entrada**: motivo, lote, validade, fornecedor, custo e documento. **Saída**: motivo (perda, consumo, amostra, ajuste) e lote.', 'Vendas (nota) e compras (recebimento) movimentam o estoque sozinhas.']],
      ['Validade e parados', ['Lotes vencidos e vencendo com valor em risco, e produtos sem saída há muito tempo. **Criar campanha** para girar ou **Baixar como perda**. **Regras** ajusta os prazos e se lote vencido bloqueia.']],
      ['Inventário', ['Carregue os itens (por grupo), digite o contado e clique em **Lançar ajustes**: só a diferença é lançada. **Folha de contagem** imprime a lista.']],
      ['Repor', ['**Repor estoque** leva à sugestão de compra.']],
    ],
  },
  '#/compras': {
    t: 'Solicitações de compra', r: 'Pedidos de compra dos setores, cotação com fornecedores e acompanhamento.',
    s: [
      ['Solicitar', ['**Nova solicitação**: departamento, urgência, data de necessidade, justificativa e itens (produto do estoque ou item livre). Você é avisado quando vira pedido ou é recusada.']],
      ['Comprador', ['Abra a solicitação, lance a **cotação** de cada fornecedor (preços, frete, prazo, parcelas) e compare: o menor preço fica destacado.', '**Comprar** gera o pedido de compra com a cotação escolhida; **Comprar direto com estes preços** dispensa cotação.']],
      ['Lista', DT],
    ],
  },
  '#/compras/pedidos': {
    t: 'Pedidos de compra', r: 'Pedidos aos fornecedores: aprovação, envio e entrega.',
    s: [
      ['Fluxo', ['Rascunho → enviar para aprovação → aprovado → enviado ao fornecedor → recebido (parcial ou total).',
        'Acima do limite de aprovação (padrão R$ 5.000; botão **Aprovação acima de**), quem aprova é a Diretoria; abaixo, é aprovado na hora. Quem aprova pode devolver com o motivo.']],
      ['Outras ações', ['**Novo pedido de compra / Compra direta** sem solicitação. Imprima para enviar ao fornecedor. Entrega atrasada aparece em vermelho.']],
      ['Lista', DT],
    ],
  },
  '#/compras/receber': {
    t: 'Receber mercadoria', r: 'Conferência com a nota do fornecedor: entra no estoque e gera a conta a pagar.',
    s: [['Como usar', ['Abra o pedido, informe a nota, as quantidades recebidas (pode ser parcial), lote e validade.',
      'Os itens entram no estoque com o custo do pedido (frete e desconto rateados) e a conta a pagar é lançada nas parcelas combinadas. O Financeiro é avisado.']]],
  },
  '#/compras/reposicao': {
    t: 'Reposição de estoque', r: 'Itens abaixo do mínimo com a quantidade sugerida para comprar.',
    s: [['Como usar', ['O disponível já desconta pedidos de venda e soma o que está em compra ou solicitado. A sugestão repõe até o dobro do mínimo.',
      'Marque os itens, ajuste as quantidades e clique em **Gerar solicitação de compra**.']]],
  },
  '#/rh': {
    t: 'Painel do RH', r: 'Visão geral do quadro: ativos, turnover, férias, exames, aniversariantes e custo.',
    s: [['O que tem', ['Colaboradores ativos, turnover de 12 meses, solicitações abertas, férias (hoje, a aprovar, vencidas), custo mensal (salários + benefícios).',
      '**Alertas e prazos**: férias vencendo ou vencidas e exames vencidos. Quadro por departamento e aniversariantes do mês.']]],
  },
  '#/rh/colaboradores': {
    t: 'Colaboradores', r: 'Admissão, ficha completa e desligamento.',
    s: [
      ['Admitir', ['**Admitir colaborador**: dados pessoais, documentos, contato e endereço, vínculo (CLT, PJ, autônomo...), cargo e departamento, equipe, gestor, jornada, salário e banco.',
        'Cargo de vendedor exige equipe; PJ exige CNPJ e razão social. CEP e CNPJ preenchem sozinhos.']],
      ['Ficha', ['Dependentes, histórico (reajustes, promoções), benefícios, exames (ASO) e documentos. Salário e banco só para quem gere o RH ou a folha.', '**Desligar** desativa também o acesso ao sistema.']],
      ['Lista', DT],
    ],
  },
  '#/rh/ferias': {
    t: 'Férias', r: 'Programação de férias dentro das regras da CLT.',
    s: [['Regras', ['Dias de direito conforme as faltas no período aquisitivo (art. 130).', 'Até 3 períodos: um com pelo menos 14 dias e nenhum com menos de 5. Abono de até 1/3.', 'O sistema avisa quando o período concessivo está vencendo.']],
      ['Como usar', ['**Programar férias**: colaborador, período aquisitivo, datas e abono. A aba Saldos e prazos mostra o que cada um tem a tirar.']]],
  },
  '#/rh/ponto': {
    t: 'Ponto', r: 'Quem está trabalhando agora, o espelho de ponto de cada colaborador com o local de cada marcação, ajustes e banco de horas.',
    s: [
      ['A lista', ['**Hoje**: trabalhando (marcou entrada e ainda não saiu), saiu ou sem marcação.',
        '**Saldo do mês** e **banco de horas** (saldo acumulado do ponto mais créditos e débitos manuais).',
        '**Pendências**: dias incompletos (número ímpar de marcações), dias úteis sem marcação, marcações sem localização, **fora da cerca** e **atrasos**.']],
      ['Locais e regras', ['**Locais** (cercas): nome, coordenadas e raio. Estando no local, use **Usar minha localização**. Marcação além do raio fica como fora da cerca (a imprecisão do GPS, até 100 m, conta a favor).',
        '**Regras**: recusar marcação fora da cerca, exigir foto, ligar os lembretes, minutos para avisar a entrada e a saída e tolerância de atraso.']],
      ['Horário de trabalho', ['No espelho do colaborador, **Horário de trabalho**: entrada, intervalo e saída de cada dia da semana (dia em branco = folga). Use os modelos prontos e **aplique o mesmo horário a vários** de uma vez.',
        'Com horário, o previsto do dia vem dele, o espelho mostra **atraso** e **saída antecipada** (além da tolerância) e os **lembretes** funcionam.',
        'Marque **trabalho externo** para quem marca fora da empresa (vendedor, motorista).']],
      ['Espelho do colaborador', ['Clique na linha: cada marcação aparece com o **endereço aproximado** e o link para o mapa, e a precisão do GPS.',
        '**Lançar marcação**: para esquecimento ou celular sem bateria. Exige justificativa e aparece com * no espelho.',
        '**Anular**: marcação errada ou duplicada. Ela continua no histórico, mas deixa de contar.',
        'Depois que a competência é fechada na Folha do mês, as marcações daquele mês ficam travadas.']],
      ['Regras do cálculo', ['Previsto do dia pela carga horária semanal e escala: 5x2 divide por 5 dias (seg. a sex.), 6x1 por 6 (seg. a sáb.); 12x36, 4x3 e flexível contam só os dias trabalhados.',
        'Tolerância de 10 minutos no dia (CLT, art. 58). Férias, atestado e falta justificada não geram débito; falta lançada já vai para a folha.',
        'O controle começa na primeira marcação do colaborador: dias anteriores não geram débito.']],
      ['Exportar', ['**Exportar espelhos** gera a planilha do mês com marcações, horas, saldo e local de cada dia.']],
    ],
  },
  '#/rh/ocorrencias': {
    t: 'Ocorrências', r: 'Faltas, atestados, atrasos, horas extras, créditos e débitos manuais no banco de horas, advertências e elogios.',
    s: [['Como usar', ['**Lançar ocorrência**: colaborador, data, tipo, horas/dias e descrição.', 'Horas extras, faltas e atrasos viram eventos da folha ao gerar os eventos do mês.',
      'Depois que a competência é fechada, as ocorrências daquele mês ficam travadas.']], ['Lista', DT]],
  },
  '#/rh/solicitacoes': {
    t: 'Solicitações dos colaboradores', r: 'Pedidos feitos pelo Meu RH para o RH aprovar ou recusar.',
    s: [['Como usar', ['Abra a solicitação, confira os anexos e **aprove** ou **recuse** com uma resposta. Atestado aprovado vira ocorrência; férias aprovadas entram na programação.']], ['Lista', DT]],
  },
  '#/rh/folha': {
    t: 'Folha do mês', r: 'Eventos variáveis do mês para a contabilidade, incluindo as comissões.',
    s: [
      ['Passo a passo', ['Escolha a competência e clique em **Gerar eventos automáticos**: horas extras, faltas, atrasos, descontos de benefícios e **comissões** (para CLT).',
        'Ajuste à mão com **Lançar evento**. **Exportar para a contabilidade** gera o Excel.', '**Fechar competência**: trava o mês, marca as comissões como pagas e lança conta a pagar para PJ/autônomos.']],
      ['Comissões desta folha', ['O card mostra por vendedor o que será pago, na folha (CLT) ou em contas a pagar (PJ/autônomo/sem cadastro), e quantas ainda aguardam revisão do Financeiro (ficam para a folha seguinte).']],
      ['Importante', ['INSS, IRRF e FGTS são calculados pela contabilidade. **Reabrir** exige permissão e motivo, e desfaz o pagamento das comissões.']],
    ],
  },
  '#/relatorios': {
    t: 'Relatórios', r: 'Relatórios de vendas, financeiro e estoque, com filtros e Excel.',
    s: [['Como usar', ['Escolha o relatório, preencha os filtros e clique em **Gerar relatório**; **Gerar Excel** baixa a planilha.', 'Os relatórios respeitam o que você pode ver (próprios, equipe ou todos).']]],
  },
  '#/relatorios/:tipo': { ref: '#/relatorios' },
  '#/analises': {
    t: 'Curva ABC', r: 'Quais clientes e produtos fazem 80% (A), 15% (B) e 5% (C) do faturamento ou da margem.',
    s: [['Como usar', ['Escolha clientes ou produtos, faturamento ou margem e o período (3 a 24 meses).', 'Classe **A** = os poucos que fazem 80% do resultado: prioridade de atendimento e estoque.']]],
  },
  '#/analises/demanda': {
    t: 'Previsão de demanda', r: 'Quanto deve vender nos próximos meses e quanto comprar para não faltar.',
    s: [['Como funciona', ['Previsão = metade pelo mesmo mês do ano passado (corrigido pela tendência) + metade pela média dos últimos 3 meses.',
      '**Cobertura** = quantos meses o disponível + em compra aguenta. **Comprar** = o que falta para o horizonte escolhido.', 'Marque os itens e clique em **Solicitar compra dos marcados**.']]],
  },
  '#/analises/recompra': {
    t: 'Recompra atrasada', r: 'Clientes que passaram do tempo normal entre uma compra e outra.',
    s: [['Como funciona', ['Para clientes com pelo menos 2 compras, calcula o intervalo médio. Aparece quem passou desse intervalo em mais de 20%.', 'Ordenado pelo ticket médio: ligue primeiro para os maiores.']]],
  },
  '#/cadastros/usuarios': {
    t: 'Usuários e permissões', r: 'Acesso ao sistema: perfil, permissões, empresas e dados que cada pessoa pode ver.',
    s: [['Como usar', ['**Novo usuário**: login, perfil, empresas e senha provisória (a pessoa troca no primeiro acesso).',
      '**Permissões**: além das do perfil, dá para liberar ou tirar permissões individuais. **Dados que pode ver**: próprios, equipe ou todos.', 'Desbloqueie quem errou a senha várias vezes e desative quem saiu.']], ['Lista', DT]],
  },
  '#/cadastros/colaboradores': { ref: '#/rh/colaboradores' },
  '#/cadastros/equipes': {
    t: 'Equipes', r: 'Equipes de venda com supervisor e gerente.',
    s: [['Como usar', ['Cada equipe tem supervisor e gerente: eles recebem as comissões de supervisão e de gerência das vendas da equipe e aprovam os pedidos dela.', 'O vendedor entra na equipe pelo cadastro do usuário ou do colaborador.']]],
  },
  '#/cadastros/produtos': {
    t: 'Produtos', r: 'Produtos, embalagens, preços, dados fiscais e estoque mínimo.',
    s: [['Como usar', ['**Novo produto**: código, nome, grupo, unidade, NCM, CST, GTIN e prazo de produção.', 'Embalagens com custo, peso e estoque mínimo; preços base por embalagem e forma de pagamento (a tabela regional ajusta por UF).']], ['Lista', DT]],
  },
  '#/tabelas-preco': {
    t: 'Tabelas de preço', r: 'Preços por estado e safra, com vigência, ajuste geral e preço próprio por embalagem.',
    s: [['Como funciona', ['O pedido e a proposta usam a tabela **vigente** para a **UF de entrega** (maior prioridade; empate, a mais recente). Sem tabela para a UF, vale o preço base.',
      'Itens sem preço próprio seguem o preço base com o **ajuste %** da tabela.', '**Reajustar tudo** aplica um % e **Copiar** cria a tabela da próxima safra.']]],
  },
  '#/cadastros/formas': {
    t: 'Formas de pagamento', r: 'Formas e condições de pagamento usadas nos pedidos.',
    s: [['Como usar', ['Forma: tipo (à vista ou a prazo) e tipo de baixa. Condições: parcelas, intervalo, carência, desconto e valor mínimo.',
      '**Faixas de penalidade**: quanto da comissão se perde conforme os dias de atraso do cliente.', 'À vista passa pela etapa Pagamento à vista antes da produção.']], ['Lista', DT]],
  },
  '#/cadastros/transportadoras': { t: 'Transportadoras', r: 'Transportadoras usadas na expedição e na cotação de frete.', s: [['Como usar', ['Cadastre nome, CNPJ (preenche pela Receita), contato e se está ativa.']], ['Lista', DT]] },
  '#/cadastros/fornecedores': { t: 'Fornecedores', r: 'Fornecedores com categoria, contato, dados bancários e prazo padrão.', s: [['Como usar', ['Digite o CNPJ para preencher pela Receita. Usados em compras, entradas de estoque e contas a pagar.']], ['Lista', DT]] },
  '#/cadastros/empresas': { t: 'Empresas', r: 'Empresas do grupo, CNPJ e endereço do remetente.', s: [['Como usar', ['O endereço da empresa vai na etiqueta de envio e nos documentos. Cada usuário acessa as empresas liberadas para ele; quem tem mais de uma pode ver "Todas as empresas" (só consulta).']], ['Lista', DT]] },
  '#/cadastros/listas': {
    t: 'Listas de opções', r: 'Opções dos campos de escolha: cargos, departamentos, culturas e origens da venda.',
    s: [['Como usar', ['Adicione, renomeie ou desative. Renomear atualiza os cadastros que usam a opção; desativar tira da lista sem apagar o histórico.', 'No cargo, a **função comercial** define comissão e exige equipe para vendedores.']]],
  },
  '#/auditoria': { t: 'Auditoria', r: 'Quem fez o quê e quando, com antes e depois de cada alteração.', s: [['Como usar', ['Filtre por usuário, ação ou registro. Clique numa linha para ver os campos antes e depois. Inclui acessos, exportações e tentativas de login.']], ['Lista', DT]] },
  '#/backups': { t: 'Backups', r: 'Cópias de segurança do banco de dados.', s: [['Como funciona', ['O backup automático roda todo dia às 03:00 e guarda os últimos 30. **Fazer backup agora** gera um na hora.', 'O arquivo tem dados pessoais (LGPD): guarde em local seguro.']]] },
  '#/importacao': { t: 'Importar dados', r: 'Carga da planilha do sistema anterior, com conferência antes de gravar.', s: [['Como usar', ['Envie a planilha (.xlsx) e clique em **Analisar**: o sistema mostra o que vai entrar, sem gravar.', '**Importar agora** grava (com backup automático antes). Reenviar a mesma planilha não duplica. **Desfazer importação** remove o que entrou.']]] },
  '#/integracoes': { t: 'Integrações', r: 'Credenciais das APIs externas: NF-e, cotação de frete, boleto e emissão de nota.', s: [['Como usar', ['Para cada serviço, informe o ambiente (homologação ou produção) e as credenciais, ative e use **Testar conexão**.']]] },
  '#/perfil': { t: 'Meu perfil', r: 'Sua foto, dados de usuário e de colaborador e o que você pode acessar.', s: [['Como usar', ['Troque a foto (JPG, PNG ou WEBP). Dados errados: fale com a administração. Para trocar a senha, use Alterar minha senha.']]] },
  '#/privacidade': { t: 'Privacidade (LGPD)', r: 'Termo de uso, política de privacidade e direitos do titular.', s: [['O que tem', ['Como o sistema trata dados pessoais, base legal, suas responsabilidades e direitos. Quem tem permissão exporta ou anonimiza os dados de um cliente.']]] },
  '#/senha': { t: 'Alterar minha senha', r: 'Troca da sua senha de acesso.', s: [['Regras', ['Mínimo de 8 caracteres, com letras e números. Depois de várias senhas erradas o login fica bloqueado por alguns minutos.']]] },
};

/** Ajuda da rota: troca números por :id e segue "ref" para telas que usam a mesma explicação. */
export function ajudaDe(chave) {
  const k = chave.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/^(#\/relatorios\/)[\w-]+$/, '$1:tipo');
  let a = AJUDA[k];
  if (a?.ref) a = AJUDA[a.ref];
  return a || null;
}
