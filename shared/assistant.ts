/**
 * Assistente local: entende frases curtas em português ("crie uma nota escrito comprar pão", "me lembre
 * de ligar para o João amanhã às 15h", "iniciar foco de 25 minutos") e as transforma em um comando
 * tipado. Puro (sem DOM, Electron ou rede): quem executa é a interface, usando as APIs que já existem.
 */
import { CHARACTERS, CHARACTER_LABELS, type CharacterId } from './settings.ts';

export type AssistantCommand =
  | { kind: 'note.create'; text: string }
  | { kind: 'task.create'; title: string; dueAt: string | null; whenLabel: string | null }
  | { kind: 'task.complete'; query: string }
  | { kind: 'list.tasks' }
  | { kind: 'list.agenda' }
  | { kind: 'list.notes' }
  | { kind: 'summary' }
  | { kind: 'achievements' }
  | { kind: 'focus.start'; minutes: number | null }
  | { kind: 'focus.pause' }
  | { kind: 'focus.resume' }
  | { kind: 'focus.cancel' }
  | { kind: 'open.notes' }
  | { kind: 'open.settings' }
  | { kind: 'character.set'; id: CharacterId }
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'ask'; question: string };

/** Minúsculas e sem acentos, mantendo o MESMO comprimento (os índices valem para o texto original). */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    // um caractere vira um caractere (senão os índices deixariam de bater com o original)
    out += [...base].length === 1 && base.length === ch.length ? base : ch.toLowerCase().slice(0, ch.length);
  }
  return out;
}

const WEEKDAYS: [string, number][] = [
  ['domingo', 0],
  ['segunda', 1],
  ['terca', 2],
  ['quarta', 3],
  ['quinta', 4],
  ['sexta', 5],
  ['sabado', 6],
];

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n: number) => String(n).padStart(2, '0');

interface Span {
  start: number;
  end: number;
}

interface ParsedWhen {
  dueAt: string | null;
  label: string | null;
  /** Trechos do texto original que expressam o prazo (removidos do título). */
  spans: Span[];
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, 'meia': 30,
};

const num = (s: string): number | null => {
  if (/^\d+$/.test(s)) return Number(s);
  return NUMBER_WORDS[s] ?? null;
};

/**
 * Procura um prazo no texto ("amanhã às 15h", "hoje 18:30", "em 2 horas", "na sexta", "dia 20").
 * `now` é injetável (testes). Datas sem hora ficam às 09:00; só a hora = hoje (ou amanhã, se já passou).
 */
export function parseWhen(original: string, now: Date): ParsedWhen {
  const f = fold(original);
  const spans: Span[] = [];
  const take = (m: RegExpExecArray | null): RegExpExecArray | null => {
    if (m) spans.push({ start: m.index, end: m.index + m[0].length });
    return m;
  };

  // relativo: "em 30 minutos", "daqui a 2 horas", "daqui 10 min"
  const rel = take(/\b(?:em|daqui(?:\s+a)?)\s+(\d+|um|uma|dois|duas|tres|quatro|cinco|dez|quinze|vinte|trinta|quarenta|meia)\s*(minutos?|min|horas?|h|hr|dias?)\b/.exec(f));
  if (rel) {
    const n = num(rel[1]);
    if (n !== null) {
      const unit = rel[2];
      const ms = unit.startsWith('d') ? n * 86_400_000 : unit.startsWith('h') ? n * 3_600_000 : n * 60_000;
      const due = new Date(now.getTime() + ms);
      due.setSeconds(0, 0);
      return { dueAt: due.toISOString(), label: `em ${n} ${unit.startsWith('d') ? 'dia(s)' : unit.startsWith('h') ? 'hora(s)' : 'minuto(s)'}`, spans };
    }
    spans.pop();
  }

  // dia
  let day: Date | null = null;
  let dayLabel: string | null = null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (n: number) => new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + n);

  if (take(/\bdepois\s+de\s+amanha\b/.exec(f))) {
    day = addDays(2);
    dayLabel = 'depois de amanhã';
  } else if (take(/\bamanha\b/.exec(f))) {
    day = addDays(1);
    dayLabel = 'amanhã';
  } else if (take(/\bhoje\b/.exec(f))) {
    day = addDays(0);
    dayLabel = 'hoje';
  } else {
    const wd = new RegExp(`\\b(?:(?:na|no|para\\s+(?:a|o)|pra|ate\\s+(?:a|o)|nesta|neste)\\s+)?(${WEEKDAYS.map(([n]) => n).join('|')})(?:-feira)?(?:\\s+que\\s+vem)?\\b`).exec(f);
    if (wd && take(wd)) {
      const target = WEEKDAYS.find(([n]) => n === wd[1])![1];
      const diff = (target - startOfToday.getDay() + 7) % 7 || 7;
      day = addDays(diff);
      dayLabel = original.slice(wd.index, wd.index + wd[0].length).trim();
    } else {
      const dm = /\bdia\s+(\d{1,2})(?:\s+de\s+([a-z]+))?\b/.exec(f);
      if (dm && take(dm)) {
        const d = Number(dm[1]);
        let month = now.getMonth();
        if (dm[2]) {
          const idx = MONTHS.indexOf(dm[2]);
          if (idx >= 0) month = idx;
        }
        if (d >= 1 && d <= 31) {
          let candidate = new Date(now.getFullYear(), month, d);
          if (candidate.getTime() < startOfToday.getTime()) {
            candidate = dm[2] ? new Date(now.getFullYear() + 1, month, d) : new Date(now.getFullYear(), month + 1, d);
          }
          day = candidate;
          dayLabel = `dia ${d}${dm[2] ? ` de ${dm[2]}` : ''}`;
        } else {
          spans.pop();
        }
      }
    }
  }

  // hora
  let hours: number | null = null;
  let minutes = 0;
  const ampm = /\b(?:de|da)\s+(manha|tarde|noite|madrugada)\b/;
  const t1 = take(/\bas\s+(\d{1,2})(?:\s*(?:h|horas?)(?:\s*(\d{2}))?|:(\d{2})|\b)(?:\s+(?:da|de)\s+(manha|tarde|noite|madrugada))?/.exec(f));
  if (t1) {
    hours = Number(t1[1]);
    minutes = t1[2] ? Number(t1[2]) : t1[3] ? Number(t1[3]) : 0;
    const part = t1[4] ?? ampm.exec(f)?.[1];
    if (part && part !== 'manha' && part !== 'madrugada' && hours < 12) hours += 12;
  } else {
    const t2 = take(/\b(\d{1,2})(?::|h)(\d{2})\b|\b(\d{1,2})\s*h\b(?!\w)/.exec(f));
    if (t2) {
      hours = Number(t2[1] ?? t2[3]);
      minutes = t2[2] ? Number(t2[2]) : 0;
      const part = ampm.exec(f);
      if (part && part[1] !== 'manha' && part[1] !== 'madrugada' && hours < 12) hours += 12;
    } else if (take(/\bmeio[- ]dia\b/.exec(f))) {
      hours = 12;
    } else if (take(/\bmeia[- ]noite\b/.exec(f))) {
      hours = 0;
    }
  }
  if (hours !== null && (hours > 23 || minutes > 59)) {
    hours = null;
    spans.length = 0;
    return { dueAt: null, label: null, spans };
  }

  if (!day && hours === null) return { dueAt: null, label: null, spans: [] };

  let base = day ?? startOfToday;
  if (!day && hours !== null) {
    // só a hora: hoje; se já passou, amanhã
    const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
    if (candidate.getTime() <= now.getTime()) base = addDays(1);
    dayLabel = base.getTime() === startOfToday.getTime() ? 'hoje' : 'amanhã';
  }
  const due = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours ?? 9, hours === null ? 0 : minutes);
  const timeLabel = hours === null ? '' : ` às ${pad(hours)}:${pad(minutes)}`;
  return { dueAt: due.toISOString(), label: `${dayLabel ?? ''}${timeLabel}`.trim() || null, spans };
}

/** Remove os trechos de prazo (e conectivos soltos) do título. */
function stripSpans(original: string, spans: Span[]): string {
  if (spans.length === 0) return original;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  let text = original;
  for (const s of sorted) text = text.slice(0, s.start) + ' ' + text.slice(s.end);
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:para|pra|as|às|a|em|no|na|de|do|da|ate|até|por)\s*$/i, '')
    .replace(/^\s*(?:para|pra)\s+/i, '')
    .trim();
}

/** Trecho do texto ORIGINAL correspondente ao grupo i de um casamento feito com a flag d no texto dobrado. */
function group(body: string, m: RegExpExecArray, i: number): string {
  const range = (m as RegExpExecArray & { indices?: [number, number][] }).indices?.[i];
  return range ? body.slice(range[0], range[1]) : '';
}

const cap = (s: string): string => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);
const clean = (s: string): string => s.replace(/^[\s:,\-–—"“']+|[\s"”']+$/g, '').replace(/\s+/g, ' ').trim();

/** Tira só a pontuação final de frases ditas ("...pão."). */
const trimEnd = (s: string): string => s.replace(/[\s.!?]+$/g, '').trim();

const NOTE_WORD = String.raw`(?:nota|notas|anotacao|anotacoes|lembrete)`;

/** Interpreta uma frase. `now` é injetável (testes). */
export function parseAssistantCommand(input: string, now: Date = new Date()): AssistantCommand {
  const original = input.trim().replace(/\s+/g, ' ');
  const f = fold(original);
  if (f.length === 0) return { kind: 'ask', question: '' };

  // "por favor", "oi mochi," no começo não mudam nada
  const lead = /^(?:(?:por favor|pf|ei|oi|ola|e ai|entao|bom dia|boa tarde|boa noite)[ ,.!:-]+)*(?:(?:mochi|assistente|amigo|amiga)[ ,.!:-]+)?/.exec(f);
  const skip = lead ? lead[0].length : 0;
  const body = original.slice(skip);
  const fb = f.slice(skip);

  if (/^(?:oi|ola|e ai|opa|bom dia|boa tarde|boa noite|hello|hey)[ !.,?]*(?:mochi)?[ !.,?]*$/.test(f)) return { kind: 'greeting' };
  if (/^(?:ajuda|help|o que (?:voce|vc) (?:sabe|consegue|pode) fazer|o que (?:voce|vc) faz|como (?:te|lhe) uso|comandos)[ ?!.]*$/.test(fb)) return { kind: 'help' };

  // ---- Foco ----
  if (/\b(?:pausar|pause|pausa)\b.*\bfoco\b|^(?:pausar|pause)[ .!]*$/.test(fb)) return { kind: 'focus.pause' };
  if (/\b(?:retomar|continuar|voltar)\b.*\bfoco\b|^(?:retomar|retoma)[ .!]*$/.test(fb)) return { kind: 'focus.resume' };
  if (/\b(?:cancelar|parar|encerrar|terminar|desligar)\b.*\b(?:foco|pomodoro|temporizador|timer)\b/.test(fb)) return { kind: 'focus.cancel' };
  if (/\b(?:iniciar|inicie|comecar|comece|começar|ligar|ligue|abrir|abra|fazer|faca|quero|vou|bora)\b.*\b(?:foco|focar|pomodoro|temporizador|timer)\b|^(?:focar|foco)\b/.test(fb) || /\bfocar\b/.test(fb)) {
    const hh = /(\d{1,2})\s*(?:h|horas?)\b/.exec(fb);
    const mm = /(\d{1,3})\s*(?:min|minutos?|m\b)/.exec(fb) ?? /\b(?:de|por)\s+(\d{1,3})\b/.exec(fb);
    let minutes: number | null = null;
    if (hh) minutes = Number(hh[1]) * 60;
    else if (mm) minutes = Number(mm[1]);
    if (minutes !== null && (minutes < 1 || minutes > 180)) minutes = null;
    return { kind: 'focus.start', minutes };
  }

  // ---- Personagem ----
  const chr = /\b(?:mude|mudar|muda|troque|trocar|troca|use|usar|quero|coloque|colocar|vire|virar)\b.*\b(?:para|pra|o|a|como|em)\b\s+(?:o\s+|a\s+|um\s+|uma\s+)?(mochi|abacaxi|quadrad\w*|cogumelo|cacto|nuvem|planeta|fantasma)\b/.exec(fb);
  if (chr) {
    const key = chr[1].startsWith('quadrad') ? 'square' : null;
    const id =
      key ??
      CHARACTERS.find((c) => fold(CHARACTER_LABELS[c]) === chr[1]) ??
      null;
    if (id) return { kind: 'character.set', id: id as CharacterId };
  }

  // ---- Abrir ----
  if (/^(?:abrir|abra|mostrar|mostre|ver|veja)\s+(?:as\s+|a\s+|minhas\s+|minha\s+|janela\s+de\s+)*(?:notas|nota|anotacoes)[ .!]*$/.test(fb)) return { kind: 'open.notes' };
  if (/^(?:abrir|abra|mostrar|mostre|ir para|va para)\s+(?:as\s+|a\s+|minhas\s+)*(?:configuracoes|configuracao|ajustes|preferencias)[ .!]*$/.test(fb)) return { kind: 'open.settings' };

  // ---- Conquistas / vínculo ----
  if (/^(?:(?:mostr\w*|abr\w*|ver|quais (?:sao )?)\s*)?(?:(?:as |os |meus |minhas )?(?:minhas? )?(?:conquistas?|trofeus?|medalhas?))[ ?!.]*$|\bminhas? (?:conquistas?|trofeus?)\b/.test(fb) && !/\b(?:cri\w*|adicion\w*|anot\w*|lembr\w*)\b/.test(fb)) return { kind: 'achievements' };

  // ---- Resumo / fechamento do dia ----
  const makes =/\b(?:cri\w*|adicion\w*|nov[ao]|anot\w*|lembr\w*|faca|fazer)\b/.test(fb);
  if (!makes && /^(?:resumo|resuma)(?: do dia| de hoje| da manha)?[ ?!.]*$|\bcomo foi (?:o meu |meu |o )?dia\b|^(?:fechamento|fechar o dia)[ ?!.]*$|\bresumo d[eo] (?:meu )?dia\b|\bresumo de hoje\b|^(?:como (?:esta|ta) (?:o )?(?:meu )?dia)[ ?!.]*$/.test(fb)) return { kind: 'summary' };

  // ---- Listas ----
  if (/\b(?:agenda|compromissos?|eventos?|reunioes?)\b/.test(fb) && /\b(?:hoje|agenda|quais|o que|que|mostr|list|ver|tenho|tem)\b/.test(fb) && !/\b(?:cri|adicion|nov[ao])\b/.test(fb)) {
    return { kind: 'list.agenda' };
  }
  if (/^(?:o que (?:eu )?tenho(?: pra| para)? fazer|o que falta(?: fazer)?|o que (?:eu )?preciso fazer)[ ?!.]*$/.test(fb)) return { kind: 'list.tasks' };
  if (/\b(?:quais|qual|listar|liste|lista|mostrar|mostre|ver|veja|minhas|meus)\b.*\btarefas?\b|^tarefas?[ ?!.]*$/.test(fb) && !/\b(?:cri|adicion|nov[ao]|concl|termin|finaliz)\w*\b/.test(fb)) {
    return { kind: 'list.tasks' };
  }
  if (/\b(?:quais|listar|liste|lista|mostrar|mostre|ver|veja|minhas|meus)\b.*\b(?:notas|anotacoes)\b|^notas[ ?!.]*$/.test(fb) && !/\b(?:cri|adicion|nov[ao]|anot[ae])\w*\b/.test(fb)) {
    return { kind: 'list.notes' };
  }

  // ---- Concluir tarefa ----
  const done = new RegExp(String.raw`^(?:conclua|concluir|conclui|finalize|finalizar|termine|terminar|marque|marcar|risque|riscar|completar|complete)\s+(?:a\s+|essa\s+|esta\s+)?(?:tarefa\s+)?(.+?)(?:\s+como\s+(?:feita|feito|concluida|concluido|pronta|pronto))?[ .!]*$`, 'd').exec(fb);
  const done2 = /^(?:ja\s+)?(?:terminei|finalizei|conclui|fiz|completei)\s+(?:a\s+|o\s+|de\s+)?(?:tarefa\s+)?(.+?)[ .!]*$/d.exec(fb);
  const doneMatch = done ?? done2;
  if (doneMatch && doneMatch[1].length > 1) {
    const query = clean(trimEnd(group(body, doneMatch, 1)));
    if (query) return { kind: 'task.complete', query };
  }

  // ---- Criar nota ----
  const noteVerb = String.raw`(?:cri(?:e|a|ar)|faca|fazer|adicion(?:e|a|ar)|nov[ao]|anot(?:e|a|ar)|escrev(?:a|er)|salv(?:e|ar)|guard(?:e|a|ar)|coloqu?e|colocar|registr(?:e|ar)|crie)`;
  const noteA = new RegExp(String.raw`^${noteVerb}\s+(?:para\s+mim\s+)?(?:uma?\s+)?(?:nova\s+)?${NOTE_WORD}(?:\s+(?:escrit[ao]|dizendo(?:\s+que)?|com\s+o\s+texto|com\s+texto|que\s+diz|falando(?:\s+que)?|sobre|com|chamad[ao]|:))?\s*[:,\-–]?\s*(.*)$`, 'd').exec(fb);
  const noteB = /^(?:anot(?:e|a|ar)|registr(?:e|ar)|nota)(?:\s+(?:ai|aqui|isso|pra mim|para mim))?\s*(?:que|:|-)?\s*(.+)$/d.exec(fb);
  if (noteA) {
    return { kind: 'note.create', text: clean(trimEnd(group(body, noteA, 1))) };
  }
  if (noteB && noteB[1].length > 0 && !/\btarefa\b/.test(fb)) {
    const text = clean(trimEnd(group(body, noteB, 1)));
    if (text) return { kind: 'note.create', text };
  }

  // ---- Criar tarefa / lembrete ----
  const taskA = new RegExp(String.raw`^(?:cri(?:e|a|ar)|faca|fazer|adicion(?:e|a|ar)|nov[ao]|coloqu?e|colocar|inclu(?:a|ir)|anot(?:e|a|ar))\s+(?:para\s+mim\s+)?(?:uma?\s+)?(?:nova\s+)?tarefa(?:\s+(?:de|para|pra|chamada|:|-|dizendo|escrit[ao]))?\s*[:,\-–]?\s*(.+)$`, 'd').exec(fb);
  const taskB = /^(?:me\s+)?(?:lembre|lembra|lembrar)(?:-me|\s+me)?(?:\s+de|\s+que|\s+para|\s+pra)?\s+(.+)$/d.exec(fb);
  const taskC = /^(?:adicion(?:e|a|ar)|coloqu?e|colocar|inclu(?:a|ir))\s+(.+?)\s+(?:nas?\s+|a\s+|na\s+|em\s+|pra\s+|para\s+)?(?:minhas?\s+)?(?:lista\s+de\s+)?tarefas?$/d.exec(fb);
  const taskD = /^(?:preciso|tenho que|tenho de|nao posso esquecer de|nao esquecer de|lembrar de)\s+(.+)$/d.exec(fb);
  const taskMatch = taskA ?? taskB ?? taskC ?? taskD;
  if (taskMatch) {
    const raw = group(body, taskMatch, 1);
    const when = parseWhen(raw, now);
    const title = cap(clean(trimEnd(stripSpans(raw, when.spans))));
    if (title) return { kind: 'task.create', title, dueAt: when.dueAt, whenLabel: when.label };
  }

  return { kind: 'ask', question: original };
}

export const ASSISTANT_HELP = [
  'Posso fazer isto por você:',
  '• “Crie uma nota escrito comprar pão e leite”',
  '• “Me lembre de ligar para o João amanhã às 15h” (cria a tarefa com lembrete)',
  '• “Adicione enviar relatório nas tarefas”',
  '• “Quais são minhas tarefas?” / “O que tenho hoje?”',
  '• “Concluir tarefa enviar relatório”',
  '• “Iniciar foco de 25 minutos” / “Pausar foco”',
  '• “Mudar para o cacto”',
  'Outras perguntas eu procuro na Wikipédia (se você ativar) ou respondo com a IA local.',
].join('\n');
