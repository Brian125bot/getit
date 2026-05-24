/**
 * @module ui/terminalkit/themes/builtin/default
 * @description Default color theme for the getit terminal UI.
 */
import { FG, BG, SGR } from '../../ansi.js';

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    muted: string;
    text: string;
    textDim: string;
    border: string;
    headerBg: string;
    headerFg: string;
  };
  styles: {
    heading: string;
    subheading: string;
    label: string;
    value: string;
    code: string;
    link: string;
  };
}

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: FG.cyan,
    secondary: FG.magenta,
    accent: FG.yellow,
    success: FG.green,
    warning: FG.yellow,
    error: FG.red,
    info: FG.blue,
    muted: FG.brightBlack,
    text: FG.white,
    textDim: `${SGR.dim}${FG.white}`,
    border: FG.cyan,
    headerBg: BG.blue,
    headerFg: `${SGR.bold}${FG.white}`,
  },
  styles: {
    heading: `${SGR.bold}${FG.cyan}`,
    subheading: `${SGR.bold}${FG.white}`,
    label: `${SGR.bold}${FG.white}`,
    value: FG.cyan,
    code: `${SGR.dim}${FG.green}`,
    link: `${SGR.underline}${FG.blue}`,
  }
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: FG.brightCyan,
    secondary: FG.brightMagenta,
    accent: FG.brightYellow,
    success: FG.brightGreen,
    warning: FG.brightYellow,
    error: FG.brightRed,
    info: FG.brightBlue,
    muted: FG.brightBlack,
    text: FG.brightWhite,
    textDim: `${SGR.dim}${FG.brightWhite}`,
    border: FG.brightCyan,
    headerBg: BG.brightBlack,
    headerFg: `${SGR.bold}${FG.brightWhite}`,
  },
  styles: {
    heading: `${SGR.bold}${FG.brightCyan}`,
    subheading: `${SGR.bold}${FG.brightWhite}`,
    label: `${SGR.bold}${FG.brightWhite}`,
    value: FG.brightCyan,
    code: `${SGR.dim}${FG.brightGreen}`,
    link: `${SGR.underline}${FG.brightBlue}`,
  }
};

export const minimalTheme: Theme = {
  name: 'minimal',
  colors: {
    primary: FG.white,
    secondary: FG.white,
    accent: SGR.bold,
    success: FG.green,
    warning: FG.yellow,
    error: FG.red,
    info: FG.white,
    muted: SGR.dim,
    text: FG.white,
    textDim: SGR.dim,
    border: SGR.dim,
    headerBg: '',
    headerFg: SGR.bold,
  },
  styles: {
    heading: SGR.bold,
    subheading: SGR.bold,
    label: SGR.bold,
    value: '',
    code: SGR.dim,
    link: SGR.underline,
  }
};

let activeTheme: Theme = defaultTheme;

export function getActiveTheme(): Theme {
  return activeTheme;
}

export function setActiveTheme(theme: Theme): void {
  activeTheme = theme;
}

export function getThemeByName(name: string): Theme {
  switch (name) {
    case 'dark': return darkTheme;
    case 'minimal': return minimalTheme;
    default: return defaultTheme;
  }
}
