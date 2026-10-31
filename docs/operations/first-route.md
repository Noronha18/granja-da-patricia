# Primeira operação com sistema vazio

Este procedimento inicia a operação sem importar a planilha. A planilha real ainda não foi recebida/analisada; não use dados da demonstração nem cadastros fictícios como dados iniciais.

## Bloqueios antes de qualquer dado real

- [ ] Confirmar com a dona o projeto Supabase próprio da Granja, seu identificador e organização. Conferir o destino antes de qualquer comando remoto. O projeto Supabase HUB é proibido; não executar `supabase link`, `db push` ou migração remota contra ele.
- [ ] Confirmar também a conta/ambiente Cloudflare de destino e o domínio/URL pretendido. Não publicar dados reais na prévia pública.
- [ ] Conferir que há backup completo do ambiente e ensaio de restauração aprovado segundo [backup e restauração](backup-restore.md). Este runbook não afirma que backup ou restauração já foram executados.
- [ ] A versão inicial exige internet durante a operação. Conferir permissões de dona/motorista. Se a rede falhar durante uma ação, não presumir sucesso nem reenviar como nova ação: consultar/recuperar o resultado pela mesma tentativa idempotente antes de continuar. Não há promessa de fila offline.
- [ ] Criar/confirmar acesso da dona e do motorista por procedimento seguro. Não enviar senha, token ou chave em chat, log, Git ou planilha.

Se qualquer destino, permissão ou recuperação estiver incerta, pare antes de cadastrar dados reais.

## Abrir a operação sem estoque presumido

1. A dona revisa cadastros, produtos, preços, dias/ordem das rotas e configurações de origem/destino. Locais ainda não confirmados ficam pendentes; não inventar retorno para terça ou quarta.
2. Definir data e hora de corte da abertura, no fuso `America/Recife`, e registrar quem conferiu os saldos físicos e financeiros.
3. Contar ovos fisicamente por local. Para início zerado, lançar saldo zero somente se a contagem confirmar zero. Se houver ovos, não iniciar como zero: contar e registrar abertura com quantidade real.
4. Custo da abertura é independente da quantidade. Se não houver documentação confiável do custo, registrar custo desconhecido/incompleto; nunca transformar custo desconhecido em zero ou calcular lucro histórico fictício.
5. Estoque de veículo inicia em zero e rota começa sem carga. Uma carga só existe após contagem e confirmação na aplicação.
6. Conferir separadamente dívidas e créditos por cliente. Sem apuração, não presumir saldo zero e não tratar saldos históricos como venda ou faturamento. Saldos de abertura não são recebimentos nem faturamento do período.
7. Registrar o caixa/banco de abertura em controle apropriado somente após conferência. O caixa do período não equivale a saldo bancário.
8. A dona confere um resumo de cadastros, itens, estoque, custos conhecidos/desconhecidos e saldos de clientes antes do primeiro movimento.

## Primeira rota assistida

Antes de iniciar, escolher uma data sem conflitar com a operação em papel e revisar cada pedido, preço, endereço e quantidade. Fazer teste com dados fictícios em ambiente de teste, nunca com movimentações fictícias misturadas ao ambiente operacional.

No dia real, a dona confirma contagem e carga; motorista confere rota atribuída e hodômetro inicial; motorista registra cada entrega ou motivo de não entrega; ao final informa hodômetro, sobra e perda; a dona confere fisicamente retorno e divergências antes de reconciliar/encerrar. Não registrar entrega parcial como venda integral. Parada operacional não é venda.

Anotar data de serviço, responsáveis, IDs de eventos e divergências sem copiar contatos, comprovantes, senhas ou conteúdo sensível para logs/documentação. Conferir estoque da granja e veículo, vendas, contas dos clientes e caixa após a conciliação. Divergência física que torne o saldo ou a carga seguinte inválidos bloqueia essa carga até a conferência; divergência financeira fica registrada e é tratada pela dona, sem bloquear automaticamente estoque válido.

## Critério de conclusão

Marcar a primeira rota como concluída somente quando a conferência da dona fechar fisicamente, os saldos e eventos estiverem reconciliados e as pendências documentadas. Isso não equivale a validar rotas futuras, mapas ou períodos históricos.
