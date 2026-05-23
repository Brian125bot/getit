import { execSync } from 'node:child_process';
import { getTrackingRoot } from './tracking.js';
import { stripAnsi, centerBlock, getBoxChars, getTerminalWidth } from '../ui/layout.js';

export interface CommitRecord {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export class WorkspaceHistoryManager {
  /**
   * Retrieves Git commit logs from the shadow tracking repository.
   */
  static async getHistory(): Promise<CommitRecord[]> {
    const trackingRoot = await getTrackingRoot();
    try {
      const output = execSync('git log --pretty=format:"%H||__DELIM__||%an||__DELIM__||%ad||__DELIM__||%s" --date=short', {
        cwd: trackingRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      if (!output.trim()) return [];
      return output.trim().split('\n').map(line => {
        const parts = line.split('||__DELIM__||');
        return {
          hash: parts[0] || '',
          author: parts[1] || '',
          date: parts[2] || '',
          message: parts[3] || ''
        };
      });
    } catch {
      // Return empty if repo is brand new or git command fails
      return [];
    }
  }

  /**
   * Renders the history records into a beautiful adaptive card centered horizontally.
   */
  static renderHistory(commits: CommitRecord[]): string {
    const termWidth = getTerminalWidth();
    const box = getBoxChars(termWidth, true);
    // Base width 58, but shrink if terminal is narrow
    const width = Math.min(termWidth - 2, 58);

    const top = `\x1b[1;36m${box.tl}${box.h.repeat(width - 2)}${box.tr}\x1b[0m`;
    const mid = `\x1b[1;36m${box.ml}${box.mh.repeat(width - 2)}${box.mr}\x1b[0m`;
    const bot = `\x1b[1;36m${box.bl}${box.h.repeat(width - 2)}${box.br}\x1b[0m`;

    const padCenter = (text: string, w: number): string => {
      const visible = stripAnsi(text).length;
      const padding = Math.floor((w - visible) / 2);
      const left = ' '.repeat(Math.max(0, padding));
      const right = ' '.repeat(Math.max(0, w - visible - padding));
      return left + text + right;
    };

    const title = `\x1b[1;36m${box.v}\x1b[1;33m${padCenter('🕒 WORKSPACE SHADOW HISTORY', width - 2)}\x1b[1;36m${box.v}\x1b[0m`;

    if (commits.length === 0) {
      const emptyMsg = `\x1b[1;30mNo shadow history found.\x1b[0m`;
      const padRight = Math.max(0, (width - 6) - stripAnsi(emptyMsg).length);
      const line = `\x1b[1;36m${box.v}\x1b[0m  ${emptyMsg}${' '.repeat(padRight)}  \x1b[1;36m${box.v}\x1b[0m`;
      return [top, title, mid, line, bot].join('\n');
    }

    const lines: string[] = [];
    const maxLen = width - 6;

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const shortHash = commit.hash.substring(0, 7);
      
      // Line 1: [hash] date • author
      const metaText = `\x1b[1;33m[${shortHash}]\x1b[0m \x1b[1;37m${commit.date}\x1b[0m • \x1b[32m${commit.author}\x1b[0m`;
      const metaVisible = stripAnsi(metaText).length;
      const metaPad = Math.max(0, maxLen - metaVisible);
      lines.push(`\x1b[1;36m${box.v}\x1b[0m  ${metaText}${' '.repeat(metaPad)}  \x1b[1;36m${box.v}\x1b[0m`);

      // Line 2: Message (wrapped if too long)
      let msg = commit.message;
      while (msg.length > 0) {
        let chunk = msg.substring(0, maxLen);
        if (msg.length > maxLen) {
          const lastSpace = chunk.lastIndexOf(' ');
          if (lastSpace > 10) {
            chunk = chunk.substring(0, lastSpace);
          }
        }
        msg = msg.substring(chunk.length).trim();

        const visibleLength = stripAnsi(chunk).length;
        const msgPad = Math.max(0, maxLen - visibleLength);
        lines.push(`\x1b[1;36m${box.v}\x1b[0m  \x1b[37m${chunk}\x1b[0m${' '.repeat(msgPad)}  \x1b[1;36m${box.v}\x1b[0m`);
      }

      // Add a divider or empty space between commits
      if (i < commits.length - 1) {
        lines.push(`\x1b[1;36m${box.v}\x1b[0m  ${' '.repeat(maxLen)}  \x1b[1;36m${box.v}\x1b[0m`);
      }
    }

    const card = [top, title, mid, ...lines, bot].join('\n');
    return centerBlock(card, termWidth);
  }
}
