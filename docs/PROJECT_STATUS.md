# Estado do projeto

Atualizado em **2026-10-13**. Este arquivo descreve o estado **real** do código; nada aqui foi
copiado de planos. Legenda de evidência:

- **[auto]** coberto por teste automatizado (`npm test` / `test:tasks` / `test:e2e*`);
- **[manual]** verificado à mão no app real (mouse, menu e capturas de tela), sem teste automatizado;
- **[não verificado]** implementado, mas nunca exercitado no ambiente-alvo.

## Resultados mais recentes (executados em 2026-10-13)

| Verificação | Resultado |
|---|---|
| `npm run build` | limpo (`tsc` sem erros) |
| `npm test` | **178/178** — `tasks` 29, `geometry` 26, `island` 17, `durability` 14, `settings` 14, `focus` 13, `mascotController` 12, `contrast` 11, `personality` 11, `removal` 10, `backup` 6, `dnd` 5, `sounds` 5, `draft` 5 |
| `npm run test:tasks` | **53/53** (`tasks` + `removal` + `durability`) |
| `npm run test:e2e` | **14/14** passos (tarefas; app real via CDP, dados isolados) |
| `npm run test:e2e:focus` | **9/9** passos (inclui uma sessão real de 1 min com a ilha escondida; ~1,5 min) |
| `npm run test:e2e:settings` | **10/10** passos (tamanhos, cor, balões, validação, painel) |

Verificações manuais com o app real nesta etapa: atalho global (Ctrl+Alt+M enviado por `keybd_event`
com a ilha escondida → ilha volta, tarefas abertas, campo em foco) e "não incomodar" (janela em tela
cheia → Mochi some em ~1 s e volta ~1,5 s depois de fechá-la).

Ambiente: Windows 11, Node 24.20, Electron 44.7.0 (Node 24.21 / Chromium 152 / SQLite 3.53), React 19.3,
Vite 8.3, TypeScript 7.0. Máquina de desenvolvimento com 1 monitor a 100 % de escala.

## Concluído e verificado

| Área | Evidência |
|---|---|
| Janela do mascote sem borda, transparente, sempre no topo, fora da barra de tarefas | [manual] (capturas de tela sobre outros apps) |
| Mascote SVG original, 12 estados e transições suaves | `mascotController` [auto] (12 testes, relógio falso); aparência [manual] |
| Reações: olhos seguem o cursor global, proximidade, susto, cócegas, emburrado, sono/despertar, humor por afeto | lógica [auto]; olhar/cursor [manual] |
| Sono: comportamentos espontâneos **não** reiniciam mais o contador (antes ele quase nunca dormia) | [auto] |
| Arraste, clique, menu de contexto, bandeja (ícone gerado em memória), instância única, "Sair" fecha o SQLite | [manual] |
| Modo flutuante: posição lembrada, reposicionamento se o monitor some | geometria [auto]; app [manual] |
| Ilha: expandir/recolher por clique, Esc, perda de foco, inatividade (8 s); forma por `setShape`, cliques fora da forma atravessam; sem redimensionar a janela | `islandController` e geometria [auto]; janela real [manual] |
| Ciclo: ilha entra → esconde (3/6/10 s ou nunca; 6 s na chegada) → Mochi surge num canto inferior → borda superior (250 ms) traz a ilha | [manual] (8 execuções cronometradas: 7,6–8,0 s até o Mochi aparecer no canto) |
| Linha-dica da borda (lente que afina nas pontas) e morph da ilha (achata até a linha e cresce dela) | geometria [auto]; app real [manual] (capturas de quadros) |
| Tarefas: criar, concluir, reabrir, excluir com desfazer (5 s), validação (200 caracteres), retenção de 30 dias, rodapé "Concluídas", rascunho, foco, contador, `aria-live` | [auto] unit + e2e |
| SQLite: esquema v1, migrações versionadas, WAL, `synchronous=FULL` conferido a cada abertura, leituras sem transação de escrita quando nada expirou, concorrência (3 processos) | [auto] |
| **Backup antes de migrar** (`mochi.db.bak-v<n>-<data>`, últimas 3), migração que falha deixa o banco intacto | [auto] |
| **Aviso ao usuário** quando o arquivo foi recuperado (corrompido) ou é de versão mais nova | serviço/banco [auto]; faixa na lista [manual] |
| Modo foco (temporizador): foco 15/25/45/60 min e pausa 5 min; pausar/retomar/cancelar; relógio no main pelo relógio do sistema; selo na pílula; fim → comemora e traz a ilha | `FocusTimer` [auto] (13); ilha e ciclo completo e2e (9 passos); painel [manual] |
| **Configurações** (painel, aberto pela engrenagem da ilha ou pela bandeja): tamanho da ilha (80–140 %) e do Mochi solto (70–160 %), cor, tempo para esconder, sons e volume, balões, atalho global, não incomodar, iniciar com o Windows | `parseSettings`/store [auto]; e2e (10 passos); visual [manual] |
| **Atalho global** (padrão Ctrl+Alt+M; predefinidos; aviso se outro app já usa) | [manual] com teclas reais |
| **Não incomodar**: esconde o Mochi com app em tela cheia (`SHQueryUserNotificationState`) e o traz de volta | parser/vigia [auto]; tela cheia real [manual] |
| **Sons** sintetizados (tec, sininhos, vozinha do balão), baixos e curtos | planos [auto] (limites de duração/volume/frequência); audição [manual] |
| **Personalidade e balões**: falas por hora do dia/humor, quieto durante o foco, intervalos e teto por hora | `personality` [auto]; balão [manual] (captura) |
| **Cores do Mochi** (menta, pêssego, céu, lilás, limão, rosa) | e2e (estilo do SVG) |
| Contraste das cores (tarefas, configurações, balão) calculado sobre o CSS real | [auto] |

## Parcialmente implementado

- **Atalhos da ilha:** **Tarefas**, **Foco** e a engrenagem funcionam. *Notas* e *Assistente* são botões
  desabilitados ("Em breve") — não há código por trás.
- **Iniciar com o Windows:** a preferência existe e é aplicada com `app.setLoginItemSettings`, mas **só no
  app instalado** (`app.isPackaged`). Não há instalador ainda; na versão de desenvolvimento a opção fica
  desabilitada com explicação.
- **Modo foco (v1):** sem persistência (fechar o app encerra a sessão), sem ciclo Pomodoro automático, sem
  duração personalizada, sem histórico. Sons do foco existem (início, pausa, fim).
- **Mood/afeto:** funciona, mas é só memória; reinicia a cada execução (decisão, ver `DECISIONS.md`).
- **Sincronização:** o código está *preparado* (interface `TaskRepository`, UUIDs, UTC, `updated_at`,
  commits duráveis), mas **não existe** nada de rede, login ou conflito. Os riscos e pré-requisitos (S1–S13)
  estão na seção própria do `ROADMAP.md`.
- **Acessibilidade:** campos, botões, foco visível, `aria-live` e contraste tratados; **nunca** testado
  com leitor de tela real. A pílula recolhida só é acionável por mouse (alternativa: item de menu/atalho).

## Não existe (não presumir)

Ciclo Pomodoro automático, notas, assistente de IA, login, sincronização, versão mobile, instalador/
empacotamento, ícone do aplicativo (só o ícone gerado da bandeja), internacionalização (textos fixos em
pt-BR), tema escuro do painel, opção de movimento reduzido (decidido: o mascote sempre anima), edição de
título de tarefa, ordenação manual de tarefas, outros personagens (só o blob verde, com paletas), atalho
global personalizado livre (só os predefinidos), escolha do monitor da ilha pela interface.

## Problemas conhecidos e limitações

| # | Item | Gravidade | Detalhe |
|---|---|---|---|
| 1 | Repositório git só local (ramo `main`); sem remoto e sem CI | baixa | o histórico existe, mas não há cópia fora desta máquina; identidade do git não configurada (commits usam `-c user.name/email` por comando) |
| 2 | Verificação de DPI 125/150 %, barra de tarefas no topo, 2º monitor | média | geometria (inclusive escala, monitor à esquerda e 4K a 150 %) coberta por testes unitários; o app real só foi visto em 1 monitor/100 % |
| 3 | Borda superior pode disparar a ilha sem querer (arrastar janela ao topo, menus de apps em tela cheia) | baixa | mitigado com 250 ms de permanência e 1,5 s de carência; "não incomodar" cobre tela cheia |
| 4–8 | Exclusão sem *tombstone*, retenção como `DELETE` local, `updated_at` do relógio local, `create` gera o id, `TASK_LIMIT` | pré-requisito de sync | detalhados e com plano em `ROADMAP.md` (S1–S13); **nada** de sync existe |
| 9 | ~~`synchronous = NORMAL`~~ | **resolvido** | agora `FULL` (D16) |
| 10 | ~~`list()` abria transação de escrita a cada chamada~~ | **resolvido** | leitura primeiro (D16) |
| 11 | ~~Sem backup antes de migrações~~ | **resolvido** | cópia antes de migrar; falha na cópia aborta a migração (D21) |
| 12 | ~~Banco corrompido só registrado no log~~ | **resolvido** | faixa dispensável na lista de tarefas (D21) |
| 13 | `node:sqlite` está em desenvolvimento ativo no Node | baixa | API pode mudar em versões do Electron; isolado atrás de `TaskRepository` |
| 14 | Rascunho é por janela e não persiste | baixa | decisão; ilha e painel têm rascunhos independentes |
| 15 | Ao perder o foco a ilha recolhe mesmo com rascunho | baixa | o texto é preservado, mas a ilha não "fica presa" aberta |
| 16 | Duas observações isoladas de a ilha não esconder (~11–13 s) | baixa | não reproduzidas; suspeita de hover/ambiente |
| 17 | Skills de terceiros em `.agents/skills` + `skills-lock.json` | informativa | **fora do versionamento** até aprovação; excluídas localmente em `.git/info/exclude` |
| 18 | `tests/e2e` depende de temporização e de sessão gráfica | informativa | não roda em CI sem GUI; não faz parte de `npm test`; o cursor real do sistema na borda superior pode trazer a ilha durante o teste |
| 19 | Ctrl+Alt+Espaço (antigo padrão) já é usado por outros apps (ex.: Claude) | informativa | padrão agora é Ctrl+Alt+M; a tela de configurações avisa quando o atalho não pôde ser registrado |
| 20 | Um teste de durabilidade (`mutações continuam aplicando a retenção...`) falhou **uma vez** com a máquina carregada | baixa | passou em 3 execuções seguintes; usa espera curta por bloqueio entre conexões; se repetir, aumentar `busy_timeout` do teste |
| 21 | Vigia de tela cheia é um processo PowerShell oculto (um por execução) | baixa | sem módulos nativos e sem `-EncodedCommand`/`-ExecutionPolicy` (parecem malware para antivírus); se o PowerShell estiver bloqueado, só a função "não incomodar" some |

## Próxima etapa recomendada

1. **Empacotamento** (instalador, ícone do app): destrava "iniciar com o Windows" de verdade e é pré-requisito
   para distribuir.
2. **Evoluir o modo foco** (fase C do `ROADMAP.md`): ciclo Pomodoro, duração personalizada, vínculo com
   tarefa, histórico.
3. **Tarefas com data/lembrete** (o Mochi avisa com balão e som) e **Notas** (fase D).
4. **Outros personagens** (o contrato de paleta e o `Mascot.tsx` já isolam o desenho do blob).
5. Higiene: decidir o destino de `.agents/` e `skills-lock.json` e configurar a identidade do git.
