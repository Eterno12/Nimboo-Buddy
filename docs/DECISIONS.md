# Decisões técnicas

Registro das decisões que moldam o projeto: o que foi decidido, por quê e quais as limitações. A
descrição de **como** está implementado fica em `ARCHITECTURE.md`; o estado atual, em `PROJECT_STATUS.md`.

> **Regra para decisões futuras:** respeite a arquitetura existente. Para contrariar uma decisão abaixo,
> escreva uma nova entrada aqui com a justificativa explícita (o que muda, por quê, o que se perde) e
> atualize `ARCHITECTURE.md`. Não mude silenciosamente o que está registrado.

## D1 — Electron + React + TypeScript + Vite; personagem em SVG/CSS
- **Por quê:** pedido original do projeto; SVG original (sem imagens externas) permite animar por CSS
  e escalar sem perda; Vite dá recarga rápida.
- **Limitações:** Electron é pesado para um "bichinho" (memória/disco); o app é só Windows por ora.

## D2 — Uma única janela do mascote com duas apresentações (ilha e flutuante)
- **Por quê:** o estado do mascote (expressão, humor, timers) vive no renderer; reaproveitar a janela e o
  mesmo componente preserva tudo ao alternar. Uma segunda janela exigiria mover o estado para o main.
- **Alternativa rejeitada:** animar `setBounds` — irregular em janelas transparentes e, comprovadamente,
  gerava um quadro com o conteúdo deslocado e cortado ao encolher.
- **Limitações:** a janela da ilha é maior que a pílula (área transparente), tratada com `setShape`.

## D3 — Janela da ilha de tamanho fixo; expandir = trocar a forma, não redimensionar
- **Por quê:** `setShape` torna cliques fora da forma atravessantes e elimina o glitch de redimensionar.
  A animação é `clip-path` (barata), a forma cresce **antes** e encolhe **depois**.
- **Limitações:** `setShape` é uma API de Windows/Linux (não macOS); telas novas maiores exigem rever
  `ISLAND_WINDOW_SIZE` (medidas duplicadas em `presentation.ts` e `island.css`).

## D4 — Ciclo da ilha: ilha → esconde → Mochi no canto → borda superior
- **Por quê:** pedido do usuário (a ilha se esconde por inatividade e o Mochi "surge" de um canto).
  `island` é o modo padrão; "Usar modo flutuante" desliga o ciclo.
- **Detalhes:** só cantos **inferiores** (não cobrir botões de fechar de janelas maximizadas); a posição do
  canto não é gravada; configurações v1 migram para `island`.
- **Limitações:** o gatilho da borda superior pode disparar sem querer; não testado em tela cheia/2 monitores.

## D5 — Cursor global lido no main e enviado ao renderer (somente leitura)
- **Por quê:** o renderer só vê o mouse dentro da janela; olhar/proximidade/susto precisam da tela inteira.
  O main amostra a 40 ms e envia coordenadas relativas, sem expor APIs de sistema.
- **Limitações:** polling constante (barato, mas não zero); o arraste usa a mesma leitura.

## D6 — SQLite via `node:sqlite` (embutido), acessado só pelo processo principal
- **Por quê:** funciona no Electron 44 sem módulo nativo, sem recompilar e sem compilador C++ (que a máquina
  não tem); a mesma API roda nos testes em Node. O renderer só chama operações tipadas.
- **Alternativas rejeitadas:** `better-sqlite3` (nativo, recompilação por versão do Electron), `sql.js`
  (em memória, persistência manual), `localStorage` (origem muda entre dev e produção; preso ao renderer).
- **Limitações:** o módulo ainda está em desenvolvimento ativo no Node; isolado atrás de `TaskRepository`.
  Esquema por `PRAGMA user_version`; WAL; recuperação de arquivo corrompido e recusa de versão mais nova.

## D7 — Modelo de tarefas e interface de repositório assíncrona
- **Por quê:** preparar sincronização futura sem implementá-la: UUID gerado no cliente, datas ISO UTC,
  `updated_at`, `TaskRepository` assíncrono e `TaskResult` sem exceções pelo IPC.
- **Sem campos de sincronização** ainda (pedido explícito). **Limitações conhecidas** e pré-requisitos:
  ver `ROADMAP.md`, seção *Pré-requisitos e riscos da sincronização remota* (S1–S13).

## D8 — Retenção: concluídas somem 30 dias após `completed_at`
- **Por quê:** requisito do usuário. Aplicada na abertura, em `list`/`get`/mutações e de hora em hora.
  Ativas nunca são removidas; reabrir limpa `completed_at`.
- **Limitação:** é um `DELETE` local; com sync deve virar regra derivada, não exclusão propagada (`ROADMAP.md` S2, S11).

## D9 — Excluir com "Desfazer": prazo no processo principal, cancelado ao sair
- **Por quê:** todas as janelas precisam ver a mesma tarefa escondida; nada pode ser apagado antes do
  prazo. Ao fechar o app durante os 5 s a exclusão é **cancelada** e a tarefa permanece (previsível e
  não destrutivo). Desfazer não ressuscita o que a retenção já removeu.
- **Limitações:** só por botão (sem Ctrl+Z); num encerramento abrupto (crash) a exclusão pendente também é perdida, ou seja, a tarefa permanece.

## D10 — Rascunho em memória do renderer e retenção da ilha aberta
- **Por quê:** o conteúdo da ilha é desmontado ao recolher; um *store* fora do componente preserva o texto
  sem gravar no banco. Com foco no campo ou texto pendente a ilha não recolhe por inatividade.
- **Limitações:** por janela, não persiste entre execuções; perda de foco ainda recolhe.

## D11 — Tokens de cor sólidos + teste de contraste lendo o CSS real
- **Por quê:** impedir regressão silenciosa de acessibilidade; limites: texto ≥ 4,5:1, bordas/ícones ≥ 3:1.
- **Limitação:** só cobre as cores das tarefas, não o mascote nem o restante da ilha.

## D12 — O mascote sempre anima (sem opção de movimento reduzido por ora)
- **Por quê:** decisão do usuário (com os efeitos de animação do Windows desligados, a preferência de movimento reduzido do sistema fazia o app parecer parado). Uma opção "respeitar animações reduzidas" fica para a fase de configurações, desligada por padrão.
- **Limitação:** quem precisa de movimento reduzido não tem essa opção ainda.

## D13 — Testes: `node:test` com *type stripping*, e2e por CDP, sempre com dados isolados
- **Por quê:** zero dependências de teste; o e2e dirige o app real (foco, rascunho, desfazer) sem mouse do
  sistema e com `--user-data-dir` temporário, para nunca tocar no banco real.
- **Restrições:** código sob teste usa imports com `.ts` e evita sintaxe TS não "strip-able"; o e2e
  depende de sessão gráfica e de temporização (não roda em CI sem GUI).

## D14 — Nome "Mochi" mantido por enquanto
- **Contexto:** o projeto Coucou (referência de interação para a ilha) tem um personagem também chamado
  Mochi, com nome e arte de direitos reservados. Nada do código nem da arte foi copiado; o desenho do
  Mochi é original.
- **Decisão do usuário:** manter o nome agora e reavaliar depois. Rever **antes de publicar** (Fase E).

## D15 — Skills de terceiros guardadas em `.agents/skills`
- **Por quê:** instaladas por `npx skills add` como apoio a design/animação. São instruções de terceiros:
  consultivas, nunca acima de `CLAUDE.md`. Não estão em `.claude/skills`, logo não são carregadas
  automaticamente.
- **Versionamento:** ficam **fora do git** por precaução (100 arquivos, 7 MB, só uma licença presente;
  redistribuição não confirmada). Estão em `.git/info/exclude` (local); o `.gitignore` compartilhado
  não decide isso. Para versionar ou descartar, registre a decisão aqui.

## D16 — Durabilidade `synchronous = FULL` e limpeza de expiradas "leitura primeiro"
- **Contexto medido** (SQLite 3.53 do Node 24 / Electron 44, WAL): o padrão da conexão **já é** `FULL` (2);
  o projeto o rebaixava para `NORMAL` (1). O PRAGMA vale **por conexão**, não fica no arquivo. Em WAL,
  `NORMAL` não faz fsync a cada commit: numa queda de energia podem sumir as últimas transações (o
  banco continua íntegro). Custo medido de `FULL`: ~1,1 ms por commit (vs ~0,04 ms) — irrelevante para
  ações de usuário numa lista de tarefas.
- **Decisão:** `PRAGMA synchronous = FULL` definido em toda abertura (`openDatabase`) e **conferido por
  leitura do PRAGMA** (erro se não aplicar). `EXTRA` não traz ganho em WAL e foi descartado.
- **Limpeza:** `list()`, `get()` e `purgeExpired()` primeiro fazem uma leitura (`hasExpired`); só abrem
  `BEGIN IMMEDIATE` se houver expiradas. Medido: uma leitura passa em ~0,4 ms com outra conexão
  escrevendo, enquanto `BEGIN IMMEDIATE` falha com "database is locked" após o `busy_timeout`.
- **Sem corrida:** o `DELETE` reavalia `completed = 1 AND completed_at < ?` sob o lock, então uma tarefa
  reaberta/excluída entre a verificação e a limpeza nunca é apagada por engano (testado injetando a
  alteração entre os dois passos). As leituras também **excluem as expiradas na própria consulta**
  (`NOT_EXPIRED_SQL`): se a limpeza for adiada por bloqueio, nada expirado aparece e a leitura não falha.
- **Limitações:** a limpeza física pode atrasar até a próxima leitura/mutação/hora; o fsync a cada commit
  depende do disco (SSD/HDD e antivírus podem variar o custo); `node:sqlite` continua em evolução (D6).

## D17 — Linha-dica da borda em janela própria (não dentro da janela do mascote)
- **Contexto:** com o Mochi no canto, nada indicava onde levar o cursor para trazer a ilha de volta. A
  janela do mascote está no canto inferior; a dica precisa ficar no topo do monitor.
- **Decisão:** uma segunda `BrowserWindow` mínima (280×8 DIP, só HTML/CSS inline, sem preload nem IPC),
  clique atravessa, não focável, topo da pilha. Aparece só em *away* com o mascote visível e some em
  qualquer transição. Largura = zona de revelação real (`EDGE_REVEAL_HALF_WIDTH`), para a dica não mentir.
- **Alternativas descartadas:** estender a janela do mascote até o topo (cobriria a tela inteira de
  região clicável/de composição); desenhar na ilha (ela está escondida).
- **Forma e "mescla" (revisão 2):** a linha é uma "lente" rente ao topo: borda superior reta, a de baixo
  curva até zero nas pontas, com opacidade caindo para ~0 nas extremidades (afina e some). Aparece no
  instante em que a ilha começa a se esconder (`island:hiding`). A ilha **achata até virar a linha**
  (`scale(1.75, .035)` + `opacity`, origem no topo central) e, ao voltar, **cresce a partir dela** (linha
  "acende", cresce em ease-out e assenta com 3,5 % de overshoot na altura); a linha esmaece em ~200 ms
  quando a entrada começa. Só `transform`/`opacity` (compositor). Uma tentativa anterior com `clip-path`
  na janela inteira foi descartada: o recorte percorria 380 px de altura, mas a pílula só tem 48, então o
  movimento visível ficava concentrado no fim ("pulava").- **Limitações:** o Windows impõe altura mínima (~39 px) a janelas — `setShape` limita a região visível e
  clicável à faixa de 8 px; apps em tela cheia exclusiva podem ficar acima da linha.

## D18 — Modo foco: relógio no main, por instante de término, sem persistência na v1
- **Decisão:** o temporizador vive no processo principal (a ilha recolhida/oculta não pode ser a dona do
  relógio). O estado guarda `endsAt` (relógio do sistema) em vez de contar quedas de `setInterval`; o
  timer do SO é só um despertador reavaliado contra o relógio. Renderers calculam o restante localmente.
- **Escopo v1:** foco (1–180 min; presets 15/25/45/60) e pausa (1–60 min; padrão 5), uma sessão por vez,
  pausar/retomar/cancelar. Não há ciclo automático: o fim oferece o próximo passo (pausa ↔ foco).
- **Sem persistência:** fechar o app encerra a sessão. Persistir exigiria decidir o que fazer com o tempo
  decorrido enquanto o app estava fechado; fica para quando houver histórico/estatísticas.
- **Fim de sessão:** `celebrate`, ilha volta se estava escondida (sem roubar foco) e notificação nativa
  silenciosa só se o mascote estiver oculto — o aviso padrão é o próprio Mochi, discreto.
- **Não suprimido:** o mascote continua animando durante o foco (D12); ficar "quieto" é uma opção futura.

## D19 — Preferências v3, sempre validadas e aplicadas pelo main
- **Decisão:** `settings.json` passa à versão 3 (tamanho da ilha, tamanho do Mochi solto, tempo para
  esconder, atalho global, iniciar com o Windows, sons e volume, balões, não incomodar, cor). Arquivos v1/v2
  migram com os padrões. Toda alteração entra por `settings:update` com **lista de campos editáveis**
  (`mode`, posição e monitor continuam do `windowMode`) e passa por `parseSettings`: tamanhos viram o passo
  permitido mais próximo, o atalho só aceita os predefinidos, cores só as da lista.
- **Por quê:** o renderer nunca é confiável; passos fixos deixam o layout previsível (e testável) em vez de
  um controle livre.
- **Efeitos fora das janelas** ficam em `applySettingsChange` (main): reaplicar layout, registrar atalho,
  `setLoginItemSettings`, ligar/desligar o vigia de tela cheia.

## D20 — Tamanho: fator no main (janela e forma) + `transform: scale` no renderer
- **Decisão:** dois fatores independentes (ilha 80–140 %, Mochi solto 70–160 %). O main multiplica a janela
  e **todas** as formas (`scaleRect`/`islandShapes`) e limita o fator ao que cabe no monitor (`fitScale`);
  o snapshot devolve o fator **efetivo**. O renderer ampliou o `.shell` por `transform: scale(var(--ui-scale))`
  com `width/height: calc(100% / scale)`, então o layout interno (px) não muda.
- **Por quê:** `getBoundingClientRect` já devolve o tamanho visual, então a matemática do cursor/olhar
  continua certa; não é preciso `webFrame.setZoomFactor` (que é por origem e afetaria o painel).
- **Zona de revelação e linha-dica não escalam:** são uma característica da borda da tela, não da ilha.
- **Limitações:** em 80 % o texto fica pequeno; arredondamento de formas em DPI fracionário só foi
  validado por testes de geometria, não em monitor real além de 100 %.

## D21 — Backup antes de migrar e aviso de armazenamento
- **Decisão:** antes de aplicar migrações a um banco **existente**, o arquivo é copiado (`wal_checkpoint`
  antes) para `mochi.db.bak-v<n>-<data>`; ficam as 3 mais recentes. Se a cópia falhar, a migração **não**
  roda (o app segue sem tarefas e avisa), em vez de arriscar os dados. Arquivo corrompido é preservado
  (`.corrupt-<data>`) e o usuário vê uma faixa dispensável na lista; banco de versão mais nova também avisa.
- **Por quê:** é a rede de segurança exigida antes de notas (migração v2) e de qualquer sincronização.

## D22 — "Não incomodar" por `SHQueryUserNotificationState` num PowerShell oculto
- **Decisão:** um processo PowerShell (`-NoProfile -NonInteractive -Command`, sem `-EncodedCommand` nem
  política de execução) consulta o estado de notificação do Windows a cada 1,5 s e imprime `STATE n` ao
  mudar; estados 2, 3, 4 e 7 (tela cheia, D3D, apresentação, app da Store) escondem o Mochi, e ele volta
  quando acaba. O script encerra sozinho se o app pai sumir.
- **Alternativas descartadas:** módulo nativo/FFI (compilação e empacotamento), heurística de janela
  (frágil), `-EncodedCommand` (padrão de malware; o antivírus pode bloquear — travou em teste).
- **Limitações:** um processo extra (~30 MB); depende de o PowerShell estar disponível.

## D23 — Sons sintetizados e vozinha do balão
- **Decisão:** WebAudio sem arquivos: planos de notas puros (`sounds.ts`) com limites verificados em teste
  (≤ 1,6 s, ganho ≤ 0,6, 150–2400 Hz), passa-baixas a 3,2 kHz ("lo-fi") e envelope sem estalo. A "voz" é uma
  sequência de 3–9 bips finos numa escala pentatônica, proporcional à frase. Só a **janela do mascote**
  toca sons de eventos (o painel só toca o "Ouvir"), evitando som duplicado.
- **Padrões:** ligado, volume 40 %, sempre desligável.

## D24 — Personalidade: falas curtas, raras e respeitosas
- **Decisão:** catálogo de frases por evento (hora do dia, humor) e um escolhedor puro com: intervalo geral
  (9 s), intervalo por tipo, teto de 8 falas "de fundo" por hora, sem repetir as últimas 3 e **silêncio
  durante o foco** (só tarefa concluída e fim de sessão passam). Balão: abaixo da pílula (forma da janela
  cresce enquanto ele existe) ou sobre a cabeça do Mochi solto; `role=status`, cliques atravessam.
- **Futuro:** outros personagens trocam o desenho (`Mascot.tsx`) e as frases, não o mecanismo.

## D25 — Atalho global padrão: Ctrl+Alt+M
- **Contexto:** Ctrl+Alt+Espaço estava em uso (o registro falhava e o teste revelou o conflito).
- **Decisão:** padrão Ctrl+Alt+M (de "Mochi"), quatro predefinidos, e a tela de configurações mostra quando
  o registro não foi possível. O sucesso é conferido por `globalShortcut.isRegistered`, não pelo retorno.

## D26 — O app sempre abre como ilha
- **Decisão:** `STARTUP_MODE = 'island'`. Ao iniciar, o modo preferido salvo é descartado (e regravado como
  `island`); escolher "modo flutuante" pelo menu vale **até fechar o app**. A posição flutuante continua
  lembrada para quando for escolhido de novo.
- **Por quê:** a ilha é a identidade do produto; abrir como boneco solto, depois de uma troca de modo na
  véspera, surpreendia.

## D27 — Foco: tempo livre, tarefa vinculada, Pomodoro opcional e registro do dia
- **Tempo livre:** inteiros de 1–180 min (foco) e 1–60 (pausas), validados no main e na interface; o último
  foco usado vira o padrão (`focusMinutes`).
- **Ciclo (opcional, desligado por padrão):** 4 focos concluídos → pausa longa (15 min, editável), que
  fecha o ciclo. Cancelar um foco não conta. Por padrão o app **espera confirmação** no fim de cada etapa;
  "iniciar a próxima etapa sozinho" espera 5 s com a mensagem à vista e é cancelado por qualquer ação.
- **Tarefa vinculada:** o título é copiado para a sessão (a tarefa pode ser concluída/excluída); no fim do
  foco há "Concluir tarefa".
- **Registro:** `focus_sessions` (migração v2) guarda só sessões **concluídas**; alimenta "Hoje: n sessões ·
  m min" (dia local). Retenção de 400 dias.

## D28 — Prazos e lembretes de tarefas
- **Dados:** `tasks.due_at` (ISO UTC canônico, 2000–2100). Ordenação: com prazo primeiro, por data.
- **Lembretes** (`ReminderScheduler`, main): um aviso `N` min antes (0/5/10/15/30; padrão 10) e outro na hora.
  Cada (tarefa, prazo, tipo) avisa **uma vez por execução**; vencidas há mais de 1 min ao abrir o app não
  são anunciadas (aparecem como "atrasada"). Mudar o prazo reagenda. Entrega: balão com o título (mesmo
  durante o foco) + som próprio + notificação nativa silenciosa se o mascote está oculto.
- **Fora de escopo:** recorrência, prazos só de data, fusos diferentes do computador.

## D29 — Um som e uma fala para cada animação
- **Decisão:** cada animação do Mochi tem uma assinatura sonora curta e um conjunto de falas. O **som toca
  sempre** (os espontâneos — curioso, bocejo, espreguiçar, olhar em volta, sono, pulinho — calam durante o
  foco); a **fala** respeita um intervalo por animação (20–90 s), reações a ações da pessoa passam por cima do
  intervalo geral mas não contam no teto por hora, e durante o foco só tarefa concluída, lembretes e fim de
  sessão falam.
- **Detalhe:** o "happy" imediatamente depois do cumprimento ao chegar em cena não vira uma 2ª fala.

## D30 — Empacotamento com electron-builder (NSIS por usuário)
- **Decisão:** `npm run pack` (pasta `release/win-unpacked`) e `npm run dist` (instalador). Alvo NSIS x64,
  instalação por usuário (sem administrador), diretório escolhível, atalhos na área de trabalho e no menu
  Iniciar, dados do usuário **mantidos** ao desinstalar. Ícone gerado do próprio blob
  (`scripts/make-icon.cjs` → `build/icon.png`).
- **Dados:** o `productName` fica só na configuração do builder (não em `package.json`), então a pasta de
  dados continua `%APPDATA%\mochi-desktop` — a mesma do desenvolvimento.
- **Arquivos:** só `dist/` e `dist-electron/` entram no `app.asar` (~0,4 MB); React vira devDependency
  porque o Vite já o embute.
- **Limitações:** sem assinatura de código (SmartScreen avisa); sem atualização automática.

## D31 — Agenda (Google Agenda) por endereço iCal, somente leitura
- **Decisão:** a pessoa cola o "endereço secreto no formato iCal" (ou qualquer URL `https://` de iCal /
  `webcal://`). O **processo principal** baixa (`net.fetch`, 20 s, máx. 8 MB, só https, sem IP/localhost/
  usuário:senha), converte em eventos dos próximos 7 dias e guarda uma cópia local. A cada 15 min atualiza.
- **Segredo:** o endereço é um segredo (quem o tem vê a agenda). Fica **criptografado** com `safeStorage`
  (DPAPI) em `userData/calendar-url.bin`; se o cofre não existe, **não guarda**. Nunca volta para o
  renderer (só `configured`, o domínio e os eventos), não aparece em log nem em mensagem de erro.
- **Interpretação** (`electron/calendar/ics.ts`): dobras de linha, escapes, TZID (IANA; desconhecido cai no
  relógio local), dia inteiro, DTEND/DURATION, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL,
  BYDAY com ordinais, BYMONTHDAY), EXDATE, RECURRENCE-ID e STATUS:CANCELLED; regras antigas pulam direto
  para a janela; teto de ocorrências.
- **Uso:** "Agenda de hoje" no topo das Tarefas (ilha e painel) e lembretes dos eventos com horário (mesmo
  agendador dos prazos: na hora e N min antes). Falhas mantêm os últimos eventos e mostram o aviso.
- **Fora de escopo:** escrever na agenda, OAuth/login, várias agendas, eventos com participantes/convites.
- **Teste:** `MOCHI_E2E_CALENDAR_FILE` (só app não empacotado) troca o download por um arquivo local.

## D32 — Tema do painel: Automático / Claro / Escuro
- **Decisão:** `theme` nas preferências; `auto` acompanha `prefers-color-scheme` em tempo real. Vale para
  painel, tarefas, foco e configurações; a ilha é sempre escura. Os tokens escuros **reusam** os valores da
  ilha (`#342b3f`…), então o contraste já medido vale, e `contrast.test.ts` os verifica no CSS real. A janela
  do painel nasce com o fundo certo (sem "piscar" claro).

## D33 — Física do arraste e estado "enjoado"
- **Decisão:** módulo puro `dragPhysics.ts`: pêndulo com mola e amortecimento alimentado pela aceleração
  horizontal do cursor (inclina para onde vai). Sacudir com força (aceleração da mão presente) tira a
  mola e vira **giro livre** com atrito; a mola sozinha nunca reinicia um giro. 2 voltas em 3 s →
  estado `dizzy` por 5 s (olhos em espiral, cambaleio, estrelas, som e fala próprios).
- **Detalhes:** o pivô é o centro do corpo (girar em volta de si não sai da janela de 240 px); só
  `transform` é escrito (variável CSS, sem re-render do React). Vale no modo flutuante e no Mochi do canto.
