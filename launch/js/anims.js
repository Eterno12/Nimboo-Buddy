/*
 * Animações reutilizáveis. Regra para a timeline ser navegável (ir e voltar sem "sobras"):
 *  - entradas usam `enter` (estado inicial aplicado na montagem + fromTo sem render imediato);
 *  - saídas usam `.to`;
 *  - trocas instantâneas usam `tl.set` (o GSAP desfaz ao voltar).
 */
(function () {
  const NB = window.NB;

  NB.enter = (tl, target, from, to, at) => {
    gsap.set(target, from);
    tl.fromTo(target, from, { ...to, immediateRender: false }, at);
    return tl;
  };

  NB.move = (tl, target, from, to, at) => tl.fromTo(target, from, { ...to, immediateRender: false }, at);

  // ---- Tipografia -----------------------------------------------------------------------

  /** Quebra o texto em palavras mascaradas (`.w` recorta, `.wi` se move). Mantém a classe do trecho. */
  NB.splitWords = (el) => {
    const words = [];
    const nodes = [...el.childNodes];
    el.textContent = '';
    let lineStart = true;
    const add = (text, cls) => {
      if (!lineStart) el.appendChild(document.createTextNode(' '));
      lineStart = false;
      const w = document.createElement('span');
      w.className = 'w';
      const i = document.createElement('span');
      i.className = `wi${cls ? ` ${cls}` : ''}`;
      i.textContent = text;
      w.appendChild(i);
      el.appendChild(w);
      words.push(i);
    };
    for (const n of nodes) {
      if (n.nodeName === 'BR') {
        el.appendChild(document.createElement('br'));
        lineStart = true;
        continue;
      }
      const cls = n.nodeType === 1 ? n.className : '';
      for (const word of n.textContent.split(/\s+/).filter(Boolean)) add(word, cls);
    }
    return words;
  };

  /** Letra por letra (marca). */
  NB.splitChars = (el) => {
    const chars = [...el.textContent];
    el.textContent = '';
    return chars.map((ch) => {
      const w = document.createElement('span');
      w.className = 'w';
      const i = document.createElement('span');
      i.className = 'wi';
      i.textContent = ch;
      w.appendChild(i);
      el.appendChild(w);
      return i;
    });
  };

  NB.revealWords = (tl, words, at, o = {}) =>
    NB.enter(
      tl,
      words,
      { yPercent: 118, rotation: o.rotation ?? 3 },
      { yPercent: 0, rotation: 0, duration: o.duration ?? 0.9, ease: o.ease ?? 'expo.out', stagger: o.stagger ?? 0.08 },
      at,
    );

  NB.hideWords = (tl, words, at, o = {}) =>
    tl.to(words, { yPercent: -118, opacity: 0, duration: o.duration ?? 0.45, ease: 'power3.in', stagger: o.stagger ?? 0.025 }, at);

  // ---- Rastro de movimento ----------------------------------------------------------------

  /**
   * Movimento com "echo trail": cópias que repetem o mesmo trajeto com atraso e opacidade decrescente,
   * simulando motion blur. Use só em deslocamentos rápidos e mudanças de cena.
   * `tweens`: lista de { from, to } aplicada ao elemento e às cópias (permite eases diferentes por eixo).
   */
  NB.echoMove = (tl, el, tweens, at, o = {}) => {
    const copies = o.copies ?? 3;
    const lag = o.lag ?? 0.03;
    const base = o.opacity ?? 0.3;
    const dur = Math.max(...tweens.map((t) => t.to.duration ?? 0.6));
    for (const t of tweens) NB.move(tl, el, t.from, t.to, at);
    for (let i = 1; i <= copies; i++) {
      const c = el.cloneNode(true);
      c.removeAttribute('id');
      c.classList.add('echo');
      el.parentNode.insertBefore(c, el);
      gsap.set(c, { autoAlpha: 0 });
      const start = at + lag * i;
      for (const t of tweens) NB.move(tl, c, t.from, t.to, start);
      tl.set(c, { autoAlpha: base * (1 - (i - 1) / copies) }, start);
      tl.to(c, { autoAlpha: 0, duration: dur * 0.45, ease: 'power1.out' }, start + dur * 0.5);
    }
    return tl;
  };

  // ---- Mascote ------------------------------------------------------------------------------

  /** Expressão: olhos (open | happy | closed) e boca (smile | open). */
  NB.face = (tl, m, { eyes = 'open', mouth = 'smile' }, at) => {
    tl.set(m.eyesOpen, { opacity: eyes === 'open' ? 1 : 0 }, at);
    tl.set(m.eyesHappy, { opacity: eyes === 'happy' ? 1 : 0 }, at);
    tl.set(m.eyesClosed, { opacity: eyes === 'closed' ? 1 : 0 }, at);
    tl.set(m.smile, { opacity: mouth === 'smile' ? 1 : 0 }, at);
    tl.set(m.mouthOpen, { opacity: mouth === 'open' ? 1 : 0 }, at);
  };

  NB.blink = (tl, eyes, at, origin = '100 124') => {
    tl.to(eyes, { scaleY: 0.08, svgOrigin: origin, duration: 0.06, ease: 'power1.in' }, at);
    tl.to(eyes, { scaleY: 1, svgOrigin: origin, duration: 0.12, ease: 'power1.out' }, at + 0.06);
  };

  NB.look = (tl, m, x, y, at, duration = 0.3) => tl.to(m.look, { x, y, duration, ease: 'power2.out' }, at);

  /** Achata e volta com elasticidade (aterrissagem, alegria). */
  NB.squash = (tl, group, at, amount = 0.16, origin = '100 180') =>
    tl.fromTo(
      group,
      { scaleX: 1 + amount, scaleY: 1 - amount, svgOrigin: origin },
      { scaleX: 1, scaleY: 1, svgOrigin: origin, duration: 0.8, ease: 'elastic.out(1, 0.36)', immediateRender: false },
      at,
    );

  NB.hop = (tl, actor, at, height = 40, duration = 0.44) => {
    tl.to(actor, { y: `-=${height}`, duration: duration * 0.45, ease: 'power2.out' }, at);
    tl.to(actor, { y: `+=${height}`, duration: duration * 0.55, ease: 'power2.in' }, at + duration * 0.45);
  };

  /** Balanço do broto (oscilação orgânica). */
  NB.sway = (tl, sprout, at, angle = 12, times = 1, duration = 0.32) =>
    tl.to(sprout, { rotation: angle, svgOrigin: '100 78', duration, ease: 'sine.inOut', yoyo: true, repeat: times * 2 - 1 }, at);

  // ---- Interface ----------------------------------------------------------------------------

  /** Cartão-ponte que se transforma de um retângulo em outro (morph simulado entre interfaces). */
  NB.morphShell = (tl, shell, a, b, at, duration = 0.6, r0 = 20, r1 = 28) => {
    tl.set(shell, { autoAlpha: 1, left: a.x, top: a.y, width: a.w, height: a.h, borderRadius: r0 }, at);
    tl.to(shell, { left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: r1, duration, ease: 'power3.inOut' }, at);
    tl.to(shell, { autoAlpha: 0, duration: 0.18, ease: 'power1.out' }, at + duration);
  };

  /** Contador mm:ss que a timeline consegue avançar e voltar. */
  NB.countdown = (tl, el, fromS, toS, at, duration) => {
    const p = { s: fromS };
    const fmt = (s) => {
      const v = Math.max(0, Math.round(s));
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    };
    tl.fromTo(p, { s: fromS }, { s: toS, duration, ease: 'none', immediateRender: false, onUpdate: () => (el.textContent = fmt(p.s)) }, at);
  };

  /** Texto digitado (resposta do mascote). */
  NB.typeText = (tl, el, text, at, duration) => {
    const p = { n: 0 };
    tl.fromTo(
      p,
      { n: 0 },
      { n: text.length, duration, ease: 'none', immediateRender: false, onUpdate: () => (el.textContent = text.slice(0, Math.round(p.n))) },
      at,
    );
  };

  /** Retângulo de layout em coordenadas da composição (ignora escala da tela e transformações). */
  NB.rectOf = (el) => {
    const stage = document.getElementById('stage');
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== stage; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
})();
