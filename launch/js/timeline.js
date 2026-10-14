/* Timeline principal: junta as referências, mede o que precisa ser medido e monta as 7 cenas. */
(function () {
  const NB = window.NB;

  NB.collectRefs = () => {
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];
    const actor = $('#actor');
    const logo = $('#logoWrap');
    const h3el = $('#h3');
    const R = {
      camera: $('#camera'),
      s2: $('#s2'), s3: $('#s3'), s4: $('#s4'), s5: $('#s5'), s6: $('#s6'),
      // marca
      logoWrap: logo,
      logo: { squash: logo.querySelector('.l-squash'), sprout: logo.querySelector('.l-sprout'), body: logo.querySelector('.l-body'), eyes: logo.querySelector('.l-eyes') },
      glow: $('#glow'),
      wordmark: $('#wordmark'),
      tagline: $('#tagline'),
      // mascote
      actor,
      m: NB.mascotRefs(actor),
      // cena 2
      desktop: $('#desktop'),
      desktopWins: $$('#desktop .win'),
      winB: $('#desktop .win-b'),
      taskbar: $('#desktop .taskbar'),
      docLines: $$('#desktop .win-a .ln'),
      mailRows: $$('#desktop .mail'),
      // cena 3
      h3el,
      island3: $('#ctrlIsland'),
      ibHead: $('#ctrlIsland .ib-head'),
      ibTasks: $('#ctrlIsland .ib-tasks'),
      ibFocus: $('#ctrlIsland .ib-focus'),
      ibNotes: $('#ctrlIsland .ib-notes'),
      ibRing: $('#ctrlIsland .ib-ring .prog'),
      taskItems: $$('#ctrlIsland .task'),
      taskDone: $('#taskDone'),
      taskDoneText: $('#taskDone .tt'),
      cb: $('#taskDone .cb'),
      cbPath: $('#taskDone .cb path'),
      strike: $('#taskDone .strike'),
      c3: $('#ctrlIsland .c3'),
      c2: $('#ctrlIsland .c2'),
      burst: $$('#burst i'),
      // cena 4
      focusCard: $('#focusCard'),
      fcHead: $('#focusCard .fc-head'),
      fcRing: $('#focusCard .fc-ring'),
      fcSide: $$('#focusCard .fc-side > *'),
      fcProg: $('#focusCard .big-ring .prog'),
      fcTime: $('#focusCard .fc-time'),
      dot2: $('#focusCard .dots .d2'),
      note4: $('#note4'),
      rem4: $('#rem4'),
      chip4: $('#chip4'),
      bell: $('#rem4 .bell'),
      // cena 5
      desktop2: $('#desktop2'),
      scrim: $('#scrim'),
      island5: $('#island5'),
      pillRow: $('#island5 .pill-row'),
      pillTime: $('#island5 .pill-time'),
      openBody: $('#island5 .open-body'),
      msgMe: $('#island5 .msg.me'),
      msgBot: $('#island5 .msg.bot'),
      botText: $('#island5 .bot-text'),
      noteChip: $('#island5 .note-chip'),
      cursor: $('#cursor'),
      // cena 6
      giants: $$('#s6 .giant'),
      orbs: $$('.orb'),
      orbInner: $$('.orb .orb-c'),
      // cena 7 / transições
      frags: $$('#frags .frag'),
      shell: $('#shell'),
    };
    // Tipografia dividida (antes de qualquer medição).
    R.h2 = NB.splitWords($('#h2'));
    R.h3 = NB.splitWords(h3el);
    R.h3strong = R.h3.filter((w) => w.classList.contains('strong'));
    R.h4 = NB.splitWords($('#h4'));
    R.h5 = NB.splitWords($('#h5'));
    R.h6 = NB.splitWords($('#h6'));
    R.chars = NB.splitChars(R.wordmark);
    // Retângulos para os morphs entre interfaces (medidos antes de qualquer transformação).
    R.rects = {
      ibFocus: NB.rectOf(R.ibFocus),
      focusCard: NB.rectOf(R.focusCard),
      pill: NB.rectOf(R.island5),
    };
    return R;
  };

  NB.buildTimeline = () => {
    const R = NB.collectRefs();
    NB.R = R;

    // Estados de base (nada aparece antes da hora).
    gsap.set(R.shell, { autoAlpha: 0 });
    gsap.set(R.orbs, { xPercent: -50, yPercent: -50 });
    gsap.set([R.wordmark], { autoAlpha: 1 });
    gsap.set(R.tagline, { autoAlpha: 0 });

    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
    NB.scene01(tl, R);
    NB.scene02(tl, R);
    NB.scene03(tl, R);
    NB.scene04(tl, R);
    NB.scene05(tl, R);
    NB.scene06(tl, R);
    NB.scene07(tl, R);

    // Duração narrativa fixa: segura o quadro final até 30 s.
    const end = NB.config.duration;
    if (tl.duration() > end) console.warn(`[nimboo] a timeline passou de ${end}s: ${tl.duration().toFixed(2)}s`);
    tl.set({}, {}, end);
    return tl;
  };
})();
