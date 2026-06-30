create or replace function public.get_server_time()
returns timestamptz
language sql
stable
as $$
  select now();
$$;