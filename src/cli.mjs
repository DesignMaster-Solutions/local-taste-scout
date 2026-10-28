#!/usr/bin/env node
// Usage: node src/cli.mjs --business "Rosa's Taqueria" --concept "tacos" --city "Austin, TX" [--audience millennials] [--record|--replay]
import { parseArgs } from 'node:util';
import { makeRunner } from './qloo.mjs';
import { scout, toBrief } from './scout.mjs';

const { values: a } = parseArgs({
  options: {
    business: { type: 'string' }, concept: { type: 'string' }, city: { type: 'string' }, audience: { type: 'string' },
    record: { type: 'boolean' }, replay: { type: 'boolean' }, json: { type: 'boolean' }, fixtures: { type: 'string', default: 'fixtures' },
  },
});
if (!a.business || !a.concept || !a.city) {
  console.error('Required: --business, --concept, --city');
  process.exit(2);
}
const run = makeRunner({ mode: a.replay ? 'replay' : a.record ? 'record' : 'live', fixturesDir: a.fixtures });
try {
  const r = await scout(a, run);
  console.log(a.json ? JSON.stringify(r, null, 2) : toBrief(r));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
