import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_PER_HOUR,
  bubbleDurationMs,
  createPersonality,
  dayPartOf,
  LINES,
  MIN_GAP_MS,
  type SpeechContext,
  type SpeechEvent,
} from '../src/features/personality/personality.ts';

const at = (iso: string) => new Date(iso);
const ctx = (iso: string, extra: Partial<SpeechContext> = {}): SpeechContext => ({
  now: at(iso),
  mood: 'mid',
  focusActive: false,
  ...extra,
});
const fixed = (v: number) => () => v;

test('dayPartOf: manhã, tarde, noite e madrugada', () => {
  assert.equal(dayPartOf(at('2026-03-10T08:00:00')), 'morning');
  assert.equal(dayPartOf(at('2026-03-10T12:00:00')), 'afternoon');
  assert.equal(dayPartOf(at('2026-03-10T18:30:00')), 'evening');
  assert.equal(dayPartOf(at('2026-03-10T23:00:00')), 'night');
  assert.equal(dayPartOf(at('2026-03-10T03:00:00')), 'night');
});

test('catálogo: toda fala é curta e há opção para toda situação', () => {
  for (const [event, lines] of Object.entries(LINES)) {
    assert.ok(lines.length >= 2, `${event}: poucas frases`);
    for (const line of lines) assert.ok(line.text.length <= 38, `muito longa: ${line.text}`);
  }
  // "hello" tem ao menos uma frase para cada parte do dia com humor médio.
  for (const part of ['morning', 'afternoon', 'evening', 'night'] as const) {
    assert.ok(LINES.hello.some((l) => l.part === part && !l.mood), `hello sem frase para ${part}`);
  }
});

test('hello respeita a parte do dia', () => {
  const p = createPersonality(fixed(0));
  const text = p.pick('hello', ctx('2026-03-10T08:00:00'))!;
  assert.ok(LINES.hello.some((l) => l.text === text && l.part === 'morning'));
  const night = createPersonality(fixed(0)).pick('hello', ctx('2026-03-10T01:00:00'))!;
  assert.ok(LINES.hello.some((l) => l.text === night && l.part === 'night'));
});

test('humor: frases de humor baixo só aparecem com humor baixo', () => {
  const lowOnly = LINES.idle.find((l) => l.mood?.[0] === 'low')!.text;
  for (let i = 0; i < 20; i++) {
    const p = createPersonality(fixed(i / 20));
    const text = p.pick('idle', ctx('2026-03-10T10:00:00', { mood: 'mid' }));
    assert.notEqual(text, lowOnly);
  }
});

test('intervalo geral: duas falas "de fundo" seguidas — a segunda é ignorada', () => {
  const p = createPersonality(fixed(0));
  assert.ok(p.pick('hello', ctx('2026-03-10T10:00:00')));
  assert.equal(p.pick('idle', ctx('2026-03-10T10:00:03')), null, 'só 3 s depois');
  assert.ok(MIN_GAP_MS < 12_000);
  assert.ok(p.pick('idle', ctx('2026-03-10T10:00:12')), '12 s depois já pode');
});

test('eventos urgentes (tarefa concluída, fim do foco) passam por cima do intervalo', () => {
  const p = createPersonality(fixed(0));
  assert.ok(p.pick('hello', ctx('2026-03-10T10:00:00')));
  assert.ok(p.pick('taskCompleted', ctx('2026-03-10T10:00:01')));
  assert.ok(p.pick('focusFinished', ctx('2026-03-10T10:00:02')));
});

test('intervalo por tipo: "hello" não se repete em 20 min; "taskCompleted" sempre fala', () => {
  const p = createPersonality(fixed(0));
  assert.ok(p.pick('hello', ctx('2026-03-10T10:00:00')));
  assert.equal(p.pick('hello', ctx('2026-03-10T10:10:00')), null);
  assert.ok(p.pick('hello', ctx('2026-03-10T10:21:00')));
  for (let s = 0; s < 3; s++) assert.ok(p.pick('taskCompleted', ctx(`2026-03-10T10:30:0${s}`)));
});

test('foco: o Mochi fica quietinho (só fim/pausa/conclusão falam)', () => {
  const p = createPersonality(fixed(0));
  const busy = (iso: string) => ctx(iso, { focusActive: true });
  for (const e of ['hello', 'idle', 'sleepy', 'woke', 'giggle', 'annoyed'] as SpeechEvent[]) {
    assert.equal(p.pick(e, busy('2026-03-10T10:00:00')), null, e);
  }
  assert.ok(p.pick('taskCompleted', busy('2026-03-10T10:00:00')));
  assert.ok(p.pick('focusFinished', busy('2026-03-10T10:25:00')));
});

test('não repete as últimas frases do mesmo tipo enquanto houver outras', () => {
  const total = LINES.taskCompleted.length;
  let r = 0;
  const p = createPersonality(() => (r++ % total) / total);
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) seen.push(p.pick('taskCompleted', ctx(`2026-03-10T10:00:0${i}`))!);
  assert.equal(new Set(seen).size, 3);
});

test('teto por hora para falas de fundo; depois de uma hora volta a falar', () => {
  const p = createPersonality(fixed(0));
  let said = 0;
  let minute = 0;
  // woke tem intervalo de 3 min por tipo; usa idle/sleepy/woke alternando para só esbarrar no teto.
  const events: SpeechEvent[] = ['idle', 'woke', 'sleepy'];
  for (let i = 0; i < 60; i++) {
    const t = new Date(at('2026-03-10T10:00:00').getTime() + minute * 60_000);
    minute += 1;
    if (p.pick(events[i % 3], { now: t, mood: 'mid', focusActive: false })) said++;
  }
  assert.ok(said <= AMBIENT_PER_HOUR, `falou ${said}`);
  const later = new Date(at('2026-03-10T10:00:00').getTime() + 130 * 60_000);
  assert.ok(p.pick('idle', { now: later, mood: 'mid', focusActive: false }));
});

test('bubbleDurationMs: confortável e limitado', () => {
  assert.ok(bubbleDurationMs('Oi!') >= 2600);
  assert.equal(bubbleDurationMs('x'.repeat(500)), 7000);
});
