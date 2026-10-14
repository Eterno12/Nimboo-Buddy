/* Inicialização: monta, espera as fontes (para medir textos já com a fonte final) e toca. */
(function () {
  const NB = window.NB;

  async function start() {
    if (!window.gsap) {
      document.getElementById('controls').textContent = 'GSAP não carregou (sem internet?).';
      return;
    }
    NB.mount();
    NB.audio.init();
    NB.player.fit();
    await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
    NB.player.fit();
    const tl = NB.buildTimeline();
    try {
      await NB.audio.render();
    } catch (error) {
      console.warn('[nimboo] trilha indisponível:', error);
    }
    NB.tl = tl;
    NB.player.init(tl);
    document.body.classList.add('ready');
    // `?paused` abre parado no início (útil para revisar); `?t=12.5` abre nesse instante.
    const params = new URLSearchParams(location.search);
    if (params.has('t')) tl.time(Number(params.get('t')) || 0);
    if (!params.has('paused') && !params.has('t')) tl.play(0);
    NB.player.setIcon();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
