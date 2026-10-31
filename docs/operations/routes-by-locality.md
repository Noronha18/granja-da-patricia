# Roteiros por localidade

Regra confirmada pelo usuário em 2026-10-30: as rotas de cada dia seguem os bairros. Cada cliente recebe uma única vez por semana. Segunda-feira é viagem/coleta, sem entregas. Nenhuma proposta de agrupamento muda automaticamente o dia de um cadastro ou resolve nome repetido.

## Proposta inicial privada

Arquivo acessível: `Documentos/Granja-Patricia/Roteiros-por-bairro-2026-10-30.html`. Abre localmente no navegador, com busca, bairros e endereços recolhíveis. Não carrega mapas, fontes, scripts ou dados de serviços externos. Contém dados reais e não deve entrar em Git ou em links públicos. O JSON detalhado e o builder ficam no diretório privado da migração.

Após a correção de uma entrega semanal:

| Dia | Entregas aptas | Endereços base agrupados | Ovos nos padrões |
| --- | ---: | ---: | ---: |
| Terça | 83 | 67 | 2.640 |
| Quarta | 226 | 127 | 7.140 |
| Quinta | 244 | 163 | 6.885 |
| Sexta | 147 | 39 | 4.755 |
| Total | 700 | 396 | 21.420 |

Os 685 registros em conferência não participam desta prévia. As contagens não representam distância, duração, viabilidade de carga ou paradas já geocodificadas.

Núcleos principais observados na planilha, usados somente como proposta inicial:

- Terça: Intermares, Ponta de Campina, Poço e Camboinha, em Cabedelo.
- Quarta: Miramar, Brisamar, Bairro dos Estados, Expedicionários, Castelo Branco, Tambauzinho, Pedro Gondim e Torre.
- Quinta: Manaíra, Tambaú e Cabo Branco.
- Sexta: Altiplano.

Bairros fora desses núcleos aparecem como secundários para revisão, sem deslocar clientes para outro dia. Há 22 entregas com alerta de cidade/bairro/número na proposta; esses alertas podem coexistir com o alerta de setor secundário. Grafias/acentos são normalizados apenas na chave de agrupamento. Endereço original permanece visível e não é sobrescrito.

## Agrupamento e limites

O agrupador usa cidade/bairro, depois rua e número. Apartamentos, clientes, observações e quantidades continuam individuais. Número ausente/não padronizado não permite juntar registros como se fossem o mesmo edifício. Identificador duplicado ou dia fora de terça a sexta é recusado.

A ordem preliminar coloca os núcleos principais antes dos secundários e preserva a primeira ocorrência da origem dentro desses blocos. Isso **não é otimização geográfica ou viária**. Falta informar origem e chegada de cada dia para definir o sentido e avaliar as ruas. Os endereços ainda precisam de conferência e a rotina atual de Maps aceita até 30 paradas: roteiros diários maiores exigem segmentação explícita ou uma ampliação revisada, nunca descarte silencioso de entregas. Não há cálculo de distância/tempo nesta prévia.

Este início de planejamento não muda `customers.position`, templates, pedidos, rotas salvas ou banco remoto. Não houve deploy desta prévia: somente o arquivo privado e o agrupador testado foram preparados.

## Verificação

`src/features/routes/localityPlan.ts` foi exercitado com fixtures antes da geração real: agrupamento de edifício sem perder apartamentos, preservação de dias, cidades distintas, números ausentes, ordem provisória e rejeição de segunda/ID duplicado. Teste novo observado falhando antes da implementação. Builder conferiu os 700 IDs, endereços, notas e dias sem perdas. Prévia de layout/busca/escape de HTML e overflow validada em desktop/mobile somente com dados fictícios.

Referências públicas para conferência de localidades, sem envio de endereços individuais: [regiões/bairros da Prefeitura de João Pessoa](https://www.joaopessoa.pb.gov.br/servico/maparegioes/) e [cartografia municipal no plano de Cabedelo](https://sapl.cabedelo.pb.leg.br/media/sapl/public/anexonormajuridica/2024/43/lei_no_2.390-2024-anexo__plano_municipal_de_gestao_integrada_residuos_solidos.pdf). Nomes de bairros não substituem geocodificação de cada endereço nem confirmação humana de sua localidade.
