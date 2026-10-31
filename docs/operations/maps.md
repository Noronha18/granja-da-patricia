# Navegação e estimativa de percurso

## Implementação em 2026-10-29

O usuário autorizou Geoapify Free como alternativa ao cálculo pago do Google. O Google Maps continua disponível por links de navegação, sem chave ou cobrança da API Google.

A dona consulta distância e duração da rota salva em Entregas, em draft/ready. O servidor valida sessão e perfil, consulta todas as paradas ativas na ordem salva, inclui origem/chegada e exclui apenas pedidos suspensos. Endereço ausente, destino não confirmado ou mais de 30 paradas bloqueiam o cálculo; nenhuma parada é descartada silenciosamente. Geocodificação exige um único candidato preciso, confiança mínima de 0,9 e tipo building/amenity. Cidade ou rua sem localização precisa ficam pendentes.

O servidor envia somente endereços ao Geoapify, depois coordenadas, sem nomes, contatos ou dados financeiros. Essas informações passam a ser tratadas pelo provedor conforme sua política de privacidade. Resultados são estimativas, sem trânsito em tempo real ou atendimento por parada. A resposta é no-store e a interface mantém o resultado apenas em memória; edição, atualização ou mudança de versão invalida a consulta. Não existe previsão histórica congelada, comparação de desvio ou otimização automática da ordem nesta entrega. Isso substitui apenas a parte de persistência de previsão Google da Task 3 antiga, cuja licença permanecia pendente.

## Limites e resiliência

RPC get_route_distance_context retorna snapshot autorizado e reserva atomicamente uma consulta. Limite global da aplicação: 20 cálculos por dia UTC e intervalo mínimo de um minuto, inclusive após falha do provedor. Nenhum resultado externo é gravado no banco. A chave fica exclusivamente no secret GEOAPIFY_API_KEY do Worker, nunca no frontend.

Geocodificação e roteamento usam chamadas sequenciais espaçadas em pelo menos 210 ms, prazo total de 25 segundos e respostas limitadas a 2 MB. Grupos de até dez pontos compartilham somente o endpoint; todos os trechos são somados. Endereços repetidos podem reutilizar geocodificação dentro da mesma consulta, mas continuam sendo paradas distintas. Depois do cálculo, novo snapshot/versionamento verifica alteração ou início da rota. Falhas não retornam soma parcial, chave, URL do provedor ou payload privado. Entregas e navegação permanecem independentes do cálculo.

O plano Free oferece 3.000 créditos/dia, permite uso comercial com atribuição e não exige cartão. Créditos não equivalem a quantidade de rotas: geocodificação, cada ligação entre pontos e trechos longos consomem créditos. O limite interno não substitui acompanhar uso de outros aplicativos na mesma conta. Não contratar plano pago ou ativar upgrade automático.

## Ativação

Criar conta/projeto Free no Geoapify pelo próprio usuário, que aceita os termos e gera a chave. Inserir a chave pelo terminal protegido com `rtk node_modules/.bin/wrangler secret put GEOAPIFY_API_KEY`, neste repositório e na conta Cloudflare confirmada. Não enviar chave ao chat ou gravar em arquivo. O deploy preserva secrets existentes. Sem chave, o endpoint responde MAPS_NOT_CONFIGURED sem chamar o provedor; a interface explica a pendência.

Os testes usam provedor simulado e fixtures locais; não enviam endereços reais. Uma consulta real deve ser feita após chave configurada e endereços operacionais conferidos. A qualidade dos endereços e cobertura no trajeto precisam de avaliação humana; nenhuma chamada externa real foi comprovada nesta implementação.

## Fontes oficiais verificadas

- https://www.geoapify.com/pricing/
- https://apidocs.geoapify.com/docs/routing/
- https://apidocs.geoapify.com/docs/geocoding/
- https://www.geoapify.com/privacy-policy/
- https://www.geoapify.com/terms-and-conditions/
- https://developers.google.com/maps/documentation/urls/get-started

## Evidência de implementação

Testes do adaptador/Worker cobrem login, perfil, chave ausente, payload inválido, conflito durante cálculo, limites, falha do provedor, ambiguidade, centro de cidade rejeitado, paradas repetidas e soma entre grupos. pgTAP real verifica autorização, snapshot, conflito de versão, cooldown/dia, endereço ausente e bloqueio após início. E2E mobile verifica resultado, atribuição, falha de configuração sem bloquear preparação e necessidade de salvar alterações. Nenhum teste envia dados ao Geoapify real.

Validação final: build/check aprovado; suíte completa npm test passou com 111 testes unitários, 408 assertions SQL, concorrência real, administrativo, Worker/Auth/Storage e 34 E2E. Telas inspecionadas em 390 px e 1440 px. Smoke remoto aprovado sem chamada ao Geoapify; consulta posterior preservou um acesso/perfil real e confirmou zero clientes/pagamentos/objetos. Nenhum dado operacional real foi alterado.

### Ativação e diagnóstico

Secret GEOAPIFY_API_KEY confirmado por nome no Worker. A primeira chamada real entre endereços públicos de museus falhou com MAPS_UNAVAILABLE; fixtures removidas e dados preexistentes preservados. O adaptador passou a distinguir HTTP 401/403 do provedor (MAPS_KEY_REJECTED) e 429 (MAPS_PROVIDER_LIMIT), sem devolver payload, URL ou chave. Teste específico observado falhando antes da mudança e aprovado depois; 112 unitários passaram. Estes códigos identificam configuração/cota, sem alegar cálculo bem-sucedido.

Causa da falha real identificada e reproduzida em workerd/Miniflare: Workers rejeita RequestInit.redirect=error com TypeError. Corrigido para manual; respostas 3xx continuam recusadas antes de ler conteúdo, sem seguir destinos que poderiam expor a chave. scripts/test-maps-runtime.mjs exercita o adaptador completo no runtime Workers com provedor sintético. O teste foi observado falhando antes e passando depois; agora integra a preparação obrigatória do deploy. Diagnósticos devolvem apenas códigos/etapa, nunca a mensagem bruta do runtime.

Locais também aceitam coordenadas explícitas latitude,longitude em graus decimais com ponto. Limites ±90/±180 são validados; esses pontos seguem diretamente ao roteamento, sem geocodificação nem aproximação por cidade/rua. Não obter coordenadas de dados Google sujeitos a restrições para reutilizá-los em outro provedor; usar informação própria/autorizada. A verificação de roteamento externo usa os pontos públicos do exemplo oficial Geoapify (https://apidocs.geoapify.com/docs/routing/), sem dados de clientes. Os endereços dos museus não passaram pelo critério de precisão, o que não deve ser confundido com falha da chave.

### Consulta real aprovada

Em 2026-10-29, scripts/smoke-maps-live.mjs --run passou no Worker publicado com a chave protegida já salva: 3177 metros e 375 segundos entre as coordenadas públicas do exemplo oficial Geoapify. Fixtures de conta/perfil/rota/paradas foram removidas, sem alterar dados preexistentes. Isso comprova autenticação da chave e roteamento real; não comprova precisão de endereços da Granja, ainda ausentes. Endereços sem correspondência única e precisa continuam bloqueados; inserir coordenadas próprias/autorizadas é alternativa explícita. Testes finais unitários: 114 aprovados, além do teste real no runtime Workers e build/dry-run obrigatórios no deploy.
