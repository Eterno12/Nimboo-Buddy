# F3 — App Android (casca funcional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Cada tarefa segue `superpowers:test-driven-development` (teste falha → mínimo → verde).

**Goal:** um app Android que entra na mesma conta, funciona offline e mostra/edita as tarefas sincronizadas com o PC.

**Architecture:** o app é a interface web empacotada com Capacitor. Os dados ficam num SQLite **em memória do
WebView (sql.js, WASM)** com persistência em arquivo; um adaptador com a mesma API do `node:sqlite` permite
reutilizar **sem reescrever** as migrações, os repositórios, os gatilhos de fila e o motor de sincronização.

**Tech Stack:** TypeScript, Vite, React 19, sql.js 1.15, Capacitor 8, Supabase REST (mesmo `SupabaseAuth`/`SupabaseTransport`).

**Spec:** `docs/PLANO-MOBILE.md` (F3), D55 em `docs/DECISIONS.md`.

## Global Constraints
- Reutilizar `shared/` e as classes de `electron/` que não dependem do Electron (repositórios, `SyncStore`, auth, transporte).
- Nenhum acesso a `electron`/`node:*` no código do app móvel (só em testes).
- Persistir o banco depois de cada transação (com `flush` ao pausar o app); nunca perder a fila de envio.
- Token da sessão guardado com o cofre do Android (Keystore) na parte nativa (3b); no navegador, `localStorage` só em dev.
- Opt-in igual ao PC: sem conta e sem consentimento, nada sai do aparelho.

## Review Focus
- App fechado/morto logo após uma edição: a mudança e a fila de envio devem estar no arquivo (flush no `pause`).
- Arquivo do banco corrompido ou truncado: recuperar para banco novo + `needs_full_pull`, nunca travar o app.
- Banco criado por versão mais nova do app: recusar abrir sem sobrescrever (`SchemaTooNewError`).
- Duas abas/instâncias abrindo o mesmo arquivo: uma só dona do banco por vez.
- Sem rede ao abrir: mostrar o que está guardado, sem erro bloqueante.

## Parte 3a — sem SDK (testável em Node e no navegador)

### Task 1: Adaptador SQLite compatível (`mobile/db/sqlJsDatabase.ts`)
**Files:** Create `mobile/db/sqlJsDatabase.ts`, `tests/mobileDb.test.ts`
**Interfaces:**
- Produces: `class SqlJsDatabase` com `exec(sql)`, `prepare(sql) → { get, all, run }` (parâmetros posicionais),
  `isTransaction: boolean`, `close()`, e `export(): Uint8Array`; `openSqlJs(bytes?: Uint8Array): Promise<SqlJsDatabase>`.
  Deve satisfazer o subconjunto de `DatabaseSync` usado por `migrate`, `SqliteTaskRepository`, `SqliteNotesRepository`
  e `SyncStore` (`run()` devolve `{ changes }`; linhas são objetos simples).
- [ ] Teste: migrações v1–v9 aplicam; `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` e `isTransaction`; gatilhos de fila funcionam.
- [ ] Rodar (falha) → implementar → rodar (passa) → commit.

### Task 2: Repositórios e sincronização rodando sobre o adaptador
**Files:** Create `tests/mobileRepos.test.ts`
- [ ] Teste: `SqliteTaskRepository`, `SqliteNotesRepository` e `SyncStore` sobre `SqlJsDatabase`; dois "aparelhos"
  (um `node:sqlite`, um sql.js) convergem pelo servidor falso do `syncEngine.test.ts`.
- [ ] Ajustar só o necessário no adaptador (nunca nos repositórios) → commit.

### Task 3: Persistência (`mobile/db/persistence.ts`)
**Interfaces:** `interface BlobStore { read(): Promise<Uint8Array | null>; write(b: Uint8Array): Promise<void> }`;
`openPersistedDb(store, { debounceMs }) → { db, flush(): Promise<void>, close() }`.
- [ ] Teste: grava depois da transação (debounce), `flush` grava na hora, arquivo corrompido → banco novo com
  `needs_full_pull`, versão mais nova → recusa sem sobrescrever.

### Task 4: Casca do app (`mobile/`)
**Files:** Create `mobile/index.html`, `mobile/src/main.tsx`, `mobile/src/App.tsx`, `mobile/vite.config.ts`
- Telas mínimas (a interface final é a F4): entrar (e-mail + código), lista de tarefas (criar, concluir, excluir),
  status da sincronização.
- Serviço de sincronização móvel reaproveitando `SupabaseAuth`, `SupabaseTransport`, `SyncRunner` (o que depende
  de `safeStorage` fica fora: sessão em `localStorage` no dev e Keystore na 3b).
- [ ] E2E no navegador (Electron offscreen ou Playwright-like via CDP) com servidor falso: criar, sincronizar,
  ver no PC.

## Parte 3b — com SDK (precisa de você: D3, D4)
### Task 5: Ambiente Android (no G:)
- JDK 21 e Android command-line tools + `platform-tools`, `platforms;android-35`, `build-tools;35.0.0` em `G:\Android\`.
- Variáveis `ANDROID_HOME`/`JAVA_HOME` e `docs/MOBILE.md` com os comandos.
### Task 6: Projeto Capacitor
- `npx cap add android`, ícones do Nimboo, `capacitor.config.ts` (appId `app.nimboo.mobile`).
- Plugin nativo mínimo: `SecureSession` (Keystore) e `BlobFile` (arquivo do banco no armazenamento do app).
### Task 7: Build e instalação
- `gradlew assembleDebug` → APK; instalar por USB (`adb install`) no seu celular; checklist manual de teste.
