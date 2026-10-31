# Migração da planilha

## Atualização — 2026-10-30

**Regra vigente:** uma entrega semanal por cliente; nomes repetidos são enganos e ficam em conferência até definir a ocorrência correta. Estado corrigido: 700 aptos, 685 pendentes e nenhum vínculo de vários dias. Ver [correção](2026-10-30-entrega-semanal-unica.md). Os parágrafos seguintes preservam o histórico anterior.

Estado mais recente: 920 registros de entrega aptos, 465 em conferência e 96 grupos com dias vinculados. X ignorado, segunda somente coleta e quantidades da origem aplicadas. Ver [regras confirmadas](2026-10-30-regras-entregas-planilha.md). O histórico abaixo registra os lotes anteriores.

Cadastro completo autorizado e importado: 1.385 registros com endereços e 416 observações; 367 ativos e 1.018 inativos em conferência. Os 374 itens padrão anteriores foram preservados. Estado atual em [cadastros completos](2026-10-30-cadastros-completos.md). O primeiro lote permanece documentado como histórico. INT=30 e MEIA=15 foram confirmados pelo usuário. Evidências, mapeamento, backup e limitações em [migração parcial](2026-10-30-migracao-parcial.md). O procedimento abaixo foi escrito antes da recepção da planilha e permanece como referência para os próximos lotes; afirmações de origem ainda não recebida descrevem aquele estado anterior.

O procedimento abaixo foi definido antes do recebimento da planilha e permanece como referência para os próximos lotes/conferências. Os relatórios datados acima registram as importações efetivamente concluídas. Não colocar arquivo real em Git, prévia pública, logs ou fixtures.

## Preparação e proteção da origem

1. Receber a planilha por canal privado aprovado e guardar o original em local protegido, com acesso restrito. Manter uma cópia imutável para conferência e registrar nome lógico, data de recebimento e checksum, sem divulgar dados pessoais.
2. Trabalhar numa cópia protegida. Não enviar conteúdo a serviços externos (incluindo mapas) sem necessidade e autorização específica.
3. Inventariar abas, cabeçalhos, formatos, fórmulas, linhas vazias, duplicatas aparentes e campos sensíveis. Identificar o que é cadastro atual, histórico semanal, dívida/crédito, pagamentos, estoque, perdas e despesas. Não assumir que a planilha contém uma fonte completa ou consistente.
4. Com a dona, definir o que entra no primeiro corte e o que permanece como histórico de consulta. Corrigir ambiguidades na origem ou num mapeamento aprovado; não inferir identidade somente por nome, telefone ou endereço.

## Data de corte e mapeamento

Antes de preparar arquivo de importação, combinar uma data/hora de corte em `America/Recife`. Registrar: responsável pela extração, última data incluída, primeiro dia de operação no sistema e como serão lançados eventos após o corte. Evitar intervalo em que a mesma entrega/pagamento seja lançado tanto na planilha quanto no sistema.

Montar e revisar um mapeamento por campo: origem → campo do sistema → conversão → validação → tratamento de ausente/ambíguo. Para identidade, usar identificador estável da origem + `source_id`; se não existir, produzir e conferir um mapeamento manual durável antes da importação. Não unir pessoas por telefone compartilhado.

Separar explicitamente:

- cadastros e pedidos padrão, que podem ser importados após conferência;
- saldo físico de ovos por local na data de corte;
- custo associado ao estoque, que pode permanecer desconhecido/incompleto;
- saldo de abertura de cada cliente (positivo=dívida, negativo=crédito), com data e evidência;
- eventos históricos de venda e pagamento, somente se a granularidade e evidência permitirem reconstrução sem dupla contagem.

Saldos históricos de abertura não são vendas, faturamento nem recebimentos. Pagamento histórico só entra como recebimento quando o evento e data forem verificáveis. Não derivar saldo bancário do caixa calculado no período.

## Prévia, conferência e importação

O contrato CSV atual documenta campos mínimos `source_id,name,phone,address,weekday,position,eggs_per_tray,trays`; dia segue ISO, e produtos aceitos são bandejas de 15/20/30. O contrato não foi validado contra a planilha real e não cobre automaticamente XLSX, saldos ou histórico financeiro. Não adicionar conversor ou afirmar suporte até analisar o arquivo e aprovar o mapeamento.

1. Converter para o formato aprovado usando ferramenta/método revisado; manter o resultado também em local protegido.
2. Rodar a prévia da aplicação com grupos identificados por `source_id`. Conferir linhas inválidas, duplicatas, agrupamento de produtos e quais cadastros serão criados/atualizados. Erro de sintaxe que torne identidade ambígua bloqueia arquivo; dados conflitantes de um cliente bloqueiam aquele grupo.
3. Comparar totais e amostras com a origem: quantidade de clientes, itens, dias, produtos e totais de bandejas/ovos. Conferir especialmente nomes repetidos, telefones compartilhados, linhas com múltiplos produtos e cadastros inativos.
4. Apresentar prévia e relatório à dona. Importar somente após aprovação explícita do mapeamento e dos totais. Gravar primeiro em ambiente isolado quando o fluxo suportar; não importar diretamente em produção sem ensaio restaurável.
5. Repetir a conferência pós-importação e reconciliar contagens por grupo. Repetir a mesma origem/identificadores não pode duplicar cadastros. Guardar IDs de lote/evento e resumo sem dados pessoais.

## Estoque, custos e contas de abertura

Contar fisicamente estoque na data de corte, separando granja e veículo; exigir conferência da dona. Se o estoque inicial for zero, registrar zero apenas após confirmação física. Caso haja quantidade, importar a quantidade conferida.

Se não houver evidência confiável de custo histórico, manter custo desconhecido e resultado financeiro incompleto para os períodos afetados. Não preencher custo zero, não converter compra em custo de venda sem regra e não criar lucro histórico aparente.

Conferir com a dona cada dívida/crédito de abertura, cliente, valor assinado, data de corte e fonte. Importar como saldo histórico de abertura, nunca como venda ou pagamento ocorrido no período. Divergências permanecem pendentes, sem saldo inventado.

## Bloqueios e resultado

Parar se identidade de cliente, quantidade física, data de corte, saldo de abertura ou destino remoto não puderem ser conferidos. O HUB é proibido como destino. Dados reais não entram na prévia pública nem em Git.

Ao terminar, registrar versão do mapeamento, data de corte, contagens de origem/prévia/destino, rejeições e decisões pendentes. A dona aprova a reconciliação final antes de iniciar operação no sistema. Consultar os relatórios datados para distinguir importações concluídas de procedimentos ainda pendentes.
