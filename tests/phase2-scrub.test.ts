/**
 * @file phase2-scrub.test.ts
 * @description Test suite for the secret scrubber (`src/security/scrubber.ts`).
 *
 * Covers:
 *   1. Pattern-based masking — known secret prefixes (sk-, ghp_, github_pat_, AKIA, Bearer, PEM)
 *   2. Determinism — same secret always gets the same placeholder within a session
 *   3. Standard-hash whitelisting — git SHAs must never be redacted
 *   4. Entropy heuristic edge cases:
 *      - Real API-key-length secrets MUST be redacted
 *      - Legitimate technical strings (npm integrity hashes, long URLs, base64
 *        image data headers, JWT components, HTTPS cert fingerprints) MUST NOT
 *        be redacted (false-positive guard)
 *   5. Short-string fast-path — strings under 32 chars are never touched
 *   6. StreamScrubber — correct buffering and flush behaviour
 *   7. Known-secret registry — explicit registration forces masking
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  MaskingSession,
  scrubText,
  shannonEntropy,
  StreamScrubber,
  registerKnownSecret,
  resetDefaultMaskingSession,
} from '../src/security/scrubber.js';

// ─── Basic pattern masking ─────────────────────────────────────────────────

test('Phase 2 scrubber masks OpenAI sk- keys', () => {
  const session = new MaskingSession();
  const result = scrubText('Use sk-abcdefghijklmnopqrstuvwxyz123456 to call the API', session);
  assert.ok(result.includes('[REDACTED_'), `Expected redaction, got: ${result}`);
  assert.ok(!result.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), 'Raw key should not appear');
});

test('Phase 2 scrubber masks GitHub classic PATs (ghp_)', () => {
  const session = new MaskingSession();
  const result = scrubText('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567', session);
  assert.ok(result.includes('[REDACTED_'), `Expected redaction, got: ${result}`);
});

test('Phase 2 scrubber masks GitHub fine-grained PATs (github_pat_)', () => {
  const session = new MaskingSession();
  const result = scrubText('github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890', session);
  assert.ok(result.includes('[REDACTED_'), `Expected redaction, got: ${result}`);
});

test('Phase 2 scrubber masks AWS Access Key IDs (AKIA)', () => {
  const session = new MaskingSession();
  // Note: the input must be ≥32 chars to pass the early-return fast path.
  // A real AWS usage line easily meets this threshold.
  const result = scrubText('aws_key=AKIAIOSFODNN7EXAMPLE for service access', session);
  assert.ok(result.includes('[REDACTED_'), `Expected redaction, got: ${result}`);
});

test('Phase 2 scrubber masks Bearer tokens while preserving the Bearer prefix', () => {
  const session = new MaskingSession();
  const result = scrubText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc123def456', session);
  assert.ok(result.includes('Bearer '), 'Bearer prefix should be preserved');
  assert.ok(result.includes('[REDACTED_'), 'Token should be redacted');
});

test('Phase 2 scrubber masks known tokens deterministically across turns', () => {
  const session = new MaskingSession();
  const first = scrubText('token sk-abcdefghijklmnopqrstuvwxyz123456', session);
  const second = scrubText('again sk-abcdefghijklmnopqrstuvwxyz123456', session);
  assert.ok(first.includes('[REDACTED_1]'));
  assert.ok(second.includes('[REDACTED_1]'), 'Same secret must produce the same placeholder ID');
});

// ─── Standard hash whitelisting ────────────────────────────────────────────

test('Phase 2 scrubber does NOT redact 40-char git SHA-1', () => {
  const session = new MaskingSession();
  const sha1 = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
  assert.strictEqual(scrubText(sha1, session), sha1, 'git SHA-1 must never be redacted');
});

test('Phase 2 scrubber does NOT redact 64-char git SHA-256', () => {
  const session = new MaskingSession();
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.strictEqual(scrubText(sha256, session), sha256, 'git SHA-256 must never be redacted');
});

test('Phase 2 scrubber does NOT redact 64-char all-same-character hex', () => {
  const session = new MaskingSession();
  const sha = 'a'.repeat(64);
  assert.strictEqual(scrubText(sha, session), sha, 'Standard hash must be preserved');
});

// ─── Entropy heuristic — real secrets ──────────────────────────────────────

test('Phase 2 scrubber masks long high-entropy mixed-charset value', () => {
  const session = new MaskingSession();
  // Fabricated value: 43 chars, mixed case + digits, high entropy — looks like an API key
  const secret = 'amdf83jd92830fjsn3810fjsm39102jfHHHHHzzz999';
  assert.ok(shannonEntropy(secret) > 0, 'Entropy should be computable');
  const result = scrubText(secret, session);
  assert.ok(result.includes('[REDACTED_'), `High-entropy secret should be redacted, got: ${result}`);
});

// ─── Entropy heuristic — false-positive guard ──────────────────────────────

test('Phase 2 scrubber does NOT redact npm integrity sha512 hash', () => {
  // Real npm integrity hash — should never be redacted
  const npmHash = 'sha512-oHIkDEzCFJzFVWEP4Q7lJ8wR1NuKJ5WdlXP3F4i9+r4=';
  const session = new MaskingSession();
  const result = scrubText(npmHash, session);
  assert.strictEqual(result, npmHash, `npm integrity hash must not be redacted, got: ${result}`);
});

test('Phase 2 scrubber does NOT redact a long HTTPS URL with query params', () => {
  const url = 'https://registry.npmjs.org/@babel/core/-/core-7.23.9.tgz?hash=abc123def456&v=2';
  const session = new MaskingSession();
  const result = scrubText(url, session);
  assert.strictEqual(result, url, `Long URL must not be redacted, got: ${result}`);
});

test('Phase 2 scrubber does NOT redact a base64-encoded small image data header', () => {
  // The "data:" prefix makes this clearly not a secret
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42';
  const session = new MaskingSession();
  const result = scrubText(imageData, session);
  assert.strictEqual(result, imageData, `Base64 image header must not be redacted, got: ${result}`);
});

test('Phase 2 scrubber does NOT redact a typical JWT header segment', () => {
  // JWT header: base64url-encoded JSON, 36 chars — under ENTROPY_MIN_LENGTH
  const jwtHeader = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const session = new MaskingSession();
  const result = scrubText(jwtHeader, session);
  assert.strictEqual(result, jwtHeader, `Short JWT header must not be redacted, got: ${result}`);
});

test('Phase 2 scrubber does NOT redact a package name with version string', () => {
  const pkgRef = 'typescript@5.3.3-abcdef0123456789abcdef0123456789abcdef01';
  const session = new MaskingSession();
  const result = scrubText(pkgRef, session);
  assert.strictEqual(result, pkgRef, `Package version ref must not be redacted, got: ${result}`);
});

// ─── Short-string fast-path ─────────────────────────────────────────────────

test('Phase 2 scrubber short-circuits on strings under 32 chars', () => {
  const session = new MaskingSession();
  const short = 'sk-short';
  assert.strictEqual(scrubText(short, session), short, 'Sub-32-char strings must pass through unchanged');
});

// ─── Known-secret registry ──────────────────────────────────────────────────

test('Phase 2 scrubber masks explicitly registered secrets regardless of entropy', () => {
  resetDefaultMaskingSession();
  const lowEntropySecret = 'mypassword12345678901234567890123';  // low entropy but registered
  registerKnownSecret(lowEntropySecret);
  const result = scrubText(`Use ${lowEntropySecret} to authenticate`, getDefaultMaskingSession());
  assert.ok(result.includes('[REDACTED_'), `Registered secret must be masked, got: ${result}`);
  resetDefaultMaskingSession();
});

// ─── StreamScrubber ─────────────────────────────────────────────────────────

test('Phase 2 StreamScrubber flushes remaining buffer on flush()', () => {
  const session = new MaskingSession();
  const scrubber = new StreamScrubber(session);
  // Push tokens that don't end in whitespace — should buffer
  scrubber.push('sk-abcdefghijklmnop');
  scrubber.push('qrstuvwxyz123456');
  // Flush should emit scrubbed content
  const flushed = scrubber.flush();
  assert.ok(!flushed.includes('sk-'), `Flushed content should be scrubbed, got: ${flushed}`);
});

test('Phase 2 StreamScrubber emits safe content at word boundaries', () => {
  const session = new MaskingSession();
  const scrubber = new StreamScrubber(session);
  const out1 = scrubber.push('hello ');
  // "hello " ends on a whitespace boundary — should be emitted immediately
  assert.ok(out1.includes('hello'), `Word before boundary should emit, got: "${out1}"`);
});

test('Phase 2 shannonEntropy returns 0 for empty string', () => {
  assert.strictEqual(shannonEntropy(''), 0);
});

test('Phase 2 shannonEntropy returns 0 for single-character string', () => {
  assert.strictEqual(shannonEntropy('aaaa'), 0);
});

test('Phase 2 shannonEntropy increases with character diversity', () => {
  const low = shannonEntropy('aaaaaaaaaaaaaaaaaaaaaa');
  const high = shannonEntropy('aAbBcCdDeEfF0123456789');
  assert.ok(high > low, `Higher diversity string should have higher entropy (${high} > ${low})`);
});

// Helper to access the default session in tests
import { getDefaultMaskingSession } from '../src/security/scrubber.js';
