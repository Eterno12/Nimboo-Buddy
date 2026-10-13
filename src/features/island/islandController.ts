/**
 * Máquina de estados da ilha, sem dependência de React ou do DOM.
 *
 * Duas responsabilidades:
 *  1. expandir/recolher (a janela não muda de tamanho; só a forma, via main):
 *     - expandir: `openWindow()` resolve → só então o visual abre;
 *     - recolher: o visual fecha → ao fim da transição (`transitionEnded`) ou no
 *       tempo limite, `closeWindow()` devolve a forma compacta;
 *  2. presença: depois de recolhida e sem interação, a ilha se esconde (`hide`)
 *     e o Mochi passa a viver solto num canto.
 */
export interface IslandDeps {
  /** Libera a forma cheia; resolve quando já pode animar a abertura. */
  openWindow(): Promise<void>;
  /** Devolve a forma compacta (a animação de recolher já terminou). */
  closeWindow(): void;
  /** Alvo visual mudou (dispara a transição CSS). */
  onVisualChange(open: boolean): void;
  /** A ilha deve sair de cena (chamado uma vez; depois o controlador fica inativo). */
  hide(): void;
}

export interface IslandOptions {
  /** Inatividade que recolhe a ilha aberta. */
  idleMs?: number;
  /** Inatividade (já recolhida) que esconde a ilha. */
  hideMs?: number;
  /** Se `transitionend` não vier, devolve a forma compacta após este tempo. */
  closeFallbackMs?: number;
  /** Intervalo de verificação da inatividade. */
  tickMs?: number;
}

export interface IslandController {
  expand(): void;
  collapse(): void;
  toggle(): void;
  /** Interação do usuário dentro da ilha: reinicia o contador de inatividade. */
  activity(): void;
  /** O cursor está (ou não) sobre a ilha: pausa recolher e esconder. */
  setHover(hovering: boolean): void;
  /**
   * Reter a ilha aberta (campo com foco ou rascunho não enviado): o recolhimento
   * por inatividade fica suspenso. Esc, clique e perda de foco continuam recolhendo.
   */
  setHold(hold: boolean): void;
  /** Muda a inatividade (já recolhida) que esconde a ilha; Infinity = nunca esconde sozinha. */
  setHideMs(ms: number): void;
  /** A transição de recolher terminou. */
  transitionEnded(): void;
  /**
   * A ilha ficou à vista: passa a contar o tempo para esconder. `graceMs`
   * garante um mínimo de exposição (para a pessoa ver a entrada).
   */
  resume(graceMs?: number): void;
  /** Volta a recolhido sem animação e desativa o ciclo (ex.: ilha fora de cena). */
  reset(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createIslandController(deps: IslandDeps, options: IslandOptions = {}): IslandController {
  const idleMs = options.idleMs ?? 8000;
  let hideMs = options.hideMs ?? 3000;
  const closeFallbackMs = options.closeFallbackMs ?? 450;
  const tickMs = options.tickMs ?? 250;

  let wantOpen = false; // alvo visual desejado
  let windowOpen = false; // a forma está cheia
  let opening = false; // `openWindow` em andamento
  let hovering = false;
  let holding = false;
  let active = false; // o ciclo de presença está correndo
  let graceUntil = 0;
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  function stopTicking() {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function tick() {
    if (!active || hovering) return;
    const now = Date.now();
    if (wantOpen) {
      if (!holding && now - lastActivity >= idleMs) collapse();
    } else if (!opening && !windowOpen && now >= graceUntil && now - lastActivity >= hideMs) {
      active = false;
      stopTicking();
      deps.hide();
    }
  }

  function startTicking() {
    stopTicking();
    timer = setInterval(tick, tickMs);
  }

  function shrinkWindow() {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
    if (windowOpen && !wantOpen && !opening) {
      windowOpen = false;
      deps.closeWindow();
    }
  }

  function expand() {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
    wantOpen = true;
    lastActivity = Date.now();
    if (windowOpen) {
      deps.onVisualChange(true); // forma ainda cheia (ex.: reabriu durante o recolhimento)
      return;
    }
    if (opening) return;
    opening = true;
    windowOpen = true;
    void deps.openWindow().then(
      () => {
        opening = false;
        if (wantOpen) deps.onVisualChange(true);
        else shrinkWindow(); // desistiu enquanto a forma estava sendo liberada
      },
      () => {
        opening = false;
        windowOpen = false;
        wantOpen = false;
      },
    );
  }

  function collapse() {
    if (!wantOpen) return;
    wantOpen = false;
    lastActivity = Date.now(); // o tempo para esconder conta a partir daqui
    if (opening) return; // o `then` de expand() cuida da forma
    deps.onVisualChange(false);
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(shrinkWindow, closeFallbackMs);
  }

  return {
    expand,
    collapse,
    toggle: () => (wantOpen ? collapse() : expand()),
    activity() {
      lastActivity = Date.now();
    },
    setHover(next) {
      hovering = next;
      if (!next) lastActivity = Date.now(); // ao sair, começa a contar do zero
    },
    setHold(next) {
      if (holding && !next) lastActivity = Date.now(); // soltou: conta do zero, sem recolher na hora
      holding = next;
    },
    setHideMs(ms) {
      hideMs = ms;
    },
    transitionEnded: shrinkWindow,
    resume(graceMs = 0) {
      active = true;
      lastActivity = Date.now();
      graceUntil = Date.now() + graceMs;
      startTicking();
    },
    reset() {
      const was = windowOpen;
      wantOpen = false;
      opening = false;
      windowOpen = false;
      holding = false;
      active = false;
      stopTicking();
      clearTimeout(fallbackTimer);
      deps.onVisualChange(false);
      if (was) deps.closeWindow();
    },
    isOpen: () => wantOpen,
    dispose() {
      active = false;
      stopTicking();
      clearTimeout(fallbackTimer);
    },
  };
}
