/* Player: escala da composição, play/pause, replay, barra de progresso, cenas e modo limpo. */
(function () {
  const NB = window.NB;
  const icons = {
    play: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15l12-7.5Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 3.5v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  NB.player = {
    /** Mantém 16:9 e centraliza; a timeline não muda com o tamanho da janela. */
    fit() {
      const vp = document.getElementById('viewport');
      const s = Math.min(vp.clientWidth / NB.config.W, vp.clientHeight / NB.config.H);
      document.getElementById('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
    },

    init(tl) {
      const cfg = NB.config;
      const bar = document.getElementById('controls');
      bar.innerHTML = `
        <button id="pp" class="cbtn" aria-label="Pause">${icons.pause}</button>
        <button id="rp" class="cbtn" aria-label="Replay">${icons.replay}</button>
        <button id="snd" class="cbtn" aria-label="Sound">${icons.soundOn}</button>
        <span id="sndHint">Click the film for sound</span>
        <span id="time">00.0 / ${cfg.duration.toFixed(1)}s</span>
        <div id="track">
          <div id="marks">${cfg.scenes.map((s, i) => `<button class="mark" data-t="${s.start}" style="left:${(s.start / cfg.duration) * 100}%"><b>${String(i + 1).padStart(2, '0')}</b><span>${s.label}</span></button>`).join('')}</div>
          <input id="scrub" type="range" min="0" max="${cfg.duration}" step="0.01" value="0" aria-label="Timeline">
        </div>
        <button id="clean" class="cbtn wide" title="Modo apresentação (C) · Esc para sair">Clean view</button>`;

      const pp = document.getElementById('pp');
      const scrub = document.getElementById('scrub');
      const time = document.getElementById('time');
      const snd = document.getElementById('snd');
      const hint = document.getElementById('sndHint');
      const setIcon = () => {
        const playing = !tl.paused() && tl.progress() < 1;
        pp.innerHTML = playing ? icons.pause : icons.play;
        pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        const a = NB.audio;
        snd.innerHTML = a.enabled ? icons.soundOn : icons.soundOff;
        snd.setAttribute('aria-label', a.enabled ? 'Mute' : 'Unmute');
        hint.hidden = !(a.enabled && a.locked && a.buffer);
        a.sync(tl);
      };
      const sync = () => {
        scrub.value = tl.time();
        time.textContent = `${tl.time().toFixed(1).padStart(4, '0')} / ${cfg.duration.toFixed(1)}s`;
        scrub.style.setProperty('--p', `${(tl.time() / cfg.duration) * 100}%`);
        NB.audio.sync(tl);
      };
      const toggle = () => {
        if (tl.progress() >= 1) tl.restart();
        else tl.paused(!tl.paused());
        setIcon();
      };
      const seek = (t) => {
        tl.time(Math.max(0, Math.min(cfg.duration, t)));
        sync();
        setIcon();
      };
      const setClean = (on) => {
        document.body.classList.toggle('clean', on);
        NB.player.fit();
      };

      tl.eventCallback('onUpdate', sync);
      tl.eventCallback('onComplete', setIcon);
      tl.eventCallback('onStart', setIcon);
      pp.addEventListener('click', toggle);
      document.getElementById('rp').addEventListener('click', () => {
        tl.restart();
        setIcon();
      });
      let wasPlaying = false;
      scrub.addEventListener('pointerdown', () => {
        wasPlaying = !tl.paused();
        tl.pause();
        setIcon();
      });
      scrub.addEventListener('input', () => seek(Number(scrub.value)));
      scrub.addEventListener('change', () => {
        if (wasPlaying && tl.progress() < 1) tl.play();
        setIcon();
      });
      bar.querySelectorAll('.mark').forEach((b) => b.addEventListener('click', () => seek(Number(b.dataset.t))));
      document.getElementById('clean').addEventListener('click', () => setClean(true));
      // Som bloqueado pelo navegador: o primeiro clique no filme libera e recomeça do início, com som.
      document.getElementById('viewport').addEventListener('click', () => {
        if (NB.audio.enabled && NB.audio.locked && NB.audio.buffer) {
          NB.audio.unlock().then(() => {
            tl.restart();
            setIcon();
          });
          return;
        }
        toggle();
      });
      const toggleSound = () => {
        NB.audio.enabled = !NB.audio.enabled;
        NB.audio.unlock().then(setIcon);
      };
      snd.addEventListener('click', toggleSound);
      // Qualquer outro gesto (botões, teclas) também libera o áudio.
      for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => NB.audio.locked && NB.audio.unlock().then(setIcon), { capture: true });

      window.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
        if (e.key === ' ') {
          e.preventDefault();
          toggle();
        } else if (e.key === 'r' || e.key === 'R') {
          tl.restart();
          setIcon();
        } else if (e.key === 'c' || e.key === 'C') setClean(!document.body.classList.contains('clean'));
        else if (e.key === 'Escape') setClean(false);
        else if (e.key === 'm' || e.key === 'M') toggleSound();
        else if (e.key === 'ArrowRight') seek(tl.time() + 1);
        else if (e.key === 'ArrowLeft') seek(tl.time() - 1);
        else if (/^[1-7]$/.test(e.key)) seek(cfg.scenes[Number(e.key) - 1].start);
      });
      window.addEventListener('resize', () => NB.player.fit());
      if (new URLSearchParams(location.search).has('clean')) setClean(true);
      sync();
      setIcon();
      NB.player.setIcon = setIcon;
    },
  };
})();
