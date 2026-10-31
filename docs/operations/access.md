# Acesso administrativo

Desenvolvimento usa o Supabase local `granja-da-patricia`. Em 2026-10-29 o usuário confirmou o projeto remoto exclusivo `granja_da_patricia`, ref `<supabase-project-ref>`; vínculo e nove migrações foram verificados. Nunca usar credenciais ou banco do HUB. Consulte deploy.md para evidência e limites da publicação.

## Ambiente local

Requisitos: Node 22, npm, Supabase CLI 2.106.0 e runtime Docker compatível. Neste computador, Podman usa `export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock`. Inicie `systemctl --user start podman.socket` antes de `rtk supabase start`. O socket é serviço do runtime; todos os containers/volumes criados por este projeto usam sufixo `granja-da-patricia`.

Portas reservadas: API 56321, PostgreSQL 56322, sombra 56320, e-mail de teste 56324. Studio, Realtime, Analytics e Edge Runtime estão desativados. Storage privado está habilitado para comprovantes; upload exige validação pelo servidor. Nunca usar estas credenciais locais em produção. Restrinja acesso de rede às portas locais; o CLI pode publicar em todas as interfaces.

Copie `.env.example` para `.env.local` e preencha apenas a chave pública do projeto local. `VITE_` é conteúdo público do navegador. Chave administrativa nunca pertence ao frontend. `rtk npm ci` instala as dependências; `rtk npm run dev:local` inicia a aplicação e o adaptador local de comprovantes. Esse comando obtém as chaves locais somente em memória, sem exibi-las ou persistir secrets. `rtk npm run dev` isolado inicia o frontend, mas exige configuração de servidor para os endpoints de comprovantes. Não há inscrição pública. `auth.enable_signup=false` bloqueia cadastro; `auth.email.enable_signup=true` mantém o provedor de login e-mail ativo no GoTrue.

## Convite manual da dona e do motorista

Nesta etapa, convite significa provisionamento manual pelo administrador. Use `rtk node scripts/manage-local-user.mjs create EMAIL owner` para a dona inicial ou `... create EMAIL driver` para motorista. Forneça senha temporária por variável `TEMPORARY_PASSWORD`, obtida com leitura oculta no terminal (`read -s TEMPORARY_PASSWORD; export TEMPORARY_PASSWORD`). Não coloque senha em argumento, arquivo, commit ou mensagem de log. Limpe a variável depois (`unset TEMPORARY_PASSWORD`). Comunique a credencial por canal privado combinado com a pessoa, fora desta ferramenta.

O script verifica a URL local 56321, cria usuário confirmado via Auth administrativo e atribui `profiles.role` por cliente administrativo. Em caso de falha ao atribuir perfil, remove o usuário recém-criado. O frontend não recebe essa chave nem escolhe seu perfil. Não edite `raw_user_meta_data` para conceder acesso: a aplicação consulta `profiles` sob RLS. Cada usuário só pode ler seu próprio perfil; nenhum usuário pode escrever perfis. Perfil removido ou ausente impede entrada.

## Recuperação de acesso

Confirme a identidade por procedimento humano antes da recuperação. Localize o UUID com `rtk node scripts/manage-local-user.mjs list` e execute `rtk node scripts/manage-local-user.mjs recover UUID`, com nova `TEMPORARY_PASSWORD` obtida da mesma forma. O comando altera a senha pelo Auth administrativo. Não altera o perfil. Tokens de acesso já emitidos continuam sujeitos à validade configurada; para revogação, encerre sessões pelo procedimento administrativo de Auth. Recupere também o e-mail cadastrado por processo administrativo se necessário. Revogue acesso removendo o perfil por SQL administrativo e encerrando as sessões; não compartilhe a conta da dona.

Não existe recuperação pública nem callback de convite por e-mail nesta entrega. Para ambiente remoto separado, preparar SMTP, callback de definição de senha e fluxo de recuperação antes de convidar usuários reais. O projeto remoto próprio já foi criado pelo usuário e vinculado; usuários reais e recuperação ainda precisam de configuração. MFA da dona, backup e restauração precisam de validação antes de produção.

## Testes e idempotência

`rtk npm run test:db` executa pgTAP em PostgreSQL real; `rtk npm run test:e2e -- access.spec.ts` cria e exclui contas fictícias locais e usa login real no Chrome. `CHROMIUM_PATH` altera o executável local de Chrome. `rtk npm run db:types` gera `database.types.ts` pelo banco local. `scripts/bin/docker` é adaptação exclusiva para o CLI de tipos executar Podman, sem alterar o sistema.

Futuras funções transacionais autorizadas chamam `private.reserve_request` antes dos efeitos e `private.complete_request` depois dos efeitos, na mesma transação. Uma reserva já concluída retorna resultado para o mesmo autor/operação/payload. ID repetido com payload/operação divergente conflita; outro autor recebe acesso negado. `get_request_result` retorna `{found:false}` para ID alheio ou pendente, sem hashes/payload. Nenhum helper privado pode ser executado por `anon` ou `authenticated`. A representação JSONB ordena chaves e elimina espaços antes do hash. A função de negócio futura deve validar permissão própria e usar retorno de replay para não repetir efeitos.

## Fontes oficiais

- [CLI e runtime local](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Verificação remota do usuário](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Criação administrativa](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Recuperação administrativa](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

## Primeiro acesso remoto

Após autorização individual do administrador, `scripts/create-granja-user.mjs EMAIL owner|driver` cria somente no ref exclusivo fixo da Granja. Recebe senha com pelo menos 12 caracteres por stdin a partir de entrada oculta em terminal, nunca por argumento, chat ou arquivo. As chaves do projeto são obtidas em memória; o script confere ref/perfil, cria Auth e perfil, verifica login real e não altera contas existentes. Em falha após criação, remove somente a conta incompleta criada por essa execução. Não imprime senhas, tokens, e-mails ou respostas privadas. Não usar pipe com senha literal ou histórico de shell.
