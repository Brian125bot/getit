import test from 'node:test';
import assert from 'node:assert';
import { MaskingSession, scrubText, shannonEntropy } from '../src/security/scrubber.js';

test('Phase 2 scrubber masks known tokens deterministically', () => {
  const session = new MaskingSession();
  const first = scrubText('token sk-abcdefghijklmnopqrstuvwxyz123456', session);
  const second = scrubText('again sk-abcdefghijklmnopqrstuvwxyz123456', session);
  assert.ok(first.includes('[REDACTED_1]'));
  assert.ok(second.includes('[REDACTED_1]'));
});

test('Phase 2 scrubber masks long high entropy values but ignores standard hashes', () => {
  const session = new MaskingSession();
  const secret = 'amdf83jd92830fjsn3810fjsm39102jfHHHHHzzz999';
  const sha = 'a'.repeat(64);
  assert.ok(shannonEntropy(secret) > 0);
  assert.ok(scrubText(secret, session).includes('[REDACTED_1]'));
  assert.strictEqual(scrubText(sha, session), sha);
});
