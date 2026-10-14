# Plano de evolução (do estado atual a um "buddy" completo)

Cada etapa só começa **depois da sua confirmação** (marque ✅ ao aprovar). Cada etapa termina com testes,
documentação (STATUS/DECISIONS) e **sem commit automático**, a menos que você peça. Tamanho: P (≤ 1 sessão),
M (1–2), G (2+).

| # | Etapa | Tam. | Depende de | Decisão que preciso de você |
|---|---|---|---|---|
| 0 ✅ | **Higiene:** commits, instalador 0.4, `characters.css` separado, exportar/importar (JSON) | M | — | feito — resta dividir `SettingsView.tsx` e `main.ts` quando mexermos neles |
| 1 ✅ | **Tarefas completas:** editar título, reordenar (arrastar), recorrência (diária/dias úteis/semanal/mensal), adiar "+10 min", prioridade e várias subtarefas | G | 0 | feito (recorrência gera a próxima ao concluir; subtarefas de 1 nível, várias por tarefa) |
| 2 ✅ | **Malha de ligações:** nota → tarefa, tarefa → nota, nota/tarefa anexada a evento da agenda | M | 1 | feito (1 nota por tarefa; pauta por evento; migração v6) |
| 3 ✅ | **Rotina do dia:** resumo ao abrir e fechamento à noite (tarefas, eventos, atrasadas) | M | 1 | feito (resumo no 1º uso do dia; fechamento às 18h por padrão, 17–21h; desligáveis) |
| 4 ✅ | **Vínculo e memória:** afeto/humor persistentes, dias de convivência, conquistas, nome do personagem | M | — | feito (conquistas como troféus com aviso e tela própria; afeto persistente; nome do personagem) |
| 5 ✅ | **Bem-estar:** água, postura, descanso dos olhos, alongar na pausa longa (liga com o foco) | P | 4 | feito (tudo desligado por padrão; água 60, postura 45, olhos 20 min; alongar depois do foco) |
| 6 ✅ | **Estatísticas:** semana de foco, tarefas concluídas, sequência | P | 1, 4 | feito (seção "Sua semana" na janela de conquistas: cartões + barras; "minha semana" no assistente) |
| 7 ✅ | **Contexto:** reações a hora/dia (madrugada, fim de semana), comemoração ao concluir tarefa difícil | P | 4 | feito (falas por dia da semana/madrugada; tarefa difícil = prioridade alta, atrasada, 2+ subtarefas ou 3+ dias parada) |
| 8 ✅ | **Assistente+:** mais comandos (adiar, fixar nota, "o que tenho amanhã?"), histórico local apagável, atalho global para falar | M | 1–2 | feito (histórico visível e apagável, ligado por padrão; atalho opcional Ctrl+Alt+V/A ou Ctrl+Shift+V, desligado por padrão) |
| 9 ✅ | **Voz:** resposta falada (TTS do Windows) por personagem; **reconhecimento offline** (Whisper local) | G | 8 | encerrada por decisão sua: o personagem **não fala**; fica só com os sons e balões que já existem (sem TTS, sem Whisper, sem download) |
| 10 ✅ | **IA com ações:** o Ollama propõe ações e você confirma por cartão | M | 8 | refeita por decisão sua: **Gemini (Google) com sua chave grátis**, conversa com identidade por personagem, streaming e cartões de ação (Aceitar/Ignorar); Ollama segue como opção antiga |
| 11 ✅ | **Agenda:** várias agendas iCal; notificações com botões (Concluir / Adiar) | M | 1 | feito (até 5 agendas; aviso próprio no canto da tela, porque o Electron não suporta botões nas notificações nativas do Windows) |
| 12 ✅ | **Primeira execução guiada** (personagem, agenda, voz/IA) | M | 4, 9 | — |
| 13 | **Acessibilidade e multi-monitor:** teclado na ilha, leitor de tela, DPI 125/150 %, 2º monitor | M | — | Você testa em outro monitor comigo? |
| 14 | **Distribuição:** assinatura de código, atualização automática, log de erros local | G | todas | Você tem/quer certificado de código? |
| 15 | **Opcionais grandes:** nota atrás dos apps (WorkerW), sincronização/mobile (S1–S13), criar evento no Google (OAuth) | G | — | Só se quiser; são os mais arriscados |

## Ordem sugerida
`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14` (15 só sob demanda).
Agrupamentos para confirmar de uma vez, se preferir: **A** = 0–2 (organização), **B** = 3–7 (o "buddy"),
**C** = 8–10 (assistente), **D** = 11–14 (acabamento e distribuição).

## Regras de trabalho
- Antes de cada etapa: eu resumo o que vou mexer e as decisões da coluna acima; você responde "pode".
- Mudanças de banco sempre por migração com backup automático (já existe).
- Nada de rede nova sem decisão registrada; tudo que usa internet segue opt-in.
- Cada etapa entrega: testes unitários, e2e, capturas quando houver tela, docs atualizados.
