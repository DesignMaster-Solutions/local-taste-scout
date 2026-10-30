#!/usr/bin/env node
// Usage: node src/cli.mjs --business "Rosa's Taqueria" --concept "tacos" --city "Austin, TX" [--audience millennials] [--record|--replay]
import { parseArgs } from 'node:util';
import { makeRunner } from './qloo.mjs';
import { scout, toBrief } from './scout.mjs';
import { draftPlan, makeChat } from './plan.mjs';

const { values: a } = parseArgs({
  options: {
    business: { type: 'string' }, concept: { type: 'string' }, city: { type: 'string' }, audience: { type: 'string' },
    'no-plan': { type: 'boolean' }, record: { type: 'boolean' }, replay: { type: 'boolean' }, json: { type: 'boolean' }, fixtures: { type: 'string', default: 'fixtures' },
  },
});
if (!a.business || !a.concept || !a.city) {
  console.error('Required: --business, --concept, --city');
  process.exit(2);
}
const mode = a.replay ? 'replay' : a.record ? 'record' : 'live';
const run = makeRunner({ mode, fixturesDir: a.fixtures });
const chat = makeChat({ mode, fixturesDir: a.fixtures });
try {
  const r = await scout(a, run);
  // The plan is a layer on top of the cited brief: if it fails, the Qloo brief still prints and says why.
  if (!a['no-plan']) r.plan = await draftPlan(r, chat).catch((e) => { r.planError = e.message; return null; });
  console.log(a.json ? JSON.stringify(r, null, 2) : toBrief(r));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
