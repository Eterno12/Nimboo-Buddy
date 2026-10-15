/**
 * "Supabase" falso para os testes e2e: login por código (123456), renovação, e as funções de sincronização
 * com a MESMA regra de conflito do SQL (supabase/migrations/0001_sync.sql). Com CORS, para o app móvel
 * (navegador) poder falar com ele.
 */
import http from 'node:http';

export async function startFakeSupabase() {
  const state = { rows: new Map(), seq: 0, codesSent: [], refreshes: 0, pushes: 0, validToken: new Set(), pairTokens: new Set(), pairsMade: 0 };

  const sessionFor = (email) => {
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    state.validToken.add(token);
    return { access_token: token, refresh_token: `ref-${token}`, expires_in: 3600, user: { id: 'user-1', email } };
  };

  const apply = (r) => {
    const key = `${r.tbl}:${r.id}`;
    const cur = state.rows.get(key);
    const wins =
      !cur ||
      r.stamp > cur.stamp ||
      (r.stamp === cur.stamp && r.deleted && !cur.deleted) ||
      (r.stamp === cur.stamp && r.deleted === cur.deleted && r.origin > cur.origin);
    if (wins) state.rows.set(key, { ...r, payload: r.deleted ? null : r.payload, server_seq: ++state.seq });
  };

  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    const authed = () => state.validToken.has((req.headers.authorization ?? '').replace('Bearer ', ''));
    const url = req.url ?? '';

    if (url === '/auth/v1/otp') {
      state.codesSent.push(body.email);
      return send(200, {});
    }
    if (url === '/functions/v1/pair') {
      if (!authed()) return send(401, { error: 'unauthorized' });
      const hash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      state.pairTokens.add(hash);
      state.pairsMade++;
      return send(200, { token_hash: hash });
    }
    if (url === '/auth/v1/verify' && body.type === 'magiclink') {
      // Uso único, como no Supabase: depois de trocado, o token deixa de valer.
      if (!state.pairTokens.delete(body.token_hash)) return send(403, { msg: 'Email link is invalid or has expired' });
      return send(200, sessionFor('ana@exemplo.com'));
    }
    if (url === '/auth/v1/verify') {
      if (body.token !== '123456') return send(403, { msg: 'Token has expired or is invalid' });
      return send(200, sessionFor(body.email));
    }
    if (url.startsWith('/auth/v1/token')) {
      state.refreshes++;
      return send(200, sessionFor('ana@exemplo.com'));
    }
    if (url === '/auth/v1/logout') return send(204);
    if (url.startsWith('/rest/v1/rpc/')) {
      if (!authed()) return send(401, { message: 'JWT expired' });
      const fn = url.split('/').pop();
      if (fn === 'sync_push') {
        state.pushes++;
        for (const r of body.batch) apply(r);
        return send(200, state.seq);
      }
      if (fn === 'sync_pull') {
        const rows = [...state.rows.values()]
          .filter((r) => r.server_seq > body.since)
          .sort((a, b) => a.server_seq - b.server_seq)
          .slice(0, body.max_rows);
        return send(200, rows);
      }
      if (fn === 'sync_wipe') {
        state.rows.clear();
        return send(200, null);
      }
    }
    send(404, { message: 'não existe' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    /** Registro "vindo de outro aparelho" (como se o PC tivesse enviado). */
    seedTask(id, title, stamp = '2026-10-15T10:00:00.000Z') {
      apply({
        tbl: 'tasks',
        id,
        deleted: false,
        stamp,
        origin: 'pc-device',
        payload: {
          id,
          title,
          completed: 0,
          created_at: stamp,
          completed_at: null,
          updated_at: stamp,
          due_at: null,
          source_ref: null,
          priority: 0,
          recurrence: null,
          parent_id: null,
          position: null,
          origin: 'pc-device',
        },
      });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
