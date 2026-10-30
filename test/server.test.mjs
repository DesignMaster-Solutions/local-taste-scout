import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.mjs';

const base = await new Promise((ok) => server.listen(0, () => ok(`http://127.0.0.1:${server.address().port}`)));
after(() => server.close());

test('page and recorded case are served without a Qloo key', async () => {
  assert.match(await (await fetch(base)).text(), /Local Taste Scout/);
  const res = await fetch(`${base}/api/scout?business=Rosa%27s+Taqueria&concept=tacos&city=Austin%2C+TX&replay=1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'replay');
  assert.ok(body.result.partners.length > 0);
  assert.ok(body.result.areas[0].location.latitude);
});

test('bad input is a 400, and personal data never reaches Qloo', async () => {
  assert.equal((await fetch(`${base}/api/scout?business=x`)).status, 400);
  assert.equal((await fetch(`${base}/api/scout?business=${'a'.repeat(81)}&concept=t&city=c`)).status, 400);
  const pii = await fetch(`${base}/api/scout?business=a%40b.com&concept=tacos&city=Austin`);
  assert.equal(pii.status, 400);
  assert.match((await pii.json()).error, /personal data/);
});

test('the page script parses (a syntax error once shipped a dead page)', async () => {
  const html = await (await fetch(base)).text();
  assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]));
});

test('every recorded case on the page replays, including its LLM plan (a tag change once broke the yoga case)', async () => {
  const html = await (await fetch(base)).text();
  const cases = [...html.matchAll(/data-case='([^']+)'/g)].map((m) => JSON.parse(m[1].replace(/&#39;/g, "'")));
  assert.equal(cases.length, 3);
  for (const c of cases) {
    const res = await fetch(`${base}/api/scout?${new URLSearchParams({ ...c, replay: '1' })}`);
    assert.equal(res.status, 200, c.business);
    const { result, brief } = await res.json();
    assert.equal(result.plan?.grounded, true, c.business);
    assert.match(brief, /## 4\. Plan drafted by the LLM/);
    assert.doesNotMatch(result.plan.partner.message, /I'm Rosa/);
  }
});
