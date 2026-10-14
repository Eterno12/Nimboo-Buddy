import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { NoteDoc } from '../../../shared/notes';

/** Cores de texto e de marca-texto (hexadecimais: é o que o main aceita ao guardar). */
export const TEXT_COLORS = ['#c0392b', '#d35400', '#9a7d0a', '#1e8449', '#1f618d', '#6c3483'] as const;
export const HIGHLIGHT_COLORS = ['#fff176', '#ffcc80', '#ef9a9a', '#a5d6a7', '#90caf9', '#ce93d8'] as const;

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      protocols: ['mailto'],
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
    },
  }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TaskList,
  TaskItem.configure({ nested: true }),
];

/** Normaliza o que a pessoa digitou num link; `null` quando não é um endereço aceitável. */
export function normalizeHref(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || /\s/.test(text)) return null;
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    candidate = text.includes('@') && !text.includes('/') ? `mailto:${text}` : `https://${text}`;
  }
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const SAVE_DELAY_MS = 600;

interface NoteEditorProps {
  initialDoc: NoteDoc;
  /** Salva (já com o atraso aplicado). Também é chamado ao perder o foco e ao fechar. */
  onChange: (doc: NoteDoc) => void;
  /** Conteúdo vindo de outra janela: aplicado só se a pessoa não está digitando aqui. */
  remote?: { doc: NoteDoc; rev: number } | null;
  /** Barra de ferramentas visível. */
  toolbar?: boolean;
  /** Barra mais compacta (nota flutuante). */
  compact?: boolean;
  autoFocus?: boolean;
  /** Se presente, mostra o botão "Transformar em tarefa" (a seleção, ou a linha onde está o cursor). */
  onMakeTask?: (text: string) => void;
}

interface ToolState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  quote: boolean;
  codeBlock: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
  alignJustify: boolean;
  link: boolean;
  linkHref: string;
  color: string | null;
  highlight: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface ButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ label, active, disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type="button"
      className="note-tool"
      aria-label={label}
      title={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      // mouseDown não pode tirar o foco/seleção do editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Editor de nota com formatação completa (TipTap/ProseMirror). O documento é JSON validado no main. */
export function NoteEditor({
  initialDoc,
  onChange,
  remote,
  toolbar = true,
  compact = false,
  autoFocus = false,
  onMakeTask,
}: NoteEditorProps) {
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<NoteDoc | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const doc = pending.current;
    pending.current = null;
    if (doc) onChangeRef.current(doc);
  }, []);

  const editor = useEditor({
    extensions,
    content: initialDoc,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': 'Texto da nota', spellcheck: 'true' },
      handleClick: (_view, _pos, event) => {
        // Ctrl+clique abre o link no navegador (o main só aceita https).
        const link = (event.target as HTMLElement | null)?.closest?.('a');
        if (link && (event.ctrlKey || event.metaKey)) {
          const href = link.getAttribute('href') ?? '';
          if (/^https:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      pending.current = ed.getJSON() as NoteDoc;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    onBlur: () => flush(),
  });

  // Salva o que ainda está pendente ao desmontar ou fechar a janela.
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  // Alteração vinda de outra janela (a mesma nota aberta em dois lugares).
  const lastRev = useRef(remote?.rev ?? 0);
  useEffect(() => {
    if (!editor || !remote || remote.rev === lastRev.current) return;
    lastRev.current = remote.rev;
    if (editor.isFocused || pending.current) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(remote.doc)) {
      editor.commands.setContent(remote.doc, { emitUpdate: false });
    }
  }, [editor, remote]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }): ToolState | null => {
      if (!ed) return null;
      const color = (ed.getAttributes('textStyle').color as string | undefined) ?? null;
      const highlight = (ed.getAttributes('highlight').color as string | undefined) ?? null;
      return {
        bold: ed.isActive('bold'),
        italic: ed.isActive('italic'),
        underline: ed.isActive('underline'),
        strike: ed.isActive('strike'),
        code: ed.isActive('code'),
        h1: ed.isActive('heading', { level: 1 }),
        h2: ed.isActive('heading', { level: 2 }),
        h3: ed.isActive('heading', { level: 3 }),
        bullet: ed.isActive('bulletList'),
        ordered: ed.isActive('orderedList'),
        task: ed.isActive('taskList'),
        quote: ed.isActive('blockquote'),
        codeBlock: ed.isActive('codeBlock'),
        alignLeft: ed.isActive({ textAlign: 'left' }),
        alignCenter: ed.isActive({ textAlign: 'center' }),
        alignRight: ed.isActive({ textAlign: 'right' }),
        alignJustify: ed.isActive({ textAlign: 'justify' }),
        link: ed.isActive('link'),
        linkHref: (ed.getAttributes('link').href as string | undefined) ?? '',
        color,
        highlight,
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      };
    },
  });

  const [popover, setPopover] = useState<'color' | 'highlight' | 'link' | null>(null);
  const [linkText, setLinkText] = useState('');
  const [linkError, setLinkError] = useState(false);
  /** Seleção no instante em que o campo do link abriu (o campo toma o foco e o editor pode perdê-la). */
  const linkRange = useRef<{ from: number; to: number } | null>(null);

  if (!editor) return null;
  const s = state;
  const chain = () => editor.chain().focus();

  /** Devolve a seleção de quando o campo abriu e traz o foco de volta ao editor. */
  const restoreLinkSelection = () => {
    const range = linkRange.current;
    const c = chain();
    return range ? c.setTextSelection(range) : c;
  };

  const applyLink = () => {
    const raw = linkText.trim();
    if (raw === '') {
      restoreLinkSelection().extendMarkRange('link').unsetLink().run();
      setPopover(null);
      return;
    }
    const href = normalizeHref(raw);
    if (!href) {
      setLinkError(true);
      return;
    }
    restoreLinkSelection().extendMarkRange('link').setLink({ href }).run();
    setPopover(null);
  };

  const toggle = (name: 'color' | 'highlight' | 'link') => {
    setLinkError(false);
    if (name === 'link') {
      const { from, to } = editor.state.selection;
      linkRange.current = { from, to };
      setLinkText(s?.linkHref ?? '');
    }
    setPopover((current) => (current === name ? null : name));
  };

  return (
    <div className="note-editor" data-compact={compact}>
      {toolbar && (
        <div className="note-toolbar" role="toolbar" aria-label="Formatação">
          <div className="note-tool-group">
            <ToolButton label="Negrito (Ctrl+B)" active={s?.bold} onClick={() => chain().toggleBold().run()}>
              <b>B</b>
            </ToolButton>
            <ToolButton label="Itálico (Ctrl+I)" active={s?.italic} onClick={() => chain().toggleItalic().run()}>
              <i>I</i>
            </ToolButton>
            <ToolButton label="Sublinhado (Ctrl+U)" active={s?.underline} onClick={() => chain().toggleUnderline().run()}>
              <u>U</u>
            </ToolButton>
            <ToolButton label="Tachado" active={s?.strike} onClick={() => chain().toggleStrike().run()}>
              <s>S</s>
            </ToolButton>
            <ToolButton label="Código" active={s?.code} onClick={() => chain().toggleCode().run()}>
              <Icon>
                <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" {...stroke} />
              </Icon>
            </ToolButton>
          </div>

          <div className="note-tool-group">
            <ToolButton label="Título grande" active={s?.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
              H1
            </ToolButton>
            <ToolButton label="Título médio" active={s?.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
              H2
            </ToolButton>
            <ToolButton label="Título pequeno" active={s?.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
              H3
            </ToolButton>
          </div>

          <div className="note-tool-group">
            <ToolButton label="Lista com marcadores" active={s?.bullet} onClick={() => chain().toggleBulletList().run()}>
              <Icon>
                <path d="M9 7h11M9 12h11M9 17h11" {...stroke} />
                <circle cx="4.5" cy="7" r="1" fill="currentColor" />
                <circle cx="4.5" cy="12" r="1" fill="currentColor" />
                <circle cx="4.5" cy="17" r="1" fill="currentColor" />
              </Icon>
            </ToolButton>
            <ToolButton label="Lista numerada" active={s?.ordered} onClick={() => chain().toggleOrderedList().run()}>
              <Icon>
                <path d="M10 7h10M10 12h10M10 17h10M4 6l1.5-1v4M4 15.5c.5-1 2-1 2 .2 0 1-2 1.3-2 2.3h2.2" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Lista de tarefas" active={s?.task} onClick={() => chain().toggleTaskList().run()}>
              <Icon>
                <path d="M4 6.5l1.5 1.5 3-3M4 16.5l1.5 1.5 3-3M12 7h8M12 17h8" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Citação" active={s?.quote} onClick={() => chain().toggleBlockquote().run()}>
              <Icon>
                <path d="M5 8h5v5H7.5c0 2 1 3 2.500 3M14 8h5v5h-2.500c0 2 1 3 2.500 3" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Bloco de código" active={s?.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
              <Icon>
                <rect x="3.5" y="5" width="17" height="14" rx="2.500" {...stroke} />
                <path d="M9.500 10l-2 2 2 2M14.500 10l2 2-2 2" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Linha divisória" onClick={() => chain().setHorizontalRule().run()}>
              <Icon>
                <path d="M4 12h16" {...stroke} />
              </Icon>
            </ToolButton>
          </div>

          <div className="note-tool-group">
            <ToolButton label="Alinhar à esquerda" active={s?.alignLeft} onClick={() => chain().setTextAlign('left').run()}>
              <Icon>
                <path d="M4 7h16M4 12h10M4 17h14" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Centralizar" active={s?.alignCenter} onClick={() => chain().setTextAlign('center').run()}>
              <Icon>
                <path d="M4 7h16M7 12h10M5 17h14" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Alinhar à direita" active={s?.alignRight} onClick={() => chain().setTextAlign('right').run()}>
              <Icon>
                <path d="M4 7h16M10 12h10M6 17h14" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Justificar" active={s?.alignJustify} onClick={() => chain().setTextAlign('justify').run()}>
              <Icon>
                <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
              </Icon>
            </ToolButton>
          </div>

          <div className="note-tool-group">
            <ToolButton label="Cor do texto" active={popover === 'color' || !!s?.color} onClick={() => toggle('color')}>
              <span className="note-tool-color" style={{ borderBottomColor: s?.color ?? 'currentColor' }}>
                A
              </span>
            </ToolButton>
            <ToolButton label="Marca-texto" active={popover === 'highlight' || !!s?.highlight} onClick={() => toggle('highlight')}>
              <span className="note-tool-mark" style={{ background: s?.highlight ?? '#fff176' }}>
                ab
              </span>
            </ToolButton>
            <ToolButton label="Link" active={popover === 'link' || s?.link} onClick={() => toggle('link')}>
              <Icon>
                <path d="M10 14a4 4 0 0 0 5.600 0l3-3a4 4 0 0 0-5.600-5.600l-1 1M14 10a4 4 0 0 0-5.600 0l-3 3a4 4 0 0 0 5.600 5.600l1-1" {...stroke} />
              </Icon>
            </ToolButton>
          </div>

          {onMakeTask && (
            <div className="note-tool-group">
              <ToolButton
                label="Transformar a seleção (ou a linha) em tarefa"
                onClick={() => {
                  const { from, to, empty, $from } = editor.state.selection;
                  const text = (empty ? $from.parent.textContent : editor.state.doc.textBetween(from, to, ' ')).trim();
                  if (text) onMakeTask(text);
                }}
              >
                <Icon>
                  <path d="M4 7l2 2 3.500-4M4 17l2 2 3.500-4M13 8h7M13 18h7M16.500 5v6" {...stroke} />
                </Icon>
              </ToolButton>
            </div>
          )}

          <div className="note-tool-group">
            <ToolButton label="Limpar formatação" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
              <Icon>
                <path d="M5 6h14M9 6l-2 12M15 6l2 12M4 20h16" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Desfazer (Ctrl+Z)" disabled={!s?.canUndo} onClick={() => chain().undo().run()}>
              <Icon>
                <path d="M9 7L4 12l5 5M4 12h10a5 5 0 0 1 0 10h-2" {...stroke} />
              </Icon>
            </ToolButton>
            <ToolButton label="Refazer (Ctrl+Y)" disabled={!s?.canRedo} onClick={() => chain().redo().run()}>
              <Icon>
                <path d="M15 7l5 5-5 5M20 12H10a5 5 0 0 0 0 10h2" {...stroke} />
              </Icon>
            </ToolButton>
          </div>

          {popover === 'color' && (
            <div className="note-popover" role="group" aria-label="Cor do texto">
              <button type="button" className="note-swatch note-swatch-none" aria-label="Cor padrão" title="Cor padrão" onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().unsetColor().run(); setPopover(null); }}>
                ×
              </button>
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className="note-swatch" style={{ background: c }} aria-label={`Texto ${c}`} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().setColor(c).run(); setPopover(null); }} />
              ))}
            </div>
          )}
          {popover === 'highlight' && (
            <div className="note-popover" role="group" aria-label="Marca-texto">
              <button type="button" className="note-swatch note-swatch-none" aria-label="Sem marca-texto" title="Sem marca-texto" onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().unsetHighlight().run(); setPopover(null); }}>
                ×
              </button>
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" className="note-swatch" style={{ background: c }} aria-label={`Marca-texto ${c}`} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => { chain().setHighlight({ color: c }).run(); setPopover(null); }} />
              ))}
            </div>
          )}
          {popover === 'link' && (
            <form
              className="note-popover note-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                applyLink();
              }}
            >
              <input
                className="note-link-input"
                type="text"
                value={linkText}
                placeholder="https://… ou e-mail"
                aria-label="Endereço do link"
                aria-invalid={linkError}
                autoFocus
                onChange={(e) => {
                  setLinkText(e.target.value);
                  setLinkError(false);
                }}
              />
              <button type="submit" className="note-link-apply">
                {linkText.trim() === '' && s?.link ? 'Remover' : 'Aplicar'}
              </button>
              {linkError && <span className="note-link-error" role="alert">Endereço inválido</span>}
            </form>
          )}
        </div>
      )}
      <EditorContent editor={editor as Editor} className="note-content" />
    </div>
  );
}
