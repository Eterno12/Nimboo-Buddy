/**
 * Regra de conflito da sincronização (pura, igual no PC, no celular e no serviço).
 * "Última edição vence"; empate de horário decide pelo identificador do aparelho, para que todos
 * escolham o mesmo vencedor, em qualquer ordem de chegada.
 * Limite conhecido: relógios muito diferentes entre aparelhos podem favorecer uma edição mais antiga.
 */
export interface Stamp {
  /** ISO 8601 UTC com milissegundos (comparável como texto). */
  updatedAt: string;
  /** Aparelho que fez a última edição ('' quando desconhecido). */
  origin: string;
}

/** `a` deve substituir `b`? Estritamente mais novo; iguais não substituem. */
export function isNewer(a: Stamp, b: Stamp): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.origin > b.origin;
}
