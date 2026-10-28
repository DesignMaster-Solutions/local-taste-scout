import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pickTag, scout, toBrief, assertNoPersonalData } from '../src/scout.mjs';
import { makeRunner } from '../src/qloo.mjs';

const env = (operation, results, n = 1) => ({ operation, status: results.length ? 'ok' : 'empty', results, execution: { correlation_id: `c-${operation}-${n}` } });

function fakeRun() {
  const calls = [];
  const run = async (op, input) => {
    calls.push({ op, input });
    if (op === 'find_tags') return env(op, [
      { name: 'Tacos', id: 'urn:tag:genre:music:tacos', type: 'urn:tag:genre:music' },
      { name: 'Tacos', id: 'urn:tag:category:place:tacos', type: 'urn:tag:category:place' },
    ]);
    if (op === 'recommend' && input.target_type === 'place') return env(op, [
      { name: "Rosa's Taqueria" }, { name: 'Cosmic Coffee', entity_id: 'E-COSMIC', explanation: 'shared audience' }, { name: 'Vinyl Bar' },
    ], 2);
    if (op === 'recommend') return env(op, [{ name: 'Khruangbin' }], 3);
    if (op === 'where_popular') return env(op, [{ name: 'East Austin' }], 4);
    throw new Error(`unexpected ${op}`);
  };
  return { run, calls };
}

test('pickTag prefers the place-scoped tag among same-name tags', () => {
  const r = pickTag([{ name: 'Jazz', type: 'urn:tag:genre:music' }, { name: 'Jazz', type: 'urn:tag:category:place' }], 'jazz');
  assert.equal(r.tag.type, 'urn:tag:category:place');
  assert.equal(r.ambiguous, false);
});

test('pickTag prefers a place tag over a same-name cuisine tag (real Qloo "Tacos" case)', () => {
  const r = pickTag([
    { name: 'Tacos', id: 'urn:tag:cuisine:qloo:tacos', type: 'urn:tag:cuisine:qloo' },
    { name: 'Tacos', id: 'urn:tag:specialty_dish:place:tacos', type: 'urn:tag:specialty_dish:place' },
  ], 'tacos');
  assert.equal(r.tag.id, 'urn:tag:specialty_dish:place:tacos');
  assert.equal(r.ambiguous, false);
});

test('areas from where_popular render as coordinates with a map link, never "undefined"', () => {
  const brief = toBrief({ business: 'B', city: 'Austin, TX', status: 'ok', choice: { tag: { name: 'T', id: 't' }, reason: '' }, trace: [],
    partners: [], culture: [], sources: {},
    areas: [{ location: { latitude: 30.2337, longitude: -97.7433, geohash: '9v67zzc' }, query: { affinity: 0.99, popularity: 0.5 } }] });
  assert.doesNotMatch(brief, /undefined/);
  assert.match(brief, /30\.2337, -97\.7433/);
  assert.match(brief, /google\.com\/maps/);
});

test('pickTag flags ties instead of guessing silently', () => {
  const r = pickTag([{ name: 'Jazz', id: 'a' }, { name: 'Jazz', id: 'b' }], 'jazz');
  assert.equal(r.ambiguous, true);
});

test('scout chains tag → partners → culture → areas, drops the business itself, cites every step', async () => {
  const { run, calls } = fakeRun();
  const r = await scout({ business: "Rosa's Taqueria", concept: 'tacos', city: 'Austin, TX' }, run);
  assert.deepEqual(calls.map((c) => c.op), ['find_tags', 'recommend', 'recommend', 'where_popular']);
  assert.equal(calls[1].input.signal_tags[0], 'urn:tag:category:place:tacos');
  assert.equal(calls[3].input.entity, 'E-COSMIC');
  assert.ok(!r.partners.some((p) => p.name === "Rosa's Taqueria"));
  const brief = toBrief(r);
  assert.match(brief, /c-recommend-2/);
  assert.match(brief, /does not establish/);
});

test('an audience also sends signal_location (Qloo requires it for demographic signals)', async () => {
  const { run, calls } = fakeRun();
  await scout({ business: 'Flow Yoga', concept: 'tacos', city: 'Denver, CO', audience: 'millennials' }, run);
  assert.equal(calls[1].input.signal_location, 'Denver, CO');
});

test('scout stops with needs_input when no tag resolves', async () => {
  const r = await scout({ business: 'X', concept: 'zzz', city: 'Austin, TX' }, async (op) => env(op, []));
  assert.equal(r.status, 'needs_input');
  assert.equal(r.trace.length, 1);
});

test('personal data never reaches Qloo', async () => {
  assert.throws(() => assertNoPersonalData({ business: 'call me at +1 512 555 0100' }));
  await assert.rejects(scout({ business: 'a@b.com', concept: 'tacos', city: 'Austin' }, async () => assert.fail('called')));
});

test('record then replay returns the same response without calling Qloo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lts-'));
  const rec = makeRunner({ mode: 'record', fixturesDir: dir, exec: async (op) => env(op, [{ name: 'A' }]) });
  const first = await rec('find_tags', { query: 'tacos', limit: 5 });
  const rep = makeRunner({ mode: 'replay', fixturesDir: dir, exec: async () => assert.fail('live call in replay') });
  assert.deepEqual(await rep('find_tags', { query: 'tacos', limit: 5 }), first);
  await assert.rejects(rep('find_tags', { query: 'other' }), /No recorded response/);
});

test('harness errors surface instead of falling back', async () => {
  const run = makeRunner({ exec: async () => ({ error: { code: 'QLOO_AUTH', recovery: 'set key' } }) });
  await assert.rejects(run('find_tags', { query: 'x' }), /QLOO_AUTH/);
});

test('where_popular failing on the top partner moves to the next one, and a total failure is reported, not hidden', async () => {
  const { run } = fakeRun();
  const flaky = async (op, input) => {
    if (op === 'where_popular' && input.entity === 'E-COSMIC') throw new Error('Qloo where_popular failed: QLOO_CONTRACT (x)');
    return run(op, input);
  };
  const r = await scout({ business: "Rosa's Taqueria", concept: 'tacos', city: 'Austin, TX' }, flaky);
  assert.equal(r.areas[0].name, 'East Austin');
  assert.match(r.trace.find((t) => t.status === 'error').error, /QLOO_CONTRACT/);
  assert.match(r.trace.at(-1).why, /Vinyl Bar/);

  const down = async (op, input) => (op === 'where_popular' ? Promise.reject(new Error('Qloo where_popular failed: QLOO_CONTRACT')) : run(op, input));
  const r2 = await scout({ business: "Rosa's Taqueria", concept: 'tacos', city: 'Austin, TX' }, down);
  assert.equal(r2.areas.length, 0);
  assert.match(toBrief(r2), /QLOO_CONTRACT/);
});
