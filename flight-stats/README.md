# Flight Stats

Caderneta digital pessoal e análise da experiência de voo. Next.js 16 + Supabase + Vercel.

## Dados históricos

Os 111 registos realizados na Sevenair foram importados uma única vez do FlightLogger para `public.flight_stats_flights` em outubro de 2026. A aplicação lê os dados desta tabela por `GET /api/flights` e **não volta a chamar a API do FlightLogger**. A data original de importação e o perfil encontram-se em `public.flight_stats_metadata`.

Cada linha tem um `id` estável, `date`, `registration`, `source` (`flightlogger` ou `manual`) e o payload integral da caderneta em JSONB. Os antigos dados ADS-B encontram-se em `flight_stats_adsb_points` e `flight_stats_track_refs`.

## Acrescentar voos

O botão **Adicionar voo** abre o formulário com rota, aeronave, função, tempos, períodos de dia/noite, descolagens, aterragens e observações. O formulário envia um `POST /api/flights` com a chave de edição no header `x-flight-stats-editor-key`. No servidor, a variável `FLIGHT_STATS_EDITOR_KEY` é comparada de forma constante com a chave inserida e usada nas operações Supabase.

A tabela tem RLS de leitura pública (mantendo a visibilidade do dashboard atual) e uma política de inserção restrita a entradas manuais com o hash da chave enviado como header à API do Supabase. **Nunca colocar a chave de edição nem uma chave `service_role` em variáveis `NEXT_PUBLIC_*`.**

## Trajetórias ADS-B

O modal de mapa lê as posições arquivadas no Supabase, privilegiando `flight_id` e recorrendo à matrícula + janela temporal. Mostra linhas ADS-B disponíveis e, apenas quando plausível, liga pequenas falhas de cobertura com segmentos azuis tracejados identificados como estimados. Cobertura incompleta é indicada em vez de ocultar silenciosamente o mapa. Nunca devem ser apresentadas estimativas como posições GPS confirmadas.

## Desenvolvimento

```bash
npm ci
npm run build
npm run lint
```

Configurar na Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `FLIGHT_STATS_EDITOR_KEY`. As antigas variáveis do FlightLogger já não são necessárias.
