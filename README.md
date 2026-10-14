# Mochi Desktop

Bichinho virtual (blob) que vive na área de trabalho do Windows e vira um assistente pessoal discreto:
um mascote animado, uma ilha expansível no topo da tela e uma lista de tarefas local.

**Stack:** Electron · React · TypeScript · Vite · CSS · SVG · SQLite (`node:sqlite`).

> Estado do projeto, arquitetura, decisões e roteiro estão em [`docs/`](#documentação).
> Instruções para o Claude Code estão em [`CLAUDE.md`](CLAUDE.md).

## Requisitos

- Windows 10/11
- Node.js LTS (22 ou superior) e npm

## Comandos

```bash
npm install          # instala as dependências
npm run dev          # desenvolvimento (Vite com recarga + Electron)
npm start            # compila e abre o app
npm run build        # typecheck + build do renderer e do processo Electron
npm run typecheck    # apenas verificação de tipos
npm test             # testes unitários (runner nativo do Node, sem dependências)
npm run test:tasks   # só armazenamento e regras das tarefas
npm run test:e2e     # interface de tarefas no app real (precisa de sessão gráfica)
npm run test:e2e:focus # modo foco no app real (~1,5 min)
npm run test:e2e:settings # configurações no app real
```

> Se o npm bloquear scripts de instalação, rode `node node_modules/electron/install.js` uma vez para
> baixar o binário do Electron.

## Como usar

O Mochi abre como uma **ilha** no topo da tela e vive este ciclo:

1. **Entra** descendo da borda superior e cumprimenta.
2. **Clique** expande a ilha (atalhos); clique de novo recolhe. Também recolhe com `Esc`, ao perder o
   foco ou sozinha após 8 s sem interação (pausado com o cursor sobre ela).
3. **Esconde-se**: recolhida e parada por ~3 s (6 s na chegada), a ilha sobe e some.
4. **O Mochi surge** pela lateral de um dos cantos inferiores e fica solto, arrastável.
5. **Cursor na borda superior** (centro do monitor, ~0,25 s) faz o Mochi sair e a ilha voltar.

**Menu** (clique direito no mascote ou ícone da bandeja): *Mostrar painel*, *Ocultar/Mostrar mascote*,
*Expandir/Recolher ilha*, *Mostrar ilha* (quando ele está no canto), *Usar modo flutuante / Usar modo
ilha* e *Sair*. O **modo flutuante** fixa o mascote solto, sem esconder nem voltar à ilha; a escolha e a
posição são lembradas. Trocar de modo preserva o estado do mascote (expressão, humor).

### Reações do Mochi

| Gatilho | Reação |
|---|---|
| Cursor em qualquer lugar da tela | Os olhos (e um pouco do rosto) seguem o cursor |
| Cursor chega perto (sem tocar) | `curious` |
| Cursor chega rápido | `surprised` (susto; recarga de 8 s) |
| Clique (modo flutuante / no canto) | `happy` |
| 3 cliques rápidos | `giggle` (cócegas) |
| 7 cliques seguidos | `annoyed` (emburrado; clicar mais prolonga) |
| Segurar e arrastar | `grabbed`; ao soltar, assenta com um pulinho |
| Parado (a cada 8–16 s) | saltinho, `lookaround`, `stretch` ou `yawn` |
| 45 s sem interação | boceja e entra em `sleepy` |
| Cursor bem perto / clique enquanto dorme | acorda espreguiçando |
| Carinho ao longo do tempo | humor `high` (bochechas coradas, mais animado) ou `low` (folha murcha, mais quieto) |
| Tarefa concluída | `celebrate` |

Em `npm run dev`, as teclas `1 2 3 4 5 6 7 8 9 0 - =` forçam os estados na ordem: idle, happy, curious,
sleepy, celebrate, surprised, grabbed, giggle, annoyed, stretch, yawn, lookaround.

### Tarefas

No painel (modo flutuante) ou na ilha expandida (botão **Tarefas**).

- Título obrigatório, sem espaços nas pontas, até **200 caracteres**. O campo mostra um contador
  (`n/200`) e **nunca trunca em silêncio**: acima do limite o contador fica vermelho, o botão
  **Adicionar** é bloqueado e aparece quanto passou.
- **Enter** ou o botão **Adicionar** cria a tarefa; ao abrir a tela o campo já está em foco.
- **Rascunho:** o texto não enviado sobrevive a recolher/reabrir a ilha (fica só em memória). Com o campo
  em foco ou com texto, a ilha não recolhe por inatividade (Esc, clique no mascote e perda de foco ainda
  recolhem).
- Concluídas saem da lista na hora e vão para **Concluídas (n)**, num rodapé fixo, recolhido por padrão.
  Ficam **30 dias** (contados da conclusão) e depois são apagadas; ativas nunca são removidas. Reabrir
  devolve à lista principal.
- **Excluir** mostra **Desfazer** por 5 s; só depois a tarefa é apagada. Se o app fechar nesse intervalo,
  a exclusão é cancelada e a tarefa continua na lista.
- Falhas ao concluir/reabrir/excluir aparecem como mensagem; mudanças e erros são anunciados para leitores
  de tela. Todas as janelas se atualizam sozinhas.

### Agenda → tarefa

Com o Google Agenda conectado, cada evento que ainda não terminou tem o botão **→ Virar tarefa**: ele cria a tarefa com o mesmo título (e o horário do evento como prazo, com lembrete; eventos de dia inteiro ficam sem prazo). Depois aparece **✓ Tarefa** no lugar.

### Tarefas completas

Além de criar, concluir e excluir (com *Desfazer*): **duplo clique no título para editar**; **bolinha de prioridade** (clique avança: nenhuma, baixa, média, alta); **subtarefas** (botão **+**, quantas quiser, com contador `1/3`); **repetição** (todo dia, dias úteis, toda semana, todo mês — ao concluir, a próxima já aparece); **adiar** (+10 min, +1 h, amanhã 9h) pelo prazo; e **ordem manual** arrastando a tarefa (ou **Alt+↑/↓** no teclado).

### Tarefas, notas e eventos ligados

- **Anotações da tarefa:** o ícone de nota em cada tarefa cria (ou abre) uma nota só dela.
- **Pauta do evento:** o mesmo ícone nos eventos da agenda cria a nota da reunião.
- **Nota → tarefa:** na janela de notas, o botão da barra transforma a seleção (ou a linha) em tarefa; *Criar tarefa da nota* usa o título.

### Rotina do dia

No primeiro uso da manhã o Mochi mostra um **resumo** (tarefas que pedem atenção, atrasadas, eventos e o próximo) — um cartão no topo das tarefas e uma fala curta. No fim do dia (padrão 18h) vem o **fechamento**: o que você concluiu, o foco do dia e o que ficou pendente. Cada um aparece uma vez por dia e dá para dispensar; ligue/desligue e escolha a hora em *Configurações > Rotina do dia*. Também dá para perguntar ao assistente: *"resumo do dia"*.

### Conversa com IA (Gemini)

Opcional e **desligado por padrão**: o Mochi conversa de verdade (como num chat), com a personalidade do personagem que você escolheu e o nome que você deu a ele. Para ligar, em *Configurações > IA online (Gemini)*: crie uma chave grátis no Google AI Studio (o app mostra o passo a passo), cole e guarde (fica cifrada pelo Windows), marque que entende que **as mensagens vão para o Google** e ative. Ele pode propor **ações** (criar tarefa com prazo, nota ou iniciar foco) em cartões: nada acontece até você tocar em *Aceitar*. Em *Deixar o Gemini ver minhas tarefas e agenda* você decide se os títulos do dia vão junto. Comandos como "crie uma tarefa…" continuam locais, instantâneos e sem internet. O plano gratuito do Google tem limites e termos próprios.

### Assistente: histórico e atalho

A conversa com o assistente fica **guardada só no seu computador** (até 200 mensagens) e aparece quando você reabre a janela, com o separador *Conversa de agora*. Para apagar: botão **Apagar histórico** na janela (pede confirmação), o comando *"apagar histórico"* ou o botão em *Configurações > Assistente*; também dá para desligar o histórico lá. Novos comandos: *"adiar enviar relatório para amanhã às 10h"* / *"…em 2 horas"*, *"fixar a nota lista de compras"* / *"soltar a nota …"*, *"o que tenho amanhã?"*. Opcional: um **atalho global** (Ctrl+Alt+V, Ctrl+Alt+A ou Ctrl+Shift+V) abre o assistente já ouvindo.

### Sua semana

Na janela de conquistas, *Sua semana* mostra tarefas concluídas, tempo de foco, sessões e a sequência de dias, com barras de foco por dia. Pergunte ao assistente: *"minha semana"*.

### Bem-estar

Lembretes gentis para **beber água**, **ajeitar a postura** e **descansar os olhos**, com o intervalo que você escolher (padrão 60/45/20 min), mais uma sugestão de **alongar depois de cada sessão de foco**. Tudo vem desligado: ative em *Configurações > Bem-estar*. Os lembretes aparecem como um balão curto (precisam dos balões ligados) e ficam quietos durante o foco.

### Vínculo e conquistas

O Mochi lembra de você: o humor dele **persiste** entre aberturas do app, e ele conta os **dias juntos** e a sequência de dias seguidos. As **conquistas** funcionam como troféus de Steam/PSN (bronze, prata, ouro e platina, algumas secretas): ao liberar uma, um aviso aparece no canto da tela com um som curto (não aparece com apps em tela cheia). Veja tudo em *bandeja > Conquistas*, em *Configurações > Personagem > Ver conquistas* ou perguntando ao assistente: *"minhas conquistas"*. Você também pode dar um **nome** ao personagem em *Configurações > Personagem*.

### Notas

Atalho **Notas** da ilha (ou *Notas* na bandeja): lista com busca à esquerda e o editor à direita, com **negrito, itálico, sublinhado, tachado, código, títulos, listas, listas de tarefas, citação, bloco de código, alinhamento, cor do texto, marca-texto e links**. Cada nota tem a cor do papel (amarelo, rosa, azul, verde, lilás, branco) e pode ser **fixada na área de trabalho** como uma folha flutuante (fora da barra de tarefas e sem ficar por cima dos outros aplicativos). A nota flutuante lembra o lugar e reabre com o app.

### Assistente

Atalho **Assistente** da ilha (ou na bandeja): converse por texto ou **pelo microfone** (a fala vira texto e só vai quando você aperta *Enviar*). Ele entende pedidos como *"crie uma nota escrito comprar pão"*, *"me lembre de ligar para o João amanhã às 15h"*, *"quais são minhas tarefas?"*, *"iniciar foco de 25 minutos"* e *"mudar para o cacto"* (com *Desfazer*). Para perguntas livres ele usa, se você ligar nas configurações, a **Wikipédia** e/ou uma **IA local grátis (Ollama)** — sem chaves e sem tokens. Veja os requisitos do microfone e da IA local em *Configurações > Assistente*.

### Configurações

Engrenagem na ilha aberta, na barra do painel, ou *Configurações* no menu da bandeja.

- **Tamanho da ilha** (80–140 %) e **do Mochi solto** (70–160 %), separados; valem na hora.
- **Personagem:** Mochi (original), Abacaxi, Quadrado, Cogumelo, Cacto, Nuvem, Planeta e Fantasma, com
  prévia de cada um. Todos têm o mesmo rosto, as mesmas animações e reações; mudam o corpo, os
  complementos (folhas, chapéu, braços, anel...), o ritmo (mais agitado, mais sonolento...) e o "som"
  (altura e timbre). Também dá para trocar no menu da bandeja → *Personagem*. A escolha é lembrada e vale
  na hora, na ilha e no modo flutuante.
- **Cor do Mochi** (menta, pêssego, céu, lilás, limão, rosa): vale para o Mochi original; os outros
  personagens têm as próprias cores.
- **Esconder a ilha depois de** 3 s, 6 s, 10 s ou nunca.
- **Não incomodar:** o Mochi sai da frente quando um app está em tela cheia (jogo, vídeo, apresentação) e
  volta depois.
- **Balões de fala** (o Mochi comenta de vez em quando e fica quietinho durante o foco) e **sons suaves**
  (tec, sininhos e uma vozinha fina), com volume.
- **Atalho global** para chamar a ilha direto nas tarefas (padrão **Ctrl+Alt+M**; avisa se outro programa já
  o usa). **Iniciar com o Windows** é opcional e só vale no app instalado.

### Modo foco

Atalho **Foco** na ilha (ou o cartão no painel): 15, 25, 45 ou 60 minutos **ou o tempo que você quiser**
(1 a 180), com pausa configurável. Dá para **vincular uma tarefa** à sessão (e concluí-la no fim). O **ciclo
Pomodoro** (pausa longa a cada 4 focos, com avanço automático opcional) é ligado nas configurações.
Pausar, retomar e cancelar; a pílula recolhida mostra o tempo; "Hoje: n sessões · m min". Ao terminar, o
Mochi comemora e a ilha volta.

### Prazos e lembretes

Ao criar uma tarefa, o relógio ao lado do campo define data e hora (ou use Hoje/Amanhã); em cada tarefa o
selo de prazo permite alterar. Atrasadas e as de hoje ficam destacadas. O Mochi avisa na hora e alguns
minutos antes (configurável) com balão e som; se estiver oculto, vira notificação.

### Google Agenda

Em Configurações → **Google Agenda**, cole o "endereço secreto no formato iCal" da sua agenda (o app explica onde achar). O Mochi mostra a **Agenda de hoje** no topo das tarefas e avisa dos eventos na hora e antes. É somente leitura, o endereço fica criptografado neste computador e nunca é exibido de volta.

### Aparência e brincadeiras

Em Configurações: tema **Automático/Claro/Escuro** do painel. Segurando o Mochi, ele fica com cara de espanto e balança no ar; ao soltar, dá um pulinho.

### Instalador

`npm run dist` gera `release/Mochi Setup <versão>.exe` (instalação por usuário, sem administrador, sem
assinatura de código). `npm run pack` gera só a pasta `release/win-unpacked`. O app sempre **abre como ilha**.
## Dados e preferências

| O quê | Onde |
|---|---|
| Preferências (modo, posição, tamanhos, cor, sons, atalho…) | `%APPDATA%\mochi-desktop\settings.json` |
| Tarefas (SQLite) | `%APPDATA%\mochi-desktop\data\mochi.db` (cópias antes de migrar: `mochi.db.bak-v<n>-<data>`) |

Os dados ficam só neste computador. O app só usa a internet **se você conectar o Google Agenda** (e só para ler a sua agenda); sem isso, nada sai da máquina. Detalhes de formato, migrações e
recuperação em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Para testar o app sem tocar nos seus
dados, rode o Electron com `--user-data-dir=<pasta temporária>` (é o que o `test:e2e` faz).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Guia para o Claude Code: comandos, regras de segurança, convenções, o que não quebrar |
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | O que existe e foi verificado, limitações, resultados de testes, próximo passo |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Módulos, fluxos, IPC, SQLite, relação mascote/ilha/painel/tarefas |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisões técnicas, motivos e limitações |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Próximas funcionalidades, ordem e ideias futuras |
