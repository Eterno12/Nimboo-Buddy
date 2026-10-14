/*
 * Mascote e símbolo da marca. As formas vêm do personagem original do app
 * (src/features/mascot/characterArt.tsx): corpo gelatinoso + broto na cabeça (a assinatura visual),
 * aqui em versão monocromática para a campanha.
 */
(function () {
  const NB = window.NB;

  NB.SHAPES = {
    body: 'M100 74 C142 70 172 98 173 132 C174 162 150 180 100 180 C50 180 26 162 27 132 C28 98 58 70 100 74 Z',
    /** Mesmo número de comandos/pontos do corpo: o GSAP interpola o atributo `d` (morph simulado). */
    circle: 'M100 74 C129 74 153 98 153 127 C153 156 129 180 100 180 C71 180 47 156 47 127 C47 98 71 74 100 74 Z',
    sprout: 'M100 78 C97 66 99 56 107 48 C117 56 116 70 102 78 Z',
  };

  /** Mascote completo (rosto, expressões, broto). Âncora visual: pés em (100, 180) do viewBox. */
  NB.mascotSVG = (uid) => `
<svg class="mascot" viewBox="0 0 200 200" width="220" height="220" aria-hidden="true">
  <defs>
    <radialGradient id="${uid}-body" cx="40%" cy="28%" r="85%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="68%" stop-color="#e6e6e6"/>
      <stop offset="100%" stop-color="#b9b9b9"/>
    </radialGradient>
    <linearGradient id="${uid}-sprout" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#b4b4b4"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <ellipse class="m-shadow" cx="100" cy="185" rx="58" ry="7" fill="#ffffff" opacity="0.07"/>
  <g class="m-squash">
    <g class="m-sprout">
      <path d="${NB.SHAPES.sprout}" fill="url(#${uid}-sprout)" stroke="#767676" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M101 76 C103 68 105 61 107 55" fill="none" stroke="#767676" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    </g>
    <path class="m-body" d="${NB.SHAPES.body}" fill="url(#${uid}-body)" stroke="#f2f2f2" stroke-width="2"/>
    <ellipse cx="68" cy="100" rx="16" ry="8" fill="#ffffff" opacity="0.85" transform="rotate(-25 68 100)"/>
    <g class="m-look">
      <ellipse cx="58" cy="140" rx="11" ry="7" fill="#8c8c8c" opacity="0.32"/>
      <ellipse cx="142" cy="140" rx="11" ry="7" fill="#8c8c8c" opacity="0.32"/>
      <g class="m-eyes-open" fill="#0a0a0a">
        <ellipse cx="78" cy="124" rx="8" ry="11"/>
        <ellipse cx="122" cy="124" rx="8" ry="11"/>
        <circle cx="81" cy="119" r="3" fill="#ffffff"/>
        <circle cx="125" cy="119" r="3" fill="#ffffff"/>
      </g>
      <g class="m-eyes-happy" fill="none" stroke="#0a0a0a" stroke-width="5" stroke-linecap="round" opacity="0">
        <path d="M66 128 Q78 112 90 128"/>
        <path d="M110 128 Q122 112 134 128"/>
      </g>
      <g class="m-eyes-closed" fill="none" stroke="#0a0a0a" stroke-width="4" stroke-linecap="round" opacity="0">
        <path d="M68 124 Q78 131 88 124"/>
        <path d="M112 124 Q122 131 132 124"/>
      </g>
      <path class="m-smile" d="M91 144 Q100 152 109 144" fill="none" stroke="#0a0a0a" stroke-width="3.5" stroke-linecap="round"/>
      <path class="m-mouth-open" d="M88 142 Q100 166 112 142 Z" fill="#2b2b2b" stroke="#0a0a0a" stroke-width="3" stroke-linejoin="round" opacity="0"/>
    </g>
  </g>
</svg>`;

  /** Símbolo da marca: silhueta sólida + broto + dois olhos. O contorno preto separa o broto do corpo. */
  NB.logoSVG = () => `
<svg class="logo" viewBox="0 0 200 200" width="300" height="300" aria-hidden="true">
  <g class="l-squash">
    <path class="l-sprout" d="${NB.SHAPES.sprout}" fill="#ffffff"/>
    <path class="l-body" d="${NB.SHAPES.circle}" fill="#ffffff" stroke="#050505" stroke-width="5" stroke-linejoin="round"/>
    <g class="l-eyes" fill="#050505">
      <ellipse cx="80" cy="128" rx="8.5" ry="11.5"/>
      <ellipse cx="120" cy="128" rx="8.5" ry="11.5"/>
    </g>
  </g>
</svg>`;

  /** Mini símbolo para cabeçalhos de UI. */
  NB.markSVG = (size = 26) => `
<svg viewBox="0 0 200 200" width="${size}" height="${size}" aria-hidden="true">
  <path d="${NB.SHAPES.sprout}" fill="#ffffff"/>
  <path d="${NB.SHAPES.body}" fill="#ffffff" stroke="#0c0c0c" stroke-width="8"/>
  <ellipse cx="80" cy="128" rx="9" ry="12" fill="#0c0c0c"/><ellipse cx="120" cy="128" rx="9" ry="12" fill="#0c0c0c"/>
</svg>`;

  /** Partes do mascote que a timeline anima. */
  NB.mascotRefs = (root) => {
    const q = (s) => root.querySelector(s);
    return {
      root,
      squash: q('.m-squash'),
      sprout: q('.m-sprout'),
      look: q('.m-look'),
      eyesOpen: q('.m-eyes-open'),
      eyesHappy: q('.m-eyes-happy'),
      eyesClosed: q('.m-eyes-closed'),
      smile: q('.m-smile'),
      mouthOpen: q('.m-mouth-open'),
      shadow: q('.m-shadow'),
    };
  };
})();
