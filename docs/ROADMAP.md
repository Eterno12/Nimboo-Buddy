# Roadmap

Separa o que está **planejado** (com ordem e dependências) do que são **ideias futuras** (sem
compromisso). O que já existe está em `PROJECT_STATUS.md`. Toda funcionalidade nova deve respeitar a
arquitetura de `ARCHITECTURE.md` e as decisões de `DECISIONS.md`.

## Funcionalidades planejadas (próximas, em ordem sugerida)

### Fase A — Higiene (pequena, sem funcionalidade nova)
- ~~`git init`, `.gitignore` revisado, commit-base~~ (feito: `193d2d3`). Resta decidir sobre `.agents/` e
  `skills-lock.json` (hoje fora do versionamento) e configurar a identidade do git.
- Remover/ignorar artefatos de teste; opcional: CI simples (build + `npm test`).
- ✅ Testes unitários do `mascotController` (12; revelaram e corrigiram o bug do sono).

### Fase B — Endurecimento das tarefas ("P3")
Pré-requisito saudável antes de novos tipos de dado.
- ✅ `synchronous = FULL` (verificado por leitura do PRAGMA a cada abertura) — ver `DECISIONS.md` D16.
- ✅ `list()`/`get()` sem transação de escrita quando nada expirou; leituras nunca falham por causa da
  limpeza — D16.
- ✅ Riscos e pré-requisitos da sincronização documentados (seção abaixo, lugar único).
- ✅ Backup do arquivo antes de aplicar migrações (D21).
- ✅ Aviso ao usuário quando o banco foi recuperado de um arquivo corrompido (D21).

### Fase C — Temporizador ("Modo foco") — v1 implementada, ver D18
- ✅ Relógio no processo principal; tela na ilha (`IslandExtent` `focus`) e cartão no painel; selo com o
  tempo na pílula recolhida; fim de sessão: Mochi comemora, ilha volta, notificação se o mascote está oculto.
- ✅ Foco (15/25/45/60 min) e pausa (5 min), pausar/retomar/cancelar; uma sessão por vez.
- ⏳ Ciclo Pomodoro automático (foco → pausa → pausa longa a cada 4), duração personalizada, histórico e
  estatísticas, som opcional, vincular sessão a uma tarefa, retomar sessão após reiniciar o app.

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

## Pré-requisitos e riscos da sincronização remota

**Lugar único** desta lista (outros documentos apenas apontam para cá). Hoje **nada** de rede, login ou
conflito existe; o armazenamento local está *preparado* (UUID gerado no cliente, datas ISO UTC, `updated_at`,
`TaskRepository` assíncrono, SQLite como fonte de verdade, escritas transacionais e duráveis), mas os itens
abaixo **precisam** ser resolvidos antes de qualquer sincronização, sob pena de perder ou duplicar tarefas.

| # | Risco | Como causa perda/duplicação | Pré-requisito | Onde está hoje |
|---|---|---|---|---|
| S1 | Exclusão sem marca (*tombstone*) | Outro dispositivo que ainda tem a tarefa a reenvia: ela "ressuscita" | Coluna de exclusão (`deleted_at`) por migração; listas a filtram; remoção física só depois do TTL/confirmação | `remove()` e a limpeza fazem `DELETE` físico |
| S2 | Retenção de 30 dias é um `DELETE` local | Propagada como exclusão do usuário, ou desfeita pelo remoto (ressurreição/duplicata) | Regra **derivada** de `completed_at`, igual em todos os clientes e no serviço; limpeza **não** gera exclusão sincronizada; registros remotos já expirados não são reinseridos | `purgeInside()` |
| S3 | Banco recuperado de corrupção volta **vazio** | Ausência pode ser lida como "o usuário apagou tudo" | Sincronização por operações/tombstones (ausência ≠ exclusão); após recuperar, *pull* completo antes de qualquer *push*; nova identidade de réplica | `openDatabase()` renomeia para `.corrupt-*` |
| S4 | `updated_at` vem do relógio local (ms, sem desempate) | Relógios diferentes ou empates: "última escrita vence" descarta edições | Relógio híbrido lógico ou `revision` monotônica por registro + id do dispositivo para desempate | `new Date().toISOString()` no repositório |
| S5 | Conflito de campos: concluir/reabrir/título em dispositivos diferentes | Dois dispositivos concluem a mesma tarefa com `completed_at` diferentes; concluir × reabrir concorrentes | Regra determinística de merge (por registro ou por campo) documentada e testada, p.ex. o menor `completed_at` vence | `setCompleted()` grava `now()` local |
| S6 | `create(title)` gera o `id` dentro do repositório | Repetição após falha de rede cria **duplicata** (outro UUID) | Operação idempotente com `id`/`createdAt` vindos do chamador (*upsert*) e chave de idempotência no serviço; nunca deduplicar por título | `create()` chama `newId()` |
| S7 | Não existe fila de saída durável | `TaskChange` são eventos em memória; mudanças feitas offline se perdem ao fechar | Registro de mudanças (outbox) gravado na **mesma transação** da mudança | `onChange` só avisa janelas |
| S8 | `TASK_LIMIT` (5000) aplicado a toda criação | Tarefas recebidas poderiam ser recusadas ou divergir | Não aplicar o limite a registros remotos; limite coerente com o serviço | `create()` |
| S9 | Regras de título só no cliente local | Cliente móvel com regras diferentes: títulos rejeitados/truncados; "iguais" com bytes diferentes (Unicode) | Mesmas regras (200 pontos de código, `trim`) em todos os clientes e no serviço; decidir normalização NFC | `validateTitle()` em `shared/tasks.ts` |
| S10 | Exclusão pendente (desfazer) é estado local em memória | Sincronizar antes do prazo apagaria o que ainda se podia desfazer | O serviço ignora `pendingRemovals`; o *tombstone* nasce só na finalização | `RemovalScheduler` |
| S11 | Mudança do relógio do sistema | Salto para frente expira (e apaga) concluídas de uma vez; propagado, vira perda em massa | Detectar saltos grandes; usar tempo do servidor/relógio lógico; nunca propagar limpeza como exclusão | `now()` em `purgeInside()` |
| S12 | Versões de esquema e de protocolo | Dados remotos de versão mais nova seriam descartados ou corrompidos | Preservar campos desconhecidos; **backup do arquivo antes de migrar** (Fase B pendente); versionar o protocolo | `SchemaTooNewError` só recusa o banco local |
| S13 | Credenciais e dados em trânsito | Vazamento de token; renderer com acesso a rede | Token no `safeStorage`; TLS; chamadas só do processo principal; ajustar CSP e a regra "sem rede" do `CLAUDE.md` com decisão registrada | nada de rede hoje |

**Já mitigado:** durabilidade do commit (`synchronous = FULL`, necessária para o *outbox* confiável);
escritas concorrentes (WAL + `BEGIN IMMEDIATE`, testado com 3 processos); limpeza sem corrida
(o `DELETE` reavalia a regra sob o lock); falha de notificação não finge erro depois do commit.
## Ideias futuras (sem compromisso)

- **Sincronização entre computadores e celular** — exige antes os pré-requisitos da seção
  *Pré-requisitos e riscos da sincronização remota* (abaixo). Depois: serviço autenticado, repositório remoto
  que **complementa** o SQLite (o offline continua funcionando) e resolução de conflitos.
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

## Próximos passos já combinados (após configurações, sons, balões e "não incomodar")
- **Empacotamento** (instalador, ícone): habilita "iniciar com o Windows" de verdade e a distribuição.
- **Outros personagens**: o blob ganhou paletas; novos personagens (ex.: quadradinho de cantos arredondados)
  trocam o desenho e o catálogo de falas, sem mudar balões, sons nem janela.
- **Tarefas com data e lembrete** (balão + som discretos), depois **Notas** (fase D, com backup já pronto).
- **Foco evoluído**: ciclo Pomodoro, duração livre, vínculo com tarefa, contagem diária.
- **Escolha do monitor da ilha** pela interface; atalho global personalizado livre.

## Estado desta rodada (2026-10-13)
- ✅ Abrir sempre como ilha; som e fala por animação; foco com tempo livre/Pomodoro/tarefa/contador;
  tarefas com prazo e lembrete; migração v2; empacotamento (instalador NSIS).
- ✅ Física ao segurar + enjoo; modo noturno do painel; Google Agenda por endereço iCal (somente leitura).
- ⏳ Próximo: notas (migração v3), segundo personagem, assinatura de código, atualização automática, login Google (OAuth) se a agenda precisar de escrita.
