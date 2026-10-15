/**
 * Projeto Supabase do Nimboo (D55). A chave `anon` é PÚBLICA por desenho (vai em qualquer app cliente);
 * quem protege os dados são as regras por usuário (RLS) em `supabase/migrations/0001_sync.sql`.
 * Nunca coloque aqui a `service_role`.
 */
export const SUPABASE_URL = 'https://dgzzzztyfzuggxcnutfl.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnenp6enR5Znp1Z2d4Y251dGZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMzI4NTgsImV4cCI6MjEwNzYwODg1OH0.VSWlVF8WIdVuWFDO2bVYWnBhg8lQ7pza34tq9gmJYGw';

/** Intervalo entre verificações (a sincronização roda se houver algo na fila ou passou 1 minuto). */
export const SYNC_TICK_MS = 15_000;
export const SYNC_IDLE_INTERVAL_MS = 60_000;
