-- Roda no SQL Editor do Supabase (projeto de teste) DEPOIS de aplicar 0001_sync.sql.
-- Cria dois usuários falsos, tenta ler/gravar como o outro e confere o merge. Desfaz tudo no fim.
begin;
  insert into auth.users (id, instance_id, aud, role, email) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@teste.local'),
    ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@teste.local');

  -- como A
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
  select public.sync_push('[{"tbl":"tasks","id":"t1","stamp":"2026-10-15T10:00:00.000Z","origin":"aa","payload":{"title":"A"}}]'::jsonb);
  select public.sync_push('[{"tbl":"tasks","id":"t1","stamp":"2026-10-15T09:00:00.000Z","origin":"bb","payload":{"title":"antigo"}}]'::jsonb);
  do $t$ begin
    assert (select payload ->> 'title' from public.sync_records where id = 't1') = 'A', 'edição mais antiga não pode vencer';
  end $t$;
  select public.sync_push('[{"tbl":"tasks","id":"t1","stamp":"2026-10-15T10:00:00.000Z","origin":"aa","deleted":true}]'::jsonb);
  do $t$ begin
    assert (select deleted from public.sync_records where id = 't1'), 'exclusão no mesmo instante vence';
  end $t$;

  -- como B: não enxerga nada de A
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
  do $t$ begin
    assert (select count(*) from public.sync_records) = 0, 'B não pode ver linhas de A';
    assert (select count(*) from public.sync_pull(0)) = 0, 'pull de B vazio';
  end $t$;
  -- B tenta gravar como A: a política bloqueia
  do $t$ begin
    begin
      insert into public.sync_records (user_id, tbl, id, stamp) values ('00000000-0000-0000-0000-0000000000a1', 'tasks', 'x', 'z');
      raise exception 'B conseguiu gravar como A';
    exception when insufficient_privilege then null;
    end;
  end $t$;
rollback;
select 'rls_check: ok' as resultado;
