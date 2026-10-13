# Arquitetura

Descreve **como** o código está organizado e como os fluxos funcionam. O **porquê** das escolhas está em
`DECISIONS.md`; as **regras** de segurança e convenções, em `CLAUDE.md`; o comportamento visível ao
usuário, no `README.md`.

## 1. Visão geral

```
┌──────────────── processo principal (electron/) ────────────────┐
│ main.ts        ciclo de vida, menu, bandeja, cursor global      │
│ windowMode.ts  dono da janela do mascote (ilha ↔ flutuante)     │
│ windows.ts     fábrica de janelas (preferências seguras)        │
│ settingsStore  settings.json       tasksService  IPC de tarefas │
│ tasks/*        SQLite, migrações, repositório, desfazer         │
└───────────────▲───────────────────────────────▲─────────────────┘
        IPC tipado (shared/ipc.ts)      eventos main → renderer
┌───────────────┴───────────────────────────────┴─────────────────┐
│ preload.ts   contextBridge → window.mochi (operações específicas) │
├──────────────────────────────────────────────────────────────────┤
│ renderer (src/)  uma página; hash #mascot | #panel                │
│  features/mascot  mascote SVG + máquina de estados + MascotView   │
│  features/island  presença, controlador da ilha, conteúdo         │
│  features/tasks   lista, rascunho, tema       features/panel      │
└──────────────────────────────────────────────────────────────────┘
```

Duas janelas: a **do mascote** (transparente, sempre no topo, `#mascot`) e o **painel** (janela comum
de 380×520, `#panel`, criada sob demanda; fechar só oculta).

## 2. Mapa de pastas

| Caminho | Responsabilidade |
|---|---|
| `electron/main.ts` | Instância única, menu de contexto/bandeja, arraste (cursor lido no main), difusão do cursor a ~25 Hz, encerramento |
| `electron/windowMode.ts` | Apresentação da janela do mascote, ciclo ilha→canto→ilha, forma (`setShape`), foco, persistência da posição |
| `electron/windows.ts` | `createMascotWindow`, `createPanelWindow`, `secureWebPreferences`, bloqueio de navegação |
| `electron/preload.ts` | Única superfície exposta ao renderer (ver §4) |
| `electron/settingsStore.ts` | `settings.json`: leitura tolerante, escrita atômica com debounce |
| `electron/tasksService.ts` | Liga repositório + agendador ao IPC; difunde mudanças; limpeza horária |
| `electron/tasks/` | `database.ts` (abrir/recuperar), `migrations.ts`, `sqliteTaskRepository.ts`, `removalScheduler.ts` |
| `shared/` | Contratos usados por main, preload e renderer: `ipc.ts`, `tasks.ts`, `settings.ts`, `presentation.ts`, `geometry.ts` |
| `src/features/mascot/` | `Mascot.tsx` (SVG), `mascot.css`, `mascotController.ts` (estados), `useMascot.ts`, `MascotView.tsx` |
| `src/features/island/` | `usePresence.ts`/`presence.ts` (entrada/saída), `islandController.ts`, `useIsland.ts`, `IslandContent.tsx`, `island.css` |
| `src/features/tasks/` | `TasksView.tsx`, `useTasks.ts`, `draftStore.ts`, `tasks.css` |
| `src/features/panel/` | `PanelView.tsx` (hoje só hospeda `TasksView`) |
| `scripts/` | `dev.mjs` (Vite + Electron), `build-electron.mjs` (esbuild → `dist-electron/*.cjs`) |
| `tests/` | Testes unitários (`*.test.ts`), `helpers/`, `e2e/tasks-ui.e2e.mjs` |

## 3. Janela do mascote e suas apresentações

Existe **uma** `BrowserWindow` do mascote, criada por `windowMode.ts`, e um **único renderer**
(`MascotView`). O estado do mascote (`mascotController`: expressão, humor, timers) vive nesse renderer,
por isso trocar de apresentação não o reinicia.

| Apresentação | Janela | Quando |
|---|---|---|
| **ilha** | 352×380 fixa, topo-centro da área útil do monitor; forma = pílula 176×58 (recolhida), 352×174 (aberta, home) ou 352×380 (aberta, tarefas); não focável quando recolhida | modo preferido `island` e ilha à vista |
| **flutuante** | 240×240, arrastável, posição lembrada | modo preferido `floating`, ou "Mochi no canto" (*away*) |

`settings.mode` (`island` padrão | `floating`) é a **preferência**. Em `island` há um estado de execução
`away` (ilha escondida, Mochi solto num canto): usa o layout flutuante, mas não persiste a posição.

### Fluxos principais

- **Abertura:** `createWindowModeManager` lê `settings`, calcula os limites (`shared/geometry.ts`), cria a
  janela (invisível) e define `pendingEntrance = drop`. O renderer pede `getPresentation`, desenha, confirma
  com `presentationApplied`; só então a janela é revelada e a ilha desce (Web Animations em `presence.ts`).
- **Expandir/recolher:** clique → `islandController.expand()` → `islandOpen` (main libera a forma cheia e
  foca) → o visual anima `clip-path` → ao fim de recolher (`transitionend`) → `islandClosed` (forma volta a
  compacta). A janela **nunca** é redimensionada.
- **Tela de tarefas na ilha:** `islandExtent('tasks')` aumenta a forma **antes** de animar; ao voltar,
  `islandExtent('home')` encolhe **depois** da animação.
- **Esconder → canto:** ilha recolhida, sem hover/atividade por 3 s (6 s na chegada) → `exitUp` anima →
  `islandHidden` → `goAway()` troca para 240×240 num canto inferior (alterna esquerdo/direito) com entrada
  `slide`.
- **Voltar à ilha:** `onCursor()` (amostra do main) detecta cursor na borda superior do monitor, perto do
  centro, por ~250 ms (após 1,5 s de carência) → `showIsland()` envia `leave`, espera `leaveDone` → ilha
  entra com `drop`. O menu "Mostrar ilha" faz o mesmo.
- **Trocar de modo (menu):** `setMode()` com a janela em opacidade 0 durante a troca; o renderer confirma o
  layout (`presentationApplied`) antes de revelar.
- **Arraste:** `dragStart/Move/End` sem coordenadas; o main lê `screen.getCursorScreenPoint()`. Só vale na
  apresentação flutuante; o main também recusa se for ilha.
- **Cursor global:** a cada 40 ms o main envia `{x,y}` relativo à janela (só quando muda e se visível). O
  renderer deriva olhar, proximidade e susto; distâncias são normalizadas pela escala do SVG
  (`REFERENCE_SCALE`) para a ilha pequena e o mascote grande se comportarem igual.
- **Posição:** `move` → `persistPosition()` só grava se o usuário mudou (não fixa a posição padrão) e nunca
  na ilha ou em *away*.

### Estados do mascote

`mascotController.ts` (puro): `idle, happy, curious, sleepy, celebrate, surprised, grabbed, giggle,
annoyed, stretch, yawn, lookaround`, com prioridades (`STATE_PRIORITY`), durações e timers de
piscada/comportamentos/sono. Humor (`low|mid|high`) deriva de um "afeto" em memória que decai com o tempo.
A aparência é puro CSS por `data-state`/`data-mood` em `Mascot.tsx` + `mascot.css`: todas as partes do rosto
ficam no DOM e só trocam de opacidade (transições suaves, sem remontar).

## 4. IPC e preload

Contrato único em `shared/ipc.ts` (canais `IPC` + interface `MochiApi`). O preload implementa `MochiApi`
sem expor `ipcRenderer` nem o objeto `event`.

| Canal | Direção | Tipo | Uso |
|---|---|---|---|
| `mascot:drag-start/move/end` | R→M | send | arraste (sem coordenadas) |
| `mascot:show-menu` | R→M | send | menu de contexto nativo |
| `mascot:cursor` | M→R | evento | posição do cursor relativa à janela |
| `presentation:get` | R→M | invoke | apresentação atual + entrada pendente (uma vez) |
| `presentation:changed` | M→R | evento | nova apresentação |
| `presentation:applied` | R→M | send | layout desenhado; main revela a janela |
| `island:open` / `island:extent` | R→M | invoke | forma cheia / extensão (home, tasks) |
| `island:closed` | R→M | send | recolheu; forma compacta |
| `island:toggle` | M→R | evento | alternar pelo menu |
| `island:hidden` | R→M | send | ilha escondida; Mochi vai ao canto |
| `presence:leave` / `presence:leave-done` | M→R / R→M | evento / send | Mochi sai de cena |
| `tasks:list/create/complete/reopen` | R→M | invoke | operações de tarefa |
| `tasks:schedule-remove` / `tasks:undo-remove` | R→M | invoke | excluir com desfazer |
| `tasks:changed` | M→R | evento | recarregue a lista |
| `tasks:completed` | M→R | evento | só ao concluir (dispara `celebrate`) |

Validação: handlers do mascote exigem `sender === window.webContents`; os de tarefas (`tasksService`)
exigem janela do app + quadro principal + URL do app (`file://` ou servidor de desenvolvimento) e validam
argumentos (`validateTitle`, `isTaskId`). Respostas de tarefas são `TaskResult` (sem exceções pelo IPC).

## 5. Tarefas e SQLite

Camadas (de baixo para cima):

1. `electron/tasks/database.ts` — abre `userData/data/mochi.db`; `busy_timeout=3000`, `WAL`,
   `synchronous=NORMAL`, `foreign_keys=ON`; aplica migrações; arquivo corrompido → renomeado
   `mochi.db.corrupt-<data>` e banco novo; versão mais nova que o app → `SchemaTooNewError` (não toca).
2. `migrations.ts` — lista ordenada; cada migração roda em transação junto com `PRAGMA user_version`.
   **v1:** `tasks(id TEXT PK, title, completed 0|1, created_at, completed_at, updated_at)` `STRICT`, `CHECK`
   (concluída ⇔ tem `completed_at`), índice `(completed, completed_at)`.
3. `sqliteTaskRepository.ts` — implementa `TaskRepository` (`shared/tasks.ts`): escritas em
   `BEGIN IMMEDIATE`; retenção (30 dias de `completed_at`) aplicada em `list`, `get` e a cada mutação;
   `notify()` chama `onChange` **depois** do commit e nunca propaga falha do ouvinte.
4. `removalScheduler.ts` — exclusão com desfazer: agendar não apaga; o `DELETE` ocorre após 5 s
   (`UNDO_WINDOW_MS`); `undo` cancela o timer **antes** de consultar o banco; `dispose()` (ao sair)
   cancela tudo sem apagar; `snapshot()` esconde as pendentes e descarta as já expiradas.
5. `tasksService.ts` — IPC, `broadcast()` (isola falha por janela), limpeza horária; `tasks:list` devolve
   `TaskSnapshot` (`active`, `completed`, `pendingRemovals`).
6. Renderer — `useTasks` (cópia para desenhar; recarrega em `tasks:changed`), `draftStore` (rascunho em
   memória, retém a ilha aberta), `TasksView` (campo com contador, erros de operação, desfazer, rodapé fixo,
   `aria-live`).

**Fonte de verdade:** o SQLite. O renderer nunca decide estado definitivo; qualquer janela recarrega ao
receber `tasks:changed`.

## 6. Relação mascote × ilha × painel × tarefas

- O **mascote** não conhece tarefas. `MascotView` apenas assina `tasks.onCompleted` → `celebrate()`.
- A **ilha** hospeda `IslandContent`: atalhos (home) ou `TasksView variant="island"`. O rascunho segura a
  ilha aberta (`setHold`) mas não a impede de recolher por Esc/clique/foco.
- O **painel** (`PanelView`) renderiza `TasksView variant="panel"` na janela comum; é o único lugar das
  tarefas no modo flutuante.
- Ilha e painel são janelas/processos de renderização separados: compartilham dados só pelo main.

## 7. Persistência

| O quê | Onde | Notas |
|---|---|---|
| Preferências | `userData/settings.json` | `{version:2, mode, floating:{x,y}|null, displayId}`; v1 migra para `island`; escrita atômica; corrompido → `.bak` |
| Tarefas | `userData/data/mochi.db` | ver §5 |
| Rascunho, humor, estado do mascote | memória do renderer | não persistem entre execuções (decisão) |

`userData` = `%APPDATA%\mochi-desktop` (ou o valor de `--user-data-dir`).

## 8. Build e testes

- `tsc --noEmit` (um `tsconfig.json` cobre `src`, `electron`, `shared`, `tests`) → `vite build`
  (renderer, `base: './'`, saída `dist/`) → `scripts/build-electron.mjs` (esbuild empacota `main` e
  `preload` em CJS: `dist-electron/main.cjs` e `preload.cjs`; `electron` externo).
- Em dev, `scripts/dev.mjs` sobe o Vite e o Electron com `VITE_DEV_SERVER_URL`.
- Testes: `node --test` sobre `tests/**/*.test.ts` (ver convenções em `CLAUDE.md`); e2e em
  `tests/e2e/tasks-ui.e2e.mjs` dirige o app real por CDP com `--user-data-dir` temporário.

## 9. Pontos de atenção para futuras alterações

- **Novo canal IPC:** `shared/ipc.ts` (canal + `MochiApi`) → `preload.ts` → handler no main com validação de
  remetente → teste. Não ampliar a superfície sem necessidade.
- **Mudou tamanho/forma da ilha:** `shared/presentation.ts` **e** `island.css` (clip-paths, alturas) juntos;
  conferir `islandShape()` e o e2e.
- **Nova tabela/coluna:** nova migração + teste "evoluir sem perder dados"; avaliar impacto na futura
  sincronização (ver `ROADMAP.md`).
- **Nova seção na ilha** (timer, notas): o conteúdo vive em `IslandContent`; o extent da forma é por tela
  (`IslandExtent`); a janela fica com tamanho fixo, então telas maiores exigem rever `ISLAND_WINDOW_SIZE`.
- **Comportamento do mascote:** manter lógica em `mascotController` (puro) e apresentação em CSS por
  `data-state`; um estado novo exige prioridade, duração e regras de rosto no CSS.
- **Timers ou lógica que precisam sobreviver à ilha recolhida/oculta** devem morar no **main** (como o
  agendador de exclusões), não no componente: o conteúdo da ilha é desmontado ao recolher.
- Não remontar `Mascot` ao trocar de apresentação (perde estado e reinicia animações).
