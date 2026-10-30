// LLM step: turns the cited Qloo results into an owner-ready plan (who to call and what to say,
// the next event, the flyer). The model only sees numbered Qloo facts (P1, C1, A1) and must cite
// them; every reference is checked against those facts, and a plan that cites something Qloo did
// not return is sent back once with the error, then shown as ungrounded instead of trusted.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixtureKey } from './qloo.mjs';

export function facts(r) {
  const f = {};
  r.partners.forEach((p, i) => { f[`P${i + 1}`] = `${p.name}${p.properties?.address ? `, ${p.properties.address}` : ''}${p.explanation ? ` (${p.explanation})` : ''}`; });
  r.culture.forEach((c, i) => { f[`C${i + 1}`] = c.name ?? c.id; });
  r.areas.forEach((a, i) => {
    const { latitude: la, longitude: lo } = a.location ?? {};
    if (la != null) f[`A${i + 1}`] = `area at ${la.toFixed(4)}, ${lo.toFixed(4)}${a.query?.popularity != null ? `, popularity ${Math.round(a.query.popularity * 100)}%` : ''}`;
  });
  return f;
}

const SHAPE = '{"partner":{"ref":"P#","why":"...","message":"..."},"event":{"title":"...","partner_ref":"P#","culture_refs":["C#"],"pitch":"..."},"flyer":{"area_ref":"A# or null","headline":"..."},"first_step":"..."}';

export function prompt(r, f) {
  return [
    { role: 'system', content: `You write short, concrete marketing plans for small local businesses. Use ONLY the numbered facts from Qloo's taste graph; cite them by id. Never invent venues, artists, places, numbers or prices. The partner message is a 3-sentence first contact the owner can send as is, signed "[your name], <business>": never invent a person's name. Reply with JSON only, exactly this shape: ${SHAPE}` },
    { role: 'user', content: `Business: ${r.business} (${r.concept}) in ${r.city}.\nQloo facts:\n${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n')}` },
  ];
}

// Every id the plan cites must be one Qloo returned; names of venues outside the facts are also flagged.
export function check(plan, f, r) {
  const errors = [];
  const refs = [plan?.partner?.ref, plan?.event?.partner_ref, ...(plan?.event?.culture_refs ?? []), plan?.flyer?.area_ref].filter((x) => x != null && x !== 'null');
  for (const ref of refs) if (!f[ref]) errors.push(`${ref} is not one of the Qloo facts`);
  if (!plan?.partner?.ref || !plan?.partner?.message) errors.push('partner.ref and partner.message are required');
  if (!plan?.event?.title) errors.push('event.title is required');
  if (r.areas.length && !plan?.flyer?.area_ref) errors.push('flyer.area_ref is required when Qloo returned areas');
  return errors;
}

const parse = (text) => JSON.parse(String(text).replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'));

// chat(messages) -> text. Two attempts: the second carries the validation errors of the first.
export async function draftPlan(r, chat) {
  if (r.status !== 'ok' || !r.partners.length) return null;
  const f = facts(r);
  const messages = prompt(r, f);
  let plan = null;
  let errors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await chat(messages);
    try { plan = parse(text); errors = check(plan, f, r); } catch { plan = null; errors = ['reply was not valid JSON']; }
    if (!errors.length) return { ...plan, facts: f, grounded: true, attempts: attempt };
    messages.push({ role: 'assistant', content: String(text) }, { role: 'user', content: `Fix these problems and reply with the JSON only: ${errors.join('; ')}` });
  }
  return { ...(plan ?? {}), facts: f, grounded: false, errors, attempts: 2 };
}

// OpenAI-compatible endpoint (Nebius Token Factory by default) with the same record/replay as Qloo.
export function makeChat({ mode = 'live', fixturesDir = 'fixtures', env = process.env, fetchFn = fetch } = {}) {
  const base = env.LLM_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1';
  const model = env.LLM_MODEL ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507';
  return async function chat(messages) {
    const file = path.join(fixturesDir, fixtureKey('plan', { model, messages }));
    if (mode === 'replay') {
      try { return JSON.parse(await readFile(file, 'utf8')).text; } catch {
        throw new Error(`No recorded LLM reply (${file}). Run with --record and LLM_API_KEY.`);
      }
    }
    if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is not set: the plan step needs an OpenAI-compatible key.');
    const res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.LLM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 700, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = (await res.json()).choices?.[0]?.message?.content ?? '';
    if (mode === 'record') {
      await mkdir(fixturesDir, { recursive: true });
      await writeFile(file, JSON.stringify({ model, text }, null, 2));
    }
    return text;
  };
}

export function planSection(p) {
  if (!p) return [];
  const f = (ref) => (p.facts?.[ref] ? `${p.facts[ref]} [${ref}]` : `${ref} (not in Qloo results)`);
  const out = ['', `## 4. Plan drafted by the LLM from sections 1-3 (${p.grounded ? 'every reference checked against Qloo' : `UNGROUNDED: ${p.errors.join('; ')}`})`];
  if (p.partner) out.push(`**Call first:** ${f(p.partner.ref)}. ${p.partner.why ?? ''}`, '', `> ${String(p.partner.message ?? '').replace(/\n+/g, '\n> ')}`);
  if (p.event) out.push('', `**Next event:** ${p.event.title}, with ${f(p.event.partner_ref)}; theme ${(p.event.culture_refs ?? []).map(f).join(', ') || 'n/a'}. ${p.event.pitch ?? ''}`);
  if (p.flyer) out.push('', `**Flyer:** "${p.flyer.headline}"${p.flyer.area_ref && p.flyer.area_ref !== 'null' ? `, around ${f(p.flyer.area_ref)}` : ''}.`);
  if (p.first_step) out.push('', `**First step this week:** ${p.first_step}`);
  return out;
}
