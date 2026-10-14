import type { Mood } from '../mascot/mascotStates.ts';

/** Coisas que o Mochi pode comentar. Cada uma tem frases curtas (máx. ~38 caracteres). */
export type SpeechEvent =
  | 'hello'
  | 'taskCompleted'
  | 'focusStart'
  | 'focusFinished'
  | 'breakFinished'
  | 'sleepy'
  | 'woke'
  | 'annoyed'
  | 'giggle'
  | 'idle'
  // reações às animações (cada uma tem a sua fala e o seu som)
  | 'happy'
  | 'curious'
  | 'surprised'
  | 'grabbed'
  | 'stretch'
  | 'yawn'
  | 'lookaround';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPartOf(date: Date): DayPart {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

interface Line {
  text: string;
  /** Só neste(s) humor(es). */
  mood?: readonly Mood[];
  /** Só nesta parte do dia. */
  part?: DayPart;
  /** Só nestes dias da semana (0 = domingo ... 6 = sábado). */
  days?: readonly number[];
  /** Só de madrugada (0h às 4h59). */
  late?: boolean;
}

const WEEKEND = [0, 6] as const;

/** Madrugada: da meia-noite às 5h. */
export const isLateNight = (date: Date) => date.getHours() < 5;

const L = (text: string, extra: Omit<Line, 'text'> = {}): Line => ({ text, ...extra });

/** O texto é do Mochi: fofo, brincalhão, nunca cobra nem julga. */
export const LINES: Record<SpeechEvent, readonly Line[]> = {
  hello: [
    L('Bom dia! Vamos nessa?', { part: 'morning' }),
    L('Bom dia~ já tomou água?', { part: 'morning' }),
    L('Dia novo, tarefas novas!', { part: 'morning' }),
    L('Boa tarde! Tudo certo por aí?', { part: 'afternoon' }),
    L('Oi, voltei! Precisa de mim?', { part: 'afternoon' }),
    L('Boa noite! Como foi o dia?', { part: 'evening' }),
    L('Oi~ já fez uma pausa hoje?', { part: 'evening' }),
    L('Já é tarde... bora descansar?', { part: 'night' }),
    L('Madrugada, hein? Água e cama!', { part: 'night' }),
    L('Oi! Tava com saudade.', { mood: ['low'] }),
    // contexto: dia da semana e madrugada
    L('Fim de semana! Sem pressa hoje.', { days: WEEKEND }),
    L('Dia de descanso... vai com calma~', { days: WEEKEND }),
    L('Segunda! Um passo de cada vez.', { days: [1], part: 'morning' }),
    L('Sextou! Falta pouquinho.', { days: [5] }),
    L('Meia-noite já passou... dormir?', { late: true }),
    L('Tá tarde! Salva e vai descansar.', { late: true }),
  ],
  taskCompleted: [
    L('Mais uma! Mandou bem!'),
    L('Feito! Você é demais.'),
    L('Tarefa concluída. Yay!'),
    L('Isso aí!'),
    L('Uma a menos. Orgulho!'),
  ],
  focusStart: [
    L('Foco ligado. Fico quietinho.'),
    L('Bora! Tô torcendo por você.'),
    L('Tec tec... foco total.'),
  ],
  focusFinished: [
    L('Terminou! Hora de respirar.'),
    L('Sessão concluída! Que orgulho.'),
    L('Boa! Que tal uma pausa?'),
  ],
  breakFinished: [
    L('Pausa acabou. Pronto pra mais?'),
    L('Voltando? Eu te espero aqui.'),
  ],
  sleepy: [L('Zzz... só um cochilinho.'), L('Tô com soninho...'), L('Vou dar uma cochilada.')],
  woke: [L('Hm? Ah, oi!'), L('Opa, acordei!'), L('Voltei!')],
  annoyed: [L('Ei, calma! Cócegas!'), L('Para, para! Hihi... não.'), L('Tá bom, já entendi!')],
  giggle: [L('Hihi!'), L('Hehe, cosquinhas!'), L('Aiii, que gostoso!')],
  happy: [L('Hihi, adorei!'), L('Mais um pouquinho~'), L('Que gostoso, obrigado!'), L('Você me deixa feliz.')],
  curious: [
    L('Hm? O que é isso?'),
    L('Tô de olho em você...'),
    L('Oi? Chegou perto, hein.'),
    L('Curioso por aqui...'),
  ],
  surprised: [L('Ai! Que susto!'), L('Opa! Veio rápido!'), L('Eita!'), L('Aaah! Calma!')],
  grabbed: [L('Uuu, tô voando!'), L('Me solta... ou não.'), L('Cuidado comigo!'), L('Wooow!')],
  stretch: [L('Aaahh, que gostoso.'), L('Hora de alongar!'), L('Estalou tudo aqui.')],
  yawn: [L('Aaaah... que sono.'), L('Uaaah! Desculpa.'), L('Tô com soninho...')],
  lookaround: [L('Alguém por aí?'), L('Hum, tudo calmo.'), L('Procurando você...')],
  idle: [
    L('Se precisar, é só chamar.'),
    L('Lembra de beber água!'),
    L('Postura! Ombros pra trás.'),
    L('Que tal alongar um pouquinho?'),
    L('Eu tô aqui, viu?'),
    L('Respira fundo. Isso.'),
    L('Faz tempo sem carinho... snif.', { mood: ['low'] }),
    L('Tava pensando em você.', { mood: ['high'] }),
    L('Dia bom pra riscar tarefas!', { mood: ['high'] }),
    L('Hoje é dia de pausa. Aproveite!', { days: WEEKEND }),
    L('Fim de semana: cuide de você também.', { days: WEEKEND }),
    L('A madrugada pede cama, viu?', { late: true }),
    L('Água e descanso. O resto espera.', { late: true }),
  ],
};

/** Tempo mínimo (ms) entre duas falas do MESMO tipo. Evita repetição sem silenciar eventos importantes. */
const EVENT_COOLDOWN_MS: Record<SpeechEvent, number> = {
  hello: 20 * 60_000,
  taskCompleted: 0,
  focusStart: 0,
  focusFinished: 0,
  breakFinished: 0,
  sleepy: 5 * 60_000,
  woke: 3 * 60_000,
  annoyed: 20_000,
  giggle: 20_000,
  idle: 4 * 60_000,
  // "espaço de tempo" entre falas de uma mesma animação (o som toca sempre; a fala respeita isto)
  happy: 25_000,
  curious: 60_000,
  surprised: 20_000,
  grabbed: 25_000,
  stretch: 60_000,
  yawn: 60_000,
  lookaround: 90_000,
};

/** Falas "de fundo": somem enquanto o foco está correndo (o Mochi fica quietinho). */
const SUPPRESSED_DURING_FOCUS: readonly SpeechEvent[] = [
  'hello',
  'sleepy',
  'woke',
  'giggle',
  'idle',
  'annoyed',
  'happy',
  'curious',
  'surprised',
  'grabbed',
  'stretch',
  'yawn',
  'lookaround',
];

/** Falas que passam por cima do intervalo mínimo geral (respondem a algo que a pessoa fez/terminou). */
const URGENT: readonly SpeechEvent[] = ['taskCompleted', 'focusFinished', 'breakFinished', 'focusStart'];

/**
 * Reações a algo que a pessoa fez ao Mochi (carinho, susto, arraste, cócegas): também passam por cima do
 * intervalo geral, mas cada uma tem o seu próprio intervalo e não contam no teto por hora.
 */
const REACTIVE: readonly SpeechEvent[] = ['happy', 'giggle', 'annoyed', 'surprised', 'grabbed'];

/** Intervalo mínimo entre quaisquer duas falas (ms). */
export const MIN_GAP_MS = 9_000;
/** Teto de falas "de fundo" (hello/idle/sleepy/woke/giggle) por hora. */
export const AMBIENT_PER_HOUR = 10;

export interface SpeechContext {
  now: Date;
  mood: Mood;
  /** Há uma sessão de foco em andamento (rodando ou pausada). */
  focusActive: boolean;
  /** Frases extras do personagem escolhido, somadas às de sempre (a personalidade dele). */
  extra?: Partial<Record<SpeechEvent, readonly string[]>>;
}

export interface Personality {
  /** Texto a dizer agora, ou `null` se não deve falar (intervalo, foco, limite por hora). */
  pick(event: SpeechEvent, context: SpeechContext): string | null;
}

/**
 * Escolhe o que o Mochi diz. Regras: respeita o foco, nunca fala demais (intervalo geral, intervalo
 * por tipo e teto por hora) e evita repetir as últimas frases. `random` é injetável para testes.
 */
export function createPersonality(random: () => number = Math.random): Personality {
  const lastByEvent = new Map<SpeechEvent, number>();
  const recent = new Map<SpeechEvent, string[]>();
  const ambient: number[] = []; // instantes das falas "de fundo" na última hora
  let lastAny = -Infinity;

  return {
    pick(event, ctx) {
      const t = ctx.now.getTime();
      if (ctx.focusActive && SUPPRESSED_DURING_FOCUS.includes(event)) return null;
      const bypassGap = URGENT.includes(event) || REACTIVE.includes(event);
      if (!bypassGap && t - lastAny < MIN_GAP_MS) return null;
      if (t - (lastByEvent.get(event) ?? -Infinity) < EVENT_COOLDOWN_MS[event]) return null;

      const isAmbient = !URGENT.includes(event) && !REACTIVE.includes(event);
      if (isAmbient) {
        while (ambient.length > 0 && t - ambient[0] > 3_600_000) ambient.shift();
        if (ambient.length >= AMBIENT_PER_HOUR) return null;
      }

      const part = dayPartOf(ctx.now);
      const candidates = [
        ...LINES[event].filter(
          (line) =>
            (!line.mood || line.mood.includes(ctx.mood)) &&
            (!line.part || line.part === part) &&
            (!line.days || line.days.includes(ctx.now.getDay())) &&
            (!line.late || isLateNight(ctx.now)),
        ),
        ...(ctx.extra?.[event] ?? []).map((text) => ({ text })),
      ];
      if (candidates.length === 0) return null;
      const seen = recent.get(event) ?? [];
      const fresh = candidates.filter((c) => !seen.includes(c.text));
      const pool = fresh.length > 0 ? fresh : candidates;
      const choice = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].text;

      lastAny = t;
      lastByEvent.set(event, t);
      recent.set(event, [...seen, choice].slice(-3));
      if (isAmbient) ambient.push(t);
      return choice;
    },
  };
}

/**
 * Texto do balão de um lembrete de prazo. O título é cortado para o balão não virar um parágrafo
 * (o texto completo continua na lista de tarefas e na notificação).
 */
export function reminderText(reminder: { kind: 'soon' | 'due'; minutes: number; title: string }): string {
  const head = reminder.kind === 'due' ? 'Chegou a hora:' : `Em ${reminder.minutes} min:`;
  const max = 56 - head.length - 1;
  const title = [...reminder.title.trim()];
  const shown = title.length > max ? `${title.slice(0, max - 1).join('').trimEnd()}…` : title.join('');
  return `${head} ${shown}`;
}

/** Duração de exibição do balão (ms): mínimo confortável + tempo de leitura. */
export function bubbleDurationMs(text: string): number {
  return Math.min(7000, 2600 + text.length * 55);
}
