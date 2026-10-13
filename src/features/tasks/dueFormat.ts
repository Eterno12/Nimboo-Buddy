/**
 * Prazos das tarefas na interface: conversão entre o campo `datetime-local` (horário do computador,
 * sem fuso) e o instante ISO em UTC guardado, e textos curtos para a lista. Funções puras.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO (UTC) → valor de `<input type="datetime-local">` no horário local (`2026-06-10T18:00`). */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor do campo (horário local) → ISO em UTC; `null` se vazio ou inválido. */
export function fromLocalInputValue(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Recusa datas que o calendário "corrige" (31/02 viraria 03/03).
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "hoje 18:00", "amanhã 09:00", "ontem 08:30" ou "12/06 09:00". */
export function formatDue(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const time = timeFormat.format(d);
  if (diffDays === 0) return `hoje ${time}`;
  if (diffDays === 1) return `amanhã ${time}`;
  if (diffDays === -1) return `ontem ${time}`;
  return `${dayFormat.format(d)} ${time}`;
}

/** Atalhos de prazo: "hoje às 18:00" (ou daqui a 1 h, se já passou) e "amanhã às 09:00". */
export function presetDue(kind: 'today' | 'tomorrow', now: Date = new Date()): string {
  if (kind === 'tomorrow') {
    return toLocalInputValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString());
  }
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0);
  const target = evening.getTime() > now.getTime() ? evening : new Date(now.getTime() + 60 * 60_000);
  target.setSeconds(0, 0);
  return toLocalInputValue(target.toISOString());
}
