# Importação conferida e configuração local

Este contrato é de exemplo. A planilha real da operação ainda não foi recebida nem analisada. Não há conversão de Excel, reconhecimento automático de colunas ou deduplicação por telefone.

## Antes de importar

1. Acesse Clientes → Importar CSV de exemplo como dona.
2. Use uma fonte estável para a base, por exemplo `cadastro-inicial`. Reutilize a mesma fonte nas próximas importações dessa base. Não use um nome novo por arquivo: fontes diferentes têm mapeamentos diferentes.
3. Cada cliente precisa de `source_id` estável e conferido. Se a fonte não possui identificador, crie e confira um arquivo de mapeamento antes de importar. Não derive identidade apenas de telefone, nome ou endereço.
4. Guarde o arquivo original em local protegido, fora de logs e Git. A aplicação não guarda o CSV bruto no banco nem no storage do navegador.

O formato mínimo é:

```csv
source_id,name,phone,address,weekday,position,eggs_per_tray,trays
exemplo-1,Cliente fictício,,Endereço fictício,2,1,30,2
exemplo-1,Cliente fictício,,Endereço fictício,2,1,15,1
```

Dia usa ISO: 2=terça, 3=quarta, 4=quinta, 5=sexta. Posição e bandejas são inteiros positivos até 2147483647. Tamanho permitido: 15, 20 ou 30. Campos com vírgulas, aspas ou quebras de linha seguem as regras de CSV com aspas. O exemplo não tem coluna de preço; o importador não recebe preços arbitrários.

## Conferência e confirmação

“Conferir arquivo” reutiliza o parser aprovado, mostra ocorrências por registro/campo e agrupa produtos pelo identificador. Dados de nome, telefone, endereço, dia e posição devem coincidir dentro do cliente. Produto repetido, quantidade inválida ou dados divergentes bloqueiam todas as linhas desse cliente. Erro de sintaxe CSV que deixa o identificador incerto bloqueia o arquivo inteiro. Outros grupos válidos podem ser conferidos separadamente.

A prévia informa quais grupos criarão ou atualizarão cadastros. Conferir não cria clientes. É necessário marcar a confirmação e clicar “Confirmar importação” para gravar os grupos aprovados.

- Identidade no banco: `(source,source_id)`, nunca telefone sozinho. Pessoas com o mesmo telefone permanecem distintas.
- Vários produtos do mesmo grupo compõem um único pedido padrão.
- Atualização substitui nome/endereço/telefone/dia/posição e itens padrão. Inatividade e preços negociados existentes são conservados.
- Pedidos semanais e paradas já gerados mantêm seus snapshots.
- O banco revalida todos os grupos recebidos. Se o payload enviado ao banco é inválido ou alguma versão mudou desde a conferência, o lote inteiro falha; nenhum grupo recebido é gravado parcialmente. Os grupos excluídos pelo parser não são enviados.
- Os contadores `created/updated/rejected` se referem ao payload aprovado enviado ao banco. Em sucesso, `rejected=0`; ocorrências excluídas na prévia são apresentadas separadamente. Erro de validação do servidor aborta o lote, sem contagem fictícia de sucesso.

## Contrato das RPCs

`prepare_customer_import(p_batch_id uuid,p_source text,p_rows jsonb)` valida o contrato e registra apenas fonte, hash canônico, identificadores/versões esperadas e autor. Retorna contagens previstas e ações por identificador. Nenhum CSV ou payload de cadastro é guardado na tabela de lote.

`commit_customer_import(p_batch_id uuid,p_rows jsonb,p_request_id uuid)` exige a conferência correspondente. Fonte/payload/autor precisam coincidir. O mapeamento e as versões são bloqueados e conferidos antes das gravações; alteração concorrente produz `PT409/VERSION_CONFLICT`. Repetir o mesmo lote/payload, mesmo com outro request, retorna o resultado sem duplicar alterações. Payload diferente recebe `PT409/BATCH_CONFLICT`.

Tentativas incertas usam UUID por autor/operação no sessionStorage. A reconciliação usa tombstone transacional e consulta um save em voo antes de liberar nova intenção; envio atrasado encerrado recebe `REQUEST_CLOSED`. Depois de recarregar, a interface recupera o resultado ou informa que não importou; o arquivo deve ser selecionado novamente para nova conferência. Isso não é fila offline.

## Configuração operacional

A dona configura um veículo/motorista padrão, locais e origem/destino por dia. Um local incompleto permanece pendente; só endereços marcados como conferidos entram nos futuros snapshots de paradas. Alterar o texto do endereço desmarca a conferência na interface.

Terça e quarta continuam sem chegada adicional enquanto o destino não for explicitamente escolhido. Não são inventados endereços ou retornos. Configuração usa controle de versão global e não reescreve execuções existentes. Geração segura compartilha um lock de leitura da configuração, impedindo misturar atribuição e locais de versões diferentes durante a cópia.

Cálculo de distância/Maps permanece desabilitado. Carga, estoque, saída, entrega e retorno operacional pertencem ao Plano 2. A definição de funcionamento offline e a conferência da planilha real continuam pendentes.

## Ambiente e verificações

Nesta entrega, somente a stack local da Granja: API 56321, PostgreSQL 56322, Podman. Não usar Supabase HUB, projeto remoto, `link`, `db push` ou deploy nesta etapa.

```bash
rtk npm run check
rtk env DOCKER_HOST=unix:///run/user/1000/podman/podman.sock npm test
```

A suíte inclui parser aprovado, PostgreSQL real, concorrência de pedidos/rotas e E2E com usuários fictícios. A aplicação funcional não foi publicada nem substitui a planilha operacional.
