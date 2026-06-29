# Jogo de Biologia

Aplicacao web estatica com quiz solo e multiplayer usando Supabase.

## Deploy em Vercel + Supabase

1. No Supabase, execute os SQLs nesta ordem:
   - `supabase/get_server_time.sql`
   - `supabase/submit_answer.sql`

2. No Supabase, confirme que Realtime esta ativo para as tabelas:
   - `rooms`
   - `players`

3. Em `js/config.js`, confira:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

   A anon key pode ficar no frontend. A seguranca das escritas multiplayer fica nas RPCs `security definer` do Supabase, nao em updates diretos do navegador.

4. Na Vercel:
   - Framework Preset: `Other`
   - Build Command: vazio
   - Output Directory: `.`
   - Install Command: vazio

O arquivo `vercel.json` ja configura rotas SPA e `Cache-Control: no-cache` para evitar que navegadores usem JS antigo depois de atualizar as RPCs.

## Execucao local

```bash
python -m http.server 8000
```

Acesse:

```text
http://127.0.0.1:8000/
```

## Multiplayer

O frontend hospedado na Vercel apenas chama RPCs do Supabase:

- `create_room`
- `join_room`
- `start_game`
- `submit_answer`
- `advance_question_if_ready`
- `ensure_question_timer`
- `leave_room`
- `update_nickname`
- `get_server_time`

As perguntas avancam somente quando todos os players da sala responderam. O timer de cada questao usa `rooms.question_started_at` e `rooms.question_time`, ambos definidos pelo servidor Supabase.
