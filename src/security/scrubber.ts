const MASK_PREFIX = '[REDACTED_';

const knownSecrets = new Set<string>();

export function registerKnownSecret(secret: string): void {
  if (secret && secret.trim().length >= 8) {
    knownSecrets.add(secret.trim());
  }
}

export class MaskingSession {
  private values = new Map<string, string>();

  mask(value: string): string {
    const existing = this.values.get(value);
    if (existing) return existing;
    const token = `${MASK_PREFIX}${this.values.size + 1}]`;
    this.values.set(value, token);
    return token;
  }
}

let defaultSession = new MaskingSession();

export function resetDefaultMaskingSession(): void {
  defaultSession = new MaskingSession();
}

export function getDefaultMaskingSession(): MaskingSession {
  return defaultSession;
}

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

function isStandardHash(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})$/i.test(value);
}

function looksLikeSecretByEntropy(value: string): boolean {
  if (value.length <= 32) return false;
  if (isStandardHash(value)) return false;

  const hexLike = /^[a-f0-9]+$/i.test(value);
  const base64Like = /^[A-Za-z0-9+/=_-]+$/.test(value);
  const entropy = shannonEntropy(value);

  if (hexLike) return entropy > 4.5;
  if (base64Like) {
    return entropy > 5.1 || (value.length > 40 && entropy > 3.7 && /[A-Za-z]/.test(value) && /\d/.test(value));
  }
  return entropy > 4.8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

const SECURITY_PREFIXES = ['sk-', 'ghp_', 'Bearer ', 'github_pat_', 'AWS_', '-----BEGIN'];

export function scrubText(text: string, session: MaskingSession = defaultSession): string {
  if (!text || text.length < 32) return text;

  let hasPotentialSecret = false;

  // Keyword check
  for (const prefix of SECURITY_PREFIXES) {
    if (text.includes(prefix)) {
      hasPotentialSecret = true;
      break;
    }
  }

  // Entropy check (only if text is long enough to contain high-entropy secrets)
  if (!hasPotentialSecret) {
    if (/\S{33,}/.test(text)) {
      hasPotentialSecret = true;
    }
  }

  if (!hasPotentialSecret) {
    let hasKnown = false;
    for (const secret of knownSecrets) {
      if (text.includes(secret)) {
        hasKnown = true;
        break;
      }
    }
    if (!hasKnown) return text;
  }

  let scrubbed = text;

  // Mask exact registered secrets first to avoid partial replacements by other rules
  for (const secret of knownSecrets) {
    if (scrubbed.includes(secret)) {
      const escaped = secret.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      scrubbed = scrubbed.replace(regex, (m) => session.mask(m));
    }
  }

  const replacements: Array<[RegExp, (match: string, ...groups: string[]) => string]> = [
    [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, (m) => session.mask(m)],
    [/\b(ghp_[A-Za-z0-9_]{20,})\b/g, (m) => session.mask(m)],
    [/\b(github_pat_[A-Za-z0-9_]{20,})\b/g, (m) => session.mask(m)],
    [/\b(AKIA[0-9A-Z]{16})\b/g, (m) => session.mask(m)],
    [/(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})/g, (_m, prefix, token) => `${prefix}${session.mask(token)}`],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, (m) => session.mask(m)]
  ];

  for (const [regex, replace] of replacements) {
    scrubbed = scrubbed.replace(regex, replace as any);
  }

  scrubbed = scrubbed.replace(/\S{33,}/g, (candidate) => {
    const trimmed = candidate.replace(/^[`"'({[]+|[`"')}\],.;:]+$/g, '');
    if (!trimmed || !looksLikeSecretByEntropy(trimmed)) return candidate;
    return candidate.replace(trimmed, session.mask(trimmed));
  });

  return scrubbed;
}

export class StreamScrubber {
  private buffer = '';
  private session: MaskingSession;

  constructor(session: MaskingSession = defaultSession) {
    this.session = session;
  }

  push(token: string): string {
    this.buffer += token;
    
    const boundaryMatch = this.buffer.match(/[\s\n](?=[^\s\n]*$)/);
    
    if (boundaryMatch && boundaryMatch.index !== undefined) {
      const boundaryIdx = boundaryMatch.index + 1;
      const chunkToFlush = this.buffer.substring(0, boundaryIdx);
      this.buffer = this.buffer.substring(boundaryIdx);
      return scrubText(chunkToFlush, this.session);
    }
    
    if (this.buffer.length > 200) {
       const chunkToFlush = this.buffer.substring(0, this.buffer.length - 100);
       this.buffer = this.buffer.substring(this.buffer.length - 100);
       return scrubText(chunkToFlush, this.session);
    }

    return '';
  }

  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return scrubText(remaining, this.session);
  }
}

