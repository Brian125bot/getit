import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getRuntimeSession } from '../runtime/session.js';
import { scrubText } from '../security/scrubber.js';
import { getCenterPadding, centerPrompt, centerLine, centerBlock, getBoxChars, stripAnsi } from '../ui/layout.js';

let rlInstance: readline.Interface | null = null;
let mockRlInstance: readline.Interface | null = null;

export function setReadlineInterface(rl: readline.Interface | null): void {
  mockRlInstance = rl;
}

export function getReadlineInterface(): readline.Interface {
  if (mockRlInstance) return mockRlInstance;
  if (!rlInstance) {
    rlInstance = readline.createInterface({ input, output });
  }
  return rlInstance;
}

export function closeReadlineInterface(): void {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

export interface InterceptionResult {
  approved: boolean;
  payload: string;
  reason?: string;
  clarifyRequest?: string;
}

/**
 * Slices a string by visible width without breaking ANSI sequences
 */
function sliceVisible(text: string, maxLength: number): { chunk: string; remaining: string } {
  let visibleCount = 0;
  let i = 0;
  let inEscape = false;

  while (i < text.length && visibleCount < maxLength) {
    if (text[i] === '\x1b') {
      inEscape = true;
    }
    if (!inEscape) {
      visibleCount++;
    }
    if (inEscape && (text[i] === 'm' || (text[i] >= 'A' && text[i] <= 'Z' && text[i] !== 'O' && text[i] !== 'R'))) {
      inEscape = false;
    }
    i++;
  }
  // Ensure we don't end in the middle of an escape sequence
  while (inEscape && i < text.length) {
    if (text[i] === 'm' || (text[i] >= 'A' && text[i] <= 'Z' && text[i] !== 'O' && text[i] !== 'R')) {
      inEscape = false;
    }
    i++;
  }

  return { chunk: text.slice(0, i), remaining: text.slice(i) };
}

export async function interceptToolCall(
  context: 'BASH' | 'FILE CREATE' | 'FILE PATCH',
  payload: string,
  warnings: string[] = [],
  editPayload?: string
): Promise<InterceptionResult> {
  // If running in automated test suite mode, auto-approve to avoid blocking stdin
  if (process.env.GETIT_TEST_MODE === 'true') {
    return { approved: true, payload };
  }

  const session = getRuntimeSession();
  if (session.suppressMitl) {
    return { approved: true, payload };
  }
  if (session.processActive) {
    return { approved: false, payload, reason: 'Cannot prompt for approval while a child process is actively streaming.' };
  }
  session.mitlActive = true;

  const rl = getReadlineInterface();

  try {
    // Clear previous terminal block / draw some spacing
    console.log('\n');

    const displayPayload = scrubText(payload, session.maskingSession);
    const lines = displayPayload.split('\n');
    const box = getBoxChars();

    // Calculate card width based on content, constrained by terminal size
    const payloadWidth = Math.max(context.length + 8, ...lines.map(l => stripAnsi(l).length)) + 4;
    const cardWidth = Math.min(80, Math.max(40, payloadWidth));
    const padding = ' '.repeat(getCenterPadding(cardWidth));

    const horizontalLine = box.h.repeat(cardWidth - 2);

    // RENDER CARD HEADER
    // ANSI Colors: Yellow (\x1b[33m) for warnings/attention boxes
    console.log(`${padding}\x1b[33m${box.tl}${horizontalLine}${box.tr}\x1b[0m`);
    const headerText = `  ${context}  `;
    const headerPadding = ' '.repeat(Math.max(0, cardWidth - 2 - headerText.length));
    console.log(`${padding}\x1b[33m${box.v}\x1b[1;37m${headerText}\x1b[0m\x1b[33m${headerPadding}${box.v}\x1b[0m`);
    console.log(`${padding}\x1b[33m${box.ml}${horizontalLine}${box.mr}\x1b[0m`);

    // RENDER PAYLOAD
    for (const line of lines) {
      let currentLine = line;
      if (line.length === 0) {
          const rightPadding = ' '.repeat(cardWidth - 4);
          console.log(`${padding}\x1b[33m${box.v}\x1b[0m  ${rightPadding}  \x1b[33m${box.v}\x1b[0m`);
          continue;
      }
      while (currentLine.length > 0) {
        const { chunk, remaining } = sliceVisible(currentLine, cardWidth - 6);
        currentLine = remaining;
        const rightPadding = ' '.repeat(Math.max(0, cardWidth - 6 - stripAnsi(chunk).length));
        // Use Green (\x1b[32m) for safe/executable content
        console.log(`${padding}\x1b[33m${box.v}\x1b[0m  \x1b[32m${chunk}\x1b[0m${rightPadding}  \x1b[33m${box.v}\x1b[0m`);
      }
    }

    // RENDER WARNINGS SECTION
    if (warnings.length > 0) {
      console.log(`${padding}\x1b[33m${box.ml}${horizontalLine}${box.mr}\x1b[0m`);
      console.log(`${padding}\x1b[33m${box.v}\x1b[1;31m  ⚠ SECURITY WARNINGS:\x1b[0m\x1b[33m${' '.repeat(Math.max(0, cardWidth - 23))}${box.v}\x1b[0m`);
      for (const warning of warnings) {
        const formattedWarning = `  - ${warning}`;
        const { chunk } = sliceVisible(formattedWarning, cardWidth - 6); // Simple wrap for warnings too
        const rightPadding = ' '.repeat(Math.max(0, cardWidth - 6 - stripAnsi(chunk).length));
        console.log(`${padding}\x1b[33m${box.v}\x1b[0m  \x1b[31m${chunk}\x1b[0m${rightPadding}  \x1b[33m${box.v}\x1b[0m`);
      }
    }

    // RENDER CARD FOOTER
    console.log(`${padding}\x1b[33m${box.bl}${horizontalLine}${box.br}\x1b[0m`);

    // PROMPT USER
    while (true) {
      // Use Cyan (\x1b[1;36m) for primary prompts
      const questionPrompt = centerPrompt('\x1b[1;36mApprove command? [Y/n/e/c] ❯ \x1b[0m');
      const answer = await rl.question(questionPrompt);
      const choice = answer.trim().toLowerCase();

      if (choice === 'y' || choice === '') {
        return { approved: true, payload };
      } else if (choice === 'n') {
        return { approved: false, payload, reason: 'Execution denied by user.' };
      } else if (choice === 'e') {
        console.log('\n' + centerLine('\x1b[1;33m--- EDIT MODE ---\x1b[0m', 17));
        if (editPayload !== undefined) {
          console.log(centerLine('\x1b[2m(Original content shown below for reference)\x1b[0m', 44));
          console.log(centerBlock(editPayload));
          console.log('');
        }
        const editPrompt = centerPrompt('\x1b[1;36mEnter modified payload ❯ \x1b[0m');
        const targetPayload = editPayload !== undefined ? editPayload : payload;
        
        const questionPromise = rl.question(editPrompt);
        rl.write(targetPayload);
        const editedPayload = await questionPromise;
        
        return { approved: true, payload: editedPayload };
      } else if (choice === 'c') {
        console.log('\n' + centerLine('\x1b[1;33m--- CLARIFY MODE ---\x1b[0m', 20));
        const clarifyPrompt = centerPrompt('\x1b[1;36mQuestion for Agent ❯ \x1b[0m');
        const question = await rl.question(clarifyPrompt);
        return { approved: false, payload, clarifyRequest: `User paused execution to ask: ${question}` };
      } else {
        console.log(centerLine('\x1b[1;31mInvalid input. Please enter "y", "n", "e", or "c".\x1b[0m', 47));
      }
    }
  } finally {
    session.mitlActive = false;
  }
}
