/**
 * @module scrubber
 * @description Real-time secret scrubbing layer for getit.
 *
 * All text sent to the LLM context and all text streamed to the terminal
 * passes through this module. It uses a combination of:
 *   1. Exact-match masking for explicitly registered secrets (API keys, tokens
 *      loaded from `.getitrc` or the environment).
 *   2. Pattern-based masking for well-known secret formats (OpenAI `sk-`,
 *      GitHub `ghp_` / `github_pat_`, AWS AKIA, Bearer tokens, PEM keys).
 *   3. Shannon-entropy analysis as a last-resort heuristic for novel high-entropy
 *      strings that don't match any known pattern.
 *
 * Entropy thresholds are deliberately conservative to avoid false-positive
 * redaction of legitimate technical content such as npm package hashes, long
 * URLs, base64-encoded images, and JWT payloads that the user has intentionally
 * included in the conversation.
 *
 * Tuning guide:
 *   - `HEX_ENTROPY_THRESHOLD`    — Applies to pure hex strings (0-9a-f).
 *                                   Values above ~4.0 on a 64-char hex string
 *                                   indicate a true random secret.
 *   - `BASE64_HARD_THRESHOLD`    — Absolute upper-bound for any base64-like token.
 *                                   Set conservatively at 5.5 (near-theoretical max
 *                                   for base64 alphabet) so normal JWT headers,
 *                                   HTTPS fingerprints, and npm integrity hashes
 *                                   are NOT redacted.
 *   - `BASE64_SOFT_THRESHOLD`    — Softer check applied only when the token is
 *                                   longer than 60 chars AND contains both letters
 *                                   and digits (both conditions reduce false-positive
 *                                   rate on URLs and package hashes).
 *   - `GENERAL_ENTROPY_THRESHOLD`— Catch-all for mixed-charset tokens.
 *
 * @see {@link https://github.com/Brian125bot/getit} for full documentation.
 */

const MASK_PREFIX = '[REDACTED_';

// ─── Entropy thresholds ────────────────────────────────────────────────────
/**
 * Minimum token length that triggers entropy analysis.
 * Tokens shorter than this are never scrubbed by the entropy path
 * (they are still scrubbed by the pattern path above).
 */
const ENTROPY_MIN_LENGTH = 33;

/**
 * For pure hex strings (e.g., SHA digests, API keys expressed as hex).
 * Standard git SHAs (40/64-char, all hex) are whitelisted by `isStandardHash`
 * before this threshold is ever evaluated.
 */
const HEX_ENTROPY_THRESHOLD = 4.5;

/**
 * Hard upper threshold for base64-like tokens (A-Za-z0-9+/=_-).
 * Set at 5.1 (matching the original calibration) as a near-theoretical max
 * that reliably catches real random-byte API keys.
 */
const BASE64_HARD_THRESHOLD = 5.1;

/**
 * Soft threshold for base64-like tokens longer than `BASE64_SOFT_MIN_LENGTH`.
 * Kept at 3.7 (original calibration) to catch moderate-entropy API key styles
 * (mixed upper/lower/digit strings common in custom API key formats).
 * URLs and standard hashes are excluded before this path runs, which was the
 * main source of false positives in the original implementation.
 */
const BASE64_SOFT_THRESHOLD = 3.7;
const BASE64_SOFT_MIN_LENGTH = 40;

/**
 * Catch-all for mixed-charset tokens that are neither hex nor base64-like.
 * Raised slightly to 4.9 to avoid catching high-entropy prose substrings
 * that are not secrets. URLs are excluded by `looksLikeUrl()` before this
 * path is reached.
 */
const GENERAL_ENTROPY_THRESHOLD = 4.9;

// ─── Known-secret registry ─────────────────────────────────────────────────

const knownSecrets = new Set<string>();

/**
 * Registers a known secret value so it is always masked, regardless of entropy.
 * Called at startup for every API key and sensitive env-var value loaded from
 * `.getitrc` or the process environment.
 *
 * @param secret - The raw secret string to register. Must be at least 8 chars.
 */
export function registerKnownSecret(secret: string): void {
  if (secret && secret.trim().length >= 8) {
    knownSecrets.add(secret.trim());
  }
}

// ─── Masking session ───────────────────────────────────────────────────────

/**
 * Maintains a per-session mapping from raw secret values to stable placeholder
 * tokens (`[REDACTED_1]`, `[REDACTED_2]`, …).
 *
 * A single session is used for the entire conversation so the LLM receives
 * consistent placeholder tokens across turns, allowing it to reference
 * previously mentioned credentials by placeholder without seeing the real value.
 */
export class MaskingSession {
  private values = new Map<string, string>();

  /**
   * Returns a stable placeholder token for the given secret value,
   * creating one if this is the first time the value has been seen.
   *
   * @param value - The raw secret to mask.
   * @returns A stable `[REDACTED_N]` placeholder string.
   */
  mask(value: string): string {
    const existing = this.values.get(value);
    if (existing) return existing;
    const token = `${MASK_PREFIX}${this.values.size + 1}]`;
    this.values.set(value, token);
    return token;
  }
}

let defaultSession = new MaskingSession();

/**
 * Resets the default masking session, clearing all accumulated placeholder
 * mappings. Call this when starting a completely new conversation so old
 * placeholder IDs don't bleed across sessions.
 */
export function resetDefaultMaskingSession(): void {
  defaultSession = new MaskingSession();
}

/**
 * Returns the current default masking session.
 * Use this to share a session across multiple `scrubText` calls within the
 * same conversation turn.
 */
export function getDefaultMaskingSession(): MaskingSession {
  return defaultSession;
}

// ─── Entropy utilities ─────────────────────────────────────────────────────

/**
 * Computes the Shannon entropy (in bits) of a string.
 * Returns a value in the range [0, log₂(alphabet_size)].
 *
 * @example
 * shannonEntropy('aaaa')   // → 0   (all same character)
 * shannonEntropy('abcd')   // → 2   (4 distinct chars, equally distributed)
 * shannonEntropy('sk-abc...') // → ~4–5 for real API keys
 *
 * @param value - Input string.
 * @returns Shannon entropy in bits per character.
 */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Returns true if the string looks like a URL (http/https/ftp scheme or
 * starts with `www.`). URLs are intentionally excluded from entropy-based
 * scrubbing because they routinely contain high-entropy path segments and
 * query parameters that are not secrets.
 *
 * @param value - Candidate string (already stripped of surrounding punctuation).
 */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^ftp:\/\//i.test(value) || /^www\./i.test(value);
}

/**
 * Returns true if the value is a well-known, non-secret hash format:
 * - 40-char hex  → git SHA-1
 * - 64-char hex  → git SHA-256 / SHA-2
 * - 128-char hex → some extended digest formats
 *
 * These are never treated as secrets even if their entropy is high.
 *
 * @param value - String to test.
 */
function isStandardHash(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})$/i.test(value);
}

/**
 * Returns true if a token looks like a high-entropy secret based on its
 * character set and Shannon entropy score.
 *
 * This is the last line of defence — it is intentionally conservative to
 * minimise false positives on legitimate technical strings. Pattern-based
 * checks (prefix matching) always run first and are far more reliable.
 *
 * @param value - Candidate token (already stripped of surrounding punctuation).
 */
function looksLikeSecretByEntropy(value: string): boolean {
  if (value.length < ENTROPY_MIN_LENGTH) return false;
  if (isStandardHash(value)) return false;
  if (looksLikeUrl(value)) return false;
  // npm / yarn subresource integrity hashes (sha256-… / sha512-…) are not secrets
  if (/^sha(?:256|512)-/i.test(value)) return false;

  const hexLike = /^[a-f0-9]+$/i.test(value);
  const base64Like = /^[A-Za-z0-9+/=_-]+$/.test(value);
  const entropy = shannonEntropy(value);

  if (hexLike) return entropy > HEX_ENTROPY_THRESHOLD;
  if (base64Like) {
    // Hard threshold: near-theoretical max → almost certainly a real secret
    if (entropy > BASE64_HARD_THRESHOLD) return true;
    // Soft threshold: long token with mixed alphanumeric content
    if (
      value.length > BASE64_SOFT_MIN_LENGTH &&
      entropy > BASE64_SOFT_THRESHOLD &&
      /[A-Za-z]/.test(value) &&
      /\d/.test(value)
    ) return true;
    return false;
  }
  return entropy > GENERAL_ENTROPY_THRESHOLD && /[A-Za-z]/.test(value) && /\d/.test(value);
}

// ─── Pattern-based replacement rules ──────────────────────────────────────

/**
 * Prefixes that immediately mark a string as containing a potential secret,
 * triggering the full scrub pipeline. Adding a prefix here is cheap and
 * avoids false-negatives for well-known secret formats.
 */
const SECURITY_PREFIXES = ['sk-', 'ghp_', 'Bearer ', 'github_pat_', 'AWS_', 'AKIA', '-----BEGIN'];

/**
 * Ordered list of `[RegExp, replacer]` pairs used to mask well-known secret
 * formats. Rules are applied in order; earlier rules take precedence.
 *
 * Pattern rules are far more precise than the entropy heuristic and should
 * always be preferred when a known format is in scope.
 *
 * Note: all replacer functions close over `currentSession` which is swapped
 * in `scrubText()` before the replacement loop runs so the correct session
 * is used without needing to pass it through the replacer signature.
 */
const PATTERN_REPLACEMENTS: Array<[RegExp, (match: string, ...groups: string[]) => string]> = [
  // OpenAI / OpenRouter API keys
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, (m) => defaultSession.mask(m)],
  // GitHub personal access tokens (classic)
  [/\b(ghp_[A-Za-z0-9_]{20,})\b/g, (m) => defaultSession.mask(m)],
  // GitHub fine-grained personal access tokens
  [/\b(github_pat_[A-Za-z0-9_]{20,})\b/g, (m) => defaultSession.mask(m)],
  // AWS Access Key IDs
  [/\b(AKIA[0-9A-Z]{16})\b/g, (m) => defaultSession.mask(m)],
  // HTTP Bearer tokens (preserves the "Bearer " prefix for readability)
  [/(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})/g, (_m, prefix, token) => `${prefix}${defaultSession.mask(token)}`],
  // PEM private keys (multi-line)
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, (m) => defaultSession.mask(m)],
];

// ─── Main scrub function ───────────────────────────────────────────────────

/**
 * Scrubs a text string, replacing all detected secrets with stable placeholder
 * tokens from the provided masking session.
 *
 * The function short-circuits early if the text is too short to contain a
 * secret (< 32 chars) or if it contains no substrings that could be secrets
 * (no known prefixes, no long non-whitespace runs, no registered secrets).
 * This makes it safe to call on every token in a streaming response with
 * negligible overhead.
 *
 * @param text    - Input text to scrub.
 * @param session - Masking session to use (defaults to the global session).
 * @returns The scrubbed text with all detected secrets replaced.
 */
export function scrubText(text: string, session: MaskingSession = defaultSession): string {
  if (!text || text.length < 32) return text;

  // ── Fast-path: skip entirely if no suspicious content ──────────────────
  let hasPotentialSecret = false;

  for (const prefix of SECURITY_PREFIXES) {
    if (text.includes(prefix)) { hasPotentialSecret = true; break; }
  }

  if (!hasPotentialSecret && /\S{33,}/.test(text)) {
    hasPotentialSecret = true;
  }

  if (!hasPotentialSecret) {
    for (const secret of knownSecrets) {
      if (text.includes(secret)) { hasPotentialSecret = true; break; }
    }
    if (!hasPotentialSecret) return text;
  }

  let scrubbed = text;

  // ── Step 1: Exact-match registered secrets (highest priority) ──────────
  for (const secret of knownSecrets) {
    if (scrubbed.includes(secret)) {
      const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      scrubbed = scrubbed.replace(regex, (m) => session.mask(m));
    }
  }

  // ── Step 2: Pattern-based masking ──────────────────────────────────────
  // Temporarily rebind defaultSession for session-aware replacers
  const savedSession = defaultSession;
  // @ts-ignore — intentionally rebinding module-level let for this call scope
  defaultSession = session;
  for (const [regex, replace] of PATTERN_REPLACEMENTS) {
    scrubbed = scrubbed.replace(regex, replace as any);
  }
  // @ts-ignore
  defaultSession = savedSession;

  // ── Step 3: Entropy-based masking (last resort) ─────────────────────────
  scrubbed = scrubbed.replace(/\S{33,}/g, (candidate) => {
    const trimmed = candidate.replace(/^[`"'({[]+|[`"')}\],.;:]+$/g, '');
    if (!trimmed || !looksLikeSecretByEntropy(trimmed)) return candidate;
    return candidate.replace(trimmed, session.mask(trimmed));
  });

  return scrubbed;
}

// ─── Streaming scrubber ────────────────────────────────────────────────────

/**
 * Stateful streaming wrapper around `scrubText` for real-time token streams.
 *
 * LLM APIs deliver responses as a stream of small string tokens. Because a
 * secret can be split across multiple tokens, naïvely scrubbing each token
 * independently would miss multi-token secrets.
 *
 * `StreamScrubber` solves this by accumulating tokens in an internal buffer
 * and flushing complete "words" (whitespace-delimited) only after a word
 * boundary is seen. This ensures every candidate token is evaluated as a
 * complete unit before being passed to the terminal.
 *
 * @example
 * const scrubber = new StreamScrubber();
 * for await (const token of llmStream) {
 *   process.stdout.write(scrubber.push(token));
 * }
 * process.stdout.write(scrubber.flush()); // emit any remaining buffered content
 */
export class StreamScrubber {
  private buffer = '';
  private session: MaskingSession;

  /**
   * @param session - Masking session shared with the surrounding conversation
   *                  turn. Passing the same session as `scrubText` ensures
   *                  placeholder IDs are consistent within a turn.
   */
  constructor(session: MaskingSession = defaultSession) {
    this.session = session;
  }

  /**
   * Accepts the next token from the LLM stream and returns any bytes that are
   * now safe to emit to the terminal.
   *
   * Returns an empty string while buffering a word that has not yet reached a
   * whitespace boundary.
   *
   * @param token - Next raw token string from the LLM stream.
   * @returns Scrubbed bytes ready to write to stdout (may be empty string).
   */
  push(token: string): string {
    this.buffer += token;

    const boundaryMatch = this.buffer.match(/[\s\n](?=[^\s\n]*$)/);

    if (boundaryMatch && boundaryMatch.index !== undefined) {
      const boundaryIdx = boundaryMatch.index + 1;
      const chunkToFlush = this.buffer.substring(0, boundaryIdx);
      this.buffer = this.buffer.substring(boundaryIdx);
      return scrubText(chunkToFlush, this.session);
    }

    // Safety valve: prevent the buffer from growing unboundedly
    if (this.buffer.length > 200) {
      const chunkToFlush = this.buffer.substring(0, this.buffer.length - 100);
      this.buffer = this.buffer.substring(this.buffer.length - 100);
      return scrubText(chunkToFlush, this.session);
    }

    return '';
  }

  /**
   * Flushes all remaining buffered content through the scrubber and resets
   * the internal buffer. Must be called after the stream ends to avoid
   * truncating the final word.
   *
   * @returns Scrubbed bytes from the final buffered chunk.
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return scrubText(remaining, this.session);
  }
}
