# F2 — Motor de sincronização e conta no PC (plano de execução)

> Executar com `superpowers:test-driven-development` (teste falha → mínimo → verde → commit).
> Plano-mestre: `docs/PLANO-MOBILE.md`. Decisão: D55.

**Goal:** PC entra numa conta Supabase (e-mail + código) e sincroniza tarefas, notas e foco, com opt-in.

**Architecture:** motor puro em `shared/sync/engine.ts` com `Transport` e `LocalStore` injetados; transporte
Supabase em `electron/sync/` (fetch do processo principal); sessão no `safeStorage`; IPC + aba em Configurações.

**Tech Stack:** TypeScript, node:sqlite, Electron `net.fetch`, Supabase REST (`/auth/v1`, `/rest/v1/rpc`).

## Global Constraints
- Rede só no processo principal; token no `safeStorage`; nada sincroniza sem conta + consentimento.
- Projeto: `https://dgzzzztyfzuggxcnutfl.supabase.co` (a chave `anon` é pública, vai no app).
- Regra de conflito única: `shared/sync/merge.ts` (igual ao SQL de `supabase/migrations/0001_sync.sql`).

## Tasks
1. **Motor** (`shared/sync/engine.ts`, `tests/syncEngine.test.ts`): `syncOnce()` = baixar, aplicar, (full pull
   pendente?), enviar. Interfaces: `Transport.push(rows) → number`, `Transport.pull(since, limit) → rows`,
   `LocalStore` (SyncStore). Testes com servidor falso (regra do SQL): dois aparelhos convergem, offline,
   idempotência, exclusão sem ressurreição, sem eco, full pull antes do push.
2. **SyncStore**: cursor global, marca de "primeira sincronização", carimbo da exclusão (`tombstoneStamp`).
3. **Auth** (`electron/sync/supabaseAuth.ts`): código por e-mail (`/auth/v1/otp` + `/verify`), renovação do
   token, sessão persistida cifrada; testes com `fetch` falso.
4. **Transporte** (`electron/sync/supabaseTransport.ts`): `push`/`pull`/`wipe` via RPC com o token; erros → mensagens.
5. **Serviço + IPC** (`electron/syncService.ts`): estado (desconectado / conectado / sincronizando / erro),
   agenda a cada 60 s + após mudanças; handlers `sync:*`; gancho de teste com servidor em arquivo.
6. **Interface**: Configurações > Geral > "Conta e sincronização" (entrar, código, status, sincronizar agora,
   sair, apagar da nuvem, consentimento).
7. **E2E + docs**: dois "aparelhos" (pastas de dados) trocando dados via servidor falso; README/GUIA/D55.

## Review Focus
- Perda de dado ao reenviar após queda de rede no meio do lote (ack só até o que foi aceito).
- Token expirado durante a sincronização (renovar uma vez; senão pedir novo login sem apagar nada).
- Sair da conta não apaga dados locais; "apagar da nuvem" não apaga os locais.
- Relógio do PC muito adiantado/atrasado ao comparar edições.
