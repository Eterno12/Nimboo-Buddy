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
- **Sem campos de sincronização** ainda (pedido explícito). **Limitações conhecidas:** exclusão sem
  *tombstone*, `updated_at` do relógio local, `create` gera o id no repositório (ver
  `PROJECT_STATUS.md` #4–#8).

## D8 — Retenção: concluídas somem 30 dias após `completed_at`
- **Por quê:** requisito do usuário. Aplicada na abertura, em `list`/`get`/mutações e de hora em hora.
  Ativas nunca são removidas; reabrir limpa `completed_at`.
- **Limitação:** é um `DELETE` local; com sync deve virar regra derivada, não exclusão propagada.

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
