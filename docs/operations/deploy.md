# Publicação do ambiente operacional

Este documento descreve uma publicação futura. A aplicação funcional não deve ser considerada publicada por existir uma prévia; a prévia pública é demonstração e não pode receber dados reais.

## Pré-condições

- Confirmar com a dona o Supabase próprio da Granja (organização, projeto e ref). Conferir o destino por identificador antes de qualquer operação remota. HUB é proibido. Não usar credenciais de outros projetos.
- Confirmar a conta Cloudflare e o Worker/site de destino. Não substituir a URL da prévia sem aprovação explícita do destino final.
- Ter migrations revisadas, permissões/RLS e Storage privado conferidos, configuração de Auth/recuperação preparada e backup/restauração ensaiados conforme runbook próprio.
- A versão inicial é online e exige internet durante a operação; conferir que a rede estará disponível no uso previsto. Após falha de rede, a aplicação deve recuperar a tentativa idempotente sem alegar sucesso antes de confirmação. Se Maps ou outro serviço pago for necessário, confirmar escopo, limites e autorização antes de ativar cobrança.
- Usar dados fictícios em verificação de publicação. Não inserir dados reais em prévia, logs, Git ou testes.

Se projeto ou organização não corresponderem ao Supabase próprio confirmado, interromper. Nunca tentar “corrigir” o destino usando o HUB.

## Sequência condicionada à existência/configuração dos recursos

Os comandos abaixo são modelos; só executá-los depois de confirmar que Supabase CLI, projeto remoto próprio, conta Cloudflare, secrets e configuração de build existem e foram revisados. Este documento não afirma que qualquer comando de deploy ou migração foi executado.

1. Registrar janela, responsável, revisão/código e destinos confirmados. Guardar refs/URLs não secretas em registro operacional autorizado.
2. Fazer backup e conferir integridade antes de alterar schema. Ver [backup e restauração](backup-restore.md).
3. Conferir identidade e destino no CLI/console, sem exibir secrets. Uma sessão autenticada no CLI não prova, sozinha, que o projeto selecionado é o correto.
4. **Condicional:** vincular apenas o projeto próprio confirmado (`rtk supabase link --project-ref <REF_CONFIRMADA>`). Inspecionar o ref resolvido imediatamente antes de qualquer migração. Se houver dúvida, parar.
5. Revisar a lista de migrations e plano de alteração. **Condicional:** aplicar migrações somente no projeto próprio confirmado (`rtk supabase db push`). Não aplicar seed ou fixtures fictícias em produção.
6. Configurar Auth: signup público desligado, redirect URLs explícitas, SMTP/recuperação e política de sessão aprovados; criar usuários individualmente pelo procedimento administrativo seguro.
7. Configurar bucket privado e políticas de Storage, se esses recursos estiverem implementados e revisados. Não tornar comprovantes públicos.
8. Configurar secrets exigidos no ambiente de destino por painel/gerenciador de secrets. Não pôr secrets em argumentos, arquivos versionados, bundle, logs ou documentação.
9. **Condicional:** publicar Worker/site na conta Cloudflare confirmada, usando o alvo explicitamente nomeado. Não publicar a partir de um contexto de conta ambíguo.
10. Executar smoke check com usuário e dados fictícios: login, leitura autorizada, tentativa negada para motorista em área de dona, fluxo não destrutivo e URL/versão esperada. Não criar venda, pagamento ou movimentação de estoque real como teste.
11. Registrar revisão, URL, migrações, evidências do smoke check, operador e horário. Guardar logs sem dados pessoais, tokens ou conteúdo de comprovantes.

## Rollback

Antes da janela, identificar procedimento por migration e plano de retorno da versão do Worker. Não apagar/recriar banco nem reverter movimentos financeiros/estoque por SQL improvisado. Se uma migration de dados falhar, parar gravações afetadas, preservar evidências sem dados sensíveis e restaurar em ambiente controlado conforme procedimento ensaiado. Reversões de eventos de negócio devem usar correções específicas da aplicação e motivo auditável.

## Situação

Destino remoto, publicação e validação de produção dependem de confirmação e preparação futuras. Este runbook é procedimento planejado, não evidência de deploy executado.

## Execução verificada — 2026-10-29

Usuário criou e indicou o projeto exclusivo `granja_da_patricia`, organização Noronha18, ref `<supabase-project-ref>`. CLI autenticado fora do sandbox e vínculo conferido. Consulta prévia confirmou zero tabelas públicas, usuários Auth e objetos Storage; portanto não havia dados operacionais a copiar antes da primeira instalação. Dry-run listou exatamente as nove migrações locais, aplicadas com sucesso sem seed/fixtures. Consulta posterior confirmou nove migrações, zero clientes/pagamentos/usuários, estoque da granja zero, nenhuma tabela pública sem RLS e bucket de comprovantes privado. Cadastro público foi desativado no painel; confirmação de e-mail continua ativa. Nenhum destino HUB foi vinculado ou alterado.

O usuário autorizou explicitamente a transferência automática protegida das chaves deste projeto para o Worker exclusivo, como exceção à proibição geral de leitura de secrets do AGENTS.md. O script `scripts/deploy-granja.mjs` fixa ref, nome e conta, valida perfis das chaves, usa memória/entrada padrão, bloqueia chave administrativa no frontend e não mostra saídas de subprocessos. Sem `--publish`, executa somente build e dry-run; `--self-test` verifica rejeição de chave malformada, perfil ou projeto diferentes com fixtures. Requer Python 3 para fornecer pipe real ao Wrangler, além de Node/Supabase/Wrangler autenticados. Não executa migração, seed nem altera contas de usuários.

### Publicação e smoke remoto

Worker funcional publicado em <url-do-worker>, conta Cloudflare fixada no wrangler.jsonc. A prévia estática foi preservada. Build e dry-run com secrets em pipe passaram; os valores não foram exibidos ou gravados em arquivos. Verificação adicional bloqueou chave administrativa no bundle do frontend.

`rtk node scripts/smoke-granja.mjs --run` passou contra o destino fixo: página HTTP 200, Auth com cadastro público desativado, login real e perfil de dona/motorista, endpoint privado de comprovantes com dona 200, motorista 403 e anônimo 401. As duas contas fictícias foram removidas no finally; nenhum cliente, pagamento ou estoque foi criado. O script é opt-in, nunca executado pela suíte local. Testes unitários locais repetidos: 101 aprovados.

Ainda pendentes: primeiro acesso real, recuperação/SMTP ou procedimento administrativo acordado, backup de produção e primeira rota assistida. Publicação técnica não equivale a prontidão operacional. A planilha não foi migrada.

Site URL do Auth ajustada e salva para a URL funcional acima; não foram autorizados redirects com wildcard. Recuperação pública/callback de definição de senha ainda não está implementada. A consulta pós-smoke deve registrar contagens finais antes de criar qualquer acesso real.

## Integração de rotas gratuita — 2026-10-29

Migração 202610290010_maps aplicada após dry-run no projeto exclusivo confirmado. Nova versão Worker publicada com Geoapify, sem chave embutida e sem contratação paga. O endpoint só chama o provedor quando a chave GEOAPIFY_API_KEY está configurada, usuário é dona, snapshot da rota é completo e reserva de uso é aprovada. Chave sendo configurada pelo usuário em terminal protegido; chamada real ainda não comprovada. Sem previsão histórica persistida ou reordenação das entregas; detalhes em maps.md.
