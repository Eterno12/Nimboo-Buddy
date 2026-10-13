/**
 * Física do Mochi segurado: um pêndulo preso pela folha que balança para onde a pessoa o leva, gira se
 * for sacudido com força e fica enjoado se der voltas demais. Puro (sem DOM): recebe a aceleração
 * horizontal do cursor e devolve ângulo/velocidade; a view só aplica o ângulo.
 */

/** Ângulos em graus; tempos em segundos; aceleração do cursor em px/s². */
export interface PhysicsState {
  angle: number;
  /** Velocidade angular (graus/s). */
  omega: number;
  /** Girando livremente (sem mola): ganha-se com sacudidas fortes. */
  spinning: boolean;
  /** Voltas recentes, para detectar enjoo: (instante em s, voltas naquele passo). */
  turns: { t: number; amount: number }[];
}

export const PHYSICS = {
  /** Mola (volta ao centro) e amortecimento do balanço normal. */
  spring: 130,
  damping: 6.5,
  /** Quanto a aceleração do cursor vira torque. */
  gain: 0.52,
  /** Inclinação máxima do balanço "normal" (antes de virar giro). */
  softLimit: 38,
  /** Passou disto (graus/s ou graus), deixa de ser balanço e vira giro. */
  spinOmega: 520,
  spinAngle: 85,
  /** Atrito do giro (por segundo) e velocidade em que ele "acaba" e a mola reassume. */
  spinFriction: 0.9,
  spinEnd: 110,
  /** Rigidez extra do batente macio depois do limite suave. */
  wallSpring: 900,
  /** Enjoo: voltas dentro da janela. */
  dizzyTurns: 2,
  dizzyWindowS: 3,
  /** Teto de segurança da velocidade angular. */
  maxOmega: 1800,
} as const;

export function initialPhysics(): PhysicsState {
  return { angle: 0, omega: 0, spinning: false, turns: [] };
}

/** Normaliza para [-180, 180). */
export function wrapAngle(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

/**
 * Avança `dt` segundos. `ax` é a aceleração horizontal do cursor (px/s²; positiva = para a direita).
 * O mochi inclina na direção do movimento (como quem "se inclina para ir").
 */
export function stepPhysics(prev: PhysicsState, ax: number, dt: number, now: number): PhysicsState {
  const s: PhysicsState = { ...prev, turns: prev.turns };
  const step = Math.min(Math.max(dt, 0), 0.05);
  if (step === 0) return s;
  const torque = PHYSICS.gain * ax;

  if (s.spinning) {
    s.omega += torque * 0.5 * step; // sacudir de novo ainda empurra, mas com menos efeito
    s.omega *= Math.exp(-PHYSICS.spinFriction * step);
    s.omega = Math.max(-PHYSICS.maxOmega, Math.min(PHYSICS.maxOmega, s.omega));
    s.angle += s.omega * step;
    if (Math.abs(s.omega) < PHYSICS.spinEnd) {
      s.spinning = false;
      s.angle = wrapAngle(s.angle); // a mola volta pelo caminho mais curto
      s.omega = Math.max(-60, Math.min(60, s.omega)); // sai do giro devagar, sem solavanco
    }
  } else {
    // Além do limite suave a mola endurece (o balanço "bate" num batente macio, sem teleportar).
    const over = Math.abs(s.angle) - PHYSICS.softLimit;
    // (o batente só vale na faixa do balanço; fora dela, depois de um giro, só a mola comum puxa de volta)
    const wall = over > 0 && Math.abs(s.angle) <= PHYSICS.spinAngle ? PHYSICS.wallSpring * over * Math.sign(s.angle) : 0;
    const alpha = torque - PHYSICS.spring * s.angle - PHYSICS.damping * s.omega - wall;
    s.omega += alpha * step;
    s.omega = Math.max(-PHYSICS.maxOmega, Math.min(PHYSICS.maxOmega, s.omega));
    s.angle += s.omega * step;
    // Vira giro com velocidade alta, ou com ângulo grande SE ainda houver impulso da mão (a mola sozinha,
    // voltando de um giro, nunca reinicia o giro).
    const driven = Math.abs(torque) > 1500; // há impulso da mão agora (a mola sozinha nunca inicia giro)
    if (driven && (Math.abs(s.omega) > PHYSICS.spinOmega || Math.abs(s.angle) > PHYSICS.spinAngle)) {
      s.spinning = true;
    }
  }
  const moved = Math.abs(s.angle - prev.angle) / 360;
  if (moved > 0 && s.spinning) {
    s.turns = [...prev.turns, { t: now, amount: moved }].filter((x) => now - x.t <= PHYSICS.dizzyWindowS);
  } else {
    s.turns = prev.turns.filter((x) => now - x.t <= PHYSICS.dizzyWindowS);
  }
  return s;
}

/** Voltas completas (soma) dentro da janela de enjoo. */
export function recentTurns(s: PhysicsState, now: number): number {
  return s.turns.filter((x) => now - x.t <= PHYSICS.dizzyWindowS).reduce((sum, x) => sum + x.amount, 0);
}

/** Deu voltas demais? */
export function isDizzy(s: PhysicsState, now: number): boolean {
  return recentTurns(s, now) >= PHYSICS.dizzyTurns;
}

/** Zera a contagem de voltas (depois de enjoar). */
export function clearTurns(s: PhysicsState): PhysicsState {
  return { ...s, turns: [] };
}

/** Parado de vez: pode encerrar a animação e zerar a rotação. */
export function isSettled(s: PhysicsState): boolean {
  return !s.spinning && Math.abs(s.angle) < 0.15 && Math.abs(s.omega) < 2;
}
