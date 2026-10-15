import { dueStatus, isTaskId, type Task } from '../../shared/tasks.ts';
import { poseFor, type WidgetPose } from '../../shared/mascotPose.ts';
import type { Profile } from './profile.ts';

/** O que o widget da tela inicial mostra. O app escreve; o Android (código nativo) só lê. */
export interface WidgetTask {
  id: string;
  title: string;
  /** "14:30" se for hoje, "amanhã 09:00", "12/10 09:00" ou "" sem prazo. */
  due: string;
  overdue: boolean;
  priority: number;
}

export interface WidgetSnapshot {
  version: 1;
  /** ISO de quando foi escrito. */
  updatedAt: string;
  character: string;
  color: string;
  skin: string | null;
  name: string;
  pose: WidgetPose;
  overdue: number;
  today: number;
  total: number;
  tasks: WidgetTask[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function dueLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return time;
  if (diff === 1) return `amanhã ${time}`;
  if (diff === -1) return `ontem ${time}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

/** Resumo para o widget: até 3 tarefas (atrasadas e próximas), contadores e a pose do mascote. */
export function buildWidgetSnapshot(tasks: readonly Task[], nowMs: number, profile: Profile): WidgetSnapshot {
  const now = new Date(nowMs);
  const mains = tasks.filter((t) => t.parentId === null);
  const active = mains.filter((t) => !t.completed);
  let overdue = 0;
  let today = 0;
  for (const t of active) {
    const s = dueStatus(t, now);
    if (s === 'overdue') overdue++;
    else if (s === 'today') today++;
  }
  const dated = active
    .filter((t) => t.dueAt !== null)
    .sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string) || b.priority - a.priority);
  const list = dated.slice(0, 3);
  const nextFuture = dated.find((t) => Date.parse(t.dueAt as string) > nowMs);
  const lastCompleted = mains
    .filter((t) => t.completed && t.completedAt)
    .map((t) => Date.parse(t.completedAt as string))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return {
    version: 1,
    updatedAt: now.toISOString(),
    character: profile.character,
    color: profile.color,
    skin: profile.skin,
    name: profile.name,
    pose: poseFor({
      now: nowMs,
      overdue,
      nextDueInMin: nextFuture ? Math.round((Date.parse(nextFuture.dueAt as string) - nowMs) / 60_000) : null,
      lastCompletedMsAgo: lastCompleted === undefined ? null : nowMs - lastCompleted,
      hour: now.getHours(),
    }),
    overdue,
    today,
    total: active.length,
    tasks: list.map((t) => ({
      id: t.id,
      title: t.title,
      due: t.dueAt ? dueLabel(t.dueAt, now) : '',
      overdue: dueStatus(t, now) === 'overdue',
      priority: t.priority,
    })),
  };
}

export interface InboxAction {
  action: 'complete';
  taskId: string;
}

/** Lê o que o widget deixou para o app fazer (só "concluir", com ids válidos, sem repetir). */
export function parseInbox(text: string | null): InboxAction[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: InboxAction[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const { action, taskId } = item as { action?: unknown; taskId?: unknown };
      if (action !== 'complete' || !isTaskId(taskId) || seen.has(taskId)) continue;
      seen.add(taskId);
      out.push({ action: 'complete', taskId });
    }
    return out;
  } catch {
    return [];
  }
}
