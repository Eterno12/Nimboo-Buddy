import { ASSISTANT_HELP, fold, type AssistantCommand } from '../../../shared/assistant';
import { todaysAgenda, eventTimeLabel } from '../../../shared/calendar';
import { CHARACTER_LABELS } from '../../../shared/settings';
import type { NoteDoc } from '../../../shared/notes';
import type { Task } from '../../../shared/tasks';

/** O que a interface mostra depois de executar um comando. */
export interface AssistantReply {
  text: string;
  /** Desfaz o que foi feito (some depois de um tempo). */
  undo?: () => Promise<void>;
  /** Abre esta nota na janela de notas. */
  openNoteId?: string;
  /** O Mochi "comemora" (a ação deu certo). */
  happy?: boolean;
  /** Próxima mensagem da pessoa será o texto da nota. */
  awaitNote?: boolean;
}

const dueFormat = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const SORRY = 'Não consegui fazer isso agora.';

/** Texto simples → documento da nota (uma linha por parágrafo). */
export function textToDoc(text: string): NoteDoc {
  const paragraphs = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
  return { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] };
}

/** Escolhe a tarefa que melhor combina com o trecho dito (sem acentos e sem maiúsculas). */
export function matchTasks(tasks: Task[], query: string): Task[] {
  const q = fold(query).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const words = q.split(' ').filter((w) => w.length > 2);
  const scored = tasks.map((task) => {
    const title = fold(task.title).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    let score = 0;
    if (title === q) score = 100;
    else if (title.includes(q)) score = 80;
    else if (q.includes(title) && title.length > 2) score = 60;
    else if (words.length > 0) {
      const hit = words.filter((w) => title.includes(w)).length;
      if (hit === words.length) score = 50;
      else if (hit > 0 && hit / words.length >= 0.6) score = 30;
    }
    return { task, score };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best === 0 ? [] : scored.filter((s) => s.score === best).map((s) => s.task);
}

const dueText = (task: Task) => (task.dueAt ? ` — ${dueFormat.format(new Date(task.dueAt))}` : '');

/** Executa um comando usando as MESMAS APIs que a interface já usa (nada de caminho paralelo). */
export async function runAssistantCommand(cmd: AssistantCommand, now: Date = new Date()): Promise<AssistantReply> {
  const api = window.mochi;
  switch (cmd.kind) {
    case 'greeting':
      return { text: 'Oi! Em que posso ajudar? Se quiser ideias, diga “ajuda”.' };
    case 'help':
      return { text: ASSISTANT_HELP };

    case 'note.create': {
      if (!cmd.text) return { text: 'Claro! O que devo anotar?', awaitNote: true };
      const r = await api.notes.create({ doc: textToDoc(cmd.text) });
      if (!r.ok) return { text: `${SORRY} ${r.error.message}` };
      const id = r.value.id;
      return {
        text: `Anotado! Criei a nota “${r.value.title}”.`,
        openNoteId: id,
        happy: true,
        undo: async () => {
          await api.notes.remove(id);
        },
      };
    }

    case 'task.create': {
      const r = await api.tasks.create(cmd.title, cmd.dueAt);
      if (!r.ok) return { text: `${SORRY} ${r.error.message}` };
      const id = r.value.id;
      const when = cmd.whenLabel ? ` para ${cmd.whenLabel}` : '';
      return {
        text: `Pronto! Criei a tarefa “${r.value.title}”${when}.${cmd.dueAt ? ' Aviso você na hora.' : ''}`,
        happy: true,
        undo: async () => {
          await api.tasks.scheduleRemove(id);
        },
      };
    }

    case 'task.complete': {
      const list = await api.tasks.list();
      if (!list.ok) return { text: `${SORRY} ${list.error.message}` };
      const found = matchTasks(list.value.active, cmd.query);
      if (found.length === 0) return { text: `Não achei nenhuma tarefa parecida com “${cmd.query}”.` };
      if (found.length > 1) {
        return { text: `Achei mais de uma:\n${found.slice(0, 5).map((t) => `• ${t.title}`).join('\n')}\nDiga qual delas.` };
      }
      const task = found[0];
      const r = await api.tasks.complete(task.id);
      if (!r.ok) return { text: `${SORRY} ${r.error.message}` };
      return {
        text: `Feito! Concluí “${task.title}”.`,
        happy: true,
        undo: async () => {
          await api.tasks.reopen(task.id);
        },
      };
    }

    case 'list.tasks': {
      const list = await api.tasks.list();
      if (!list.ok) return { text: `${SORRY} ${list.error.message}` };
      const active = list.value.active;
      if (active.length === 0) return { text: 'Você não tem tarefas pendentes. Que tal descansar um pouquinho?' };
      const lines = active.slice(0, 8).map((t) => `• ${t.title}${dueText(t)}`);
      const more = active.length > 8 ? `\n… e mais ${active.length - 8}.` : '';
      return { text: `Você tem ${active.length} ${active.length === 1 ? 'tarefa' : 'tarefas'}:\n${lines.join('\n')}${more}` };
    }

    case 'list.agenda': {
      const cal = await api.calendar.get();
      if (!cal.configured) return { text: 'A agenda ainda não está conectada. Cole o endereço iCal em Configurações.' };
      const today = todaysAgenda(cal.events, now);
      if (today.length === 0) return { text: 'Nada na agenda hoje.' };
      const lines = today.slice(0, 8).map((e) => `• ${eventTimeLabel(e)} — ${e.title}`);
      return { text: `Sua agenda de hoje:\n${lines.join('\n')}` };
    }

    case 'list.notes': {
      const r = await api.notes.list();
      if (!r.ok) return { text: `${SORRY} ${r.error.message}` };
      if (r.value.length === 0) return { text: 'Você ainda não tem notas. Diga “crie uma nota …”.' };
      const lines = r.value.slice(0, 6).map((n) => `• ${n.title}`);
      return { text: `Suas notas mais recentes:\n${lines.join('\n')}`, openNoteId: r.value[0].id };
    }

    case 'focus.start': {
      const settings = await api.settings.get();
      const minutes = cmd.minutes ?? settings.settings.focusMinutes;
      const r = await api.focus.start('focus', minutes, null);
      if (!r.ok) return { text: r.error?.message ?? 'Já existe uma sessão de foco em andamento.' };
      return { text: `Foco de ${minutes} minutos iniciado. Fico quietinho!`, happy: true };
    }
    case 'focus.pause': {
      const r = await api.focus.pause();
      return { text: r.ok ? 'Foco pausado.' : 'Não há foco em andamento para pausar.' };
    }
    case 'focus.resume': {
      const r = await api.focus.resume();
      return { text: r.ok ? 'Foco retomado.' : 'Não há foco pausado para retomar.' };
    }
    case 'focus.cancel': {
      const r = await api.focus.cancel();
      return { text: r.ok ? 'Foco cancelado.' : 'Não há foco em andamento.' };
    }

    case 'open.notes':
      api.notes.openManager();
      return { text: 'Abrindo suas notas.' };
    case 'open.settings':
      api.openSettings();
      return { text: 'Abrindo as configurações.' };

    case 'character.set': {
      await api.settings.update({ character: cmd.id });
      return { text: `Troquei para ${CHARACTER_LABELS[cmd.id]}!`, happy: true };
    }

    case 'ask':
      return { text: '' };
  }
}
