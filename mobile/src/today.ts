import { dueStatus, type Task } from '../../shared/tasks.ts';

/** O que a tela "Hoje" mostra sobre as tarefas ativas (só tarefas principais; subtarefas não contam). */
export interface TodaySummary {
  overdue: number;
  today: number;
  total: number;
  /** As 3 próximas por prazo (prioridade alta primeiro em empate); tarefas sem prazo ficam de fora. */
  next: Task[];
}

export function summarize(tasks: readonly Task[], now: Date): TodaySummary {
  const main = tasks.filter((t) => !t.completed && t.parentId === null);
  let overdue = 0;
  let today = 0;
  for (const t of main) {
    const s = dueStatus(t, now);
    if (s === 'overdue') overdue++;
    else if (s === 'today') today++;
  }
  const next = main
    .filter((t) => t.dueAt !== null)
    .sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string) || b.priority - a.priority)
    .slice(0, 3);
  return { overdue, today, total: main.length, next };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Título (pelo horário) e frase (pelo que há para fazer) do cabeçalho. */
export function greeting(now: Date, s: TodaySummary): { title: string; line: string } {
  const h = now.getHours();
  const title = h < 5 ? 'Ainda acordado?' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  let line: string;
  if (s.overdue > 0) line = `${s.overdue} ${plural(s.overdue, 'tarefa atrasada pede', 'tarefas atrasadas pedem')} atenção.`;
  else if (s.today > 0) line = `${s.today} ${plural(s.today, 'tarefa', 'tarefas')} para hoje.`;
  else if (s.total > 0) line = 'Nada urgente. Respire.';
  else line = 'Tudo em dia!';
  return { title, line };
}

/** Humor sugerido ao mascote (o controlador também mede o afeto; isto só dá o tom do dia). */
export function mascotMoodHint(s: TodaySummary): 'low' | 'mid' | 'high' {
  if (s.overdue > 0) return 'low';
  if (s.total === 0) return 'high';
  return 'mid';
}
