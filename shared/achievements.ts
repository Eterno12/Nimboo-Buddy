import { balanceOf } from './skins.ts';
/**
 * Vínculo e conquistas: contadores do que a pessoa faz com o Nimboo, regras de desbloqueio e pontuação no
 * estilo "troféus" (bronze, prata, ouro, platina). Puro: sem DOM, Electron ou banco.
 */

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

export const TIER_POINTS: Record<Tier, number> = { bronze: 10, silver: 25, gold: 50, platinum: 100 };
export const TIER_LABEL: Record<Tier, string> = { bronze: 'Bronze', silver: 'Prata', gold: 'Ouro', platinum: 'Platina' };

/** Contadores guardados (tudo numérico; dias são "AAAA-MM-DD" guardados à parte). */
export type StatKey =
  | 'tasks_created'
  | 'tasks_completed'
  | 'notes_created'
  | 'focus_sessions'
  | 'focus_minutes'
  | 'pets'
  | 'assistant_commands'
  | 'voice_used'
  | 'event_tasks'
  | 'subtasks'
  | 'characters_used'
  | 'days_total'
  | 'streak'
  | 'longest_streak'
  | 'night_owl'
  | 'early_bird';

export type Stats = Partial<Record<StatKey, number>>;

export interface BondDays {
  /** Primeiro dia de uso e último dia visto (AAAA-MM-DD). */
  firstDay: string | null;
  lastDay: string | null;
  /** Personagens já usados (para "Colecionador"). */
  characters: string[];
}

export interface BondState {
  stats: Stats;
  days: BondDays;
}

export const EMPTY_BOND: BondState = Object.freeze({
  stats: {},
  days: { firstDay: null, lastDay: null, characters: [] },
}) as BondState;

export type BondEvent =
  | { type: 'open' }
  | { type: 'task_created' }
  | { type: 'task_completed' }
  | { type: 'note_created' }
  | { type: 'focus_finished'; minutes: number }
  | { type: 'pet' }
  | { type: 'assistant' }
  | { type: 'voice' }
  | { type: 'event_task' }
  | { type: 'subtask' }
  | { type: 'character'; id: string };

/** Eventos que a interface pode enviar (os demais nascem no processo principal). */
export const RENDERER_EVENTS = ['pet', 'assistant', 'voice', 'event_task', 'subtask'] as const;

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  tier: Tier;
  /** Ícone (nome do desenho em `AchievementIcon`). */
  icon: 'check' | 'note' | 'focus' | 'heart' | 'calendar' | 'flame' | 'chat' | 'star' | 'moon' | 'sun' | 'people' | 'list' | 'mic' | 'trophy';
  /** Contador que mede o progresso e a meta; sem isso, `check` decide. */
  stat?: StatKey;
  target?: number;
  /** Só aparece (título e descrição) depois de desbloqueada. */
  hidden?: boolean;
}

const def = (d: AchievementDef): AchievementDef => d;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  def({ id: 'first_task', title: 'Primeira tarefa', description: 'Conclua uma tarefa.', tier: 'bronze', icon: 'check', stat: 'tasks_completed', target: 1 }),
  def({ id: 'tasks_10', title: 'Pegando o ritmo', description: 'Conclua 10 tarefas.', tier: 'silver', icon: 'check', stat: 'tasks_completed', target: 10 }),
  def({ id: 'tasks_50', title: 'Máquina de fazer', description: 'Conclua 50 tarefas.', tier: 'gold', icon: 'check', stat: 'tasks_completed', target: 50 }),
  def({ id: 'tasks_200', title: 'Lenda da lista', description: 'Conclua 200 tarefas.', tier: 'gold', icon: 'trophy', stat: 'tasks_completed', target: 200 }),
  def({ id: 'first_note', title: 'Primeira anotação', description: 'Crie uma nota.', tier: 'bronze', icon: 'note', stat: 'notes_created', target: 1 }),
  def({ id: 'notes_10', title: 'Caderno cheio', description: 'Crie 10 notas.', tier: 'silver', icon: 'note', stat: 'notes_created', target: 10 }),
  def({ id: 'first_focus', title: 'Foco total', description: 'Conclua uma sessão de foco.', tier: 'bronze', icon: 'focus', stat: 'focus_sessions', target: 1 }),
  def({ id: 'focus_10', title: 'Concentração de ferro', description: 'Conclua 10 sessões de foco.', tier: 'silver', icon: 'focus', stat: 'focus_sessions', target: 10 }),
  def({ id: 'focus_300', title: 'Cinco horas de foco', description: 'Acumule 300 minutos de foco.', tier: 'gold', icon: 'flame', stat: 'focus_minutes', target: 300 }),
  def({ id: 'pets_25', title: 'Carinhoso', description: 'Faça 25 carinhos no Nimboo.', tier: 'bronze', icon: 'heart', stat: 'pets', target: 25 }),
  def({ id: 'pets_200', title: 'Melhor amigo', description: 'Faça 200 carinhos.', tier: 'silver', icon: 'heart', stat: 'pets', target: 200 }),
  def({ id: 'days_7', title: 'Uma semana juntos', description: 'Use o Nimboo em 7 dias diferentes.', tier: 'bronze', icon: 'calendar', stat: 'days_total', target: 7 }),
  def({ id: 'days_30', title: 'Um mês de amizade', description: 'Use o Nimboo em 30 dias diferentes.', tier: 'gold', icon: 'calendar', stat: 'days_total', target: 30 }),
  def({ id: 'streak_3', title: 'Três seguidos', description: 'Use o Nimboo 3 dias seguidos.', tier: 'bronze', icon: 'flame', stat: 'longest_streak', target: 3 }),
  def({ id: 'streak_7', title: 'Semana em chamas', description: 'Use o Nimboo 7 dias seguidos.', tier: 'silver', icon: 'flame', stat: 'longest_streak', target: 7 }),
  def({ id: 'streak_30', title: 'Imparável', description: 'Use o Nimboo 30 dias seguidos.', tier: 'gold', icon: 'flame', stat: 'longest_streak', target: 30 }),
  def({ id: 'subtasks_1', title: 'Quebrando em pedaços', description: 'Crie uma subtarefa.', tier: 'bronze', icon: 'list', stat: 'subtasks', target: 1 }),
  def({ id: 'event_task_1', title: 'Agenda na mão', description: 'Transforme um evento da agenda em tarefa.', tier: 'bronze', icon: 'calendar', stat: 'event_tasks', target: 1 }),
  def({ id: 'assistant_1', title: 'Bate-papo', description: 'Peça algo ao assistente.', tier: 'bronze', icon: 'chat', stat: 'assistant_commands', target: 1 }),
  def({ id: 'assistant_25', title: 'Dupla dinâmica', description: 'Dê 25 pedidos ao assistente.', tier: 'silver', icon: 'chat', stat: 'assistant_commands', target: 25 }),
  def({ id: 'voice_1', title: 'Fala, Nimboo!', description: 'Use o microfone com o assistente.', tier: 'silver', icon: 'mic', stat: 'voice_used', target: 1 }),
  def({ id: 'collector', title: 'Colecionador', description: 'Use 3 personagens diferentes.', tier: 'silver', icon: 'people', stat: 'characters_used', target: 3 }),
  def({ id: 'night_owl', title: 'Coruja', description: 'Use o Nimboo de madrugada.', tier: 'bronze', icon: 'moon', stat: 'night_owl', target: 1, hidden: true }),
  def({ id: 'early_bird', title: 'Madrugador', description: 'Use o Nimboo antes das 7h.', tier: 'bronze', icon: 'sun', stat: 'early_bird', target: 1, hidden: true }),
];

/** A platina: todas as outras. */
export const PLATINUM: AchievementDef = def({
  id: 'platinum',
  title: 'Platina',
  description: 'Desbloqueie todas as outras conquistas.',
  tier: 'platinum',
  icon: 'star',
});

export const ALL_ACHIEVEMENTS: readonly AchievementDef[] = [...ACHIEVEMENTS, PLATINUM];

export const MAX_POINTS = ALL_ACHIEVEMENTS.reduce((sum, a) => sum + TIER_POINTS[a.tier], 0);

const p2 = (n: number) => String(n).padStart(2, '0');
export const dayOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

const inc = (stats: Stats, key: StatKey, by = 1): Stats => ({ ...stats, [key]: (stats[key] ?? 0) + by });

/**
 * Aplica um evento ao estado (puro). Toda atividade marca o dia (dias, sequência) e as horas
 * "madrugada" (0–4h) e "madrugador" (5–6h).
 */
export function applyBondEvent(state: BondState, event: BondEvent, now: Date = new Date()): BondState {
  let stats: Stats = { ...state.stats };
  const days: BondDays = { ...state.days, characters: [...state.days.characters] };

  // marca o dia
  const today = dayOf(now);
  if (days.lastDay !== today) {
    stats = inc(stats, 'days_total');
    if (days.firstDay === null) days.firstDay = today;
    const consecutive = days.lastDay !== null && dayDiff(days.lastDay, today) === 1;
    const streak = consecutive ? (stats.streak ?? 0) + 1 : 1;
    stats.streak = streak;
    stats.longest_streak = Math.max(stats.longest_streak ?? 0, streak);
    days.lastDay = today;
  }
  const hour = now.getHours();
  if (event.type !== 'open') {
    if (hour < 5) stats.night_owl = 1;
    else if (hour < 7) stats.early_bird = 1;
  }

  switch (event.type) {
    case 'task_created':
      stats = inc(stats, 'tasks_created');
      break;
    case 'task_completed':
      stats = inc(stats, 'tasks_completed');
      break;
    case 'note_created':
      stats = inc(stats, 'notes_created');
      break;
    case 'focus_finished':
      stats = inc(stats, 'focus_sessions');
      stats = inc(stats, 'focus_minutes', Math.max(0, Math.min(600, Math.round(event.minutes))));
      break;
    case 'pet':
      stats = inc(stats, 'pets');
      break;
    case 'assistant':
      stats = inc(stats, 'assistant_commands');
      break;
    case 'voice':
      stats = inc(stats, 'voice_used');
      break;
    case 'event_task':
      stats = inc(stats, 'event_tasks');
      break;
    case 'subtask':
      stats = inc(stats, 'subtasks');
      break;
    case 'character':
      if (/^[a-z]{2,20}$/.test(event.id) && !days.characters.includes(event.id)) {
        days.characters.push(event.id);
        stats.characters_used = days.characters.length;
      }
      break;
    case 'open':
      break;
  }
  return { stats, days };
}

export interface Progress {
  current: number;
  target: number;
  fraction: number;
}

export function progressOf(def: AchievementDef, stats: Stats, unlocked: ReadonlySet<string>): Progress {
  if (def.id === PLATINUM.id) {
    const others = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).length;
    return { current: others, target: ACHIEVEMENTS.length, fraction: others / ACHIEVEMENTS.length };
  }
  const target = def.target ?? 1;
  const current = Math.min(target, stats[def.stat as StatKey] ?? 0);
  return { current, target, fraction: target > 0 ? current / target : 0 };
}

/** Ids que passaram a valer agora (e ainda não estavam desbloqueados), em ordem; a platina vem por último. */
export function newlyUnlocked(stats: Stats, unlocked: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    if (progressOf(a, stats, unlocked).fraction >= 1) out.push(a.id);
  }
  const all = new Set([...unlocked, ...out]);
  if (!all.has(PLATINUM.id) && ACHIEVEMENTS.every((a) => all.has(a.id))) out.push(PLATINUM.id);
  return out;
}

export function pointsOf(unlocked: ReadonlySet<string>): number {
  return ALL_ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).reduce((sum, a) => sum + TIER_POINTS[a.tier], 0);
}

/** Apelido do nível de amizade, pelos dias juntos e pelos carinhos. */
export function bondTitle(stats: Stats): string {
  const days = stats.days_total ?? 0;
  if (days >= 60) return 'Melhores amigos';
  if (days >= 21) return 'Grandes amigos';
  if (days >= 7) return 'Amigos';
  if (days >= 2) return 'Conhecidos';
  return 'Recém-chegado';
}

// ---- Visão para a interface -------------------------------------------------------------

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  tier: Tier;
  icon: AchievementDef['icon'];
  unlocked: boolean;
  unlockedAt: string | null;
  hidden: boolean;
  progress: Progress;
}

export interface BondSnapshot {
  stats: Stats;
  days: BondDays;
  achievements: AchievementView[];
  points: number;
  maxPoints: number;
  unlockedCount: number;
  total: number;
  title: string;
  /** Afeto persistido (0..1) para o Nimboo lembrar do humor. */
  affection: number;
  /** Pontos ainda não gastos em acessórios (o total e a amizade não mudam). */
  balance: number;
  /** Ids dos acessórios comprados. */
  ownedSkins: string[];
}

export function buildSnapshot(
  state: BondState,
  unlockedAt: Readonly<Record<string, string>>,
  affection: number,
  ownedSkins: readonly string[] = [],
): BondSnapshot {
  const unlocked = new Set(Object.keys(unlockedAt));
  const achievements = ALL_ACHIEVEMENTS.map((a): AchievementView => {
    const isUnlocked = unlocked.has(a.id);
    const hidden = !!a.hidden && !isUnlocked;
    return {
      id: a.id,
      title: hidden ? '???' : a.title,
      description: hidden ? 'Conquista secreta.' : a.description,
      tier: a.tier,
      icon: hidden ? 'star' : a.icon,
      unlocked: isUnlocked,
      unlockedAt: unlockedAt[a.id] ?? null,
      hidden,
      progress: progressOf(a, state.stats, unlocked),
    };
  });
  return {
    stats: state.stats,
    days: state.days,
    achievements,
    points: pointsOf(unlocked),
    maxPoints: MAX_POINTS,
    unlockedCount: unlocked.size,
    total: ALL_ACHIEVEMENTS.length,
    title: bondTitle(state.stats),
    affection,
    balance: balanceOf(pointsOf(unlocked), ownedSkins),
    ownedSkins: [...ownedSkins],
  };
}
