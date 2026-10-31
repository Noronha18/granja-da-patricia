# Backup e restauração

Backup de produção precisa cobrir banco/schema e dados, Auth, arquivos de Storage e políticas/configuração associadas. Um dump apenas de tabelas não é recuperação completa. O procedimento abaixo precisa ser adaptado ao plano/recursos efetivamente contratados e ensaiado antes de produção; não houve backup ou restauração de produção. O ensaio local com dados fictícios está documentado ao final.

## Bloqueios e preparação

- Confirmar que o destino é o projeto Supabase próprio da Granja. HUB é proibido. Não executar comandos remotos até confirmar organização, nome e ref do projeto.
- Confirmar recursos e suporte do plano Supabase para exportar/restaurar banco, usuários Auth e objetos Storage; verificar a documentação vigente do serviço antes de definir comandos. Não presumir que um dump SQL inclui Auth ou arquivos.
- Definir responsável, frequência, retenção (proposta inicial: cópias diárias com sete cópias retidas), criptografia, local separado do projeto e acesso mínimo. Ajustar a retenção à necessidade/capacidade confirmada.
- Manter chaves de criptografia e credenciais do backup fora do repositório e separadas dos arquivos de backup. Nunca registrar secrets em comandos visíveis, logs, Git ou notas.
- Identificar consistência temporal: coordenar snapshot/export do banco e Storage, registrar hora UTC/local, revisão de schema, contagens e manifests/checksums dos arquivos.

## Execução de backup — procedimento futuro

1. Agendar janela e confirmar espaço/cota/local privado de destino.
2. Exportar banco usando mecanismo oficial suportado no plano. Escolher comando e opções somente após confirmar na documentação vigente quais schemas, dados e objetos são incluídos; não assumir que o padrão inclui dados de aplicação. Não há comando de exportação aprovado neste runbook.
3. Exportar os dados/Auth pelo mecanismo oficial compatível com o projeto/serviço, com proteção de credenciais e tratamento de dados pessoais. Se não houver caminho suportado para exportação/restauração Auth, registrar como bloqueio de produção e definir recuperação de usuários/sessões separadamente.
4. Copiar objetos do Storage preservando caminho e metadados necessários, usando ferramenta/API suportada e credenciais protegidas. Validar quantidade/tamanho e gerar checksum por objeto/manifest. Se Storage não estiver habilitado, registrar “não configurado”, não simular evidência.
5. Guardar definições de buckets, políticas RLS/Storage, configuração de Auth e redirects em revisão controlada sem secrets. Confirmar que políticas fazem parte da cópia/reconstrução.
6. Verificar código de saída, tamanho, checksums e contagens. Criptografar e enviar para o destino separado. Aplicar retenção sem remover a última cópia conhecida como válida.
7. Registrar apenas data, responsável, escopo, resultado, contagens/checksum e localização lógica protegida. Não incluir nomes, contatos, tokens ou caminhos públicos de comprovantes.

## Restauração e prova

Ensaiar em projeto descartável isolado, nunca sobre a produção. Antes de qualquer ação, confirmar explicitamente o destino descartável; HUB permanece proibido.

1. Escolher backup e documentar revisão, hora de corte e checksums esperados.
2. Restaurar schema e dados em banco descartável usando procedimento oficial compatível com versões do PostgreSQL/CLI. Aplicar políticas RLS e funções; confirmar que grants e extensões necessárias foram recuperadas.
3. Restaurar Auth conforme suporte confirmado. Verificar quantidade de usuários/perfis sem expor identificadores em relatório público; testar login e recuperação em contas fictícias. Se usuários/senhas não puderem ser restaurados, provar procedimento alternativo de reconvite/reset antes de declarar recuperação aprovada.
4. Restaurar Storage e políticas de bucket/objetos. Comparar contagem e checksums dos arquivos.
5. Com arquivo fictício, provar que dona autorizada consegue acessar pelo fluxo privado e motorista/anônimo são negados. Não usar comprovante real como fixture.
6. Conferir relações e contagens essenciais: clientes, pedidos, eventos de estoque, vendas, pagamentos, usuários/perfis e objetos. Confirmar que saldos calculados após restauração correspondem ao corte do backup.
7. Registrar duração, discrepâncias, verificações aprovadas/reprovadas, responsável e correções. Uma falha reprova o ensaio; corrigir e repetir antes da produção.

## Recuperação operacional

Em incidente, interromper alterações que possam ampliar divergência, preservar logs técnicos sem dados sensíveis e identificar o último backup íntegro. Restaurar primeiro em ambiente isolado e comparar antes de direcionar usuários. Decidir ponto de recuperação e possível perda de eventos com a dona. Não sobrescrever produção até haver plano aprovado, cópia preservada e destino confirmado.

## Critério de prontidão

Produção fica bloqueada até um ensaio documentado demonstrar recuperação do banco, Auth, Storage e políticas, incluindo acesso permitido/negado ao arquivo fictício. A existência de arquivo de backup ou sucesso de dump não satisfaz esse critério.

## Verificação local em 2026-10-29

Um ambiente descartável separado (`granja-coldcheck-20261029`, portas 573xx) iniciou as nove migrações do zero e passou 399 assertions SQL reais. As funções públicas/privadas foram comparadas por assinatura e hash com a stack de desenvolvimento. Uma função privada obsoleta criada durante a implementação foi removida; o histórico local foi alinhado somente após essa comparação. O ambiente descartável foi parado, sem resetar a stack de desenvolvimento e sem alterar o HUB.

Isso verifica reprodução do schema e testes sobre base limpa. Não equivale a ensaio completo de restauração de produção com Auth e arquivos. Esse ensaio continua como pré-condição da publicação operacional.

## Ensaio de restauração com dados fictícios — 2026-10-29

`tests/recovery.test.ts` passou contra duas stacks locais separadas: origem Granja na porta 56321 e destino descartável na porta 57321. O cenário criou somente dois acessos fictícios, um cliente, um pagamento e um PNG privado. Os registros Auth/identidades/perfis, dados financeiros, metadados, livro de idempotência e bytes foram arquivados com AES-256-GCM em arquivo temporário com permissão 0600; a chave permaneceu somente em memória. As fixtures da origem foram removidas antes da restauração.

No destino, o teste provou login real com os mesmos IDs/senhas fictícias, cliente/pagamento únicos, repetição do UUID sem duplicar caixa e crédito de 12345 centavos. Restaurou o comprovante com checksum igual, download privado como attachment permitido à dona e acesso negado a motorista/anônimo, inclusive por Storage/RLS. Origem, destino e arquivo temporário foram limpos no `finally`. Nenhuma chave de API, token de sessão ou senha legível entrou no arquivo.

Com o ambiente descartável previamente preparado com as nove migrações, configuração própria e portas 573xx, reproduzir:

```bash
rtk env DOCKER_HOST=unix:///run/user/1000/podman/podman.sock npm run test:recovery
```

O teste recusa URLs/containers diferentes dos dois alvos locais definidos. Ele não inicia serviço, não cria recurso remoto e não é um comando de backup de produção. O cenário não cobre MFA real, provedores externos de Auth nem toda cardinalidade de dados futuros. Rotina diária, retenção, criptografia, armazenamento separado e ensaio do ambiente real continuam a ser configurados antes da operação em produção.
