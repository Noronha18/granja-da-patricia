# Granja da Patrícia — sistema visual

Direção aprovada pelo usuário em 2026-10-29 a partir de docs/visual/proposta-2026-10-29.html. O sistema atende a tarefas diárias da dona e do motorista; a operação e a leitura prevalecem sobre decoração.

## Identidade

Verde floresta #214D36 para marca/ação e navegação lateral, papel #FFFEF9 para conteúdo, folha #EEF1EC para fundo, tinta #263A31 para texto e cinza verde #526657 para apoio. Palha clara #F6EDCF aparece apenas quando há algo a conferir. Tokens e fontes em src/app/theme.css.

DM Sans real, hospedada em public/fonts com licença OFL; pesos 400–700, fallback system-ui e font-display swap. Escala principal 14/16/18/22/28/32 px; dinheiro e contagens usam números tabulares. Texto alinhado à esquerda; valores financeiros à direita.

## Composição

Dona: a partir de 900 px, navegação verde de 200 px e área clara de trabalho. Abaixo disso, barra inferior e menu Mais. Conteúdo se adapta sem esconder campos, rotas, configurações ou ações secundárias. Formulários mantêm controles nativos, labels e foco visível.

Motorista: primeira entrega antes dos metadados; parada atual agrupada em superfície verde clara, confirmação primária e não entrega secundária. Data/atualização e lista são recolhíveis; recuperação abre automaticamente com falha ou envio pendente. Preservar 360–390 px, botões primários de 48–52 px, ações antes do rodapé no cenário representativo e confirmação explícita. Não mostrar preços ou custos privados.

Dashboard: operação do dia primeiro, próxima parada, atenção com links e dinheiro em linhas comparáveis. Somente dados reais da API. Não importar os números fictícios da proposta nem criar alegações de GPS, lucro ou saldo bancário.

## Limites

Sem fotografia decorativa, animação obrigatória, sombras em todos os blocos ou dependência de fontes externas. Mudança visual não altera regras, autenticação ou transações. Emulação não substitui validação em celular físico, leitor de tela e teclado virtual.
