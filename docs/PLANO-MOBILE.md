# Plano: Nimboo no Android (com sincronização e widget)

> **Para quem executar:** cada fase abaixo vira um plano detalhado (passos de 2–5 min, com código e testes)
> usando `superpowers:writing-plans` **logo antes** de começar a fase, e é executada com
> `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Este arquivo é o plano-mestre:
> o que fazer, em que ordem e como saber que ficou pronto.

**Objetivo:** usar o Nimboo em qualquer lugar pelo celular Android, editando tarefas, notas e foco como no
PC, com o mesmo mascote (reações e acessórios) animado no app e como widget na tela inicial.

**Arquitetura:** *local-first.* Cada aparelho tem seu SQLite e funciona offline; um **motor de sincronização**
em TypeScript (único, compartilhado entre PC e celular) troca mudanças com o **Supabase** (Postgres + login
+ regras por usuário). O app Android é o mesmo React empacotado com **Capacitor**; widget e notificações
são código nativo pequeno em Kotlin.

**Stack:** Supabase (Auth, Postgres, RLS) · Capacitor (versão estável atual) + `@capacitor-community/sqlite` · React 19 ·
Kotlin (AppWidget/Glance, WorkManager) · TypeScript compartilhado em `shared/`.

**Fora de escopo agora:** iPhone (fica para depois; a base serve), Play Store, sincronizar histórico do
assistente, chave do Gemini e endereços de agenda (segredos nunca saem do aparelho).

## Restrições globais

- **Opt-in:** nada vai para a nuvem sem a pessoa entrar numa conta e ligar a sincronização. Sem conta, o app
  continua 100% local.
- **Segredos locais:** chave do Gemini e endereços iCal não são sincronizados; tokens no cofre do aparelho
  (`safeStorage` no PC, Keystore no Android).
- **Rede só no processo principal / camada nativa**, nunca na interface web (regra do `CLAUDE.md`, que ganha
  decisão registrada na tarefa 0.2).
- **Nunca perder dado:** exclusão é marca (*tombstone*), backup antes de migrar, sincronização idempotente.
- **Mesmas regras de dados** no PC e no celular (título 200 pontos de código com `trim`, prioridades 0–3, etc.),
  vindas de `shared/`.
- **pt-BR**, tema claro/escuro, respeito a "reduzir movimento".

## Pontos que dependem de você (marcados nas tarefas)

| # | Decisão / ação | Quando |
|---|---|---|
| D1 | Criar o projeto no Supabase (grátis) e me passar **só a URL e a chave `anon`** (não é segredo) | Fase 0 |
| D2 | Forma de login: **e-mail com código** (recomendado, sem senha) ou Google | Fase 0 |
| D3 | Instalar Android Studio/SDK (cerca de 8 GB). O C: está quase cheio: **instalar no G:** | Fase 3 |
| D4 | Seu celular com **depuração USB** ligada, ou usar o emulador do Android Studio | Fase 3 |
| D5 | Aparelho de teste dos widgets: tamanho/versão do Android | Fase 7 |

## Mapa das fases

```
F0 Decisões e backend ─▶ F1 PC pronto p/ sync ─▶ F2 Motor de sync + conta no PC ─┐
                                                                                   ├▶ F3 App Android ─▶ F4 UI mobile ─▶ F5 Mascote
                                                                                   │                                   └▶ F6 Lembretes ─▶ F7 Widget ─▶ F8 Entrega
```

| Fase | Entrega que você consegue ver | Tamanho |
|---|---|---|
| F0 | Banco na nuvem criado e protegido, decisões registradas | P |
| F1 | PC com marcas de exclusão e fila de envio, nada muda para quem usa | M |
| F2 | "Conta e sincronização" nas configurações; dois PCs (ou o PC e um teste) trocam dados | G |
| F3 | App abre no celular, entra na conta e mostra suas tarefas | G |
| F4 | App com a cara certa: Hoje, Tarefas, Foco, Notas, Perfil | G |
| F5 | Mascote animado no app, com humor, acessórios e reações | M |
| F6 | Lembretes com Concluir/Adiar mesmo sem abrir o app | M |
| F7 | Widget na tela inicial com tarefas, mascote e botão Concluir | G |
| F8 | APK assinado, testes, README e página de download | M |

*P = 1 sessão · M = 2–3 · G = 4+.* **Depois de F2 você já tem sincronização entre PCs; depois de F3, tarefas no celular.**

---

## Andamento

| Fase | Estado |
|---|---|
| F0 | **Feita e verificada.** SQL aplicado no projeto `dgzzzztyfzuggxcnutfl` e teste de RLS ok (`rls_check: ok`); anon sem acesso às funções (42501). *(histórico:* **Escrita, falta aplicar.** `supabase/migrations/0001_sync.sql` (tabela, RLS, `sync_push`/`sync_pull`/`sync_wipe`) e `supabase/tests/rls_check.sql` prontos; D55 e regra do `CLAUDE.md` registradas. **Pendente:** D1/D2 (projeto Supabase) para aplicar e rodar o teste de RLS. |
| F1 | **Feita e testada** (commit `d67470f`). Migração v9 por gatilhos (fila, marcas de exclusão, identidade do aparelho), `SyncStore` e regra de merge pura. Cobre S1, S2, S3, S4 (parcial), S5, S6, S7, S8, S9, S10. **Fica para a F2:** S11 (salto de relógio), S12 (campos de versões novas), S13 (token/CSP). |
| F2 | **Feita no PC** (testes unitários e e2e com servidor falso). Motor, login por código, transporte, serviço e a tela "Conta e sincronização". **Falta:** testar com o Supabase real (e-mail com código exige o modelo de e-mail com `{{ .Token }}`), S11/S12. |
| F3 | **Feita** (APK debug instalado e aberto no Motorola Edge 50 Pro). Banco sql.js reutilizando os repositórios e o motor do PC; persistência em arquivo privado do app; sessão cifrada; casca (entrar, tarefas, sincronizar). Testes: unitários, e2e web no Chromium e abertura no aparelho. **Falta validar no aparelho:** login e sincronização reais com o PC. |
| F4–F8 | Não iniciadas. |

---

## F0 — Decisões e backend

### 0.1 Projeto Supabase e esquema
**Você (D1, D2):** criar conta em supabase.com, novo projeto (região São Paulo), ligar *Email OTP*.
**Eu:**
- Criar `supabase/migrations/0001_init.sql`: tabelas `tasks`, `notes`, `focus_sessions`, `achievements`,
  `bond` (kv), `skins_owned`, `profile` (nome do personagem, personagem, acessório em uso, tema).
- Toda tabela com `user_id uuid`, `id uuid`, `rev bigint` (relógio lógico), `device_id text`,
  `updated_at timestamptz`, `deleted_at timestamptz`, `payload jsonb` quando fizer sentido.
- **RLS:** `user_id = auth.uid()` em leitura e escrita, sem exceção.
- Função `sync_push(batch jsonb)` (idempotente por `id + rev`) e `sync_pull(since bigint)`.
- **Pronto quando:** teste SQL mostra que o usuário A não lê nem escreve linhas do usuário B.

### 0.2 Decisão registrada e regras do projeto
- `docs/DECISIONS.md` D55: nuvem opt-in, o que sincroniza e o que nunca sai, modelo de conflito.
- `CLAUDE.md`: atualizar a regra "sem rede" para "rede só em serviços do processo principal, opt-in".
- **Pronto quando:** as duas regras escritas e referenciadas no README.

---

## F1 — Preparar o PC para sincronizar (riscos S1–S13 do `ROADMAP.md`)

Nada visível muda para quem usa. Migração **v9** com backup automático antes (já existe).

### 1.1 Marca de exclusão (S1, S2, S10)
- Colunas `deleted_at` em `tasks` e `notes`; listas filtram `deleted_at IS NULL`.
- `remove()` vira `UPDATE ... SET deleted_at`; `DELETE` físico só pela limpeza após 30 dias.
- A limpeza das concluídas (30 dias) continua local e **não** gera exclusão sincronizada.
- Arquivos: `electron/tasks/migrations.ts`, `sqliteTaskRepository.ts`, `electron/notes/sqliteNotesRepository.ts`.
- **Testes:** excluir não some do banco; desfazer volta; limpeza não cria tombstone.

### 1.2 Relógio lógico e identidade do aparelho (S4, S5)
- Colunas `rev` (inteiro monotônico por registro) e `device_id` (gerado uma vez, guardado em `bond_kv`).
- Regra de merge em `shared/sync/merge.ts` (pura): maior `rev` vence; empate → maior `device_id`;
  concluir × reabrir: vence o `rev` mais novo; notas em conflito geram "Cópia de conflito".
- **Testes:** propriedade — qualquer ordem de aplicação converge para o mesmo estado.

### 1.3 Criação idempotente e regras iguais (S6, S8, S9)
- `create()` aceita `id` e `createdAt` do chamador (upsert); limite de 5000 não vale para registros recebidos.
- Regras de título em `shared/tasks.ts`, sem cópia no cliente.

### 1.4 Fila de saída durável (S7, S12, S3)
- Tabela `outbox(seq, table, id, op, rev, payload, created_at)` gravada **na mesma transação** da mudança.
- Banco recuperado de corrupção: marca `needs_full_pull`; nunca envia antes de baixar tudo.
- Campos desconhecidos de versões novas são preservados.
- **Pronto quando:** fechar o app no meio de uma mudança não perde nem duplica; testes com 3 processos continuam passando.

---

## F2 — Motor de sincronização e conta no PC

### 2.1 Motor (`shared/sync/`)
- `engine.ts`: `pushPending()`, `pullSince(cursor)`, `syncOnce()`, backoff, cursor por tabela.
- Interfaces injetadas: `Transport` (Supabase ou falso), `LocalStore` (SQLite do PC ou do celular), `Clock`.
- **Testes:** transporte falso com falhas, duplicatas e reordenação; offline por horas e volta.

### 2.2 Transporte Supabase
- `electron/sync/supabaseTransport.ts`: usa `net.fetch` + REST/RPC (sem SDK pesado); renova o token.
- Token no `safeStorage`; CSP e permissões revistas (S13).

### 2.3 Conta e interface
- Configurações > **Conta e sincronização**: entrar com e-mail + código, status, "Sincronizar agora",
  última sincronização, **sair**, **apagar meus dados da nuvem**.
- Aviso claro do que vai e do que não vai para a nuvem; liga só depois do consentimento.
- **E2E:** entrar com servidor falso, criar tarefa, ver no segundo "aparelho" (outra pasta de dados).

### 2.4 Sincronização em tempo quase real
- `Realtime` do Supabase com recuo para consulta a cada 60 s; indicador discreto de estado na ilha.

---

## F3 — App Android (casca funcional)

### 3.1 Ambiente (D3, D4)
- Instalar JDK 21 e Android SDK no G:; criar emulador; documentar em `docs/MOBILE.md`.

### 3.2 Projeto `mobile/`
- Capacitor + Vite reutilizando `shared/` e componentes do `src/` por *alias*.
- Camada `platform/`: contrato único (`TasksApi`, `NotesApi`, `FocusApi`, `BondApi`, `SettingsApi`) com a
  implementação do Electron (existente) e a do celular (nova), para as views não saberem onde rodam.

### 3.3 Dados locais
- `@capacitor-community/sqlite` com as **mesmas migrações** e repositórios (`MobileTaskRepository`
  implementa `TaskRepository`); mesmos testes de contrato rodam nos dois.

### 3.4 Conta e sincronização no celular
- Login (e-mail + código), `Transport` do Supabase via `fetch` nativo, **mesmo motor** da F2.
- Sincroniza ao abrir, ao voltar para o app, a cada edição (com atraso curto) e por `WorkManager` a cada ~15 min.

**Pronto quando:** você entra no celular com a mesma conta e vê as tarefas e notas do PC; cria uma no celular e ela aparece no PC.

---

## F4 — Interface do celular (usar `superdesign` + `artifact-design`)

> Fluxo: gerar propostas no **Superdesign** a partir das telas do app atual (capturas em `docs/media`) e do
> mascote; você escolhe a direção **antes** de eu codificar.

### 4.1 Direção visual e protótipo (tarefa de design)
- 2–3 propostas de tela inicial e navegação; tokens de cor/tipografia a partir do tema atual (claro/escuro).
- Mascote como "cabeçalho vivo" (mais discreto que no PC); alvos de toque ≥ 48 dp.
- **Pronto quando:** você aprova o protótipo.

### 4.2 Navegação e telas
- Barra inferior: **Hoje · Tarefas · Foco · Notas · Perfil**.
- **Hoje:** resumo, próximas tarefas, agenda, mascote. **Tarefas:** lista com prazo/prioridade/subtarefas,
  edição por toque longo, arrastar para ordenar, desfazer. **Foco:** temporizador (continua com a tela
  apagada, notificação fixa). **Notas:** editor Tiptap otimizado para toque. **Perfil:** conquistas,
  acessórios, configurações, conta.

### 4.3 Qualidade de uso
- Teclado não cobre o campo; gesto de voltar do Android; tema escuro; acessibilidade (TalkBack, tamanhos de fonte).
- **Testes:** componentes em navegador com viewport 360×800; revisão em dispositivo real.

---

## F5 — Mascote no celular

### 5.1 Animação e reações no app
- Reusar `Mascot.tsx` e `skinArt.tsx`; olhar segue o toque; cócegas e carinho por gestos; humor persistente e sincronizado.
- Sons do app respeitam o modo silencioso; vibração leve opcional (*haptics*).

### 5.2 Acessórios e conquistas
- Loja e conquistas portadas; compras sincronizam (`skins_owned`, saldo derivado).

### 5.3 Poses para o widget
- Renderizar, em tempo de execução, as poses do personagem e acessório **em uso** (idle, happy, sleepy,
  celebrate, curious, surprised) em PNG numa pasta que o widget lê.

---

## F6 — Lembretes e notificações

### 6.1 Notificações locais
- `@capacitor/local-notifications`: agenda lembretes de prazo (na hora e antes, igual ao PC), com botões
  **Concluir** e **Adiar 10 min**; reagenda ao sincronizar; funciona offline.

### 6.2 Foco e bem-estar
- Notificação do foco (restante/pausar), fim de sessão, lembretes de água/postura (se ligados).
- Pedir a permissão de notificação e de alarmes exatos com explicação.

---

## F7 — Widget Android (D5)

> Limite do Android: widgets **não rodam animação contínua**. O mascote é uma **imagem por estado** que
> troca com os eventos; a animação fluida fica dentro do app.

### 7.1 Widget "Hoje" (Kotlin + Glance)
- Tamanhos 2×2 (mascote + próxima tarefa) e 4×2 (mascote + 3 tarefas). Lê um resumo JSON do app
  (`next_tasks`, `pose`, `skin`, `sync_at`).

### 7.2 Regras de pose
- `celebrate` por 10 min após concluir algo; `curious` com prazo em até 30 min; `surprised` com tarefa atrasada;
  `sleepy` à noite ou sem interação há horas; `happy` no resto. Tabela única em `shared/mascotPose.ts` (testável).

### 7.3 Botão Concluir no widget
- Ação nativa envia a conclusão **idempotente** ao Supabase (token no Keystore) e grava na fila local; o app
  reconcilia na próxima abertura.
- Toque no mascote ou na tarefa abre o app na tela certa (*deep link*).

### 7.4 Atualização
- Atualiza quando o app muda dados, a cada sincronização e a cada 30 min por `WorkManager` (economia de bateria).

---

## F8 — Entrega

### 8.1 Qualidade
- Sincronização sob estresse (dois aparelhos, offline, relógio errado), bateria e consumo de dados, migração
  entre versões do banco móvel, recuperação de falhas.

### 8.2 Build e distribuição
- `release` assinado com sua *keystore* (guardada fora do git), APK em *GitHub Releases* (repositório privado)
  e instruções de instalação; opção Play Store registrada para depois.

### 8.3 Documentação
- `docs/MOBILE.md`, README com capturas do app, `docs/DECISIONS.md` atualizado, `PLANO.md` com a etapa 16.

---

## Riscos principais

| Risco | Mitigação |
|---|---|
| Conflito apaga edição de outro aparelho | Merge determinístico + notas com "Cópia de conflito" + testes de convergência (1.2, 2.1) |
| Quota ou queda do plano grátis do Supabase | Uso pessoal cabe com folga; tudo continua funcionando offline |
| Android mata o app em segundo plano | Sincronização por `WorkManager` e ao abrir; widget lê cache local |
| Widget não anima | Combinado: imagens por estado; animação completa no app |
| Disco C: cheio | SDK, JDK e emulador no G: (D3) |
| Vazamento de token ou segredos | Keystore/safeStorage; RLS testada; segredos nunca sincronizam |

## Ordem sugerida de trabalho

1. **F0** e **F1** já (sem custo e sem mexer no que você usa).
2. **F2** (sincronização valendo no PC).
3. **F3** + **F4** em paralelo parcial: design aprovado antes de codificar telas.
4. **F5 → F6 → F7 → F8**.

Cada fase termina com testes passando, documentação e um commit; só publico no GitHub quando você pedir.
