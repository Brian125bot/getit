import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getRuntimeSession } from '../runtime/session.js';
import { scrubText } from '../security/scrubber.js';
import { getCenterPadding, centerPrompt, centerLine, centerBlock } from '../ui/layout.js';

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
  const payloadWidth = Math.max(context.length + 8, ...lines.map(l => l.length)) + 4;
  const cardWidth = Math.min(80, Math.max(40, payloadWidth));
  const padding = ' '.repeat(getCenterPadding(cardWidth));

  const horizontalLine = '─'.repeat(cardWidth - 2);
  
  // RENDER CARD HEADER
  // ANSI Colors: Yellow/Orange for header context
  console.log(`${padding}\x1b[1;33m┌${horizontalLine}┐\x1b[0m`);
  const headerText = `  ${context}  `;
  const headerPadding = ' '.repeat(Math.max(0, cardWidth - 2 - headerText.length));
  console.log(`${padding}\x1b[1;33m│\x1b[1;37m${headerText}\x1b[1;33m${headerPadding}│\x1b[0m`);
  console.log(`${padding}\x1b[1;33m├${horizontalLine}┤\x1b[0m`);

  // RENDER PAYLOAD
  for (const line of lines) {
    let currentLine = line;
    while (currentLine.length > 0 || line.length === 0) {
      const chunk = currentLine.slice(0, cardWidth - 6);
      currentLine = currentLine.slice(cardWidth - 6);
      const rightPadding = ' '.repeat(Math.max(0, cardWidth - 6 - chunk.length));
      console.log(`${padding}\x1b[1;33m│\x1b[0m  \x1b[1;32m${chunk}\x1b[0m  ${rightPadding}\x1b[1;33m│\x1b[0m`);
      if (line.length === 0) break;
    }
  }

  // RENDER WARNINGS SECTION
  if (warnings.length > 0) {
    console.log(`${padding}\x1b[1;33m├${horizontalLine}┤\x1b[0m`);
    console.log(`${padding}\x1b[1;33m│\x1b[1;31m  ⚠ SECURITY WARNINGS:\x1b[1;33m${' '.repeat(Math.max(0, cardWidth - 23))}│\x1b[0m`);
    for (const warning of warnings) {
      const formattedWarning = `  - ${warning}`;
      const rightPadding = ' '.repeat(Math.max(0, cardWidth - 6 - formattedWarning.length));
      console.log(`${padding}\x1b[1;33m│\x1b[0m  \x1b[31m${formattedWarning}\x1b[0m${rightPadding}  \x1b[1;33m│\x1b[0m`);
    }
  }

  // RENDER CARD FOOTER
  console.log(`${padding}\x1b[1;33m└${horizontalLine}┘\x1b[0m`);

  // PROMPT USER
  while (true) {
    const questionPrompt = centerPrompt('\x1b[1;36mApprove command? [Y/n/e] ❯ \x1b[0m');
    const answer = await rl.question(questionPrompt);
    const choice = answer.trim().toLowerCase();

    if (choice === 'y' || choice === '') {
      return { approved: true, payload };
    } else if (choice === 'n') {
      return { approved: false, payload, reason: 'Execution denied by user.' };
    } else if (choice === 'e') {
      if (editPayload !== undefined) {
        console.log('\n' + centerLine('\x1b[1;33mOriginal full content to edit (copy and modify):\x1b[0m', 48));
        console.log(centerBlock(editPayload));
        console.log('');
      }
      const editPrompt = centerPrompt('\x1b[1;36mEnter modified payload ❯ \x1b[0m');
      const editedPayload = await rl.question(editPrompt);
      return { approved: true, payload: editedPayload };
    } else {
      console.log(centerLine('\x1b[1;31mInvalid input. Please enter "y", "n", or "e".\x1b[0m', 42));
    }
  }
  } finally {
    session.mitlActive = false;
  }
}
