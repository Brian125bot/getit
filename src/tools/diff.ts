export function generateDiffPreview(original: string, modified: string): string {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);

  // Compute Longest Common Subsequence (LCS) on line arrays
  const n = origLines.length;
  const m = modLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build the unified diff sequence
  let i = n;
  let j = m;
  const diffItems: { type: 'common' | 'removed' | 'added'; line: string }[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      diffItems.push({ type: 'common', line: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffItems.push({ type: 'added', line: modLines[j - 1] });
      j--;
    } else {
      diffItems.push({ type: 'removed', line: origLines[i - 1] });
      i--;
    }
  }

  diffItems.reverse();

  // Format with standard ANSI color syntax as per spec
  const formatted: string[] = [];
  for (const item of diffItems) {
    if (item.type === 'removed') {
      // Red removal formatting: \x1b[31m- <line>\x1b[0m
      formatted.push(`\x1b[31m- ${item.line}\x1b[0m`);
    } else if (item.type === 'added') {
      // Green insertion formatting: \x1b[32m+ <line>\x1b[0m
      formatted.push(`\x1b[32m+ ${item.line}\x1b[0m`);
    } else {
      // Common line formatting (no ANSI syntax)
      formatted.push(`  ${item.line}`);
    }
  }

  return formatted.join('\n');
}
