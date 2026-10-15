-- Nimboo: sincronização entre aparelhos (D55).
-- Uma tabela genérica de registros por usuário; o aparelho envia/recebe pelas funções abaixo.
-- Regra de conflito = a mesma de shared/sync/merge.ts: maior `stamp` (updated_at ISO) vence;
-- empate: exclusão vence; depois, maior `origin` (aparelho).

create sequence if not exists public.sync_seq;

create table if not exists public.sync_records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text    not null check (tbl in ('tasks', 'notes', 'focus_sessions', 'achievements', 'bond_kv', 'skins')),
  id         text    not null check (length(id) between 1 and 80),
  payload    jsonb,
  stamp      text    not null collate "C",
  origin     text    not null default '' collate "C",
  deleted    boolean not null default false,
  server_seq bigint  not null default nextval('public.sync_seq'),
  primary key (user_id, tbl, id)
);

create index if not exists sync_records_pull on public.sync_records (user_id, server_seq);

alter table public.sync_records enable row level security;

-- Cada pessoa só enxerga e altera as próprias linhas.
drop policy if exists sync_select on public.sync_records;
create policy sync_select on public.sync_records for select using (user_id = auth.uid());
drop policy if exists sync_insert on public.sync_records;
create policy sync_insert on public.sync_records for insert with check (user_id = auth.uid());
drop policy if exists sync_update on public.sync_records;
create policy sync_update on public.sync_records for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists sync_delete on public.sync_records;
create policy sync_delete on public.sync_records for delete using (user_id = auth.uid());

-- Envia um lote: [{ tbl, id, deleted, stamp, origin, payload }]. Idempotente: reenviar não muda nada.
-- Devolve o maior server_seq do usuário depois do lote (cursor para o próximo pull).
create or replace function public.sync_push(batch jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  item jsonb;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;
  if jsonb_typeof(batch) <> 'array' or jsonb_array_length(batch) > 500 then
    raise exception 'lote inválido' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(batch) loop
    insert into public.sync_records as r (user_id, tbl, id, payload, stamp, origin, deleted, server_seq)
    values (
      uid,
      item ->> 'tbl',
      item ->> 'id',
      case when coalesce((item ->> 'deleted')::boolean, false) then null else item -> 'payload' end,
      item ->> 'stamp',
      coalesce(item ->> 'origin', ''),
      coalesce((item ->> 'deleted')::boolean, false),
      nextval('public.sync_seq')
    )
    on conflict (user_id, tbl, id) do update
      set payload = excluded.payload,
          stamp = excluded.stamp,
          origin = excluded.origin,
          deleted = excluded.deleted,
          server_seq = excluded.server_seq
      where excluded.stamp > r.stamp
         or (excluded.stamp = r.stamp and excluded.deleted and not r.deleted)
         or (excluded.stamp = r.stamp and excluded.deleted = r.deleted and excluded.origin > r.origin);
  end loop;
  return coalesce((select max(server_seq) from public.sync_records where user_id = uid), 0);
end;
$fn$;

-- Baixa o que mudou depois do cursor (inclui exclusões). `max_rows` protege conexões lentas.
create or replace function public.sync_pull(since bigint, max_rows int default 500)
returns table (tbl text, id text, payload jsonb, stamp text, origin text, deleted boolean, server_seq bigint)
language sql
security invoker
set search_path = public
as $fn$
  select r.tbl, r.id, r.payload, r.stamp, r.origin, r.deleted, r.server_seq
  from public.sync_records r
  where r.user_id = auth.uid() and r.server_seq > since
  order by r.server_seq
  limit least(greatest(max_rows, 1), 1000);
$fn$;

-- "Apagar meus dados da nuvem" (botão nas configurações do app).
create or replace function public.sync_wipe()
returns void
language sql
security invoker
set search_path = public
as $fn$
  delete from public.sync_records where user_id = auth.uid();
$fn$;

revoke all on function public.sync_push(jsonb), public.sync_pull(bigint, int), public.sync_wipe() from public, anon;
grant execute on function public.sync_push(jsonb), public.sync_pull(bigint, int), public.sync_wipe() to authenticated;
