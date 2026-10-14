import type { CharacterId } from './settings.ts';

/**
 * Acessórios dos personagens. Cada um é exclusivo de um personagem, custa pontos de conquista e só
 * pode ser usado um por vez. Comprar gasta o SALDO (pontos ganhos − gastos); o total de pontos e o
 * nível de amizade não diminuem.
 */
export interface SkinDef {
  /** `<personagem>.<slug>`: o mesmo texto vai para as configurações. */
  id: string;
  character: CharacterId;
  name: string;
  description: string;
  price: number;
}

const S = (character: CharacterId, slug: string, name: string, description: string, price: number): SkinDef => ({
  id: `${character}.${slug}`,
  character,
  name,
  description,
  price,
});

export const SKINS: readonly SkinDef[] = [
  S('mochi', 'laco', 'Laço rosa', 'Um laço fofo na lateral da cabeça.', 20),
  S('mochi', 'oculos', 'Óculos redondos', 'Para parecer bem estudioso.', 50),
  S('pineapple', 'faixa', 'Faixa esportiva', 'Energia de sobra para o treino.', 20),
  S('pineapple', 'colar', 'Colar havaiano', 'Flores para o clima de férias.', 50),
  S('square', 'gravata', 'Gravata-borboleta', 'Elegante sem perder a calma.', 20),
  S('square', 'cartola', 'Cartola', 'Para as ocasiões especiais.', 50),
  S('mushroom', 'flor', 'Flor na capa', 'Uma florzinha para o dia ficar leve.', 20),
  S('mushroom', 'leitura', 'Óculos de leitura', 'Bom para olhar de pertinho.', 50),
  S('cactus', 'bandana', 'Bandana vermelha', 'Pronto para qualquer desafio.', 20),
  S('cactus', 'escuros', 'Óculos escuros', 'Estilo de quem não desiste.', 50),
  S('cloud', 'arco', 'Arco-íris', 'Um pedacinho de céu colorido.', 20),
  S('cloud', 'gorro', 'Gorro de dormir', 'Para sonhar bem devagar.', 50),
  S('planet', 'antena', 'Antena estelar', 'Capta sinais de longe.', 20),
  S('planet', 'capacete', 'Capacete espacial', 'Explorador de verdade.', 50),
  S('ghost', 'festa', 'Chapéu de festa', 'Todo dia é dia de comemorar.', 20),
  S('ghost', 'mascara', 'Máscara de baile', 'Mistério com muito charme.', 50),
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinById(id: string | null | undefined): SkinDef | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

export const SKIN_ID_RE = /^[a-z]{2,12}\.[a-z]{2,12}$/;

/** Saldo = pontos ganhos − preço dos acessórios comprados (ids desconhecidos não contam). */
export function balanceOf(points: number, owned: readonly string[]): number {
  const spent = owned.reduce((sum, id) => sum + (skinById(id)?.price ?? 0), 0);
  return Math.max(0, points - spent);
}
