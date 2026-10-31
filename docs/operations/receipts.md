# Comprovantes privados

O recebimento financeiro existe independentemente do anexo. Se o arquivo falhar, o pagamento continua válido; repetir o anexo não deve criar outro pagamento.

## Desenvolvimento local

A configuração `supabase/config.toml` habilita Storage somente no projeto local `granja-da-patricia`. O limite global é 5 MiB; o bucket `payment-receipts` restringe cada arquivo a **5.000.000 bytes**. Habilitar o serviço antes de aplicar a migration 006 em uma base nova. Não executar reset para habilitar Storage ou reaplicar tabelas já existentes.

Com a stack isolada saudável, usar `rtk npm run dev:local`. Esse comando consulta o status local, confere a URL `http://127.0.0.1:56321` e transmite as chaves somente ao processo de desenvolvimento. Não imprime nem grava as chaves. O adaptador Vite executa o mesmo handler usado pelo Worker. `rtk npm run test:storage` exercita o Worker contra Auth, PostgreSQL e Storage locais reais, com fixtures identificadas.

## Configuração do servidor

O Worker precisa de `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. Configurar esses valores somente no ambiente seguro do servidor após confirmar o projeto exclusivo da Granja. A chave administrativa nunca usa prefixo `VITE_`, nunca aparece no bundle do navegador e não deve ser registrada em logs ou documentação. Esta configuração não autoriza publicação e não pode usar o Supabase do HUB.

O Worker valida o token com `getUser` e consulta o perfil associado. Somente a dona passa à operação administrativa. O bucket é privado; usuários autenticados não têm política de INSERT, UPDATE ou DELETE em `storage.objects`, portanto não podem contornar a validação enviando arquivos diretamente ao Storage.

## Contrato HTTP

Todas as chamadas exigem `Authorization: Bearer <token da sessão>` e não devem registrar esse cabeçalho.

- `POST /api/payments/:paymentId/receipt`: corpo binário do arquivo, `Content-Type` JPEG/PNG/PDF e `X-Request-Id` com UUID estável para a tentativa. Retorna `{receiptId}`; 201 no vínculo novo e 200 na repetição concluída.
- `GET /api/payments/:paymentId/receipts`: lista somente anexos concluídos do pagamento.
- `GET /api/receipts/:receiptId/download`: retorna `{url,expiresIn:300}`. O link é temporário e usa download privado com nome seguro; não renderizar o anexo em iframe, HTML ou SVG.
- `GET /api/receipts/orphans`: lista caminhos privados ainda sem vínculo concluído.
- `DELETE /api/receipts/orphans`: corpo JSON `{path}` para remover um órfão. Repetir a limpeza é permitido. Arquivo já vinculado não pode ser removido por essa operação.

O servidor lê no máximo 5.000.000 bytes e confere assinatura e encerramento de JPEG, PNG ou PDF, além do MIME declarado. MIME sozinho não comprova o conteúdo. O arquivo recebe caminho gerado pelo servidor; o nome fornecido pelo usuário não define o caminho.

## Falhas e concorrência

A tentativa é vinculada antecipadamente ao pagamento com estado `pending`, hash SHA-256 e caminho determinístico. Upload concluído passa a `ready` somente depois de confirmar o objeto e seus metadados. Repetir UUID com arquivo ou pagamento diferente retorna conflito.

Se houver falha no vínculo, o objeto permanece privado e pendente. A mesma tentativa pode concluir o vínculo; alternativamente, a dona pode listar e limpar o órfão. A limpeza primeiro registra um encerramento `removed` no banco e depois remove o objeto. Um upload ou vínculo atrasado não consegue publicar esse arquivo; se seus bytes chegarem depois da limpeza, continuam listados como órfãos para repetir a remoção.

Não registrar contatos, conteúdo de anexos, tokens, chaves ou URLs assinadas nos logs. Não tratar upload, download ou falha de anexo como confirmação ou cancelamento de recebimento.
