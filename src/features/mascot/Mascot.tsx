import type { AnimationEvent, CSSProperties, Ref } from 'react';
import type { MascotState, Mood } from './mascotStates';
import type { CharacterId, MochiColor } from '../../../shared/settings';
import { characterArt } from './characterArt';
import { characterInfo } from './characters';
import './mascot.css';
import './characters.css';

interface MascotProps {
  state: MascotState;
  replay: number;
  hop: boolean;
  blinking: boolean;
  mood: Mood;
  /** Personagem desenhado (o rosto, os estados e as animações são os mesmos para todos). */
  character?: CharacterId;
  /** Cor do Mochi (as paletas ficam em mascot.css; só valem para o personagem original). */
  palette?: MochiColor;
  /** Prefixo dos ids dos gradientes: deve ser único quando há vários mascotes na mesma página. */
  uid?: string;
  /** Usado pela view para escrever as variáveis de "olhar" sem re-renderizar. */
  svgRef?: Ref<SVGSVGElement>;
  onHopEnd?: () => void;
  onHoverChange?: (hovering: boolean) => void;
}

const SPARKLES = [
  { x: -46, y: -34, c: '#ffd166' },
  { x: 0, y: -52, c: '#ff9fb2' },
  { x: 46, y: -34, c: '#7fd6ff' },
  { x: -58, y: 4, c: '#b5e48c' },
  { x: 58, y: 4, c: '#ffd166' },
  { x: 24, y: -48, c: '#c8a2ff' },
];

/** Centro do rosto original: o ajuste de posição/escala de cada personagem gira em torno dele. */
const FACE_CENTER = { x: 100, y: 136 };

/**
 * Mascote 100% SVG. Todas as partes do rosto ficam sempre no DOM e são
 * alternadas por CSS a partir de `data-state`, o que permite transições suaves.
 *
 * Camadas de movimento (cada uma com um único dono de `transform`):
 *   drag (física) > breath (contínua) > motion (saltos) > tilt (postura) > corpo / complementos / rosto
 */
export function Mascot({
  state,
  replay,
  hop,
  blinking,
  mood,
  character = 'mochi',
  palette = 'mint',
  uid = 'mochi',
  svgRef,
  onHopEnd,
  onHoverChange,
}: MascotProps) {
  const handleAnimationEnd = (e: AnimationEvent<SVGGElement>) => {
    if (e.target === e.currentTarget) onHopEnd?.();
  };

  const info = characterInfo(character);
  const art = characterArt(info.id, uid, {
    onPointerEnter: () => onHoverChange?.(true),
    onPointerLeave: () => onHoverChange?.(false),
  });
  const { dx, dy, scale } = info.face;
  const faceFit = `translate(${FACE_CENTER.x + dx} ${FACE_CENTER.y + dy}) scale(${scale}) translate(${-FACE_CENTER.x} ${-FACE_CENTER.y})`;

  const classes = ['mascot', blinking && 'is-blinking', hop && 'is-hopping'].filter(Boolean).join(' ');

  return (
    <svg
      ref={svgRef}
      className={classes}
      data-state={state}
      data-mood={mood}
      data-character={info.id}
      data-palette={info.id === 'mochi' ? palette : undefined}
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      role="img"
      aria-label={info.label}
    >
      <defs>{art.defs}</defs>

      {/* A chave reinicia a sombra junto com o salto ao repetir o mesmo estado. */}
      <ellipse key={`sh${replay}`} className="mascot-shadow" cx="100" cy="184" rx="58" ry="8" />

      <g>
        <g className="mascot-breath">
          <g key={replay} className={`mascot-motion ${hop ? 'is-hopping' : ''}`} onAnimationEnd={handleAnimationEnd}>
            <g className="mascot-tilt">
              {art.behind}
              {art.body}
              {art.front}

              {/* Rosto: segue o corpo com pequeno atraso (overlapping action). O ajuste fica num grupo
                  próprio (atributo transform) para não colidir com as animações CSS de `mascot-face`. */}
              <g transform={faceFit}>
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
                    <ellipse className="face face-mouth-yawn" cx="100" cy="152" rx="9" ry="12" fill="#7a3550" />
                  </g>
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
