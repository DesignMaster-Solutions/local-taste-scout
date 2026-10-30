// Hosted demo: the same agent behind a small web page. GET /api/scout runs it live against Qloo
// (key from QLOO_API_KEY on the server); ?replay=1 serves the recorded cases with no Qloo call.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { makeRunner } from './qloo.mjs';
import { scout, toBrief } from './scout.mjs';
import { draftPlan, makeChat } from './plan.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const PAGE = new URL('../public/index.html', import.meta.url);
const live = makeRunner({ mode: 'live' });
const FIX = new URL('../fixtures', import.meta.url).pathname;
const replay = makeRunner({ mode: 'replay', fixturesDir: FIX });
const chatLive = makeChat({ mode: 'live' });
const chatReplay = makeChat({ mode: 'replay', fixturesDir: FIX });

// shortcut: in-memory cache and per-IP limit, reset on restart; enough for a judged demo, not for real traffic.
const cache = new Map();
const hits = new Map();
const LIMIT = 15; // live runs per IP per hour
function allowed(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LIMIT) return false;
  hits.set(ip, [...recent, now]);
  return true;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

export function readInput(q) {
  const v = (k) => (q.get(k) ?? '').trim();
  const input = { business: v('business'), concept: v('concept'), city: v('city'), audience: v('audience') || undefined };
  if (!input.business || !input.concept || !input.city) return { error: 'business, concept and city are required.' };
  if (Object.values(input).some((s) => s && s.length > 80)) return { error: 'Each field must be 80 characters or fewer.' };
  return { input };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, await readFile(PAGE, 'utf8'), 'text/html');
  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (url.pathname !== '/api/scout' || req.method !== 'GET') return send(res, 404, { error: 'Not found' });

  const { input, error } = readInput(url.searchParams);
  if (error) return send(res, 400, { error });
  const isReplay = url.searchParams.get('replay') === '1';
  const key = JSON.stringify([isReplay, input]);
  try {
    if (!cache.has(key)) {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
      if (!isReplay && !allowed(ip)) return send(res, 429, { error: `Live demo limit reached (${LIMIT} runs per hour). Try a recorded case.` });
      const r = await scout(input, isReplay ? replay : live);
      r.plan = await draftPlan(r, isReplay ? chatReplay : chatLive).catch((e) => { r.planError = e.message; return null; });
      cache.set(key, { result: r, brief: toBrief(r), mode: isReplay ? 'replay' : 'live' });
    }
    send(res, 200, cache.get(key));
  } catch (e) {
    // Personal-data rejections are the caller's fault; everything else is an upstream failure.
    send(res, /personal data/.test(e.message) ? 400 : 502, { error: e.message });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(PORT, () => console.log(`listening on ${PORT}`));
export { server };
