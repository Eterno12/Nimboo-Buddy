import type { ReactNode, SVGProps } from 'react';
import type { CharacterId } from '../../../shared/settings';

/**
 * Arte SVG de cada personagem (viewBox 200). Só o CORPO e os complementos mudam; o rosto, as camadas
 * de movimento e os estados são compartilhados (ver Mascot.tsx e mascot.css).
 *
 * Contrato de cada desenho (`CharacterArt`):
 *  - `defs`: gradientes/recortes (ids com o prefixo `uid`, para várias instâncias na mesma página);
 *  - `behind`: o que fica atrás do corpo (ex.: parte de trás do anel do planeta);
 *  - `body`: o corpo (recebe os handlers de "mouse em cima");
 *  - `front`: complementos por cima do corpo e abaixo do rosto (coroa, braços, chapéu...).
 * As cores do corpo vêm das variáveis `--m-*` definidas por `[data-character]` em mascot.css.
 * Todo o desenho cabe em x 12..188 e y 30..184, o mesmo envelope do Nimboo original.
 */
export interface CharacterArt {
  defs: ReactNode;
  behind?: ReactNode;
  body: ReactNode;
  front?: ReactNode;
}

type Hover = Pick<SVGProps<SVGPathElement>, 'onPointerEnter' | 'onPointerLeave'>;

interface Props {
  uid: string;
  hover: Hover;
}

const OUTLINE = { style: { stroke: 'var(--m-stroke)' }, strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** Gradientes do corpo (cores vindas das variáveis do personagem/paleta). */
function bodyDefs(uid: string): ReactNode {
  return (
    <>
      <radialGradient id={`${uid}-body`} cx="40%" cy="30%" r="80%">
        <stop offset="0%" style={{ stopColor: 'var(--m-body-hi)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--m-body-lo)' }} />
      </radialGradient>
      <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="55%" style={{ stopColor: 'var(--m-shade)' }} stopOpacity="0" />
        <stop offset="100%" style={{ stopColor: 'var(--m-shade)' }} stopOpacity="0.28" />
      </linearGradient>
    </>
  );
}

/** Corpo + sombreado interno (o sombreado não recebe o mouse). */
function Body({ d, uid, hover, className = 'mascot-body' }: { d: string; uid: string; hover: Hover; className?: string }) {
  return (
    <>
      <path className={className} d={d} fill={`url(#${uid}-body)`} {...OUTLINE} {...hover} />
      <path d={d} fill={`url(#${uid}-shade)`} pointerEvents="none" />
    </>
  );
}

const MOCHI_BODY =
  'M100 74 C142 70 172 98 173 132 C174 162 150 180 100 180 C50 180 26 162 27 132 C28 98 58 70 100 74 Z';

/** O original: blob gelatinoso verde com uma folhinha. */
function mochi({ uid, hover }: Props): CharacterArt {
  return {
    defs: (
      <>
        {bodyDefs(uid)}
        <linearGradient id={`${uid}-leaf`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#5fbf7f" />
          <stop offset="100%" stopColor="#a6e88f" />
        </linearGradient>
      </>
    ),
    body: (
      <>
        {/* Folha: ação secundária, atrasada em relação ao corpo */}
        <g className="mascot-leaf">
          <path
            d="M100 78 C97 66 99 56 107 48 C117 56 116 70 102 78 Z"
            fill={`url(#${uid}-leaf)`}
            stroke="#4aa56e"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M101 76 C103 68 105 61 107 55" fill="none" stroke="#4aa56e" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </g>
        <Body d={MOCHI_BODY} uid={uid} hover={hover} />
        <ellipse cx="68" cy="100" rx="16" ry="8" fill="#fff" opacity="0.5" transform="rotate(-25 68 100)" />
        <ellipse cx="150" cy="150" rx="7" ry="4" fill="#fff" opacity="0.18" transform="rotate(-35 150 150)" />
      </>
    ),
  };
}

const PINEAPPLE_BODY =
  'M100 72 C140 70 167 100 167 136 C167 166 142 182 100 182 C58 182 33 166 33 136 C33 100 60 70 100 72 Z';

/** Abacaxi: oval dourado com losangos e uma coroa de folhas que balança. */
function pineapple({ uid, hover }: Props): CharacterArt {
  const lines: ReactNode[] = [];
  for (let k = -6; k <= 6; k++) {
    const o = k * 26;
    lines.push(<path key={`a${k}`} d={`M${100 + o - 90} 60 L${100 + o + 90} 200`} />);
    lines.push(<path key={`b${k}`} d={`M${100 + o + 90} 60 L${100 + o - 90} 200`} />);
  }
  return {
    defs: (
      <>
        {bodyDefs(uid)}
        <clipPath id={`${uid}-clip`}>
          <path d={PINEAPPLE_BODY} />
        </clipPath>
        <linearGradient id={`${uid}-crown`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#4fb86b" />
          <stop offset="100%" stopColor="#a6e88f" />
        </linearGradient>
      </>
    ),
    body: (
      <>
        <g className="mascot-leaf mascot-crown">
          <g className="mascot-sway">
            {/* cinco folhas em leque, a do meio mais alta */}
            <path d="M100 82 C92 68 94 56 100 46 C106 56 108 68 100 82 Z" fill={`url(#${uid}-crown)`} stroke="#3f9a58" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M94 82 C80 72 72 62 74 52 C86 57 98 68 98 82 Z" fill={`url(#${uid}-crown)`} stroke="#3f9a58" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M106 82 C120 72 128 62 126 52 C114 57 102 68 102 82 Z" fill={`url(#${uid}-crown)`} stroke="#3f9a58" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M90 84 C74 80 62 73 58 64 C70 64 84 70 94 82 Z" fill={`url(#${uid}-crown)`} stroke="#3f9a58" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M110 84 C126 80 138 73 142 64 C130 64 116 70 106 82 Z" fill={`url(#${uid}-crown)`} stroke="#3f9a58" strokeWidth="2.5" strokeLinejoin="round" />
          </g>
        </g>
        <Body d={PINEAPPLE_BODY} uid={uid} hover={hover} />
        <g clipPath={`url(#${uid}-clip)`} fill="none" stroke="#b8741a" strokeWidth="2" opacity="0.32" pointerEvents="none">
          {lines}
        </g>
        <ellipse cx="66" cy="102" rx="14" ry="7" fill="#fff" opacity="0.5" transform="rotate(-28 66 102)" />
        <ellipse cx="150" cy="156" rx="6" ry="3.5" fill="#fff" opacity="0.2" transform="rotate(-35 150 156)" />
      </>
    ),
  };
}

const SQUARE_BODY =
  'M60 76 Q100 70 140 76 Q170 82 172 116 Q174 150 168 164 Q162 180 138 180 L62 180 Q38 180 32 164 Q26 150 28 116 Q30 82 60 76 Z';

/** Quadradinho: almofada de gelatina azul pastel, achatando e esticando. */
function square({ uid, hover }: Props): CharacterArt {
  return {
    defs: bodyDefs(uid),
    body: (
      <>
        <Body d={SQUARE_BODY} uid={uid} hover={hover} />
        <path d="M46 98 Q48 88 60 86 L84 84" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" opacity="0.55" />
        <ellipse cx="152" cy="160" rx="7" ry="4" fill="#fff" opacity="0.2" transform="rotate(-35 152 160)" />
      </>
    ),
  };
}

// O cogumelo tem duas partes: o corpinho creme (talo) e o chapéu coral por cima.
const MUSHROOM_STEM =
  'M60 120 C52 130 48 150 54 166 C60 180 80 182 100 182 C120 182 140 180 146 166 C152 150 148 130 140 120 Z';
const MUSHROOM_CAP =
  'M26 126 C22 90 52 62 100 62 C148 62 178 90 174 126 C173 134 166 138 156 138 L44 138 C34 138 27 134 26 126 Z';

/** Cogumelo: chapéu coral com bolinhas creme, corpo creme; o chapéu inclina de leve. */
function mushroom({ uid, hover }: Props): CharacterArt {
  return {
    defs: (
      <>
        {bodyDefs(uid)}
        <radialGradient id={`${uid}-cap`} cx="40%" cy="28%" r="85%">
          <stop offset="0%" stopColor="#ffb3a1" />
          <stop offset="100%" stopColor="#f0645d" />
        </radialGradient>
      </>
    ),
    body: (
      <>
        <Body d={MUSHROOM_STEM} uid={uid} hover={hover} />
      </>
    ),
    front: (
      <g className="mascot-cap">
        <g className="mascot-sway">
          <path
            d={MUSHROOM_CAP}
            fill={`url(#${uid}-cap)`}
            stroke="#d9534e"
            strokeWidth="3"
            strokeLinejoin="round"
            {...hover}
          />
          <circle cx="62" cy="96" r="12" fill="#fff4e0" opacity="0.95" />
          <circle cx="104" cy="82" r="9" fill="#fff4e0" opacity="0.95" />
          <circle cx="140" cy="104" r="13" fill="#fff4e0" opacity="0.95" />
          <circle cx="94" cy="116" r="7" fill="#fff4e0" opacity="0.95" />
          <ellipse cx="58" cy="78" rx="12" ry="6" fill="#fff" opacity="0.4" transform="rotate(-28 58 78)" />
        </g>
      </g>
    ),
  };
}

const CACTUS_BODY =
  'M100 70 C138 68 160 96 160 132 C160 164 140 182 100 182 C60 182 40 164 40 132 C40 96 62 68 100 70 Z';

/** Cacto: corpo verde arredondado com bracinhos, espinhos discretos e uma florzinha. */
function cactus({ uid, hover }: Props): CharacterArt {
  const arm = (d: string) => (
    <>
      <path d={d} fill="none" stroke="var(--m-stroke)" strokeWidth="23" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#9be3a0" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
  return {
    defs: bodyDefs(uid),
    behind: (
      <>
        <g className="mascot-arm mascot-arm-l">{arm('M46 140 H26 V108')}</g>
        <g className="mascot-arm mascot-arm-r">{arm('M154 128 H174 V98')}</g>
      </>
    ),
    body: (
      <>
        <g className="mascot-leaf mascot-flower">
          <g className="mascot-sway">
            <g fill="#ff9fb2" stroke="#e4678a" strokeWidth="2">
              <circle cx="100" cy="58" r="7" />
              <circle cx="109" cy="64" r="7" />
              <circle cx="91" cy="64" r="7" />
              <circle cx="105" cy="73" r="7" />
              <circle cx="95" cy="73" r="7" />
            </g>
            <circle cx="100" cy="66" r="5" fill="#ffd166" stroke="#e0a83a" strokeWidth="1.5" />
          </g>
        </g>
        <Body d={CACTUS_BODY} uid={uid} hover={hover} />
        <g stroke="#2f8a4c" strokeWidth="2" strokeLinecap="round" opacity="0.5" pointerEvents="none">
          <path d="M64 100 l-5 -3 M64 100 l-1 -6" />
          <path d="M136 106 l5 -3 M136 106 l1 -6" />
          <path d="M70 164 l-5 2 M70 164 l-3 5" />
          <path d="M132 166 l5 2 M132 166 l3 5" />
        </g>
        <ellipse cx="70" cy="96" rx="13" ry="6.5" fill="#fff" opacity="0.45" transform="rotate(-28 70 96)" />
      </>
    ),
  };
}

const CLOUD_BODY =
  'M50 182 C26 182 17 160 26 144 C32 130 44 124 56 124 C54 98 76 78 100 84 C114 70 142 72 150 96 C170 94 184 110 181 134 C190 156 176 182 152 182 Z';

/** Nuvem: volumes arredondados lilás/brancos que flutuam; duas bolinhas de vapor ao lado. */
function cloud({ uid, hover }: Props): CharacterArt {
  return {
    defs: bodyDefs(uid),
    body: (
      <>
        <Body d={CLOUD_BODY} uid={uid} hover={hover} />
        <ellipse cx="78" cy="102" rx="15" ry="7" fill="#fff" opacity="0.65" transform="rotate(-28 78 102)" />
        <ellipse cx="46" cy="140" rx="7" ry="4" fill="#fff" opacity="0.5" transform="rotate(-30 46 140)" />
      </>
    ),
    front: (
      <g className="mascot-puffs" pointerEvents="none">
        <circle className="puff puff1" cx="34" cy="98" r="5" fill="#e4daf8" stroke="#b9a1ec" strokeWidth="2" />
        <circle className="puff puff2" cx="162" cy="86" r="4" fill="#e4daf8" stroke="#b9a1ec" strokeWidth="2" />
      </g>
    ),
  };
}

/** Planeta: esfera pastel com anel inclinado (metade atrás do corpo, metade na frente) e crateras. */
function planet({ uid, hover }: Props): CharacterArt {
  const ring = (d: string, color: string) => (
    <>
      <path d={d} fill="none" stroke="#d6a447" strokeWidth="14" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
    </>
  );
  // Elipse do anel centrada em (100, 142), rx 86 e ry 17; a rotação fica no grupo.
  const back = 'M14 142 A86 17 0 0 1 186 142';
  const front = 'M14 142 A86 17 0 0 0 186 142';
  return {
    defs: bodyDefs(uid),
    behind: (
      <g transform="rotate(-14 100 142)">
        <g className="mascot-ring-spin">{ring(back, '#ffe0a0')}</g>
      </g>
    ),
    body: (
      <>
        <Body d="M100 70 A54 54 0 0 1 100 178 A54 54 0 0 1 100 70 Z" uid={uid} hover={hover} />
        <g fill="#8e7bd6" opacity="0.4" pointerEvents="none">
          <ellipse cx="136" cy="100" rx="9" ry="6" />
          <ellipse cx="62" cy="160" rx="7" ry="4.5" />
          <ellipse cx="146" cy="130" rx="4" ry="3" />
        </g>
        <ellipse cx="72" cy="96" rx="14" ry="7" fill="#fff" opacity="0.55" transform="rotate(-28 72 96)" />
      </>
    ),
    front: (
      <g transform="rotate(-14 100 142)" pointerEvents="none">
        <g className="mascot-ring-spin">{ring(front, '#ffe0a0')}</g>
      </g>
    ),
  };
}

const GHOST_BODY =
  'M34 150 C34 98 62 72 100 72 C138 72 166 98 166 150 L166 168 Q166 182 152 181 Q140 179 134 171 Q126 161 117 172 Q110 182 100 182 Q90 182 83 172 Q74 161 66 171 Q60 179 48 181 Q34 182 34 168 Z';

/** Fantasma: corpo branco-lilás que flutua, barra ondulada e bracinhos curtos. Nunca assustador. */
function ghost({ uid, hover }: Props): CharacterArt {
  return {
    defs: bodyDefs(uid),
    behind: (
      <>
        <ellipse className="mascot-arm mascot-arm-l" cx="30" cy="140" rx="11" ry="8" fill="#efe8fb" stroke="var(--m-stroke)" strokeWidth="3" />
        <ellipse className="mascot-arm mascot-arm-r" cx="170" cy="140" rx="11" ry="8" fill="#efe8fb" stroke="var(--m-stroke)" strokeWidth="3" />
      </>
    ),
    body: (
      <>
        <Body d={GHOST_BODY} uid={uid} hover={hover} />
        <ellipse cx="68" cy="98" rx="15" ry="7.5" fill="#fff" opacity="0.7" transform="rotate(-28 68 98)" />
        <ellipse cx="148" cy="150" rx="6" ry="3.5" fill="#fff" opacity="0.4" transform="rotate(-35 148 150)" />
      </>
    ),
  };
}

const ART: Record<CharacterId, (p: Props) => CharacterArt> = {
  mochi,
  pineapple,
  square,
  mushroom,
  cactus,
  cloud,
  planet,
  ghost,
};

/** Desenho de um personagem; `uid` torna únicos os ids dos gradientes dentro da página. */
export function characterArt(id: CharacterId, uid: string, hover: Hover): CharacterArt {
  return (ART[id] ?? mochi)({ uid, hover });
}
