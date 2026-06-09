// Global high-scores leaderboard, backed by Netlify Blobs.
//
// Netlify Blobs is built into every Netlify site with zero configuration — no
// external database, no accounts, no env vars — which makes this about as
// "bulletproof, nothing to sync" as a global store gets. We keep a single JSON
// array of the top scores; reads are instant and writes are a small
// read-modify-write. Entries carry a client-generated `id` so retries (e.g. a
// score submitted while briefly offline) are idempotent and never double-count.
import { getStore } from '@netlify/blobs';

const MAX = 50;

const cleanName = (s) =>
  (String(s == null ? '' : s).replace(/[^\w !?.\-]/g, '').trim().slice(0, 12).toUpperCase() || 'BURD');
const validScore = (n) => Number.isFinite(n) && n >= 0 && n <= 1e9;
// Each level keeps its own board under `board:<level>`. Sanitise the level so a
// crafted value can't reach outside the leaderboard store's keyspace.
const cleanLevel = (s) => (String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'beach');
// Beach keeps the original 'board' key so its existing global scores survive;
// the new levels get their own per-level boards.
const boardKey = (level) => { const l = cleanLevel(level); return l === 'beach' ? 'board' : `board:${l}`; };

export default async (req) => {
  // Strong consistency so a read always sees the latest write — closes the
  // read-after-write gap and narrows the window for a concurrent read-modify-
  // write to lose an entry.
  const store = getStore({ name: 'leaderboard', consistency: 'strong' });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const scores = (await store.get(boardKey(url.searchParams.get('level')), { type: 'json' })) || [];
    return Response.json({ scores });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

    const score = Math.round(Number(body.score));
    if (!validScore(score)) return new Response('bad score', { status: 400 });

    const KEY = boardKey(body.level);
    const entry = {
      id: String(body.id || crypto.randomUUID()).slice(0, 64),
      name: cleanName(body.name),
      score,
      ts: Date.now(),
    };

    const list = (await store.get(KEY, { type: 'json' })) || [];
    if (!list.some((e) => e.id === entry.id)) list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, MAX);
    await store.setJSON(KEY, top);

    return Response.json({ scores: top });
  }

  return new Response('method not allowed', { status: 405 });
};

// Netlify Functions v2 routing — serve this at a clean /api/scores path.
export const config = { path: '/api/scores' };
