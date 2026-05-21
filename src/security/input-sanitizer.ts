export interface SanitizationResult {
  isSafe: boolean;
  warnings: string[];
}

export function sanitizeBashCommand(command: string): SanitizationResult {
  const warnings: string[] = [];

  // Check for shell chaining / cascades
  if (command.includes('&&')) {
    warnings.push('Contains logical AND chain ("&&")');
  }
  if (command.includes('||')) {
    warnings.push('Contains logical OR chain ("||")');
  }
  
  // Look for semicolon command separation (avoiding standard escaped semicolons or inside quotes if simple, but let's be strict/safe)
  // A standard semicolon not preceded by a backslash
  if (/(?<!\\);/.test(command)) {
    warnings.push('Contains statement separator (";")');
  }

  // Look for subshells and backticks
  if (command.includes('`')) {
    warnings.push('Contains backtick evaluation ("`")');
  }
  if (/\$\(.*\)/.test(command)) {
    warnings.push('Contains subshell expansion ("$(...)")');
  }

  // Check for piping or redirection that could write to system files
  if (/>>/.test(command)) {
    warnings.push('Contains append redirect (">>")');
  } else if (/(?<!2)>(?!&)/.test(command)) {
    // Avoid marking "2>&1" as redirecting output to a file, but mark standard stdout redirect
    warnings.push('Contains output redirect (">")');
  }

  if (command.includes('|') && !command.includes('||') && !command.includes('2>&1')) {
    warnings.push('Contains pipe operator ("|")');
  }

  // Check for backgrounding
  if (/(?<!&)&(?!&)/.test(command)) {
    warnings.push('Contains background operator ("&")');
  }

  // Check for hazardous command heuristics
  if (/\b(rm\s+-rf|dd|mkfs|fdisk|chmod\s+-R\s+777)\b/i.test(command)) {
    warnings.push('Contains potentially hazardous command pattern (e.g., rm -rf, dd)');
  }

  return {
    isSafe: warnings.length === 0,
    warnings
  };
}
