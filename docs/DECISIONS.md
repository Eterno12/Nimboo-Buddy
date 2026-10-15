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

## D4 — Ciclo da ilha: ilha → esconde → Nimboo no canto → borda superior
- **Por quê:** pedido do usuário (a ilha se esconde por inatividade e o Nimboo "surge" de um canto).
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

## D14 — Nome "Nimboo" mantido por enquanto
- **Contexto:** o projeto Coucou (referência de interação para a ilha) tem um personagem também chamado
  Nimboo, com nome e arte de direitos reservados. Nada do código nem da arte foi copiado; o desenho do
  Nimboo é original.
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
- **Contexto:** com o Nimboo no canto, nada indicava onde levar o cursor para trazer a ilha de volta. A
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
  silenciosa só se o mascote estiver oculto — o aviso padrão é o próprio Nimboo, discreto.
- **Não suprimido:** o mascote continua animando durante o foco (D12); ficar "quieto" é uma opção futura.

## D19 — Preferências v3, sempre validadas e aplicadas pelo main
- **Decisão:** `settings.json` passa à versão 3 (tamanho da ilha, tamanho do Nimboo solto, tempo para
  esconder, atalho global, iniciar com o Windows, sons e volume, balões, não incomodar, cor). Arquivos v1/v2
  migram com os padrões. Toda alteração entra por `settings:update` com **lista de campos editáveis**
  (`mode`, posição e monitor continuam do `windowMode`) e passa por `parseSettings`: tamanhos viram o passo
  permitido mais próximo, o atalho só aceita os predefinidos, cores só as da lista.
- **Por quê:** o renderer nunca é confiável; passos fixos deixam o layout previsível (e testável) em vez de
  um controle livre.
- **Efeitos fora das janelas** ficam em `applySettingsChange` (main): reaplicar layout, registrar atalho,
  `setLoginItemSettings`, ligar/desligar o vigia de tela cheia.

## D20 — Tamanho: fator no main (janela e forma) + `transform: scale` no renderer
- **Decisão:** dois fatores independentes (ilha 80–140 %, Nimboo solto 70–160 %). O main multiplica a janela
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
  mudar; estados 2, 3, 4 e 7 (tela cheia, D3D, apresentação, app da Store) escondem o Nimboo, e ele volta
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
  cresce enquanto ele existe) ou sobre a cabeça do Nimboo solto; `role=status`, cliques atravessam.
- **Futuro:** outros personagens trocam o desenho (`Mascot.tsx`) e as frases, não o mecanismo.

## D25 — Atalho global padrão: Ctrl+Alt+M
- **Contexto:** Ctrl+Alt+Espaço estava em uso (o registro falhava e o teste revelou o conflito).
- **Decisão:** padrão Ctrl+Alt+M (de "Nimboo"), quatro predefinidos, e a tela de configurações mostra quando
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
- **Decisão:** cada animação do Nimboo tem uma assinatura sonora curta e um conjunto de falas. O **som toca
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

## D33 — Física do arraste e estado "enjoado" (REVERTIDA)
- **Decisão atual:** ao segurar o Nimboo vale a **primeira versão**: estado `grabbed` (olhos e boca de espanto,
  balanço de pêndulo por CSS `dangle`, sombra menor, folha pendendo) e, ao soltar, um pulinho. Sem física,
  sem giro e sem estado `dizzy`.
- **Por que:** a física (pêndulo com mola, giro livre, enjoo por 2 voltas em 3 s, amostragem do cursor no main)
  funcionava, mas foi considerada desnecessária; o código foi removido por inteiro (`dragPhysics`,
  `useDragPhysics`, canal `drag:sample`, som e fala do enjoo) em vez de ficar desligado.
- **Mantido do processo:** o arraste continua lendo o cursor no main (`dragMove`), o que evita os desvios
  de coordenadas do renderer; a janela do mascote continua sem cortes (o teste e2e mede o contorno de
  todos os personagens em 12 estados).

## D34 — Personagens: um registro, a mesma infraestrutura (arte, som e ritmo por personagem)
- **Decisão:** 8 personagens selecionáveis (`mochi` original, `pineapple`, `square`, `mushroom`, `cactus`,
  `cloud`, `planet`, `ghost`) como **dados**, não como 8 mascotes. O que é compartilhado e NÃO foi
  duplicado: `mascotController` (estados, prioridades, afeto), rosto SVG (olhos e bocas de todos os estados), camadas de
  movimento, física do arraste, catálogo de sons/falas por animação, motor de áudio, interação e IPC.
- **O que muda por personagem:**
  - `src/features/mascot/characters.ts` — registro tipado (`CharacterId` vem de `shared/settings.ts`):
    nome/descrição, `traits` (ritmo dos comportamentos espontâneos, sono, piscadas, curiosidade), ajuste
    do rosto sobre o corpo (`face`: dx/dy/escala), `sound` (perfil) e frases próprias.
  - `characterArt.tsx` — só o corpo e os complementos (coroa, chapéu, braços, anel, vapor, bracinhos);
    contrato `defs / behind / body / front`; ids de gradiente com prefixo (`mochi` na janela do mascote,
    `pv-<id>` nas prévias).
  - `mascot.css` — variáveis de cor por `[data-character]` e animações de complemento (balanço da coroa,
    inclinação do chapéu, braços, anel, flutuar). Os complementos reagem às MESMAS variáveis de estado
    (`--leaf-rot`, `data-state`); o balanço contínuo fica num grupo interno (`.mascot-sway`) para não
    brigar com a postura do estado.
- **Som:** `SoundProfile` (altura, duração, volume, timbre, camada, vibrato, deslize, clique, voz do
  balão) aplicado por `applyProfile` a QUALQUER plano de `SOUNDS` e a `voicePlan`, sempre dentro de
  `SOUND_LIMITS`. Sem arquivos, sem laço, sem serviço externo; o volume geral continua mandando.
- **Escolha e persistência:** `settings.character` (v3; valor desconhecido/antigo → `mochi`), editável pelo
  canal normal de preferências e validado no main. Seleção na grade "Personagem" das configurações (com
  prévias vivas) e no submenu "Personagem" da bandeja/menu de contexto. A troca vale na hora, sem reiniciar
  e sem interromper a animação em curso.
- **Cor:** as paletas do Nimboo continuam só para o original; os outros têm cores próprias (a interface avisa).
- **Alternativas descartadas:** um componente por personagem com seu próprio controlador (duplica estados e
  testes); sprites/PNG (perde cor por variável, escala e tema); trocar o rosto por personagem (quebra a
  família visual e as expressões já prontas).

## D35 — Evento da agenda vira tarefa (`source_ref`, migração v3)
- **Decisão:** botão "→ Virar tarefa" em cada evento que ainda não terminou (ilha e painel). Título = o do
  evento (cortado em 200 caracteres); evento com horário que ainda não começou usa o início como **prazo**
  (os lembretes de tarefas já existentes passam a valer); evento de **dia inteiro** ou em andamento fica
  **sem prazo**. Depois de criada, o botão vira "✓ Tarefa".
- **Sem duplicar:** a migração v3 adiciona `tasks.source_ref` (id estável do evento, `<uid>|<início>`) com
  **índice único parcial**; `create(title, due, sourceRef)` é idempotente (devolve a tarefa existente, ativa
  ou concluída, sem avisar de novo). Excluir a tarefa libera a origem (o botão volta).
- **Sem aviso duplo:** eventos que já viraram tarefa saem do agendador de lembretes de eventos; quem avisa é
  o da tarefa (`onTasksChanged(ativas, origens)` → `syncEventReminders` no main).
- **Segurança:** a origem é só um texto curto validado (sem controle, até 300); a agenda continua somente
  leitura e nada é escrito no Google.

## D36 — Notas com formatação (TipTap), documento JSON validado e notas flutuantes
- **Decisão:** notas ricas (negrito, itálico, sublinhado, tachado, código, títulos H1–H3, listas, listas de
  tarefas, citação, bloco de código, linha divisória, alinhamento, cor do texto, marca-texto, link) com o
  **TipTap** (ProseMirror). Dependência nova de desenvolvimento (empacotada pelo Vite): `@tiptap/*` 3.x,
  MIT. Foi escolhida em vez de um editor próprio por causa do desfazer/refazer, listas aninhadas, colar e
  atalhos já prontos e testados.
- **Armazenamento:** migração v4 (`notes`): o documento do editor em JSON + título/prévia/texto de busca
  derivados (a busca ignora acentos e maiúsculas). Mesmo arquivo SQLite das tarefas, com backup automático
  antes de migrar. Limites: 200 KB por nota, 2000 notas.
- **Segurança:** o main **normaliza o documento por lista de permissões** (`validateNoteDoc`): só os nós e
  marcas acima; atributos fora da lista somem; cores só `#rrggbb`; links só `http/https/mailto`;
  profundidade, nós e texto limitados. Nada de HTML cru: o renderer nunca usa `innerHTML` com conteúdo da
  nota. Ctrl+clique em link abre só `https` pelo navegador (`setWindowOpenHandler`).
- **Nota flutuante:** janela própria por nota fixada (`#note=<id>`): sem borda, **fora da barra de tarefas**
  e **não** "sempre no topo", com aparência de papel (cor, linhas, canto dobrado); posição e tamanho
  lembrados; reabre ao iniciar o app. Fechar a folha (✕) só "solta" a nota. Limitação: é uma janela
  comum do Windows (não fica *atrás* dos outros apps nem some com "Mostrar área de trabalho").
- **Janela de notas:** `#notes` (lista + busca + editor); aberta pelo atalho "Notas" da ilha e pela bandeja.
  Excluir tem "Desfazer" (recria a nota); a mesma nota aberta em duas janelas sincroniza sem sobrescrever o
  que está sendo digitado.

## D37 — Assistente: comandos locais, voz do Windows e conhecimento sem tokens (opt-in)
- **Decisão:** janela `#assistant` (atalho "Assistente" da ilha e item da bandeja). Três camadas:
  1. **Comandos locais** (`shared/assistant.ts`, puro e testado): entende frases em português — criar nota,
     criar tarefa/lembrete com prazo ("amanhã às 15h", "em 30 minutos", "na sexta"), listar tarefas/agenda/notas,
     concluir tarefa por nome, foco (iniciar/pausar/retomar/cancelar), trocar de personagem, abrir notas e
     configurações. Executa pelas MESMAS APIs da interface (`assistantActions.ts`); criações têm "Desfazer".
  2. **Voz:** `electron/speech.ts` roda `Windows.Media.SpeechRecognition` (ditado pt-BR) numa sessão curta
     de PowerShell oculto. O texto vai para a caixa de mensagem e **só é enviado quando a pessoa aperta Enviar**.
     O ditado do Windows exige "Reconhecimento de fala online" ligado (Privacidade > Fala): o app não liga isso
     sozinho (é configuração do sistema) — mostra a mensagem e um botão que abre a página certa.
  3. **Perguntas livres, sem chave e sem tokens:** (a) **IA local pelo Ollama** (`127.0.0.1:11434`, grátis e
     privada; o app detecta, conversa e pede o download do modelo ao próprio Ollama) e/ou (b) **Wikipédia**
     (`pt.wikipedia.org`, resumo + link). Ambas **desligadas por padrão** (`assistantLocalAi`,
     `assistantWeb`): perguntar com tudo desligado só explica e oferece ativar. Só o texto da pergunta
     (e as últimas trocas, no caso da IA local) sai do processo principal.
- **Rede:** só o processo principal, só esses dois destinos (https para a Wikipédia; loopback para o
  Ollama), via `net.fetch`. O renderer continua sem rede (CSP). Atualiza a regra do `CLAUDE.md`.
- **Limites assumidos:** a IA não executa ações (só responde texto) — ações vêm do analisador local; a qualidade
  das respostas da IA local depende do modelo (padrão `qwen2.5:3b`, ~2 GB, cabe em 4 GB de VRAM/CPU).
  Reconhecimento **offline** de verdade (Whisper local) ficou como evolução: exigiria baixar um modelo
  de 75–500 MB e uma dependência nativa/WASM.
- **Teste:** `MOCHI_E2E_AI_FIXTURE` (só app não empacotado) troca a rede por um arquivo.

## D38 — Tarefas completas: editar, prioridade, repetição, subtarefas e ordem manual (migração v5)
- **Decisão:** a tarefa ganha `priority` (0–3), `recurrence` (`daily`/`weekdays`/`weekly`/`monthly`), `parentId`
  (subtarefa, **um nível, várias por tarefa**, até 50) e `position` (ordem manual). Migração v5 com backup.
- **Repetição:** a próxima ocorrência é criada **ao concluir** (não uma série): mesmo título/prioridade/repetição,
  prazo seguinte na mesma hora local e **sempre depois de agora** (app fechado por dias não gera fila de
  atrasadas), subtarefas copiadas e zeradas, sem `sourceRef`. Só tarefas com prazo repetem; subtarefas não repetem.
- **Subtarefas:** concluir a principal conclui as subtarefas; excluir a principal apaga as subtarefas (e a
  exclusão com "Desfazer" as esconde junto). Sob a principal aparecem ativas e concluídas, com contador `n/m`;
  uma concluída sob principal ativa não entra em "Concluídas".
- **Ordem:** `reorder(ids)` grava `position` das principais ativas; sem ordem manual vale a ordem anterior
  (prazo, criação). Tarefas novas sem posição vão para o fim. Arrastar (HTML5) e **Alt+↑/↓** (teclado).
- **Adiar:** sem coluna nova — "+10 min / +1 h / Amanhã 9h" são atalhos de `setDue` no editor de prazo.
- **Interface:** duplo clique renomeia (Enter grava, Esc cancela); bolinha de prioridade (clique avança); ↻ marca
  as que repetem. Cor da prioridade média é o token `--t-warn` (contraste verificado em `contrast.test.ts`).

## D39 — Malha de ligações: anotações da tarefa, pauta do evento e nota → tarefa (migração v6)
- **Decisão:** a nota ganha `taskId` e `eventRef` (migração v6, índices únicos parciais): **uma nota por
  tarefa** ("anotações") e **uma por evento da agenda** ("pauta"). `notes.create({ taskId | eventRef })` é
  idempotente: devolve a nota existente; excluir a nota libera o vínculo.
- **Interface:** botão de nota em cada tarefa ativa (vira "aberto" quando já existe) e em cada evento da agenda;
  a janela de notas mostra a etiqueta do vínculo e marca a lista (· tarefa / · pauta). A nota nasce com o
  título (e horário/local do evento) como cabeçalho.
- **Nota → tarefa:** botão da barra do editor transforma a **seleção** (ou a linha do cursor) em tarefa, e
  "Criar tarefa da nota" usa o título da nota. Sem vínculo automático de volta (a tarefa criada é comum).
- **Limites:** tarefa excluída deixa a nota no lugar (sem vínculo órfão visível); o vínculo não vai no
  arquivo de exportação (ids mudam entre bancos).

## D40 — Rotina do dia: resumo da manhã e fechamento da noite
- **Decisão:** `shared/routine.ts` (puro, testado) escolhe e monta o cartão: **resumo da manhã** no primeiro uso
  do dia (tarefas que pedem atenção, atrasadas, eventos e o próximo) e **fechamento** a partir da hora escolhida
  (concluídas hoje, foco do dia, pendências; sem culpa quando nada foi feito). O fechamento tem prioridade quando
  já é a hora; sem fechamento ligado, o resumo vale o dia todo.
- **Uma vez por dia:** `routineLastMorning`/`routineLastEvening` (AAAA-MM-DD) nas preferências; dispensar o
  cartão grava a data. Reiniciar no mesmo dia não repete; dia novo volta.
- **Onde aparece:** cartão "Boa tarde! Hoje: …" no topo das tarefas (ilha e painel) e uma fala curta do Nimboo
  (≤ 56 caracteres, sem repetir por execução, calada durante o foco). O assistente responde "resumo do dia" /
  "como foi meu dia?" com o mesmo texto.
- **Preferências:** `routineMorning`, `routineEvening`, `routineEveningHour` (17–21; padrão 18). Tudo ligado por
  padrão, desligável em Configurações > Rotina do dia.
- **Limite:** o fechamento "chega" enquanto o app está aberto; se o Nimboo está escondido, a fala vem quando a ilha
  aparecer de novo (o cartão já está nas tarefas).

## D41 — Vínculo e conquistas: afeto persistente, dias juntos e troféus (migração v7)
- **Decisão:** `shared/achievements.ts` (puro, testado) guarda as regras: contadores (`stats`), dias juntos e
  sequência, 24 conquistas em 4 níveis (bronze 10 / prata 25 / ouro 50 / platina 100 pontos), 2 secretas
  ("???" até liberar) e a platina por completar todas. `applyBondEvent` é um redutor sem efeitos colaterais.
- **Onde vive:** só o processo principal (`BondEngine` + `SqliteBondStore`, tabelas `bond_kv` e `achievements`
  no mesmo SQLite das tarefas, migração v7 com backup). A interface só lê (`bond.get/onChange`) e envia cinco
  eventos que nascem nela (`pet`, `assistant`, `voice`, `event_task`, `subtask`); os demais (tarefa criada/
  concluída, nota criada, foco concluído, troca de personagem, abrir o app) vêm dos próprios serviços.
  Qualquer outro tipo enviado pela interface é descartado (`RENDERER_EVENTS`).
- **Aviso estilo Steam/PSN:** janela transparente, sem foco e que ignora o mouse (`toast=<id>`), no canto da
  tela, 5,6 s, com som próprio (`achievement`, no timbre do personagem). Fila: um por vez. Com app em tela cheia
  os avisos são descartados (a conquista continua valendo) — mesma regra do "não incomodar".
- **Tela de conquistas:** perfil (personagem, nome, dias juntos, sequência, título de amizade, pontos),
  barra geral, filtros Todas/Conquistadas/Bloqueadas, cartões com medalha por nível e barra de progresso.
  Abre pela bandeja, pelas Configurações ou pelo assistente ("minhas conquistas").
- **Afeto persistente:** o humor do Nimboo volta ao valor guardado e é salvo a cada minuto (e ao fechar).
- **Nome do personagem:** preferência `mascotName` (1–20 caracteres, sem `<>` nem controle; inválido volta a
  "Nimboo"), usada no assistente e nas conquistas.
- **Limites:** o horário da madrugada (0–4 h) e do "cedo" (5–6 h) usa o relógio local; dias sem abrir o app
  zeram a sequência; importar dados não traz conquistas (ficam por instalação).

## D42 — Bem-estar: lembretes gentis, desligados por padrão
- **Decisão:** água (60 min), postura (45) e olhos (20), cada um ligável e com intervalo escolhido em lista
  fechada (`WELLNESS_INTERVALS`); mais "alongar depois do foco" (fala 4,5 s após o fim da sessão). Tudo
  **desligado** por padrão: lembretes são opt-in.
- **Regras (puras, testadas):** vence quando passou o intervalo desde o último lembrete (ou desde ligar/abrir);
  com vários vencidos sai o mais atrasado e há no mínimo 2 min entre dois lembretes; foco em andamento ou
  janela oculta (tela cheia) **adia** sem perder o vencimento; ligar/trocar intervalo recomeça a contagem.
- **Forma:** balão de fala curto (≤ 56 caracteres) + som suave; sem notificação do Windows e sem rede. Com os
  balões desligados nada aparece (e nada é consumido).
- **Limite:** os temporizadores vivem na janela do mascote (30 s de resolução); fechar o app zera a contagem.

## D43 — Estatísticas da semana na janela de conquistas
- **Decisão:** sem janela nova: a janela de conquistas ganha "Sua semana" (tarefas concluídas, foco total e
  sessões, sequência, barras de foco por dia, dia de mais foco, média). Cartões e mini-barras, sem biblioteca de
  gráficos.
- **Dados:** `statsWeek` (IPC, só o main lê o SQLite) agrupa `focus_sessions` (só `kind='focus'`) e `tasks`
  concluídas por dia **local**; o agrupamento é puro (`shared/stats.ts`, testado, inclui virada de mês).
- **Limite:** tarefas concluídas somem 30 dias depois (D8), então a semana é sempre confiável; histórico longo
  de tarefas não existe (o total acumulado está nas conquistas).

## D44 — Contexto: dia da semana, madrugada e comemoração de tarefa difícil
- **Decisão:** nenhuma leitura do que a pessoa faz no computador (sem janela ativa, sem teclado). O contexto é só
  o relógio local: falas com `days` (fim de semana, segunda, sexta) e `late` (0h–4h59) entram no mesmo sorteio
  das demais, com os mesmos limites (intervalos, teto por hora, calado no foco, ≤ 38 caracteres).
- **Tarefa difícil** (`shared/celebration.ts`, puro): prioridade alta, concluída **depois do prazo**, 2+
  subtarefas ou criada há 3+ dias. Subtarefas nunca disparam. O main calcula o motivo ao concluir e o envia junto
  do evento; a interface toca o som de conquista e fala uma frase própria (56 caracteres).
- **Tom:** nunca cobra: "atrasada, mas resolvida!" comemora, não aponta o atraso.

## D45 — Assistente+: novos comandos, histórico visível e atalho para falar (migração v8)
- **Comandos:** "adiar X para amanhã às 10h" / "em 2 horas" / sem prazo (amanhã 9h), com *Desfazer* que devolve o
  prazo anterior; "fixar/soltar a nota X"; "o que tenho amanhã?" (agenda + tarefas com prazo amanhã);
  "apagar histórico". Mesmo casamento por título das tarefas (`matchTasks`, agora genérico e em `shared/`);
  se houver mais de uma candidata, o assistente pede para escolher.
- **Histórico:** tabela `assistant_history` (só texto: papel, texto, fonte, hora; no máximo 200 mensagens, as
  antigas saem sozinhas; fonte só com `http(s)`). **Ligado por padrão** e sempre **visível**: ao abrir a
  janela as conversas anteriores aparecem no topo com o separador "Conversa de agora". Apagar: botão na janela
  (com confirmação), comando falado/escrito e botão nas Configurações. Desligar a preferência para de guardar
  (o que já existe continua visível até apagar). Nada sai do computador.
- **Atalho para falar:** opcional, **desligado por padrão**, lista fechada (Ctrl+Alt+V, Ctrl+Alt+A,
  Ctrl+Shift+V; nunca igual ao do painel). Abre a janela do assistente e começa a ouvir (o pedido é lido pela
  interface ao montar, ou chega por evento se a janela já estava aberta). Se outro app já usa a combinação,
  o registro falha em silêncio (logado).
- **Limite:** o atalho depende da permissão de fala do Windows como o microfone da janela; não foi exercitado
  com uma fala real.

## D46 — Sem voz falada para o personagem (Etapa 9 encerrada)
- **Decisão (do usuário):** o personagem não ganha voz falada. Continua só com os sons sintetizados (D23, D29) e
  os balões de texto. Ficam de fora: resposta falada (TTS do Windows) e reconhecimento offline (Whisper local),
  portanto **nenhum modelo é baixado** e não há nova superfície de rede.
- **O que permanece:** o microfone do assistente usa o reconhecimento de fala do Windows (D37), só para ditar o
  pedido; isso não muda.
- **Reabrir:** se um dia quiser, a etapa volta como opcional (TTS desligado por padrão).

## D47 — IA online com identidade: Gemini (Google) com a chave da própria pessoa
- **Decisão (do usuário):** conversa tipo ChatGPT, sem Ollama obrigatório. Provedor único: **Gemini**, por
  chave de API pessoal (plano gratuito do Google, com limites). Outros provedores (Groq, OpenRouter) ficaram
  para depois, sem trabalho feito. A conta gratuita do ChatGPT não tem API e não foi usada.
- **Rede e consentimento:** a única saída é `generativelanguage.googleapis.com`, feita **só no processo
  principal** (`net.fetch`), **desligada por padrão**. Para ativar: chave guardada + marcar "Entendi que as
  mensagens vão para o Google" (aviso também diz que o plano gratuito pode usar o conteúdo para melhorar os
  serviços deles). Contexto do dia (títulos de tarefas e agenda) é uma segunda opção, também desligada.
- **Chave:** colada pela pessoa, guardada cifrada com `safeStorage` (DPAPI) em `gemini.key`; **recusa guardar
  em texto simples** se a cifra não existir; nunca é devolvida à interface nem aparece na URL (cabeçalho
  `x-goog-api-key`) nem nas preferências.
- **Identidade (`shared/persona.ts`):** instrução do sistema montada a cada conversa: nome dado pela pessoa,
  tom do personagem (8 tons), regras (pt-BR, curto, honesto, não finge executar, sem senhas/diagnósticos),
  data/hora, ajustes livres da pessoa (400 caracteres) e, se permitido, o contexto do dia.
- **Ações com confirmação:** a IA só *propõe* (bloco `acoes` com JSON: tarefa/nota/foco); o app valida
  (tipos fechados, 5 no máximo, títulos e prazos checados) e mostra cartões **Aceitar / Ignorar / Aceitar tudo**.
  Executar usa os mesmos comandos locais (com *Desfazer*). Nada acontece sozinho.
- **Fluxo:** comandos locais continuam primeiro e sem rede; só o que o analisador não entende vai ao Gemini.
  Resposta em streaming (SSE) com botão Parar; erros viram frases claras (chave, cota, modelo, rede, bloqueio).
  Memória: últimas mensagens da conversa (e do histórico guardado, D45).
- **Modelo:** campo editável (padrão `gemini-3.5-flash-lite`, sugestões na lista); os nomes vêm da
  documentação do Google no dia da implementação e podem mudar — o erro de "modelo não encontrado" orienta a trocar.
- **Limites:** não testado com a API real (sem chave neste ambiente; o e2e usa uma resposta local de arquivo);
  a cota e a política do plano gratuito são do Google e mudam.

## D48 — Nome Nimboo, Gemini mais robusto, telas responsivas e configurações em abas
- **Nome:** o app e o personagem original passam a se chamar **Nimboo** (texto, janelas, bandeja, instalador
  `productName`, pacote `nimboo-desktop`). O **id interno do personagem continua `mochi`** (preferências já
  salvas) e o nome padrão guardado "Mochi" é lido como "Nimboo". `appId` mantido (`com.mochi.desktop`) para o
  instalador atualizar a instalação existente em vez de criar outra. A pasta de dados antiga (`Mochi` ou
  `mochi-desktop`) é **reaproveitada** se existir e a nova não (nada é movido nem apagado); `--user-data-dir`
  (testes) tem prioridade. A pasta do repositório continua `Mochi-Desktop`.
- **Gemini — correções:** chave aceita formatos novos (com `.`, até 250 caracteres; aspas e quebras de linha
  são removidas); "Testar conexão" funciona sem ativar o Gemini, **lista os modelos que a chave enxerga**,
  escolhe um que existe (Flash-Lite estável mais novo) e grava; na conversa, "modelo não encontrado" tenta uma
  vez com um modelo válido. Mensagens de erro trazem o detalhe do Google (`HTTP 400: …`, sem a chave).
- **Responsividade:** `responsive.css` (carregado por último): controles com `min-height` em vez de altura
  fixa; textos de conteúdo (título de tarefa, prazo, agenda, resumo, foco) **quebram** em vez de cortar;
  painel rola quando a janela fica baixa (mínimo 320×440); conquistas, assistente e configurações reorganizam
  abaixo de 520/420 px; notas empilham abaixo de 700 px. Janelas de forma fixa (ilha, Nimboo solto, aviso)
  continuam com tamanho próprio por desenho.
- **Configurações em abas:** Aparência · Comportamento · Assistente · Foco e agenda · Geral. As seções
  inativas ficam com `hidden` (continuam no DOM), a aba escolhida é lembrada na sessão.

## D49 — Player de música na ilha (SMTC do Windows) e ilha maior
- **Decisão:** o cartão "Tocando agora" fica na **tela inicial** da ilha, abaixo da fileira de atalhos
  (Tarefas…Assistente): **reduzido** (uma linha: nota + "Nada tocando agora" / faixa pausada + botão) e, quando
  algo **toca**, **expande** (capa, título, artista · app, progresso com clique para ir ao ponto, anterior /
  tocar-pausar / próxima). A ilha cresceu para caber: janela 352×440, pílula máxima 336×430 (tarefas ganham
  60 px); extensões `home` 164, `home-mini` 188, `home-player` 276.
- **Fonte:** controle de mídia do Windows (`GlobalSystemMediaTransportControlsSessionManager`) num PowerShell
  oculto e persistente (`electron/media/mediaSession.ts`): título, artista, álbum, app, estado, posição, capa e
  comandos pelo próprio Windows (não simula teclas). Funciona com os apps que se anunciam ao Windows (Spotify,
  navegadores, VLC, Media Player...). Reinicia até 3 vezes por minuto; depois desiste em silêncio.
- **Privacidade e custo:** 100 % local, sem rede. Só roda com `mediaPlayer` ligado (padrão). O leitor só lê o
  que o Windows já mostra no controle de volume; capa só como `data:image` validado; comandos só de uma lista
  fechada. O script não contém rede nem execução de texto (verificado em teste).
- **Reação:** com `mediaReact` ligado, o Nimboo balança (animação do contêiner, sem tocar nas expressões) enquanto
  toca; segue a regra D12 (sempre anima).
- **Assistente:** "pausar a música", "próxima/anterior", "tocar", "o que está tocando?".
- **Limites:** nem todo app informa tudo (capa, posição ou ir-para podem faltar); com várias mídias vale a que o
  Windows considera ativa; volume continua nas teclas do Windows. Não foi testado com Spotify real aqui (o e2e
  usa um arquivo no lugar do Windows).
- **Também nesta rodada:** a tela de conquistas rola; a linha da tarefa agrupa os botões à direita e o título
  tem largura mínima (subtarefas não espremem mais o texto; os botões descem para uma segunda linha).

## D50 — Primeira execução guiada (etapa 12)
- **Decisão:** janela própria `#welcome` (560×640) com 5 passos: boas-vindas, personagem (8 com prévia), nome,
  recursos (balões, resumo do dia, player, bem-estar) e dicas. Nimboo reage a cada passo com as animações
  existentes e há confete no final. Tudo opcional: "Pular" e fechar pelo X também contam como vista.
- **Quando abre:** `onboardingDone=false` (padrão). Execuções com `--user-data-dir` (testes) não abrem, salvo
  `MOCHI_E2E_ONBOARDING=1`. Reabrir: bandeja > "Rever introdução".
- **Escolhas** usam as preferências já existentes (personagem, mascotName, bubbles, routine*, mediaPlayer,
  wellness*); nada novo vai para rede. Gemini e agenda ficam em Configurações (exigem chave/endereço).
- **Limite:** quem já usa o app e não tem `onboardingDone` salvo vê a introdução uma vez.

## D51 (revertida) — Visual vidro escuro / acrílico
- Tentado e revertido a pedido do usuário: o acrílico nativo não apareceu na máquina dele, apesar de medido
  como funcionando em outra execução (só vale em janela transparente sem moldura, com barra de título
  própria). Voltou-se ao visual claro/escuro anterior e à moldura normal do Windows. Os commits `08a3508` e
  `7ca04de` e suas reversões ficam no histórico do git para consulta.

## D52 — Acessórios dos personagens (loja com pontos de conquista)
- **Moeda:** pontos de conquista. Comprar gasta o **saldo** (`balance` = pontos − preço dos acessórios
  comprados); o total de pontos e o nível de amizade **não** diminuem.
- **Itens:** 2 acessórios exclusivos por personagem (16), 20 e 50 pontos (total 560 de 660). Um por vez
  (`settings.skin`, id `<personagem>.<nome>`); só aparece se for do personagem atual. Cores/paletas extras
  só existem para o Nimboo original e ficam fora desta etapa.
- **Dados:** compras em `bond_kv.skins` (JSON, sem migração); validadas no main (`buySkin`): id conhecido,
  não repetido, saldo suficiente. Arte SVG em `src/features/mascot/skinArt.tsx`, camadas `body` (por cima do
  corpo) e `face` (acompanha o olhar); animações em `skins.css`, desligadas com "reduzir movimento".
- **Interface:** aba "Acessórios" na janela de conquistas, com prévia viva, preço e Comprar/Usar/Tirar.
- **Limite:** o main não confere posse ao receber `skin` pelas preferências (só a interface oferece itens
  comprados); impacto é só visual e local.

## D53 — Várias agendas e aviso de lembrete com botões
- **Agendas:** até 5 endereços iCal (`CALENDAR_MAX_SOURCES`), cada um uma `CalendarSync` com arquivos próprios
  (`calendar-url[-n].bin`, `calendar-cache[-n].json`; o 1º mantém os nomes antigos, sem migração). A interface
  recebe o resumo (`sources`, eventos mesclados, sem duplicar o mesmo `id`); os endereços nunca saem do main.
- **Aviso de lembrete:** janela própria no canto (`#reminder=<token>`) com Concluir (só tarefas), Adiar 10 min e
  Dispensar; some em 30 s. Substitui a notificação nativa, que no Windows não aceita botões pelo Electron.
  "Adiar" reapresenta o aviso depois; o prazo da tarefa não muda. Respeita app em tela cheia.
- **Limite:** o aviso aparece mesmo com o mascote visível (além do balão).

## D54 — Registro local de erros e instalador 0.5.0
- **Registro:** `userData/logs/nimboo.log` (rodízio em 512 KB, um `.1`). Grava exceções e rejeições do main,
  `console.error/warn` e quedas de processos. Só local, nada é enviado; Configurações > Geral > Diagnóstico abre a pasta.
- **Instalador 0.5.0** gerado sem assinatura (`Get-AuthenticodeSignature` = NotSigned): o Windows mostra o aviso
  do SmartScreen na primeira instalação. Assinar exige certificado de código (pago); `electron-builder` usa
  `CSC_LINK`/`CSC_KEY_PASSWORD` automaticamente se existirem.
- **Atualização automática: adiada.** Exigiria um servidor/Releases e uma verificação de rede periódica; só com
  decisão explícita (fonte da atualização) e opt-in.

## D55 — Sincronização na nuvem (Supabase), opt-in
- **Decisão:** a pessoa pode entrar numa conta (e-mail + código) e sincronizar PC e Android pelo Supabase.
  Desligada por padrão; sem conta, nada muda e nada sai do computador.
- **O que vai:** tarefas, notas, sessões de foco, conquistas, vínculo e acessórios. **Nunca:** chave do Gemini,
  endereços de agenda, histórico do assistente.
- **Modelo:** *local-first* (cada aparelho tem o SQLite e funciona offline). Fila de saída (`outbox`) e marcas
  de exclusão (`tombstones`) mantidas por gatilhos do banco (migração v9), na mesma transação da mudança.
  Conflito: a edição mais recente vence; empate decide pela exclusão e depois pelo aparelho
  (`shared/sync/merge.ts`, igual a `supabase/migrations/0001_sync.sql`). A limpeza dos 30 dias é local e não
  vira exclusão sincronizada (S2). Banco recuperado de corrupção baixa tudo antes de enviar (S3).
- **Limites:** relógios muito diferentes entre aparelhos podem favorecer uma edição mais antiga (S4);
  edições simultâneas na mesma nota ficam com a mais recente (sem mesclagem de texto).
- **Segurança:** RLS por `auth.uid()`, token no cofre do aparelho, chamadas só do processo principal.
- **Estado (F0–F2):** projeto Supabase criado e esquema aplicado (RLS verificada). PC: motor puro
  (`shared/sync/engine.ts`), login por código (`electron/sync/supabaseAuth.ts`), transporte RPC, serviço e tela
  em Configurações > Geral. Sessão cifrada em `sync-session.bin` (safeStorage). A chave `anon` fica em
  `shared/sync/config.ts` (pública por desenho). O e-mail do login precisa do modelo com o código (`{{ .Token }}`).
- **Limite do teste:** os testes usam um servidor falso com a mesma regra do SQL; a conversa real com o Supabase
  (e-mail, renovação do token) só é exercitada manualmente.

## D56 — Banco do app Android: SQLite WASM (sql.js) com o mesmo código do PC
- **Decisão:** o app móvel usa o sql.js (SQLite em WASM) atrás de um adaptador com a API do `node:sqlite`
  (`mobile/db/sqlJsDatabase.ts`). Assim as migrações, os repositórios, os gatilhos da fila e o `SyncStore` do PC
  rodam **sem alteração** (testado em `tests/mobileDb.test.ts` e `tests/mobileSync.test.ts`).
- **Persistência:** banco em memória, regravado (arquivo inteiro) depois de cada transação com atraso de 300 ms e
  ao pausar o app; arquivo corrompido vira cópia + banco novo com `needs_full_pull`; versão mais nova é recusada.
- **Alternativa descartada:** plugin SQLite nativo do Capacitor (assíncrono): exigiria reescrever repositórios e
  gatilhos, duplicando regras.
- **Limites:** o banco inteiro cabe na memória (uso pessoal: poucos MB) e uma morte súbita do app pode perder
  até ~300 ms de escrita (a fila de envio é regravada junto, então nada fica inconsistente).

## D57 — Vínculo e perfil sincronizados (conquistas, acessórios, personagem)
- **O que sincroniza:** conquistas desbloqueadas (união entre aparelhos), acessórios comprados (união) e o **perfil**
  (personagem, cor, nome, acessório em uso; a edição mais nova vence). Os pontos e o saldo são derivados, então
  batem nos dois aparelhos.
- **O que NÃO sincroniza:** contadores (tarefas concluídas, dias juntos, sequência, afeto) ficam por aparelho; o
  progresso das barras pode diferir entre PC e celular. Somar contadores de vários aparelhos exigiria contadores por
  aparelho (CRDT) e foi adiado.
- **Regras:** conquistas e compras são "só entram" (o que já existe aqui nunca é trocado por cópia de fora); o perfil
  segue `shared/sync/merge.ts`. Migração v10: `skins_owned` (antes JSON em `bond_kv`), `achievements.origin`, `profile`.
- **PC:** o perfil vive nas preferências (settings.json); uma ponte (`main.ts`) grava na linha `profile` quando
  personagem/cor/nome/acessório mudam e aplica o que chega da nuvem, sem eco. `ensureProfile` nunca sobrescreve o de
  outro aparelho.

## D58 — Widget Android: poses pré-renderizadas e arquivos como ponte
- **Por quê PNG por pose:** widget não anima. Cada pose do mascote (`idle, happy, curious, sleepy, celebrate, surprised`)
  é renderizada no build (`scripts/render-poses.cjs`, Electron offscreen a partir do mesmo componente Mascot) e
  empacotada em `android/app/src/main/assets/poses` (234 imagens, ~7 MB).
- **Pose:** `shared/mascotPose.ts` decide (comemorar até 10 min após concluir > atrasada > prazo em 30 min > sono à noite > normal).
- **Ponte JS↔nativo:** o app grava `widget.json` (Directory.Data = `getFilesDir()`); o provider Java só lê. O plugin
  `NimbooWidget.refresh()` pede o redesenho. Sem Kotlin/Glance: RemoteViews com 3 linhas fixas bastam e evitam dependências.
- **Concluir:** não fala com a nuvem (o token fica cifrado no WebView). O widget anota em `widget_inbox.json`, tira a
  tarefa do resumo local e o app aplica a conclusão ao abrir/voltar ao primeiro plano (ids validados, sem repetição).
- **Limites:** a tarefa só conclui no banco quando o app abre; o resumo atualiza a cada mudança, a cada 15 min com o app
  vivo e pelo `updatePeriodMillis` do Android (mín. 30 min).
