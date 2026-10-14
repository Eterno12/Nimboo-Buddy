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
| `npm test` | **312/312** (+ `tasksComplete` 9, `portability` 2; `notes` 16) — `tasks` 34, `geometry` 26, `focus` 21, `personality` 18, `island` 17, `calendar` 20, `settings` 16, `durability` 14, `mascotController` 13, `notes` 13, `contrast` 13, `characters` 12, `reminders` 11, `assistant` 10, `assistantAi` 10, `removal` 10, `calendarSync` 10, `backup` 6, `sounds` 5, `focusLog` 5, `dnd` 5, `draft` 5, `dueFormat` 4 |
| `npm run test:tasks` | **58/58** (`tasks` + `removal` + `durability`) |
| `npm run test:e2e` | **14/14** passos (tarefas; app real via CDP, dados isolados) |
| `npm run test:e2e:focus` | **11/11** passos (tempo livre, tarefa vinculada, sessão real de 1 min com a ilha escondida; ~1,5 min) |
| `npm run test:e2e:settings` | **13/13** passos (abre como ilha, tamanhos, cor, balões, validação, painel, prazo e lembrete) |
| `npm run test:e2e:calendar` (`node tests/e2e/calendar-ui.e2e.mjs`) | **13/13** passos (sem rede, com o gancho de arquivo: endereço inválido, conexão, "Agenda de hoje", lembrete, segredo criptografado e persistente, botão "Virar tarefa" — aparece, converte, não duplica, volta ao excluir —, "Pauta" do evento, remoção) |
| `npm run test:e2e:links` | **6/6** passos (anotações da tarefa: uma nota por tarefa e sem duplicar; nota → tarefa pela linha e pela seleção; "Criar tarefa da nota"; marca na lista) |
| `npm run test:e2e:characters` | **10/10** passos, 2 execuções seguidas após a reversão do arraste (8 personagens renderizam com rosto completo; rosto dentro do corpo; 8 personagens × 12 estados × 4 instantes sem nenhum ponto fora da área; troca sem quebrar o clique; valor inválido; painel; persistência entre reinícios; config antiga/inválida; modo flutuante) |
| `npm run test:e2e:tasks-complete` | **6/6** passos (editar título; prioridade; várias subtarefas com contador; adiar +10 min, repetir e concluir gerando a próxima; reordenar por Alt+↓ e arrastar; excluir/desfazer com subtarefas) |
| `npm run test:e2e:notes` | **11/11** passos (criar/buscar sem acento; segurança do documento; janela de notas; formatação completa pelo editor real; busca; fixar → folha flutuante; cor do papel sincronizada; edição em duas janelas; soltar; reabrir no mesmo lugar ao reiniciar; excluir + desfazer) |
| `npm run test:e2e:assistant` | **9/9** passos (nota por frase + desfazer; nota sem texto; tarefa com prazo, listar e concluir por nome; foco; trocar personagem; pergunta sem fonte → ativar → resposta com fonte [arquivo-fixture, sem rede]; microfone até a mensagem de privacidade do Windows; privacidade por padrão) |
| Rede real | agenda pública do Google (feriados do Brasil) lida em ~0,6 s; endereço errado → "não encontrada (código 404)" |
| `npm run pack` + `node tests/e2e/packaged.e2e.mjs` | **5/5** passos no `Mochi.exe` empacotado (ilha, `packaged`, banco, foco, preferências) |
| `npm run dist` | gera `release/Mochi Setup 0.4.0.exe` (106,6 MB, NSIS por usuário, **sem assinatura**); `packaged.e2e` 5/5 no `win-unpacked` novo |

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
| **Abre sempre como ilha**, mesmo com o modo flutuante salvo (D26) | [auto] e2e (dev e empacotado) |
| **Som e fala para cada animação** (carinho, curioso, susto, cócegas, emburrado, arraste, bocejo, espreguiçar, olhar em volta, sono, pulinho); fala com intervalo por animação, som sempre (os espontâneos calam no foco) | catálogo e regras [auto]; audição [manual] |
| **Foco evoluído:** minutos livres (1–180), última duração lembrada, tarefa vinculada (e "Concluir tarefa" no fim), ciclo Pomodoro opcional (pausa longa a cada 4; automático opcional), contador do dia | `FocusTimer`/`FocusLog` [auto]; e2e (11 passos) |
| **Tarefas com prazo e lembrete:** data/hora opcional, atrasada/hoje destacados, lembrete na hora e N min antes (balão + som + notificação se oculto) | repositório, validação, agendador [auto]; e2e (lembrete real) |
| **Migração v2 do banco** (`due_at`, `focus_sessions`) com backup automático | [auto] |
| **Empacotamento:** `npm run pack`/`dist` (electron-builder, NSIS por usuário, ícone do blob); app empacotado reconhece `isPackaged` | e2e empacotado [auto]; instalador **construído**, não instalado nesta máquina |
| **Segurar o Mochi:** primeira versão (D33): cara de espanto, balanço e pulinho ao soltar; sem física e sem enjoo | estados e prioridades [auto] (`mascotController`); app real [manual] |
| **Personagens (D34):** Mochi original + Abacaxi, Quadrado, Cogumelo, Cacto, Nuvem, Planeta e Fantasma sobre o mesmo controlador, rosto, sons e interação; seleção nas configurações (prévias) e na bandeja; ritmo e som próprios; persistência | registro, validação, limites de som, personalidade, ritmos [auto] (12); renderização, nada cortado, painel, persistência, config inválida, flutuante [auto] e2e (10); aparência [manual] (capturas de todos os personagens em 9 estados) |
| **Modo noturno do painel:** Automático (segue o Windows) / Claro / Escuro, em tarefas, foco, agenda e configurações (D32) | contraste dos tokens escuros [auto]; capturas [manual] |
| **Evento → tarefa (D35):** botão "→ Virar tarefa" (título, horário como prazo, dia inteiro sem prazo), "✓ Tarefa" depois, sem duplicar, lembrete único; migração v3 | repositório, migração e conversão [auto] (9 testes); e2e (4 passos) + captura |
| **Notas com formatação (D36):** negrito/itálico/sublinhado/tachado/código, títulos, listas, tarefas, citação, bloco de código, alinhamento, cor, marca-texto, link; busca sem acento; cor do papel; **nota flutuante** na área de trabalho (posição lembrada, reabre com o app); excluir com desfazer; migração v4 | validação do documento, repositório e migração [auto] (13); e2e (11 passos); aparência [manual] (capturas do editor e da folha) |
| **Assistente (D37):** conversa por texto ou microfone; cria notas/tarefas com prazo, lista, conclui, foco, troca de personagem (com *Desfazer*); perguntas via Wikipédia e/ou IA local (Ollama), ambas opt-in | analisador (10), Wikipédia/Ollama/voz (10) [auto]; e2e (9 passos, sem rede); microfone com fala real **não verificado** |
| **Ligações (D39):** anotações da tarefa (1 nota por tarefa), pauta do evento (1 por evento), nota → tarefa (seleção/linha e título); migração v6 | repositório, idempotência, migração [auto] (3); e2e (6 + 1 passos) |
| **Tarefas completas (D38):** editar título (duplo clique), prioridade, várias subtarefas (1 nível) com contador, repetição (diária/dias úteis/semanal/mensal, gera a próxima ao concluir), adiar (+10 min/+1 h/amanhã 9h), ordem manual (arrastar e Alt+↑/↓); migração v5 | repositório, repetição, cascata, ordem, migração [auto] (9); e2e (6 passos) + captura |
| **Exportar / importar dados:** "Seus dados" nas configurações gera um JSON (tarefas e notas) e importa sem sobrescrever (pula o que já existe, ignora itens inválidos) | exportar → importar em outro banco, duplicatas e arquivos inválidos [auto] (2); diálogos do Windows **não exercitados** |
| **Google Agenda (iCal, somente leitura):** "Agenda de hoje", lembretes dos eventos, segredo criptografado (D31) | parser (16) e sincronização (10) [auto]; e2e (8); rede real [manual] |
| Contraste das cores (tarefas, configurações, balão, painel escuro) calculado sobre o CSS real | [auto] |

## Parcialmente implementado

- **Atalhos da ilha:** **Tarefas**, **Foco**, **Notas**, **Assistente** e a engrenagem funcionam. Notas e
  Assistente abrem janelas próprias (não dentro da ilha).
- **Voz do assistente:** usa o ditado do Windows e depende de "Reconhecimento de fala online" ligado no
  Windows (nesta máquina estava desligado: o app mostra o aviso e abre a página). **Nunca ouviu uma fala
  real** nos testes; um modo 100 % offline (Whisper local) não existe.
- **Nota flutuante:** é uma janela comum do Windows (não "atrás" dos outros apps; some com "Mostrar área de
  trabalho"). Não fica sobre os aplicativos nem na barra de tarefas.
- **Iniciar com o Windows:** a preferência é aplicada com `app.setLoginItemSettings` **só no app
  empacotado** (`app.isPackaged`). O instalador existe, mas a opção ainda **não foi exercitada** com o app
  instalado de verdade (o teste empacotado roda o `win-unpacked`).
- **Modo foco:** a sessão em andamento não persiste (fechar o app a encerra); o histórico guarda só o
  que a estatística do dia precisa (400 dias). Sem gráficos nem relatórios.
- **Mood/afeto:** funciona, mas é só memória; reinicia a cada execução (decisão, ver `DECISIONS.md`).
- **Sincronização:** o código está *preparado* (interface `TaskRepository`, UUIDs, UTC, `updated_at`,
  commits duráveis), mas **não existe** nada de rede, login ou conflito. Os riscos e pré-requisitos (S1–S13)
  estão na seção própria do `ROADMAP.md`.
- **Acessibilidade:** campos, botões, foco visível, `aria-live` e contraste tratados; **nunca** testado
  com leitor de tela real. A pílula recolhida só é acionável por mouse (alternativa: item de menu/atalho).

## Não existe (não presumir)

IA em nuvem (o assistente só usa Wikipédia e Ollama local), assistente que executa ações por conta própria (só o
analisador local executa), reconhecimento de voz offline, login, sincronização, versão mobile, assinatura de código do instalador,
atualização automática, recorrência de tarefas (prazo é uma data só), escrever na agenda/login Google (OAuth), várias agendas, internacionalização (textos fixos em
pt-BR), tema escuro do painel, opção de movimento reduzido (decidido: o mascote sempre anima), edição de
título de tarefa, ordenação manual de tarefas, personagens fora dos 8 do registro (nem importar/criar
personagem pela interface), paleta de cores para os personagens novos (só o Mochi original tem), atalho
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
| 22 | O e2e depende do foco/ponteiro do sistema (ilha recolhe se outra janela toma o foco) | informativa | os passos sensíveis usam "nunca esconder" e `keepAlive`; ainda pode oscilar com a máquina ocupada |
| 23 | Instalador sem assinatura de código | média | o Windows SmartScreen mostra aviso na 1ª instalação; assinar exige certificado |
| 24 | `npm run pack`/`dist` baixam binários (Electron, NSIS) na 1ª vez | informativa | precisa de internet no build |
| 25 | A agenda só atualiza a cada 15 min e só por endereço iCal (sem login) | informativa | "Atualizar agora" nas configurações; eventos recém-criados podem demorar a aparecer (limite do Google para o endereço secreto) |
| 26 | O endereço secreto do Google Agenda é um segredo de longa duração | média | fica criptografado (DPAPI) e nunca volta à interface; quem o tem lê a agenda — regenerar no Google invalida o antigo |
| 27 | O app passa a usar internet (só se a agenda for conectada) | informativa | regra atualizada em `CLAUDE.md`; D31 |
| 28 | Sons dos personagens nunca foram ouvidos por uma pessoa | média | os planos de notas são testados (limites de frequência, volume e duração; assinaturas distintas), mas o timbre "agradável" depende de audição; os perfis são só números em `characters.ts` e ajustáveis |
| 29 | Submenu "Personagem" da bandeja/menu de contexto não exercitado com clique real | baixa | o menu nativo não é acionável por CDP; a troca em si (`chooseCharacter` → mesmo caminho de `settings.update`) é a mesma testada pelo painel; compila e tipa |
| 30 | Personagens novos vistos só em 1 monitor/100 % | baixa | a janela é a mesma do Mochi; o teste mede pontos do contorno (não caixas) em 12 estados |
| 36 | ~~Link no editor de notas aplicado à seleção errada~~ | **resolvido** | o campo do link tomava o foco e o editor podia perder a seleção (intermitente); agora a seleção do momento da abertura é restaurada ao aplicar. O e2e de notas foi a fonte (5/5 depois do ajuste) |
| 35 | Em baterias longas de e2e (várias suítes em sequência) o passo "restaurar padrões" de configurações e o passo do editor de notas falharam algumas vezes; sozinhos passam sempre | baixa | não reproduzido isoladamente (13/13 e 11/11 em repetições); suspeita: máquina ocupada/processos do Electron de execuções anteriores; limpar `electron.exe` antes de rodar |
| 31 | Microfone do assistente depende de "Reconhecimento de fala online" do Windows e nunca foi testado com fala | média | sem a opção, o app explica e abre a página; áudio processado pelo serviço de fala da Microsoft quando ligada; alternativa offline (Whisper local) não existe |
| 32 | IA local exige o Ollama instalado pela própria pessoa (+ ~2 GB de modelo); qualidade depende do modelo | baixa | detecção, conversa e download testados com respostas simuladas; **nunca rodou com um Ollama real** nesta máquina |
| 33 | TipTap (3.x) entrou como dependência; `npm audit` aponta 8 vulnerabilidades moderadas na árvore de dev (electron-builder etc.) | baixa | são de ferramentas de build, não do app empacotado; revisar antes de distribuir |
| 34 | Instalador 0.3.0 gerado antes de notas, assistente e personagens | informativa | refazer `npm run dist` para incluir tudo (não feito) |
| 20 | Um teste de durabilidade (`mutações continuam aplicando a retenção...`) falhou **uma vez** com a máquina carregada | baixa | passou em 3 execuções seguintes; usa espera curta por bloqueio entre conexões; se repetir, aumentar `busy_timeout` do teste |
| 21 | Vigia de tela cheia é um processo PowerShell oculto (um por execução) | baixa | sem módulos nativos e sem `-EncodedCommand`/`-ExecutionPolicy` (parecem malware para antivírus); se o PowerShell estiver bloqueado, só a função "não incomodar" some |

## Próxima etapa recomendada

1. **Instalar de verdade e conferir** (por você): rodar `release/Mochi Setup 0.4.0.exe`, ligar "iniciar com o
   Windows", reiniciar e ver se abre como ilha.
2. **Experimentar com a sua agenda real:** colar o endereço secreto e conferir eventos recorrentes, fusos e lembretes.
3. **Notas rápidas** (fase D do `ROADMAP.md`): a migração v3 já tem backup automático.
4. **Ouvir e ajustar os sons dos personagens** (e a cara do cogumelo, a menor): são valores em `characters.ts`.
5. **Assinatura de código** e atualização automática, se for distribuir para outras pessoas.
6. Higiene: decidir o destino de `.agents/` e `skills-lock.json`; configurar a identidade do git.