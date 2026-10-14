/*
 * As sete cenas. Cada função recebe a timeline principal e as referências (R) e usa tempos
 * absolutos (s), para a montagem ficar fácil de ler e ajustar. As transições ficam no fim de
 * cada cena e já entregam os elementos na posição em que a próxima começa.
 */
(function () {
  const NB = window.NB;
  const SW = 'sine.inOut';

  // CENA 01 — Revelação da marca (0–3 s): ponto → círculo → símbolo, nome discreto.
  NB.scene01 = (tl, R) => {
    const L = R.logo;
    gsap.set(R.logoWrap, { autoAlpha: 0, scale: 0.02 });
    gsap.set(L.body, { attr: { d: NB.SHAPES.circle } });
    gsap.set(L.sprout, { scale: 0, svgOrigin: '100 78' });
    gsap.set(L.eyes, { scaleY: 0, svgOrigin: '100 128' });

    NB.move(tl, R.logoWrap, { autoAlpha: 0, scale: 0.02 }, { autoAlpha: 1, scale: 0.05, duration: 0.45, ease: 'power2.out' }, 0.35);
    NB.enter(tl, R.glow, { autoAlpha: 0, scale: 0.3 }, { autoAlpha: 1, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.55);
    NB.echoMove(tl, R.logoWrap, [{ from: { scale: 0.05 }, to: { scale: 1, duration: 0.75, ease: 'expo.out' } }], 0.85, { opacity: 0.26 });
    tl.to(L.body, { attr: { d: NB.SHAPES.body }, duration: 0.5, ease: 'power3.inOut' }, 1.28);
    tl.to(L.sprout, { scale: 1, svgOrigin: '100 78', duration: 0.6, ease: 'back.out(2.4)' }, 1.5);
    tl.to(L.eyes, { scaleY: 1, svgOrigin: '100 128', duration: 0.26, ease: 'back.out(2)' }, 1.66);
    NB.squash(tl, L.squash, 1.86, 0.07);
    NB.sway(tl, L.sprout, 1.98, -12, 1, 0.3);
    NB.blink(tl, L.eyes, 2.42, '100 128');

    NB.revealWords(tl, R.chars, 2.05, { stagger: 0.05, duration: 0.85, rotation: 0 });
    NB.move(tl, R.wordmark, { letterSpacing: '0.75em', textIndent: '0.75em' }, { letterSpacing: '0.38em', textIndent: '0.38em', duration: 1.2, ease: 'expo.out' }, 2.0);

    NB.move(tl, R.camera, { scale: 1 }, { scale: 1.07, duration: 2.8, ease: 'power1.inOut' }, 0);

    // Saída: o símbolo sobe e se desfaz com rastro; a câmera recua para a cena 2.
    NB.echoMove(tl, R.logoWrap, [{ from: { y: 0, scale: 1 }, to: { y: -90, scale: 0.8, duration: 0.5, ease: 'power3.in' } }], 2.75, { copies: 2, opacity: 0.22 });
    tl.to(R.logoWrap, { autoAlpha: 0, duration: 0.4, ease: 'power2.in' }, 2.85);
    tl.to(R.wordmark, { autoAlpha: 0, y: -18, duration: 0.4, ease: 'power2.in' }, 2.72);
    tl.to(R.glow, { autoAlpha: 0, duration: 0.6, ease: 'power1.out' }, 2.8);
    tl.to(R.camera, { scale: 1, duration: 0.7, ease: 'power3.inOut' }, 2.8);
  };

  // CENA 02 — "Your desktop. A little more alive." (3–7 s)
  NB.scene02 = (tl, R) => {
    const m = R.m;
    tl.set(R.s2, { autoAlpha: 1 }, 3.0);
    tl.set(R.s2, { autoAlpha: 0 }, 7.5);

    NB.revealWords(tl, R.h2, 3.15, { stagger: 0.085 });
    NB.enter(tl, R.desktop, { autoAlpha: 0, y: 70, scale: 0.965 }, { autoAlpha: 1, y: 0, scale: 1, duration: 1.1, ease: 'expo.out' }, 3.45);
    NB.enter(tl, R.desktopWins, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.85, ease: 'expo.out', stagger: 0.12 }, 3.75);
    NB.enter(tl, R.taskbar, { yPercent: 100 }, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, 3.95);
    NB.enter(tl, R.docLines, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'power3.out', stagger: 0.09 }, 4.05);
    NB.move(tl, R.camera, { scale: 1, y: 0 }, { scale: 1.03, y: -8, duration: 3.1, ease: SW }, 3.5);

    // O mascote entra pela lateral em arco e pousa na borda da janela.
    gsap.set(R.actor, { autoAlpha: 0 });
    tl.set(R.actor, { autoAlpha: 1 }, 4.6);
    NB.echoMove(
      tl,
      R.actor,
      [
        { from: { x: 2160, scale: 0.8 }, to: { x: 1420, scale: 0.8, duration: 0.85, ease: 'power3.out' } },
        { from: { y: 230 }, to: { y: 471, duration: 0.85, ease: 'power2.in' } },
      ],
      4.6,
    );
    NB.squash(tl, m.squash, 5.45, 0.2);
    NB.enter(tl, m.shadow, { opacity: 0 }, { opacity: 0.08, duration: 0.3 }, 5.45);
    // O "impacto" acorda a área de trabalho.
    tl.to(R.winB, { y: 5, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out' }, 5.45);
    tl.to(R.desktopWins, { borderColor: 'rgba(255,255,255,0.34)', duration: 0.45, stagger: 0.1, ease: 'power2.out' }, 5.5);
    NB.enter(tl, R.mailRows, { autoAlpha: 0.35 }, { autoAlpha: 1, duration: 0.4, stagger: 0.08 }, 5.6);

    NB.look(tl, m, -7, 0, 5.75);
    NB.blink(tl, m.eyesOpen, 6.0);
    NB.look(tl, m, 6, -1, 6.1);
    NB.look(tl, m, 0, 0, 6.35, 0.2);
    NB.face(tl, m, { eyes: 'happy', mouth: 'open' }, 6.35);
    NB.hop(tl, R.actor, 6.35, 38, 0.46);
    NB.sway(tl, m.sprout, 6.35, 14, 1, 0.2);
    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 6.85);

    // Saída: texto sai pela máscara, o desktop se afasta e o mascote vai ao centro.
    NB.hideWords(tl, R.h2, 6.7);
    tl.to(R.desktop, { autoAlpha: 0, scale: 1.05, duration: 0.6, ease: 'power3.in' }, 6.75);
    tl.to(R.camera, { scale: 1, y: 0, duration: 0.7, ease: 'power3.inOut' }, 6.7);
    NB.echoMove(tl, R.actor, [{ from: { x: 1420, y: 471, scale: 0.8 }, to: { x: 960, y: 760, scale: 1.5, duration: 0.8, ease: 'power3.inOut' } }], 6.85);
  };

  // CENA 03 — "MORE than a MASCOT." (7–11 s)
  NB.scene03 = (tl, R) => {
    const m = R.m;
    tl.set(R.s3, { autoAlpha: 1 }, 7.0);
    tl.set(R.s3, { autoAlpha: 0 }, 11.7);

    NB.revealWords(tl, R.h3, 7.35, { stagger: 0.11, duration: 1 });
    tl.fromTo(R.h3strong, { scale: 1.16 }, { scale: 1, duration: 1.2, ease: 'expo.out', stagger: 0.33, immediateRender: false }, 7.35);
    NB.face(tl, m, { eyes: 'happy', mouth: 'smile' }, 7.95);
    NB.squash(tl, m.squash, 7.95, 0.1);
    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 8.4);

    tl.to(R.h3el, { y: -50, autoAlpha: 0, duration: 0.5, ease: 'power3.in' }, 8.45);
    NB.move(tl, R.actor, { x: 960, y: 760, scale: 1.5 }, { x: 540, y: 800, scale: 1.32, duration: 0.75, ease: 'power3.inOut' }, 8.55);
    NB.look(tl, m, 7, -1, 8.95);

    // A ilha nasce de uma pílula (clip-path) e cada parte entra do seu jeito.
    NB.enter(
      tl,
      R.island3,
      { autoAlpha: 0, clipPath: 'inset(46% 42% 46% 42% round 48px)' },
      { autoAlpha: 1, clipPath: 'inset(0% 0% 0% 0% round 28px)', duration: 0.75, ease: 'expo.out' },
      8.75,
    );
    NB.enter(tl, R.ibHead, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 9.0);
    NB.enter(tl, R.ibTasks, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: 'expo.out' }, 9.05);
    NB.enter(tl, R.taskItems, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: 'expo.out', stagger: 0.08 }, 9.15);
    NB.enter(tl, R.ibFocus, { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: 'back.out(1.6)' }, 9.15);
    NB.enter(tl, R.ibRing, { strokeDashoffset: NB.RING.small }, { strokeDashoffset: NB.RING.small * 0.32, duration: 1.0, ease: 'power2.inOut' }, 9.3);
    NB.enter(tl, R.ibNotes, { clipPath: 'inset(0% 0% 100% 0% round 20px)' }, { clipPath: 'inset(0% 0% 0% 0% round 20px)', duration: 0.7, ease: 'expo.out' }, 9.3);

    // Tarefa concluída: marca, risca e sai da lista; o mascote comemora.
    tl.to(R.cb, { backgroundColor: '#ffffff', borderColor: '#ffffff', duration: 0.18, ease: 'power2.out' }, 9.95);
    NB.enter(tl, R.cbPath, { strokeDashoffset: 20 }, { strokeDashoffset: 0, duration: 0.25, ease: 'power2.out' }, 10.02);
    NB.enter(tl, R.strike, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power3.inOut' }, 10.05);
    tl.to(R.taskDoneText, { color: '#6a6a6a', duration: 0.2 }, 10.05);
    tl.to(R.taskDone, { height: 0, autoAlpha: 0, borderBottomWidth: 0, duration: 0.4, ease: 'power3.inOut' }, 10.4);
    tl.to(R.c3, { yPercent: -100, autoAlpha: 0, duration: 0.3, ease: 'power2.in' }, 10.45);
    NB.enter(tl, R.c2, { yPercent: 100, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.35, ease: 'power3.out' }, 10.5);

    NB.face(tl, m, { eyes: 'happy', mouth: 'open' }, 10.3);
    NB.hop(tl, R.actor, 10.3, 50, 0.5);
    NB.sway(tl, m.sprout, 10.3, 16, 1, 0.22);
    NB.squash(tl, m.squash, 10.8, 0.14);
    NB.enter(tl, R.burst, { scaleY: 0, y: 0, autoAlpha: 1 }, { scaleY: 1, y: -16, duration: 0.25, ease: 'power2.out', stagger: 0.02 }, 10.35);
    tl.to(R.burst, { autoAlpha: 0, y: -36, duration: 0.3, ease: 'power1.in', stagger: 0.02 }, 10.62);
    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 10.95);

    // Saída: o bloco de foco "cresce" até virar o temporizador da cena 4.
    tl.to([R.ibHead, R.ibTasks, R.ibNotes], { autoAlpha: 0, y: 10, duration: 0.32, ease: 'power2.in', stagger: 0.04 }, 10.85);
    tl.to(R.island3, { autoAlpha: 0, duration: 0.25, ease: 'power1.in' }, 11.0);
    NB.morphShell(tl, R.shell, R.rects.ibFocus, R.rects.focusCard, 10.98, 0.58, 20, 28);
    NB.look(tl, m, 0, 0, 10.95);
    NB.move(tl, R.actor, { x: 540, y: 800, scale: 1.32 }, { x: 470, y: 885, scale: 0.95, duration: 0.65, ease: 'power3.inOut' }, 10.95);
  };

  // CENA 04 — "Your routine, with a little company." (11–16 s)
  NB.scene04 = (tl, R) => {
    const m = R.m;
    tl.set(R.s4, { autoAlpha: 1 }, 11.0);
    tl.set(R.s4, { autoAlpha: 0 }, 16.6);

    NB.revealWords(tl, R.h4, 11.2, { stagger: 0.075 });
    NB.enter(tl, R.focusCard, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'power1.out' }, 11.5);
    NB.enter(tl, R.fcHead, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 11.58);
    NB.enter(tl, R.fcRing, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'back.out(1.5)' }, 11.6);
    NB.enter(tl, R.fcSide, { autoAlpha: 0, x: 18 }, { autoAlpha: 1, x: 0, duration: 0.6, ease: 'expo.out', stagger: 0.08 }, 11.7);
    NB.enter(tl, R.fcProg, { strokeDashoffset: NB.RING.big }, { strokeDashoffset: NB.RING.big * 0.24, duration: 3.9, ease: 'power1.inOut' }, 11.75);
    NB.countdown(tl, R.fcTime, 1500, 1496, 11.7, 4.0);
    tl.to(R.dot2, { backgroundColor: '#ffffff', borderColor: '#ffffff', duration: 0.3 }, 12.1);

    // O mascote fica ao lado, atento ao temporizador.
    NB.look(tl, m, 6, -3, 11.75);
    tl.fromTo(m.squash, { scaleX: 1, scaleY: 1, svgOrigin: '100 180' }, { scaleX: 0.985, scaleY: 1.025, svgOrigin: '100 180', duration: 0.9, ease: SW, yoyo: true, repeat: 3, immediateRender: false }, 11.8);
    NB.blink(tl, m.eyesOpen, 12.85);

    // Notas e lembretes chegam e se organizam em volta, em profundidades diferentes.
    NB.enter(tl, R.note4, { autoAlpha: 0, x: -90, rotation: -8, scale: 0.92 }, { autoAlpha: 1, x: 0, rotation: -3, scale: 1, duration: 1, ease: 'expo.out' }, 13.2);
    NB.enter(tl, R.rem4, { autoAlpha: 0, x: 90, y: -20 }, { autoAlpha: 1, x: 0, y: 0, duration: 1, ease: 'expo.out' }, 13.45);
    NB.enter(tl, R.chip4, { autoAlpha: 0, y: 60, scale: 0.95 }, { autoAlpha: 1, y: 0, scale: 1, duration: 1, ease: 'expo.out' }, 13.7);
    NB.look(tl, m, -6, -4, 13.35);
    NB.look(tl, m, 6, -3, 14.05);
    tl.to(R.bell, { rotation: 16, transformOrigin: '50% 10%', duration: 0.08, yoyo: true, repeat: 5, ease: SW }, 14.4);
    NB.blink(tl, m.eyesOpen, 14.75);
    tl.to(R.note4, { y: -14, duration: 2.2, ease: SW }, 14.2);
    tl.to(R.rem4, { y: -24, duration: 2.0, ease: SW }, 14.45);
    tl.to(R.chip4, { y: -8, duration: 1.8, ease: SW }, 14.7);
    NB.move(tl, R.camera, { scale: 1, x: 0 }, { scale: 1.04, x: -20, duration: 4.2, ease: SW }, 11.4);

    // Saída: o temporizador encolhe até virar a ilha compacta no topo (cena 5).
    NB.hideWords(tl, R.h4, 15.45);
    tl.to(R.note4, { autoAlpha: 0, x: -60, duration: 0.45, ease: 'power2.in' }, 15.55);
    tl.to([R.rem4, R.chip4], { autoAlpha: 0, x: 60, duration: 0.45, ease: 'power2.in', stagger: 0.05 }, 15.55);
    tl.to(R.focusCard, { autoAlpha: 0, duration: 0.2 }, 15.68);
    NB.morphShell(tl, R.shell, R.rects.focusCard, R.rects.pill, 15.65, 0.6, 28, 32);
    tl.to(R.camera, { scale: 1, x: 0, duration: 0.7, ease: 'power3.inOut' }, 15.6);
    NB.look(tl, m, 0, 0, 15.85);
    NB.echoMove(tl, R.actor, [{ from: { x: 470, y: 885, scale: 0.95 }, to: { x: 1640, y: 1000, scale: 0.5, duration: 0.8, ease: 'power3.inOut' } }], 15.9, { copies: 2 });
  };

  // CENA 05 — "Always there. Never in the way." (16–21 s)
  NB.scene05 = (tl, R) => {
    const m = R.m;
    tl.set(R.s5, { autoAlpha: 1 }, 15.7);
    tl.set(R.s5, { autoAlpha: 0 }, 21.6);

    NB.enter(tl, R.desktop2, { autoAlpha: 0, scale: 1.04 }, { autoAlpha: 0.42, scale: 1, duration: 1.0, ease: 'power2.out' }, 15.75);
    NB.enter(tl, R.scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 15.9);
    NB.enter(tl, R.island5, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 }, 16.2);
    NB.enter(tl, R.pillRow, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 16.3);
    NB.countdown(tl, R.pillTime, 1496, 1491, 16.3, 4.7);
    NB.revealWords(tl, R.h5, 16.45, { stagger: 0.08 });

    // Descansando no canto: olhos fechados e respiração lenta.
    NB.face(tl, m, { eyes: 'closed', mouth: 'smile' }, 16.75);
    tl.fromTo(m.squash, { scaleX: 1, scaleY: 1, svgOrigin: '100 180' }, { scaleX: 0.98, scaleY: 1.035, svgOrigin: '100 180', duration: 0.7, ease: SW, yoyo: true, repeat: 1, immediateRender: false }, 16.8);

    // O cursor se aproxima: ele acorda e olha.
    NB.enter(tl, R.cursor, { autoAlpha: 0, x: 1260, y: 780, scale: 1 }, { autoAlpha: 1, duration: 0.25 }, 17.4);
    tl.to(R.cursor, { x: 1590, y: 910, duration: 0.75, ease: 'power2.inOut' }, 17.5);
    NB.face(tl, m, { eyes: 'open', mouth: 'open' }, 18.2);
    NB.squash(tl, m.squash, 18.2, 0.14);
    NB.hop(tl, R.actor, 18.22, 22, 0.36);
    NB.look(tl, m, -7, -4, 18.25, 0.2);
    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 18.6);

    // Clique na ilha: ela se expande com uma conversa e uma nota, depois volta a ser pílula.
    tl.to(R.cursor, { x: 1100, y: 86, duration: 0.55, ease: 'power3.inOut' }, 18.6);
    NB.look(tl, m, -5, -8, 18.65);
    tl.to(R.cursor, { scale: 0.82, transformOrigin: '20% 10%', duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 19.15);
    tl.to(R.pillRow, { autoAlpha: 0, duration: 0.15 }, 19.2);
    tl.to(R.island5, { left: 650, top: 36, width: 620, height: 400, borderRadius: 34, duration: 0.55, ease: 'expo.out' }, 19.2);
    NB.enter(tl, R.openBody, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 19.4);
    tl.to(R.cursor, { x: 1330, y: 320, autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, 19.4);
    NB.enter(tl, R.msgMe, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 19.5);
    NB.enter(tl, R.msgBot, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 19.8);
    NB.typeText(tl, R.botText, 'Design review at 3 PM. Want a reminder?', 19.85, 0.5);
    NB.enter(tl, R.noteChip, { autoAlpha: 0, y: 10, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(1.6)' }, 20.3);
    NB.face(tl, m, { eyes: 'happy', mouth: 'smile' }, 20.35);
    tl.to(R.openBody, { autoAlpha: 0, duration: 0.18 }, 20.62);
    tl.to(R.island5, { left: 760, top: 44, width: 400, height: 64, borderRadius: 32, duration: 0.4, ease: 'power3.inOut' }, 20.65);
    tl.to(R.pillRow, { autoAlpha: 1, duration: 0.2 }, 20.95);

    // Saída para a cena 6.
    NB.hideWords(tl, R.h5, 20.95);
    tl.to([R.desktop2, R.scrim], { autoAlpha: 0, duration: 0.6, ease: 'power1.inOut' }, 21.0);
    tl.to(R.island5, { autoAlpha: 0, y: -20, duration: 0.45, ease: 'power2.in' }, 21.05);
  };

  // CENA 06 — "A little buddy. A big difference." (21–26 s): ritmo mais lento, peso emocional.
  NB.scene06 = (tl, R) => {
    const m = R.m;
    tl.set(R.s6, { autoAlpha: 1 }, 21.0);
    tl.set(R.s6, { autoAlpha: 0 }, 26.2);

    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 21.0);
    NB.look(tl, m, 0, 0, 21.05);
    NB.echoMove(tl, R.actor, [{ from: { x: 1640, y: 1000, scale: 0.5 }, to: { x: 960, y: 800, scale: 2, duration: 0.95, ease: 'expo.inOut' } }], 21.05);
    NB.face(tl, m, { eyes: 'happy', mouth: 'smile' }, 22.05);
    NB.sway(tl, m.sprout, 22.0, 12, 3, 0.5);
    NB.face(tl, m, { eyes: 'open', mouth: 'smile' }, 23.3);
    NB.blink(tl, m.eyesOpen, 23.8);
    NB.face(tl, m, { eyes: 'happy', mouth: 'open' }, 24.3);
    NB.squash(tl, m.squash, 24.3, 0.08);

    // Tipografia em camadas (contornos e cinzas de baixa opacidade) atrás do personagem.
    R.giants.forEach((g, i) => {
      const o = Number(getComputedStyle(g).getPropertyValue('--o')) || 0.06;
      NB.enter(tl, g, { autoAlpha: 0, scale: 1.12, y: (i - 1) * 26 }, { autoAlpha: o, scale: 1, duration: 1.4, ease: 'expo.out' }, 21.35 + i * 0.18);
      tl.to(g, { x: (i - 1) * 34, duration: 2.6, ease: SW }, 22.5);
    });
    NB.revealWords(tl, R.h6, 22.0, { stagger: 0.12, duration: 1.1, ease: 'power4.out' });

    // Elementos das cenas anteriores orbitam o personagem.
    const o = { a: -30, r: 1 };
    const place = () => {
      R.orbs.forEach((orb, i) => {
        const ang = ((o.a + i * 90) * Math.PI) / 180;
        const s = Math.sin(ang);
        const depth = (s + 1) / 2;
        gsap.set(orb, {
          x: 960 + 600 * o.r * Math.cos(ang),
          y: 640 + 175 * o.r * s,
          scale: 0.8 + 0.25 * depth,
          opacity: 0.5 + 0.5 * depth,
          zIndex: s > 0 ? 7 : 3,
        });
      });
    };
    place();
    NB.enter(tl, R.orbInner, { autoAlpha: 0, scale: 0.5 }, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'back.out(1.7)', stagger: 0.16 }, 22.25);
    tl.fromTo(o, { a: -30 }, { a: 170, duration: 3.6, ease: SW, immediateRender: false, onUpdate: place }, 22.0);
    NB.move(tl, R.camera, { scale: 1 }, { scale: 1.05, duration: 3.7, ease: SW }, 21.3);

    // Convergência: tudo vai para o centro e o personagem vira um ponto de luz.
    tl.fromTo(o, { r: 1 }, { r: 0, duration: 0.8, ease: 'power3.in', immediateRender: false, onUpdate: place }, 25.0);
    tl.to(R.orbInner, { scale: 0.2, autoAlpha: 0, duration: 0.45, ease: 'power2.in', stagger: 0.04 }, 25.3);
    NB.hideWords(tl, R.h6, 25.0);
    tl.to(R.giants, { autoAlpha: 0, scale: 1.06, duration: 0.6, ease: 'power2.in' }, 25.0);
    tl.to(R.camera, { scale: 1, duration: 0.9, ease: 'power3.inOut' }, 25.0);
    NB.echoMove(tl, R.actor, [{ from: { x: 960, y: 800, scale: 2 }, to: { x: 960, y: 456, scale: 0.05, duration: 0.75, ease: 'expo.in' } }], 25.2, { lag: 0.04 });
    tl.to(R.actor, { autoAlpha: 0, duration: 0.12 }, 25.9);
  };

  // CENA 07 — Logo final e assinatura (26–30 s). Nada novo entra depois da tagline.
  NB.scene07 = (tl, R) => {
    const L = R.logo;
    tl.set(L.body, { attr: { d: NB.SHAPES.circle } }, 25.85);
    tl.set(L.sprout, { scale: 0, rotation: 0, svgOrigin: '100 78' }, 25.85);
    tl.set(L.eyes, { scaleY: 0, svgOrigin: '100 128' }, 25.85);
    tl.set(R.chars, { yPercent: 118 }, 25.85);
    tl.set(R.logoWrap, { y: 0, scale: 0.05, autoAlpha: 1 }, 25.88);

    // Linhas e fragmentos convergem para o ponto.
    R.frags.forEach((f, i) => {
      const deg = i * (360 / R.frags.length) + (i % 2 ? 9 : -6);
      const a = (deg * Math.PI) / 180;
      const dist = 780 + (i % 3) * 150;
      const at = 25.95 + i * 0.018;
      gsap.set(f, { autoAlpha: 0 });
      NB.move(tl, f, { x: dist * Math.cos(a), y: dist * Math.sin(a) * 0.62, rotation: deg, scaleX: 1 }, { x: 0, y: 0, scaleX: 0.12, rotation: deg + (f.classList.contains('sq') ? 180 : 0), duration: 0.8, ease: 'power3.in' }, at);
      tl.to(f, { autoAlpha: f.classList.contains('sq') ? 0.6 : 0.85, duration: 0.25 }, at);
      tl.to(f, { autoAlpha: 0, duration: 0.12 }, at + 0.7);
    });

    NB.move(tl, R.glow, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 1.6, ease: 'power2.out' }, 26.4);
    tl.to(R.logoWrap, { scale: 0.09, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 }, 26.72);
    NB.echoMove(tl, R.logoWrap, [{ from: { scale: 0.05 }, to: { scale: 1, duration: 0.7, ease: 'expo.out' } }], 26.95, { opacity: 0.24 });
    tl.to(L.body, { attr: { d: NB.SHAPES.body }, duration: 0.5, ease: 'power3.inOut' }, 27.3);
    tl.to(L.sprout, { scale: 1, svgOrigin: '100 78', duration: 0.6, ease: 'back.out(2.4)' }, 27.5);
    tl.to(L.eyes, { scaleY: 1, svgOrigin: '100 128', duration: 0.26, ease: 'back.out(2)' }, 27.65);
    NB.squash(tl, L.squash, 27.85, 0.06);
    NB.blink(tl, L.eyes, 28.15, '100 128');

    tl.set(R.wordmark, { autoAlpha: 1, y: 0, letterSpacing: '0.38em', textIndent: '0.38em' }, 27.8);
    tl.fromTo(R.chars, { yPercent: 118 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.05, immediateRender: false }, 27.8);
    NB.enter(tl, R.tagline, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'expo.out' }, 28.35);
    NB.move(tl, R.camera, { scale: 1 }, { scale: 1.025, duration: 2, ease: 'sine.out' }, 26.6);
  };
})();
