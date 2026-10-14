/* Configurações globais do filme de lançamento. Tudo em coordenadas da composição 1920×1080. */
window.NB = window.NB || {};

NB.config = {
  W: 1920,
  H: 1080,
  /** Duração narrativa fixa (s). A timeline é preenchida até aqui e nunca passa disso. */
  duration: 30,
  brand: 'NIMBOO',
  name: 'Nimboo',
  tagline: 'A little buddy for your everyday.',
  /** Inícios das cenas (s): usados pela timeline e pela navegação dos controles. */
  scenes: [
    { id: 's1', label: 'Reveal', start: 0 },
    { id: 's2', label: 'Desktop', start: 3 },
    { id: 's3', label: 'Mascot', start: 7 },
    { id: 's4', label: 'Routine', start: 11 },
    { id: 's5', label: 'Island', start: 16 },
    { id: 's6', label: 'Buddy', start: 21 },
    { id: 's7', label: 'Signature', start: 26 },
  ],
  /** Centro do símbolo da marca (abertura e assinatura). */
  logo: { x: 960, y: 450 },
};
