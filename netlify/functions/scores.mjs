// Global high-scores leaderboard, backed by Netlify Blobs.
//
// Netlify Blobs is built into every Netlify site with zero configuration — no
// external database, no accounts, no env vars — which makes this about as
// "bulletproof, nothing to sync" as a global store gets. We keep a single JSON
// array of the top scores; reads are instant and writes are a small
// read-modify-write. Entries carry a client-generated `id` so retries (e.g. a
// score submitted while briefly offline) are idempotent and never double-count.
import { getStore } from '@netlify/blobs';

const KEY = 'top';
const MAX = 50;

const cleanName = (s) =>
  (String(s == null ? '' : s).replace(/[^\w !?.\-]/g, '').trim().slice(0, 12).toUpperCase() || 'BURD');
const validScore = (n) => Number.isFinite(n) && n >= 0 && n <= 1e9;

export default async (req) => {
  const store = getStore('leaderboard');

  if (req.method === 'GET') {
    const scores = (await store.get(KEY, { type: 'json' })) || [];
    return Response.json({ scores });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

    const score = Math.round(Number(body.score));
    if (!validScore(score)) return new Response('bad score', { status: 400 });

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
