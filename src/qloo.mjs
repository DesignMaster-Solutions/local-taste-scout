// Thin transport over the official harness (`qloo exec`), plus a replay mode so judges can
// reproduce the demo from recorded responses without a credential.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const fixtureKey = (op, input) =>
  `${op}-${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)}.json`;

function execHarness(op, input, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('qloo', ['exec', op], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`qloo exec ${op} timed out`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`qloo exec ${op}: non-JSON output: ${(out || err).slice(0, 300)}`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

// mode: 'live' calls Qloo, 'record' calls and saves, 'replay' reads saved responses only.
export function makeRunner({ mode = 'live', fixturesDir = 'fixtures', exec = execHarness } = {}) {
  return async function run(op, input) {
    const file = path.join(fixturesDir, fixtureKey(op, input));
    if (mode === 'replay') {
      try { return JSON.parse(await readFile(file, 'utf8')); } catch {
        throw new Error(`No recorded response for ${op} ${JSON.stringify(input)} (${file}). Run with --record and a key.`);
      }
    }
    const res = await exec(op, input);
    if (res?.error) throw new Error(`Qloo ${op} failed: ${res.error.code} (${res.error.recovery ?? ''})`);
    if (mode === 'record') {
      await mkdir(fixturesDir, { recursive: true });
      await writeFile(file, JSON.stringify(res, null, 2));
    }
    return res;
  };
}
