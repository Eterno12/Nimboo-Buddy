/*
 * Trilha e efeitos sonoros 100% sintetizados (Web Audio), sem arquivos nem licenças de terceiros.
 * Tudo é renderizado UMA vez num buffer de 30 s (OfflineAudioContext), com os efeitos nos mesmos
 * instantes da timeline. Na reprodução, o buffer toca a partir de `tl.time()`: pausar, navegar e
 * repetir continuam sincronizados.
 */
(function () {
  const NB = window.NB;
  const SR = 44100;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---- Instrumentos e efeitos (cada função agenda nós no contexto offline) --------------------

  function makeKit(ctx) {
    // Ruído determinístico (sempre o mesmo resultado).
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const noise = ctx.createBuffer(1, SR * 2, SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand();

    // Barramentos: música, efeitos e reverb (impulso gerado).
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);

    const verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, SR * 2.6, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = rand() * Math.pow(1 - i / d.length, 3.2);
    }
    verb.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.32;
    verb.connect(verbOut).connect(master);

    const bus = (gain, send) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(master);
      if (send) {
        const s = ctx.createGain();
        s.gain.value = send;
        g.connect(s).connect(verb);
      }
      return g;
    };
    const music = bus(0.5, 0.35);
    const drums = bus(0.55, 0.08);
    const sfx = bus(0.75, 0.3);

    /** Envelope ADSR simples num GainNode. */
    const env = (g, t, a, peak, d, sustain = 0, hold = 0, r = 0.05) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      g.gain.exponentialRampToValueAtTime(Math.max(sustain || 0.0001, 0.0001), t + a + d);
      if (hold) {
        g.gain.setValueAtTime(Math.max(sustain, 0.0001), t + a + d + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
      }
    };
    const osc = (type, f, t, dur, out) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    };
    const pan = (out, p) => {
      const pn = ctx.createStereoPanner();
      pn.pan.value = p;
      pn.connect(out);
      return pn;
    };
    const noiseSrc = (t, dur, out) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.connect(out);
      s.start(t, (t * 0.37) % 1.5);
      s.stop(t + dur + 0.05);
      return s;
    };

    const K = {
      // -- música --
      pad(notes, t, dur, gain = 0.06, cutoff = 1800) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(cutoff * 0.5, t);
        lp.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
        lp.Q.value = 0.5;
        const g = ctx.createGain();
        lp.connect(g).connect(music);
        env(g, t, Math.min(0.6, dur * 0.3), gain, 0.4, gain * 0.8, Math.max(0, dur - 1.0), 1.2);
        notes.forEach((n, i) => {
          for (const det of [-7, 7]) {
            const o = osc('sawtooth', midi(n), t, dur + 1.3, pan(lp, (i % 2 ? 0.35 : -0.35) * (det > 0 ? 1 : -1)));
            o.detune.value = det;
          }
        });
      },
      pluck(n, t, gain = 0.07, p = 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(4200, t);
        lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
        const g = ctx.createGain();
        lp.connect(g).connect(pan(music, p));
        env(g, t, 0.004, gain, 0.32);
        osc('triangle', midi(n), t, 0.4, lp);
        osc('sine', midi(n + 12), t, 0.25, lp);
      },
      bass(n, t, dur, gain = 0.16) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const g = ctx.createGain();
        lp.connect(g).connect(music);
        env(g, t, 0.01, gain, dur * 0.8, 0.0001);
        osc('sine', midi(n), t, dur, lp);
        osc('sawtooth', midi(n), t, dur, lp).detune.value = 4;
      },
      drone(notes, t, dur, gain) {
        const g = ctx.createGain();
        g.connect(music);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
        notes.forEach((n) => osc('sine', midi(n), t, dur + 0.7, g));
      },
      // -- bateria --
      kick(t, gain = 0.7) {
        const g = ctx.createGain();
        g.connect(drums);
        env(g, t, 0.003, gain, 0.32);
        const o = osc('sine', 130, t, 0.4, g);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      },
      hat(t, gain = 0.05, p = 0.2) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7500;
        const g = ctx.createGain();
        hp.connect(g).connect(pan(drums, p));
        env(g, t, 0.002, gain, 0.045);
        noiseSrc(t, 0.07, hp);
      },
      clap(t, gain = 0.14) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1600;
        bp.Q.value = 0.8;
        const g = ctx.createGain();
        bp.connect(g).connect(drums);
        for (const off of [0, 0.012, 0.024]) {
          const gg = ctx.createGain();
          gg.connect(bp);
          env(gg, t + off, 0.002, gain, off === 0.024 ? 0.16 : 0.02);
          noiseSrc(t + off, 0.2, gg);
        }
        g.gain.value = 1;
      },
      // -- efeitos --
      blip(t, f, gain = 0.12, dur = 0.18, p = 0) {
        const g = ctx.createGain();
        g.connect(pan(sfx, p));
        env(g, t, 0.004, gain, dur);
        osc('sine', f, t, dur, g);
      },
      pop(t, gain = 0.12, p = 0, f0 = 900, f1 = 260) {
        const g = ctx.createGain();
        g.connect(pan(sfx, p));
        env(g, t, 0.003, gain, 0.09);
        const o = osc('sine', f0, t, 0.12, g);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.08);
      },
      click(t, gain = 0.08, p = 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2500;
        const g = ctx.createGain();
        hp.connect(g).connect(pan(sfx, p));
        env(g, t, 0.001, gain, 0.018);
        noiseSrc(t, 0.03, hp);
        K.blip(t, 2400, gain * 0.5, 0.03, p);
      },
      whoosh(t, dur, gain = 0.14, f0 = 300, f1 = 3000, p0 = -0.4, p1 = 0.4) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const pn = ctx.createStereoPanner();
        pn.pan.setValueAtTime(p0, t);
        pn.pan.linearRampToValueAtTime(p1, t + dur);
        const g = ctx.createGain();
        bp.connect(g).connect(pn).connect(sfx);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        noiseSrc(t, dur, bp);
      },
      thud(t, gain = 0.4) {
        const g = ctx.createGain();
        g.connect(sfx);
        env(g, t, 0.003, gain, 0.22);
        const o = osc('sine', 110, t, 0.3, g);
        o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 600;
        const gn = ctx.createGain();
        lp.connect(gn).connect(sfx);
        env(gn, t, 0.002, gain * 0.25, 0.08);
        noiseSrc(t, 0.12, lp);
      },
      boing(t, gain = 0.1, f0 = 330, f1 = 620) {
        const g = ctx.createGain();
        g.connect(sfx);
        env(g, t, 0.005, gain, 0.38);
        const o = osc('sine', f0, t, 0.42, g);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.12);
        const lfo = osc('sine', 22, t, 0.42, ctx.createGain());
        const depth = ctx.createGain();
        depth.gain.value = 26;
        lfo.disconnect();
        lfo.connect(depth).connect(o.frequency);
      },
      /** "Voz" do mascote: pequenas sílabas com deslize de altura (sem palavras). */
      chirp(t, notes, gain = 0.09, step = 0.085) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        lp.Q.value = 3;
        const g = ctx.createGain();
        lp.connect(g).connect(sfx);
        const end = t + notes.length * step;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
        notes.forEach((n, i) => {
          if (i > 0) {
            g.gain.setValueAtTime(gain, t + i * step - 0.012);
            g.gain.linearRampToValueAtTime(gain * 0.45, t + i * step);
            g.gain.linearRampToValueAtTime(gain, t + i * step + 0.02);
          }
        });
        g.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);
        for (const [type, mul, lvl] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
          const lg = ctx.createGain();
          lg.gain.value = lvl;
          lg.connect(lp);
          const o = osc(type, midi(notes[0]) * mul, t, end - t + 0.1, lg);
          notes.forEach((n, i) => o.frequency.exponentialRampToValueAtTime(midi(n) * mul, t + i * step + step * 0.6));
        }
      },
      chime(t, notes, gain = 0.07, spread = 0.06) {
        notes.forEach((n, i) => {
          const tt = t + i * spread;
          for (const [ratio, lvl, dec] of [[1, 1, 1.4], [2.76, 0.3, 0.5], [5.4, 0.12, 0.25]]) {
            const g = ctx.createGain();
            g.connect(pan(sfx, (i / Math.max(1, notes.length - 1)) * 0.6 - 0.3));
            env(g, tt, 0.003, gain * lvl, dec);
            osc('sine', midi(n) * ratio, tt, dec + 0.05, g);
          }
        });
      },
      tick(t, gain = 0.035, p = 0) {
        K.blip(t, 3200, gain, 0.025, p);
      },
      typing(t0, t1, gain = 0.03) {
        for (let t = t0, i = 0; t < t1; t += 0.045 + (i % 3) * 0.012, i++) K.click(t, gain, (i % 2 ? 0.15 : -0.15));
      },
      riser(t0, t1, gain = 0.16) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.Q.value = 2;
        hp.frequency.setValueAtTime(400, t0);
        hp.frequency.exponentialRampToValueAtTime(7000, t1);
        const g = ctx.createGain();
        hp.connect(g).connect(sfx);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.05);
        noiseSrc(t0, t1 - t0 + 0.1, hp);
        const og = ctx.createGain();
        og.connect(sfx);
        og.gain.setValueAtTime(0.0001, t0);
        og.gain.exponentialRampToValueAtTime(gain * 0.3, t1);
        og.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.05);
        const o = osc('sawtooth', 110, t0, t1 - t0 + 0.1, og);
        o.frequency.exponentialRampToValueAtTime(880, t1);
      },
      impact(t, gain = 0.6) {
        const g = ctx.createGain();
        g.connect(sfx);
        env(g, t, 0.004, gain, 1.4);
        const o = osc('sine', 70, t, 1.6, g);
        o.frequency.exponentialRampToValueAtTime(32, t + 1.0);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5000, t);
        lp.frequency.exponentialRampToValueAtTime(200, t + 0.8);
        const gn = ctx.createGain();
        lp.connect(gn).connect(sfx);
        env(gn, t, 0.002, gain * 0.35, 0.9);
        noiseSrc(t, 1.0, lp);
      },
    };
    return K;
  }

  // ---- Partitura (mesmos instantes da timeline das cenas) -------------------------------------

  function score(K) {
    // Harmonia em Ré maior: Dmaj7 · Bm7 · Gmaj7 · A(add6).
    const CH = [
      { pad: [50, 57, 61, 66], root: 38, arp: [62, 66, 69, 73] },
      { pad: [47, 54, 57, 62], root: 35, arp: [59, 62, 66, 69] },
      { pad: [55, 59, 62, 66], root: 43, arp: [62, 67, 71, 74] },
      { pad: [52, 57, 61, 64], root: 33, arp: [61, 64, 69, 73] },
    ];
    const BEAT = 0.625; // 96 BPM
    const BAR = BEAT * 4;
    const GRID0 = 3.0; // compassos a partir da cena 2

    // Cena 1: abertura (zumbido grave que cresce e brilho agudo).
    K.drone([26, 38, 45], 0.0, 3.2, 0.05);
    K.drone([86, 93], 1.2, 1.8, 0.008);
    K.blip(0.35, 1760, 0.08, 0.5);
    K.whoosh(0.8, 0.8, 0.12, 200, 2600, 0, 0);
    K.pop(1.28, 0.14, 0, 520, 180);
    K.boing(1.5, 0.08, 420, 760);
    K.click(2.42, 0.04);
    K.chime(2.05, [74, 78, 81, 86], 0.045, 0.07);
    K.whoosh(2.7, 0.7, 0.1, 2400, 300, 0.3, -0.3);

    // Cenas 2–5: groove leve.
    for (let b = 0; GRID0 + b * BAR < 21; b++) {
      const t = GRID0 + b * BAR;
      const c = CH[b % 4];
      const len = Math.min(BAR, 21 - t);
      K.pad(c.pad, t, len, b === 0 ? 0.035 : 0.05);
      // arpejo a partir da entrada do mascote
      for (let s = 0; s < 8; s++) {
        const ts = t + s * (BEAT / 2);
        if (ts < 4.6 || ts > 20.7) continue;
        const pat = [0, 1, 2, 3, 2, 1, 2, 3];
        K.pluck(c.arp[pat[s]], ts, s % 2 ? 0.045 : 0.06, s % 2 ? 0.3 : -0.3);
      }
      for (let q = 0; q < 4; q++) {
        const tq = t + q * BEAT;
        if (tq >= 20.8) continue;
        const light = tq >= 16.0; // cena 5 mais leve ("never in the way")
        if (tq >= 5.45 && (!light || q % 2 === 0)) K.kick(tq, light ? 0.45 : 0.6);
        if (tq >= 8.0) K.hat(tq + BEAT / 2, light ? 0.03 : 0.045);
        if (tq >= 10.5 && tq < 16.0 && (q === 1 || q === 3)) K.clap(tq, 0.1);
        if (tq >= 8.0) K.bass(c.root, tq, BEAT * 0.9, light ? 0.11 : 0.15);
      }
    }

    // Cena 2
    K.whoosh(3.1, 0.6, 0.06, 500, 3500);
    K.whoosh(4.55, 0.85, 0.16, 2600, 400, 0.8, 0.2);
    K.thud(5.45, 0.38);
    K.boing(5.48, 0.05, 240, 160);
    K.chirp(6.35, [74, 81], 0.08);
    K.whoosh(6.8, 0.75, 0.12, 300, 2200, 0.3, -0.1);
    // Cena 3
    K.whoosh(7.3, 0.5, 0.05, 600, 4000);
    K.chirp(7.95, [76, 79, 83], 0.07, 0.07);
    K.whoosh(8.72, 0.5, 0.08, 800, 3000, -0.1, 0.4);
    K.pop(9.0, 0.06, 0.3);
    [9.15, 9.23, 9.31].forEach((t, i) => K.pop(t, 0.045, 0.2 + i * 0.05, 1200, 500));
    K.click(9.95, 0.09, 0.25);
    K.whoosh(10.05, 0.3, 0.05, 2000, 6000, 0.1, 0.4);
    K.chirp(10.3, [79, 83, 86], 0.09, 0.075);
    K.chime(10.36, [86, 90, 93], 0.035, 0.05);
    K.whoosh(10.95, 0.6, 0.1, 400, 2400, 0.4, 0);
    // Cena 4: tique-taque discreto do foco, cartões chegando, sininho do lembrete
    for (let t = 11.75; t < 15.6; t += 1) K.tick(t, 0.03, 0.1);
    K.whoosh(13.15, 0.6, 0.07, 300, 2000, -0.7, -0.3);
    K.whoosh(13.4, 0.6, 0.07, 300, 2000, 0.7, 0.3);
    K.whoosh(13.65, 0.6, 0.06, 300, 2000, 0.5, 0.2);
    K.chime(14.4, [93, 88], 0.05, 0.12);
    K.whoosh(15.6, 0.65, 0.11, 3000, 400, 0, 0);
    K.whoosh(15.9, 0.8, 0.09, 1800, 300, -0.2, 0.7);
    // Cena 5: acorda, clique, conversa, nota salva
    K.chirp(18.2, [67, 74, 79], 0.08, 0.06);
    K.click(19.15, 0.1, 0.1);
    K.whoosh(19.18, 0.45, 0.08, 500, 3500, 0, 0);
    K.pop(19.5, 0.07, 0.2);
    K.pop(19.8, 0.07, -0.1, 700, 300);
    K.typing(19.85, 20.33);
    K.chime(20.3, [81, 86], 0.045, 0.08);
    K.chirp(20.35, [79, 83], 0.05);
    K.whoosh(20.62, 0.4, 0.06, 3500, 600, 0, 0);

    // Cena 6: o ritmo desacelera (só harmonia), peso emocional.
    K.whoosh(21.0, 1.0, 0.14, 300, 2600, 0.6, 0);
    K.pad([55, 59, 62, 66, 71], 21.0, 2.0, 0.06, 2400);
    K.pad([52, 57, 61, 64, 69], 23.0, 1.5, 0.06, 2600);
    K.pad([47, 54, 57, 62, 66], 24.5, 1.4, 0.055, 2800);
    K.bass(31, 21.0, 2.0, 0.12);
    K.bass(33, 23.0, 1.5, 0.12);
    K.bass(35, 24.5, 1.4, 0.12);
    [[22.2, 74], [22.8, 78], [23.4, 81], [24.0, 78], [24.6, 83]].forEach(([t, n]) => K.pluck(n, t, 0.05, 0));
    K.chirp(22.05, [74, 78, 81], 0.06, 0.09);
    K.chirp(24.3, [79, 83, 79, 86], 0.07, 0.06);
    K.riser(25.0, 26.0, 0.14);
    K.whoosh(25.2, 0.75, 0.1, 3000, 500, 0, 0);

    // Cena 7: fragmentos, impacto, acorde final.
    for (let i = 0; i < 6; i++) K.whoosh(25.95 + i * 0.1, 0.5, 0.035, 5000, 1500, i % 2 ? 0.7 : -0.7, 0);
    K.blip(26.72, 1760, 0.06, 0.3);
    K.impact(26.95, 0.55);
    K.pad([50, 57, 61, 64, 66, 69, 74], 26.95, 2.4, 0.07, 3000);
    K.bass(26, 26.95, 2.6, 0.18);
    K.chime(26.98, [74, 81, 86, 90], 0.04, 0.05);
    K.pop(27.3, 0.12, 0, 520, 180);
    K.boing(27.5, 0.07, 420, 760);
    K.chime(27.8, [86, 90, 93, 98], 0.035, 0.06);
    K.drone([86, 93], 28.3, 1.4, 0.006);
  }

  // ---- Reprodução sincronizada -----------------------------------------------------------------

  NB.audio = {
    ctx: null,
    buffer: null,
    src: null,
    out: null,
    enabled: true,
    offset0: 0,

    /** Renderiza a trilha (uma vez). */
    async render() {
      const dur = NB.config.duration;
      const off = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
      score(makeKit(off));
      this.buffer = await off.startRendering();
      // Normaliza (pico ~ -1 dBFS) e faz o fade final para terminar em silêncio exatamente aos 30 s.
      let peak = 0;
      for (let c = 0; c < 2; c++) for (const v of this.buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      const k = peak > 0 ? 0.89 / peak : 1;
      for (let c = 0; c < 2; c++) {
        const d = this.buffer.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= k;
        const n = Math.floor(SR * 0.8);
        for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n;
      }
      return this.buffer;
    },

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    },

    get locked() {
      return !this.ctx || this.ctx.state !== 'running';
    },

    unlock() {
      return this.ctx ? this.ctx.resume() : Promise.resolve();
    },

    start(at) {
      this.stop();
      if (!this.enabled || !this.buffer || this.locked) return;
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffer;
      s.connect(this.out);
      s.start(0, Math.max(0, at));
      this.src = s;
      this.offset0 = this.ctx.currentTime - at;
    },

    stop() {
      if (!this.src) return;
      try {
        this.src.stop();
      } catch {
        /* já parado */
      }
      this.src.disconnect();
      this.src = null;
    },

    /** Chamado a cada atualização da timeline e a cada play/pause/navegação. */
    sync(tl) {
      const playing = !tl.paused() && tl.progress() < 1;
      if (!playing || !this.enabled) return this.stop();
      if (!this.src) return this.start(tl.time());
      const drift = this.ctx.currentTime - this.offset0 - tl.time();
      if (Math.abs(drift) > 0.08) this.start(tl.time());
    },
  };
})();
