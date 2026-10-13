import type { AnimationEvent, CSSProperties, Ref } from 'react';
import type { MascotState, Mood } from './mascotStates';
import type { MochiColor } from '../../../shared/settings';
import './mascot.css';

interface MascotProps {
  state: MascotState;
  replay: number;
  hop: boolean;
  blinking: boolean;
  mood: Mood;
  /** Cor do Mochi (as paletas ficam em mascot.css). */
  palette?: MochiColor;
  /** Usado pela view para escrever as variáveis de "olhar" sem re-renderizar. */
  svgRef: Ref<SVGSVGElement>;
  onHopEnd: () => void;
  onHoverChange: (hovering: boolean) => void;
}

const BODY_PATH =
  'M100 74 C142 70 172 98 173 132 C174 162 150 180 100 180 C50 180 26 162 27 132 C28 98 58 70 100 74 Z';

const SPARKLES = [
  { x: -46, y: -34, c: '#ffd166' },
  { x: 0, y: -52, c: '#ff9fb2' },
  { x: 46, y: -34, c: '#7fd6ff' },
  { x: -58, y: 4, c: '#b5e48c' },
  { x: 58, y: 4, c: '#ffd166' },
  { x: 24, y: -48, c: '#c8a2ff' },
];

/**
 * Mascote blob 100% SVG. Todas as partes do rosto ficam sempre no DOM e são
 * alternadas por CSS a partir de `data-state`, o que permite transições suaves.
 *
 * Camadas de movimento (cada uma com um único dono de `transform`):
 *   breath (contínua) > motion (saltos) > tilt (postura) > corpo / folha / rosto
 */
export function Mascot({ state, replay, hop, blinking, mood, palette = 'mint', svgRef, onHopEnd, onHoverChange }: MascotProps) {
  const handleAnimationEnd = (e: AnimationEvent<SVGGElement>) => {
    if (e.target === e.currentTarget) onHopEnd();
  };

  const classes = ['mascot', blinking && 'is-blinking', hop && 'is-hopping'].filter(Boolean).join(' ');

  return (
    <svg
      ref={svgRef}
      className={classes}
      data-state={state}
      data-mood={mood}
      data-palette={palette}
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      role="img"
      aria-label="Mochi"
    >
      <defs>
        <radialGradient id="mochi-body" cx="40%" cy="30%" r="80%">
          <stop offset="0%" style={{ stopColor: 'var(--m-body-hi)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--m-body-lo)' }} />
        </radialGradient>
        <linearGradient id="mochi-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="55%" style={{ stopColor: 'var(--m-shade)' }} stopOpacity="0" />
          <stop offset="100%" style={{ stopColor: 'var(--m-shade)' }} stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id="mochi-leaf" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#5fbf7f" />
          <stop offset="100%" stopColor="#a6e88f" />
        </linearGradient>
      </defs>

      {/* A chave reinicia a sombra junto com o salto ao repetir o mesmo estado. */}
      <ellipse key={`sh${replay}`} className="mascot-shadow" cx="100" cy="184" rx="58" ry="8" />

      <g className="mascot-drag">
      <g className="mascot-breath">
        <g key={replay} className={`mascot-motion ${hop ? 'is-hopping' : ''}`} onAnimationEnd={handleAnimationEnd}>
          <g className="mascot-tilt">
            {/* Folha: ação secundária, atrasada em relação ao corpo */}
            <g className="mascot-leaf">
              <path
                d="M100 78 C97 66 99 56 107 48 C117 56 116 70 102 78 Z"
                fill="url(#mochi-leaf)"
                stroke="#4aa56e"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <path d="M101 76 C103 68 105 61 107 55" fill="none" stroke="#4aa56e" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            </g>

            <path
              className="mascot-body"
              d={BODY_PATH}
              fill="url(#mochi-body)"
              style={{ stroke: 'var(--m-stroke)' }}
              strokeWidth="3"
              onPointerEnter={() => onHoverChange(true)}
              onPointerLeave={() => onHoverChange(false)}
            />
            <path d={BODY_PATH} fill="url(#mochi-shade)" pointerEvents="none" />
            <ellipse cx="68" cy="100" rx="16" ry="8" fill="#fff" opacity="0.5" transform="rotate(-25 68 100)" />
            <ellipse cx="150" cy="150" rx="7" ry="4" fill="#fff" opacity="0.18" transform="rotate(-35 150 150)" />

            {/* Rosto: segue o corpo com pequeno atraso (overlapping action) */}
            <g className="mascot-face">
              {/* O rosto inteiro desliza um pouco na direção do cursor; os olhos vão um pouco além. */}
              <g className="mascot-look">
                <ellipse className="mascot-cheek" cx="58" cy="140" rx="11" ry="7" fill="#ff9fb2" />
                <ellipse className="mascot-cheek" cx="142" cy="140" rx="11" ry="7" fill="#ff9fb2" />

                <g className="mascot-eyes-look">
                  <g className="face face-eyes-open" fill="#3b3040">
                    <ellipse cx="78" cy="124" rx="8" ry="11" />
                    <ellipse cx="122" cy="124" rx="8" ry="11" />
                    <circle cx="81" cy="119" r="3" fill="#fff" />
                    <circle cx="125" cy="119" r="3" fill="#fff" />
                    <circle cx="75" cy="128" r="1.5" fill="#fff" opacity="0.7" />
                    <circle cx="119" cy="128" r="1.5" fill="#fff" opacity="0.7" />
                  </g>
                  <g className="face face-eyes-dizzy" fill="none" stroke="#3b3040" strokeWidth="3" strokeLinecap="round">
                    <path className="spiral" d="M78 124 m-1 0 a1 1 0 1 1 2 0 a3 3 0 1 1 -6 0 a5 5 0 1 1 10 0 a7.5 7.5 0 1 1 -15 0" />
                    <path className="spiral" d="M122 124 m-1 0 a1 1 0 1 1 2 0 a3 3 0 1 1 -6 0 a5 5 0 1 1 10 0 a7.5 7.5 0 1 1 -15 0" />
                  </g>
                  <g
                    className="face face-eyes-happy"
                    stroke="#3b3040"
                    strokeWidth="5"
                    strokeLinecap="round"
                    fill="none"
                  >
                    <path d="M66 128 Q78 112 90 128" />
                    <path d="M110 128 Q122 112 134 128" />
                  </g>
                </g>

                <path
                  className="face face-mouth-smile"
                  d="M91 144 Q100 152 109 144"
                  fill="none"
                  stroke="#3b3040"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  className="face face-mouth-open"
                  d="M88 142 Q100 166 112 142 Z"
                  fill="#c4496a"
                  stroke="#3b3040"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                <ellipse className="face face-mouth-o" cx="100" cy="148" rx="5" ry="6" fill="#7a3550" />
                <ellipse className="face face-mouth-sleep" cx="100" cy="148" rx="4" ry="3" fill="#7a3550" />
                <path
                  className="face face-mouth-flat"
                  d="M91 148 Q96 145 100 148 T109 148"
                  fill="none"
                  stroke="#3b3040"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  className="face face-mouth-wavy"
                  d="M86 150 q4.5 -7 9 0 t9 0 t9 0"
                  fill="none"
                  stroke="#3b3040"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <ellipse className="face face-mouth-yawn" cx="100" cy="152" rx="9" ry="12" fill="#7a3550" />
              </g>
            </g>
          </g>
        </g>
      </g>
      </g>

      {state === 'sleepy' && (
        <g
          className="mascot-zzz"
          fill="#7b6cc4"
          stroke="#fff"
          strokeWidth="3"
          paintOrder="stroke"
          fontWeight="700"
          fontFamily="'Segoe UI', sans-serif"
        >
          <text x="140" y="80" fontSize="18" className="z z1">z</text>
          <text x="152" y="62" fontSize="14" className="z z2">z</text>
          <text x="162" y="48" fontSize="11" className="z z3">z</text>
        </g>
      )}

      {state === 'dizzy' && (
        <g className="mascot-dizzy-stars" fill="#ffd166" stroke="#fff" strokeWidth="1.5" paintOrder="stroke">
          <path d="M100 38 l2.4 5 5.4 .8 -3.9 3.8 .9 5.4 -4.8 -2.6 -4.8 2.6 .9 -5.4 -3.9 -3.8 5.4 -.8 z" />
          <path d="M138 62 l1.9 4 4.3 .6 -3.1 3 .7 4.3 -3.8 -2 -3.8 2 .7 -4.3 -3.1 -3 4.3 -.6 z" fill="#ff9fb2" />
          <path d="M62 62 l1.9 4 4.3 .6 -3.1 3 .7 4.3 -3.8 -2 -3.8 2 .7 -4.3 -3.1 -3 4.3 -.6 z" fill="#7fd6ff" />
        </g>
      )}

      {state === 'celebrate' && (
        <g key={`s${replay}`} className="mascot-sparkles">
          {SPARKLES.map((s, i) => (
            <circle
              key={i}
              className="sparkle"
              cx="100"
              cy="100"
              r="7"
              fill={s.c}
              style={{ '--dx': `${s.x}px`, '--dy': `${s.y}px`, animationDelay: `${i * 60}ms` } as CSSProperties}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
