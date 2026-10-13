# Roadmap

Separa o que está **planejado** (com ordem e dependências) do que são **ideias futuras** (sem
compromisso). O que já existe está em `PROJECT_STATUS.md`. Toda funcionalidade nova deve respeitar a
arquitetura de `ARCHITECTURE.md` e as decisões de `DECISIONS.md`.

## Funcionalidades planejadas (próximas, em ordem sugerida)

### Fase A — Higiene (pequena, sem funcionalidade nova)
- ~~`git init`, `.gitignore` revisado, commit-base~~ (feito: `193d2d3`). Resta decidir sobre `.agents/` e
  `skills-lock.json` (hoje fora do versionamento) e configurar a identidade do git.
- Remover/ignorar artefatos de teste; opcional: CI simples (build + `npm test`).
- Testes unitários do `mascotController` (hoje sem cobertura automatizada).

### Fase B — Endurecimento das tarefas ("P3" pendente)
Pré-requisito saudável antes de novos tipos de dado.
- `synchronous = FULL`; `list()` sem transação de escrita quando nada expirou.
- Backup do arquivo antes de aplicar migrações.
- Aviso ao usuário quando o banco foi recuperado de um arquivo corrompido.
- Documentar, no README, os pré-requisitos de sincronização listados em `PROJECT_STATUS.md`.

### Fase C — Temporizador (Pomodoro)
- **Dependências:** nenhuma de dados; precisa de decisão sobre onde o relógio vive.
- **Direção:** timers no **processo principal** (a ilha recolhida/oculta desmonta o conteúdo), evento de
  tique/fim para o renderer, nova seção na ilha (`IslandExtent` novo) e no painel.
- Fim de ciclo pode usar o `celebrate` existente e notificação nativa.
- Decidir: persistir um timer em andamento entre execuções? (sugestão: não na v1).

### Fase D — Notas
- **Dependências:** Fase B (backup antes de migrar). Nova migração **v2** em `electron/tasks/migrations.ts`
  (ou banco/módulo separado — decidir e registrar em `DECISIONS.md`), mesmo padrão: interface de repositório
  assíncrona, UUID do cliente, datas UTC, IPC específico e tipado, eventos de mudança.
- Seção na ilha reaproveitando o padrão rascunho/foco/desfazer das tarefas.

### Fase E — Aplicativo "de verdade"
- Tela de configurações: tempos da ilha (8 s/3 s), cantos, opção "respeitar animações reduzidas do
  Windows" (desligada por padrão — decisão do usuário), iniciar com o Windows.
- Ícone do aplicativo, empacotamento/instalador, assinatura; decidir o **nome definitivo** (ver
  `DECISIONS.md`).
- Rodar a matriz de verificação que falta: DPI 125/150 %, barra no topo, 2 monitores, tela cheia.

### Fase F — Assistente de IA (opcional)
- **Dependências:** Fase E (configurações) e decisão de privacidade. **Nada** de rede hoje.
- Sempre opcional e desligado por padrão; chave do próprio usuário guardada com segurança; chamadas só do
  processo principal; conteúdo enviado visível ao usuário. Exige entrada nova em `DECISIONS.md`
  (a regra "sem rede" do `CLAUDE.md` precisa ser ajustada explicitamente).

## Ideias futuras (sem compromisso)

- **Sincronização entre computadores e celular** — exige, antes, no armazenamento: marca de exclusão
  (*tombstone*), regra de retenção derivada (sem apagar "para sincronizar"), relógio híbrido ou `revision`
  + id de dispositivo em vez do `updated_at` local, *upsert* idempotente com id do cliente, tratamento do
  `TASK_LIMIT`, migração com backup. Depois: serviço autenticado, repositório remoto que
  **complementa** o SQLite (offline continua funcionando), resolução de conflitos.
- **Aplicativo móvel** — consome o mesmo serviço de sincronização; só faz sentido depois do item acima.
- Edição de título e ordenação manual das tarefas; recorrência, prazos e prioridades (explicitamente
  fora de escopo até agora).
- Mais cantos/comportamentos espontâneos, sons, skins do Mochi, humor persistente.
- Reagir ao contexto do desktop (hora do dia, janelas em foco) — planejado na proposta original da ilha,
  nunca implementado.
- Atalho global de teclado para abrir a ilha; "Desfazer" por teclado (Ctrl+Z).
- Ocultar a ilha automaticamente sobre aplicativos em tela cheia.
- Tema escuro para o painel; internacionalização.

## Ordem e dependências (resumo)

```
A higiene ──▶ B endurecimento ──▶ C temporizador ──▶ E app completo ──▶ F IA (opcional)
                      └────────▶ D notas ───────────┘
                      └────────▶ [ideias] pré-requisitos de sync ──▶ sync ──▶ mobile
```

C e D são independentes entre si. E pode começar em paralelo à C, mas o **empacotamento** deve esperar
as funcionalidades da v1 estabilizarem.
