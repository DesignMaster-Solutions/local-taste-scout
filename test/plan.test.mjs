import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPlan, facts, check } from '../src/plan.mjs';
import { toBrief } from '../src/scout.mjs';

const r = {
  business: "Rosa's Taqueria", concept: 'tacos', city: 'Austin, TX', status: 'ok', trace: [], sources: {},
  choice: { tag: { name: 'Tacos', id: 't' }, reason: '' },
  partners: [{ name: 'Cosmic Coffee' }, { name: 'Vinyl Bar' }],
  culture: [{ name: 'Khruangbin' }],
  areas: [{ location: { latitude: 30.2337, longitude: -97.7433, geohash: '9v67zzc' }, query: { popularity: 0.5 } }],
};
const good = { partner: { ref: 'P1', why: 'w', message: 'Hi' }, event: { title: 'Taco night', partner_ref: 'P2', culture_refs: ['C1'], pitch: 'p' }, flyer: { area_ref: 'A1', headline: 'h' }, first_step: 's' };

test('facts number every Qloo result the model may cite', () => {
  assert.deepEqual(Object.keys(facts(r)), ['P1', 'P2', 'C1', 'A1']);
});

test('a reference Qloo did not return is caught, sent back once, and fixed', async () => {
  const bad = { ...good, event: { ...good.event, culture_refs: ['C7'] } };
  const seen = [];
  const plan = await draftPlan(r, async (m) => { seen.push(m.length); return JSON.stringify(seen.length === 1 ? bad : good); });
  assert.equal(plan.grounded, true);
  assert.equal(plan.attempts, 2);
  assert.equal(seen[1], 4); // system, user, bad reply, correction
  assert.match(toBrief({ ...r, plan }), /every reference checked against Qloo[\s\S]*Khruangbin \[C1\]/);
});

test('a plan that stays ungrounded is labeled, never presented as checked', async () => {
  const plan = await draftPlan(r, async () => JSON.stringify({ ...good, partner: { ref: 'P9', message: 'x' } }));
  assert.equal(plan.grounded, false);
  assert.match(toBrief({ ...r, plan }), /UNGROUNDED: P9 is not one of the Qloo facts/);
  assert.deepEqual(check(good, facts(r), r), []);
});

test('an LLM failure leaves the Qloo brief intact and says why', () => {
  const brief = toBrief({ ...r, plan: null, planError: 'LLM_API_KEY is not set' });
  assert.match(brief, /LLM step skipped: LLM_API_KEY is not set/);
  assert.match(brief, /Partner candidates/);
});
