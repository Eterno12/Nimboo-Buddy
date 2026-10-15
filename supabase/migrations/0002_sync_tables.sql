-- Corrige a lista de tabelas aceitas por sync_records: o app envia `skins_owned` (acessórios comprados) e
-- `profile` (personagem, cor, nome), que a 0001 não listava. Sem isto o servidor recusa o lote inteiro (HTTP 400).
-- Pode rodar mais de uma vez.
alter table public.sync_records drop constraint if exists sync_records_tbl_check;
alter table public.sync_records
  add constraint sync_records_tbl_check
  check (tbl in ('tasks', 'notes', 'focus_sessions', 'achievements', 'skins_owned', 'profile', 'bond_kv', 'skins'));
