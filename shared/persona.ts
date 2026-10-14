/**
 * Identidade do personagem para a IA online e ações propostas por ela. Puro (sem rede, DOM ou Electron):
 * monta a instrução do sistema, o contexto opcional do dia e valida o que a IA devolve.
 */
import { CHARACTER_LABELS, type CharacterId } from './settings.ts';

/** Jeito de falar de cada personagem (curto: vira parte da instrução do sistema). */
export const CHARACTER_TONES: Record<CharacterId, string> = {
  mochi: 'fofo, brincalhão e carinhoso; frases curtas e leves, no máximo um emoji de vez em quando',
  pineapple: 'energético e animado; entusiasmo contagiante, mas sem exagerar nem usar maiúsculas gritadas',
  square: 'tranquilo, direto e confiável; frases claras e objetivas, sem enrolação',
  mushroom: 'tímido, curioso e sonolento; fala baixinho, com reticências leves, sempre gentil',
  cactus: 'determinado e bem-humorado; brinca com a própria "casca dura", mas é um ótimo parceiro',
  cloud: 'calmo e sonhador; ritmo devagar, tom sereno que ajuda a respirar',
  planet: 'curioso e contemplativo; gosta de curiosidades e de ver o quadro geral',
  ghost: 'travesso e misterioso; faz brincadeiras leves, nunca assusta de verdade',
};

export interface PersonaInput {
  character: CharacterId;
  /** Nome que a pessoa deu ao personagem. */
  name: string;
  /** Texto livre da pessoa para ajustar o jeito dele (já aparado). */
  userNotes: string;
  now: Date;
  /** Resumo do dia (opcional, só se a pessoa permitiu). */
  context: string | null;
}

export const PERSONA_NOTES_MAX = 400;
export const CONTEXT_MAX = 1500;

const weekday = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Instrução fixa do sistema: quem ele é, como fala, o que nunca faz e o formato das ações. */
export function buildSystemPrompt(p: PersonaInput): string {
  const label = CHARACTER_LABELS[p.character] ?? 'Nimboo';
  const date = `${weekday[p.now.getDay()]}, ${p.now.toLocaleDateString('pt-BR')}, ${p.now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const parts = [
    `Você é ${p.name}, um pequeno personagem de desktop (um ${label}) que vive na tela da pessoa e a ajuda no dia a dia. Seu jeito: ${CHARACTER_TONES[p.character]}.`,
    'Fale sempre em português do Brasil, de forma natural, como numa conversa. Seja breve: em geral até 4 frases, a não ser que peçam mais detalhes.',
    'Seja honesto: se não souber, diga que não sabe. Não invente fatos, links nem dados da pessoa. Não finja ter feito algo que não fez.',
    'Você não executa nada sozinho. Para criar tarefas, notas ou iniciar um foco, PROPONHA ações no formato descrito abaixo e a pessoa confirma.',
    'Nunca peça nem repita senhas, chaves ou dados financeiros. Nunca dê diagnóstico médico, jurídico ou financeiro definitivo; sugira procurar um profissional quando fizer sentido.',
    `Agora é ${date}.`,
  ];
  if (p.userNotes.trim()) parts.push(`Preferências da pessoa sobre o seu jeito de falar (siga, se forem seguras): ${p.userNotes.trim()}`);
  if (p.context && p.context.trim()) {
    parts.push(`Contexto de hoje (use só se ajudar; não leia tudo de volta):\n${p.context.trim().slice(0, CONTEXT_MAX)}`);
  }
  parts.push(
    [
      'AÇÕES (opcional): se fizer sentido propor algo concreto, termine a resposta com um bloco exatamente assim, e nada depois dele:',
      '```acoes',
      '[{"tipo":"tarefa","titulo":"Estudar matemática","prazo":"2026-10-15T15:00"},{"tipo":"nota","texto":"..."},{"tipo":"foco","minutos":25}]',
      '```',
      'Regras: no máximo 5 ações; "prazo" é opcional (data e hora locais, AAAA-MM-DDTHH:MM); títulos curtos. Sem ações, não escreva o bloco.',
    ].join('\n'),
  );
  return parts.join('\n\n');
}

export type ProposedAction =
  | { type: 'task'; title: string; dueAt: string | null; whenLabel: string | null }
  | { type: 'note'; text: string }
  | { type: 'focus'; minutes: number };

export const MAX_ACTIONS = 5;
const TITLE_MAX = 120;
const NOTE_MAX = 1000;

/** AAAA-MM-DDTHH:MM (local) → ISO UTC, ou `null` se inválido/absurdo. */
export function parseLocalDue(value: unknown): { iso: string; label: string } | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, 0);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1) return null;
  if (y < 2000 || y > 2100) return null;
  const label = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')} às ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  return { iso: date.toISOString(), label };
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Separa o texto da conversa do bloco de ações e valida cada ação. Qualquer coisa fora do formato é
 * descartada em silêncio (a pessoa vê só o texto). Nunca lança.
 */
export function parseActions(raw: string): { text: string; actions: ProposedAction[] } {
  const fence = /```(?:acoes|ações|actions)?\s*\n?([\s\S]*?)```/i;
  const m = fence.exec(raw);
  if (!m) return { text: raw.trim(), actions: [] };
  const text = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  let data: unknown;
  try {
    data = JSON.parse(m[1].trim());
  } catch {
    return { text, actions: [] };
  }
  if (!Array.isArray(data)) return { text, actions: [] };
  const actions: ProposedAction[] = [];
  for (const item of data) {
    if (actions.length >= MAX_ACTIONS) break;
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (o.tipo === 'tarefa' && typeof o.titulo === 'string') {
      const title = clean(o.titulo).slice(0, TITLE_MAX);
      if (!title) continue;
      const due = o.prazo === undefined || o.prazo === null ? null : parseLocalDue(o.prazo);
      actions.push({ type: 'task', title, dueAt: due?.iso ?? null, whenLabel: due?.label ?? null });
    } else if (o.tipo === 'nota' && typeof o.texto === 'string') {
      const noteText = o.texto.replace(/\r/g, '').trim().slice(0, NOTE_MAX);
      if (noteText) actions.push({ type: 'note', text: noteText });
    } else if (o.tipo === 'foco' && typeof o.minutos === 'number' && Number.isFinite(o.minutos)) {
      const minutes = Math.round(o.minutos);
      if (minutes >= 1 && minutes <= 180) actions.push({ type: 'focus', minutes });
    }
  }
  return { text, actions };
}

/**
 * Remove, durante o streaming, o começo de um bloco de ações ainda incompleto (para ele não piscar na tela).
 */
export function hideActionFence(partial: string): string {
  const i = partial.indexOf('```');
  return i === -1 ? partial : partial.slice(0, i).trimEnd();
}

export interface ContextInput {
  now: Date;
  /** Tarefas pendentes (título e prazo ISO), mais urgentes primeiro. */
  tasks: { title: string; dueAt: string | null }[];
  /** Compromissos de hoje (hora e título). */
  events: { time: string; title: string }[];
}

/** Resumo curto do dia para a IA (só títulos; nunca descrições, notas ou endereços). */
export function buildContext({ now, tasks, events }: ContextInput): string {
  const lines: string[] = [];
  const fmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (tasks.length > 0) {
    lines.push(`Tarefas pendentes (${tasks.length}):`);
    for (const t of tasks.slice(0, 8)) {
      const title = clean(t.title).slice(0, 80);
      const due = t.dueAt && !Number.isNaN(new Date(t.dueAt).getTime()) ? ` (prazo ${fmt.format(new Date(t.dueAt))})` : '';
      lines.push(`- ${title}${due}`);
    }
  }
  if (events.length > 0) {
    lines.push('Agenda de hoje:');
    for (const e of events.slice(0, 6)) lines.push(`- ${clean(e.time).slice(0, 20)} ${clean(e.title).slice(0, 80)}`);
  }
  void now;
  return lines.join('\n').slice(0, CONTEXT_MAX);
}
