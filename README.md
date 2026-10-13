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

## Dados e preferências

| O quê | Onde |
|---|---|
| Preferências (modo, posição) | `%APPDATA%\mochi-desktop\settings.json` |
| Tarefas (SQLite) | `%APPDATA%\mochi-desktop\data\mochi.db` |

Os dados ficam só neste computador; o app não usa a internet. Detalhes de formato, migrações e
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
