// ---------------------------------------------------------------------------
// Global leaderboard client. Talks to the Netlify Function at /api/scores, but
// is built so the game NEVER waits on or breaks because of the network:
//
//  - Every score is written to a local cache (localStorage) immediately, so the
//    chart reflects it instantly ("instant local reflection").
//  - The server sync happens in the background. Each entry carries a stable id,
//    so a retry after being offline is idempotent — no duplicates, no double
//    counting, no merge conflicts.
//  - If the function is unreachable (offline, or running the static files with
//    no Netlify backend), everything still works from the local cache.
// ---------------------------------------------------------------------------
const URL = '/api/scores';
const K_NAME = 'burds_name';
const K_CACHE = 'burds_lb_cache';
const K_PENDING = 'burds_lb_pending';
const MAX = 50;

const load = (k, d) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
  catch { return d; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const uuid = () =>
  (crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// Merge entries by id, sort high→low, keep the top MAX.
function merge(...lists) {
  const byId = new Map();
  for (const list of lists) for (const e of (list || [])) {
    if (e && typeof e.score === 'number') byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX);
}

export function getName() { return load(K_NAME, '') || ''; }
export function setName(n) { save(K_NAME, String(n || '').slice(0, 12)); }

export function cachedScores() { return load(K_CACHE, []); }

// Fetch the authoritative board; falls back to the local cache when offline.
export async function fetchScores() {
  try {
    const r = await fetch(URL, { method: 'GET' });
    if (!r.ok) throw new Error('http ' + r.status);
    const { scores } = await r.json();
    const merged = merge(scores, load(K_PENDING, []));
    save(K_CACHE, merged);
    return merged;
  } catch {
    return cachedScores();
  }
}

// POST a single entry; on success reconcile the cache with the server's list.
async function sync(entry, onUpdate) {
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const { scores } = await r.json();
    const pending = load(K_PENDING, []).filter((e) => e.id !== entry.id);
    save(K_PENDING, pending);
    const merged = merge(scores, pending);
    save(K_CACHE, merged);
    if (onUpdate) onUpdate(merged, false);
    return merged;
  } catch {
    return null; // stays queued; retried by flushPending()
  }
}

// Submit a score. Returns the optimistic list synchronously (for instant
// display) plus the entry; `onUpdate(list, pending)` fires again if/when the
// server confirms with the authoritative ordering.
export function submitScore(name, score, onUpdate) {
  setName(name);
  const entry = { id: uuid(), name: String(name || 'BURD').slice(0, 12).toUpperCase() || 'BURD', score: Math.round(score), ts: Date.now() };
  const optimistic = merge(cachedScores(), [entry]);
  save(K_CACHE, optimistic);
  const pending = load(K_PENDING, []);
  pending.push(entry);
  save(K_PENDING, pending);
  sync(entry, onUpdate);
  return { list: optimistic, entry };
}

// Retry any entries that never reached the server (called on load / regained
// connectivity).
export async function flushPending() {
  const pending = load(K_PENDING, []);
  for (const e of pending) await sync(e);
}
