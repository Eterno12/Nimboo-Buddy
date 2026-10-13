# Estado do projeto

Atualizado em **2026-10-13**. Este arquivo descreve o estado **real** do código; nada aqui foi
copiado de planos. Legenda de evidência:

- **[auto]** coberto por teste automatizado (`npm test` / `test:tasks` / `test:e2e`);
- **[manual]** verificado à mão no app real (mouse, menu e capturas de tela), sem teste automatizado;
- **[não verificado]** implementado, mas nunca exercitado no ambiente-alvo.

## Resultados mais recentes (executados em 2026-10-13)

| Verificação | Resultado |
|---|---|
| `npm run build` | limpo (`tsc` sem erros; `dist/` ~262 kB) |
| `npm test` | **96/96** — `tasks` 29, `geometry` 17, `island` 17, `removal` 10, `settings` 10, `contrast` 8, `draft` 5 |
| `npm run test:tasks` | **39/39** |
| `npm run test:e2e` | **14/14** passos (app real via CDP, dados isolados) |

Ambiente: Windows 11, Node 24.20, Electron 44.7.0 (Node 24.21 / Chromium 152 / SQLite 3.53), React 19.3,
Vite 8.3, TypeScript 7.0. Máquina de desenvolvimento com 1 monitor a 100 % de escala.

## Concluído e verificado

| Área | Evidência |
|---|---|
| Janela do mascote sem borda, transparente, sempre no topo, fora da barra de tarefas | [manual] (capturas de tela sobre outros apps) |
| Mascote SVG original, 12 estados e transições suaves (idle, happy, curious, sleepy, celebrate, surprised, grabbed, giggle, annoyed, stretch, yawn, lookaround) | [manual] — `mascotController` **não tem testes unitários** |
| Reações: olhos seguem o cursor global, proximidade, susto, cócegas, emburrado, sono/despertar, humor por afeto | [manual] |
| Arraste, clique, menu de contexto, bandeja (ícone gerado em memória), instância única, "Sair" fecha o SQLite | [manual] |
| Modo flutuante: posição lembrada, reposicionamento se o monitor some | geometria [auto]; app [manual] |
| Ilha: expandir/recolher por clique, Esc, perda de foco, inatividade (8 s); forma por `setShape`, cliques fora da forma atravessam; sem redimensionar a janela | `islandController` e geometria [auto]; janela real [manual] |
| Ciclo: ilha entra → esconde (3 s; 6 s na chegada) → Mochi surge num canto inferior → borda superior (250 ms) traz a ilha | [manual] (8 execuções cronometradas: 7,6–8,0 s até o Mochi aparecer no canto) |
| Preferências `settings.json` v2 (migra v1), escrita atômica, `.bak` | [auto] |
| Tarefas: criar, concluir, reabrir, excluir com desfazer (5 s), validação (200 caracteres), retenção de 30 dias, rodapé "Concluídas", rascunho, foco, contador, `aria-live` | [auto] unit + e2e |
| SQLite: esquema v1, migrações versionadas, WAL, recuperação de arquivo corrompido, recusa de banco de versão mais nova, concorrência (3 processos) | [auto] |
| Sincronia entre painel, ilha e mascote; celebração só ao concluir | e2e parcial [auto] (ilha) + painel [manual] |
| Contraste das cores das tarefas (cálculo sobre o CSS real) | [auto] |

## Parcialmente implementado

- **Atalhos da ilha:** só **Tarefas** funciona. *Temporizador*, *Notas* e *Assistente* são botões
  desabilitados ("Em breve") — não há código por trás.
- **Mood/afeto:** funciona, mas é só memória; reinicia a cada execução (decisão, ver `DECISIONS.md`).
- **Sincronização:** o código está *preparado* (interface `TaskRepository`, UUIDs, UTC, `updated_at`), mas
  **não existe** nada de rede, login ou conflito. Há pré-requisitos conhecidos (ver abaixo e `ROADMAP.md`).
- **Acessibilidade:** campos, botões, foco visível, `aria-live` e contraste tratados; **nunca** testado
  com leitor de tela real. A pílula recolhida só é acionável por mouse (alternativa: item de menu).

## Não existe (não presumir)

Temporizador/Pomodoro, notas, assistente de IA, login, sincronização, versão mobile, tela de configurações,
iniciar com o Windows, instalador/empacotamento, ícone do aplicativo (só o ícone gerado da bandeja),
internacionalização (textos fixos em pt-BR), tema escuro do painel, opção de movimento reduzido
(decidido: o mascote sempre anima), edição de título de tarefa, ordenação manual de tarefas, backups.

## Problemas conhecidos e limitações

| # | Item | Gravidade | Detalhe |
|---|---|---|---|
| 1 | Repositório git só local (commit-base `193d2d3`, ramo `main`); sem remoto e sem CI | baixa | o histórico existe, mas não há cópia fora desta máquina; identidade do git não configurada |
| 2 | Verificação de DPI 125/150 %, barra de tarefas no topo, 2º monitor e apps em tela cheia | média | geometria coberta por testes unitários; o app real só foi visto em 1 monitor/100 % |
| 3 | Borda superior pode disparar a ilha sem querer (arrastar janela ao topo, menus de apps em tela cheia) | baixa | mitigado com 250 ms de permanência e 1,5 s de carência |
| 4 | Exclusão definitiva e sem marca (*tombstone*) | pré-requisito de sync | outro dispositivo poderia "ressuscitar" tarefas |
| 5 | Retenção apaga localmente | pré-requisito de sync | deve virar regra derivada de `completed_at` em todos os dispositivos |
| 6 | `updated_at` vem do relógio local, em ms, sem desempate | pré-requisito de sync | "última escrita vence" é frágil |
| 7 | `create(title)` gera o `id` no repositório | pré-requisito de sync | reenvio duplicaria; sync precisa de *upsert* idempotente com id do cliente |
| 8 | `TASK_LIMIT` (5000) bloquearia tarefas recebidas | pré-requisito de sync | |
| 9 | `synchronous = NORMAL` | baixa | pode perder as últimas transações em queda de energia (banco continua íntegro); `FULL` é barato aqui |
| 10 | `list()` abre transação de escrita a cada chamada (limpeza) | baixa | barato hoje; revisar com sync/vários processos |
| 11 | Sem backup antes de migrações | média | adicionar antes da migração v2 |
| 12 | Banco corrompido é só registrado no log | baixa | o usuário vê a lista vazia sem aviso (dados ficam em `.corrupt-*`) |
| 13 | `node:sqlite` está em desenvolvimento ativo no Node | baixa | API pode mudar em versões do Electron; isolado atrás de `TaskRepository` |
| 14 | Rascunho é por janela e não persiste | baixa | decisão; ilha e painel têm rascunhos independentes |
| 15 | Ao perder o foco a ilha recolhe mesmo com rascunho | baixa | o texto é preservado, mas a ilha não "fica presa" aberta |
| 16 | Duas observações isoladas de a ilha não esconder (~11–13 s) | baixa | não reproduzidas em 8 tentativas seguintes; suspeita de hover/ambiente |
| 17 | Skills de terceiros em `.agents/skills` + `skills-lock.json` | informativa | **fora do versionamento** até aprovação (100 arquivos, 7 MB, licenças desconhecidas); excluídas localmente em `.git/info/exclude`; não carregadas automaticamente pelo Claude Code |
| 18 | `tests/e2e` depende de temporização e de sessão gráfica | informativa | não roda em CI sem GUI; não faz parte de `npm test` |

## Próxima etapa recomendada

1. **Higiene (resta pouco):** decidir o destino de `.agents/` e `skills-lock.json` (versionar, ignorar de vez ou remover) e configurar a identidade do git.
2. **Endurecimento P3 das tarefas** (itens 9–12 acima): `synchronous=FULL`, `list()` sem escrita quando nada
   expirou, backup antes de migrar, aviso ao usuário quando o banco é recuperado.
3. **Testes unitários do `mascotController`** (lógica pura, hoje sem cobertura automatizada).
4. **Primeira funcionalidade nova: Temporizador** (ver `ROADMAP.md`, fase C): timers no processo principal,
   seção na ilha, sem tocar no armazenamento das tarefas.
