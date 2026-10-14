import type { ReactNode } from 'react';
import { skinById } from '../../../shared/skins';

/**
 * Arte dos acessórios (viewBox 200, mesmo envelope dos personagens).
 *  - `body`: fica por cima do corpo e do rosto, em coordenadas absolutas (chapéus, laços, colares);
 *  - `face`: acompanha o olhar do rosto e usa as coordenadas do rosto original (olhos em 78/122, 124),
 *    então vale igual para qualquer personagem (óculos, máscara).
 * Os movimentos (`acc-*`) ficam em skins.css e respeitam "reduzir movimento".
 */
export interface SkinArt {
  layer: 'body' | 'face';
  node: ReactNode;
}

const INK = '#3b3040';

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Pontos de uma curva quadrática (para pendurar flores num colar). */
function along(p0: [number, number], p1: [number, number], p2: [number, number], n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
  });
}

const PETALS = [0, 72, 144, 216, 288];

const ART: Record<string, SkinArt> = {
  'mochi.laco': {
    layer: 'body',
    node: (
      <g className="acc acc-bob" transform="rotate(-16 62 86)">
        <path d="M62 86 C50 70 34 74 37 89 C40 101 52 99 62 86 Z" fill="#ff8fb1" stroke="#d9557f" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M62 86 C74 70 90 73 87 88 C84 100 72 99 62 86 Z" fill="#ff8fb1" stroke="#d9557f" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="62" cy="86" r="6" fill="#ffb3cb" stroke="#d9557f" strokeWidth="2.5" />
      </g>
    ),
  },
  'mochi.oculos': {
    layer: 'face',
    node: (
      <g fill="rgba(255,255,255,0.2)" stroke={INK} strokeWidth="3.5" strokeLinecap="round">
        <circle cx="78" cy="124" r="15" />
        <circle cx="122" cy="124" r="15" />
        <path d="M92 121 Q100 115 108 121" fill="none" />
        <path d="M63 122 L54 119 M137 122 L146 119" fill="none" />
        <path d="M68 114 Q72 110 77 109" fill="none" stroke="#fff" strokeWidth="3" opacity="0.8" />
        <path d="M112 114 Q116 110 121 109" fill="none" stroke="#fff" strokeWidth="3" opacity="0.8" />
      </g>
    ),
  },
  'pineapple.faixa': {
    layer: 'body',
    node: (
      <g className="acc">
        <path d="M36 106 L22 98 L24 112 Z M36 110 L24 122 L34 124 Z" fill="#ef476f" stroke="#b8264a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M35 108 Q100 90 165 108" fill="none" stroke="#b8264a" strokeWidth="14" strokeLinecap="round" />
        <path d="M35 108 Q100 90 165 108" fill="none" stroke="#ef476f" strokeWidth="10" strokeLinecap="round" />
        <path d="M40 104 Q100 87 160 104" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.7" strokeDasharray="6 8" />
      </g>
    ),
  },
  'pineapple.colar': {
    layer: 'body',
    node: (
      <g className="acc acc-bob">
        <path d="M44 146 Q100 196 156 146" fill="none" stroke="#3f9a58" strokeWidth="3" strokeLinecap="round" />
        {along([44, 146], [100, 196], [156, 146], 7).map(([x, y], i) => (
          <g key={i} transform={`translate(${x.toFixed(1)} ${(y + 1).toFixed(1)})`}>
            {PETALS.map((a) => (
              <ellipse
                key={a}
                cx="0"
                cy="-5"
                rx="3.6"
                ry="5.4"
                transform={`rotate(${a})`}
                fill={['#ff6b9d', '#ffd166', '#ffffff'][i % 3]}
                stroke="#c0457a"
                strokeWidth="1"
              />
            ))}
            <circle r="2.6" fill="#ff9f1c" />
          </g>
        ))}
      </g>
    ),
  },
  'square.gravata': {
    layer: 'body',
    node: (
      <g className="acc">
        <path d="M100 168 L72 154 Q67 168 72 182 Z" fill="#6c5ce7" stroke="#4a3fb5" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M100 168 L128 154 Q133 168 128 182 Z" fill="#6c5ce7" stroke="#4a3fb5" strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="92" y="160" width="16" height="16" rx="5" fill="#8a7dff" stroke="#4a3fb5" strokeWidth="2.5" />
      </g>
    ),
  },
  'square.cartola': {
    layer: 'body',
    node: (
      <g className="acc acc-bob" transform="rotate(-5 100 78)">
        <path d="M66 78 L69 36 Q100 29 131 36 L134 78 Z" fill="#3a3550" stroke="#221f33" strokeWidth="3" strokeLinejoin="round" />
        <path d="M67.5 66 L132.5 66 L133.5 77 L66.5 77 Z" fill="#e63946" />
        <ellipse cx="100" cy="78" rx="48" ry="9" fill="#3a3550" stroke="#221f33" strokeWidth="3" />
        <path d="M76 42 L78 62" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      </g>
    ),
  },
  'mushroom.flor': {
    layer: 'body',
    node: (
      <g transform="translate(142 76) rotate(10)">
        <g className="acc acc-bob">
          {PETALS.map((a) => (
            <ellipse key={a} cx="0" cy="-8" rx="6" ry="8" transform={`rotate(${a})`} fill="#fff6c9" stroke="#e0a83a" strokeWidth="1.8" />
          ))}
          <circle r="5.5" fill="#ff9f1c" stroke="#d9780a" strokeWidth="1.5" />
        </g>
      </g>
    ),
  },
  'mushroom.leitura': {
    layer: 'face',
    node: (
      <g fill="rgba(255,255,255,0.22)" stroke="#d9a441" strokeWidth="3" strokeLinecap="round">
        <circle cx="78" cy="124" r="14" />
        <circle cx="122" cy="124" r="14" />
        <path d="M92 122 Q100 117 108 122" fill="none" />
        <path d="M64 122 L55 119 M136 122 L145 119" fill="none" />
        <path d="M69 116 Q73 112 78 111" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.85" />
      </g>
    ),
  },
  'cactus.bandana': {
    layer: 'body',
    node: (
      <g className="acc">
        <path d="M152 96 L176 84 L172 100 Z M152 100 L174 112 L163 119 Z" fill="#e63946" stroke="#a82833" strokeWidth="2" strokeLinejoin="round" />
        <path d="M44 100 Q100 78 156 100" fill="none" stroke="#a82833" strokeWidth="15" strokeLinecap="round" />
        <path d="M44 100 Q100 78 156 100" fill="none" stroke="#e63946" strokeWidth="11" strokeLinecap="round" />
        <g fill="#fff" opacity="0.85">
          <circle cx="62" cy="94" r="2" />
          <circle cx="82" cy="88" r="2" />
          <circle cx="104" cy="86" r="2" />
          <circle cx="126" cy="90" r="2" />
          <circle cx="144" cy="97" r="2" />
        </g>
      </g>
    ),
  },
  'cactus.escuros': {
    layer: 'face',
    node: (
      <g>
        <path d="M94 124 H106" stroke="#1d1b26" strokeWidth="5" strokeLinecap="round" />
        <path d="M60 122 L50 118 M140 122 L150 118" stroke="#1d1b26" strokeWidth="4.5" strokeLinecap="round" />
        <rect x="60" y="112" width="36" height="28" rx="10" fill="#1d1b26" stroke="#0e0d14" strokeWidth="2" />
        <rect x="104" y="112" width="36" height="28" rx="10" fill="#1d1b26" stroke="#0e0d14" strokeWidth="2" />
        <path d="M68 120 L78 118 L72 130 L66 130 Z M112 120 L122 118 L116 130 L110 130 Z" fill="#fff" opacity="0.28" />
        <path className="acc-glint" d="M84 116 L88 116 L82 136 L78 136 Z M128 116 L132 116 L126 136 L122 136 Z" fill="#fff" />
      </g>
    ),
  },
  'cloud.arco': {
    layer: 'body',
    node: (
      <g className="acc acc-bob" fill="none" strokeLinecap="round">
        {(
          [
            [40, '#ff6b6b'],
            [33, '#ffd166'],
            [26, '#7bdff2'],
            [19, '#b39cd0'],
          ] as const
        ).map(([r, c]) => (
          <path key={r} d={`M${100 - r} 90 A${r} ${r} 0 0 1 ${100 + r} 90`} stroke={c} strokeWidth="6" />
        ))}
      </g>
    ),
  },
  'cloud.gorro': {
    layer: 'body',
    node: (
      <g transform="rotate(-4 100 90)">
        <g className="acc acc-bob">
          <path d="M58 94 Q60 64 100 62 Q132 60 154 46 Q152 78 142 92 Q100 82 58 94 Z" fill="#7aa2f7" stroke="#4f73c9" strokeWidth="3" strokeLinejoin="round" />
          <path d="M56 93 Q100 80 144 91" fill="none" stroke="#e8ecff" strokeWidth="10" strokeLinecap="round" />
          <circle cx="154" cy="44" r="9" fill="#fff" stroke="#cfd6f5" strokeWidth="2.5" />
          <polygon points={star(92, 74, 6)} fill="#e8ecff" opacity="0.9" />
        </g>
      </g>
    ),
  },
  'planet.antena': {
    layer: 'body',
    node: (
      <g>
        <path d="M100 72 L100 46" stroke="#6a5bc0" strokeWidth="4" strokeLinecap="round" />
        <g className="acc-twinkle">
          <polygon points={star(100, 36, 13)} fill="#ffd166" stroke="#e0a83a" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
      </g>
    ),
  },
  'planet.capacete': {
    layer: 'body',
    node: (
      <g>
        <circle cx="100" cy="124" r="62" fill="rgba(170,225,255,0.2)" stroke="#fff" strokeWidth="4" opacity="0.95" />
        <path d="M60 90 A50 50 0 0 1 96 68" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
        <path d="M52 170 Q100 194 148 170" fill="none" stroke="#b8c4e8" strokeWidth="9" strokeLinecap="round" />
        <circle cx="156" cy="170" r="4" fill="#ff6b6b" />
      </g>
    ),
  },
  'ghost.festa': {
    layer: 'body',
    node: (
      <g transform="rotate(8 100 78)">
        <g className="acc acc-bob">
          <path d="M74 80 L100 32 L126 80 Q100 88 74 80 Z" fill="#ff9f1c" stroke="#d9780a" strokeWidth="3" strokeLinejoin="round" />
          <path d="M86 58 L114 66 M82 68 L118 76" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          <circle cx="100" cy="31" r="7" fill="#ffd166" stroke="#e0a83a" strokeWidth="2.5" />
        </g>
      </g>
    ),
  },
  'ghost.mascara': {
    layer: 'face',
    node: (
      <g>
        <path d="M58 122 L46 113 M142 122 L154 113" stroke="#ffd166" strokeWidth="4" strokeLinecap="round" />
        <path
          fillRule="evenodd"
          d="M54 118 Q78 104 100 114 Q122 104 146 118 Q150 142 124 142 Q110 142 100 132 Q90 142 76 142 Q50 142 54 118 Z M67 124 a11 14 0 1 0 22 0 a11 14 0 1 0 -22 0 Z M111 124 a11 14 0 1 0 22 0 a11 14 0 1 0 -22 0 Z"
          fill="#3b3550"
          stroke="#ffd166"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="100" cy="116" r="3" fill="#ffd166" />
      </g>
    ),
  },
};

/** Arte do acessório; `null` quando o id não existe ou não é do personagem pedido. */
export function skinArt(id: string | null | undefined, character: string): SkinArt | null {
  const def = skinById(id);
  if (!def || def.character !== character) return null;
  return ART[def.id] ?? null;
}
