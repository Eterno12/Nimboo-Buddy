// Edge Function "pair": gera um token de uso único para o celular entrar na MESMA conta do PC lendo um QR.
//
// Quem chama é o PC já logado (Authorization: Bearer <token do usuário>). A função valida o usuário e pede ao
// Supabase Auth um link mágico SEM enviar e-mail (`generateLink`); devolve só o `token_hash`. O celular troca
// esse token por uma sessão em /auth/v1/verify (type=magiclink). O token vale uma vez e expira conforme a
// configuração de OTP do projeto; o app ainda recusa QR com mais de 2 minutos.
//
// Publicar: painel do Supabase → Edge Functions → Deploy a new function → nome `pair` → colar este arquivo.
// Mantenha "Verify JWT" LIGADO. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente da função.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'unauthorized' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // O e-mail vem do token validado pelo servidor, nunca do corpo da requisição.
  const { data: who, error: whoError } = await admin.auth.getUser(jwt);
  const email = who?.user?.email;
  if (whoError || !email) return json(401, { error: 'unauthorized' });

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) return json(500, { error: 'link_failed' });

  return json(200, { token_hash: hash });
});
