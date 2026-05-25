/**
 * @module ui/panes
 * @description Pane management for the rich terminal dashboard.
 *
 * Each pane is a named rectangular region of the terminal that renders
 * independently. Panes can be toggled, resized, and arranged.
 */
import { stripAnsi } from './layout.js';

export type PaneName = 'session' | 'watch' | 'plugins' | 'memory' | 'actions' | 'recipes';

export interface Pane {
  name: PaneName;
  title: string;
  visible: boolean;
  priority: number;
  render: () => string[];
}

export interface PaneLayout {
  panes: Pane[];
  maxWidth: number;
  maxHeight: number;
}

/**
 * Create a default pane layout.
 */
export function createDefaultLayout(): PaneLayout {
  return {
    panes: [
      { name: 'session', title: 'Session', visible: true, priority: 1, render: () => ['No active session.'] },
      { name: 'watch', title: 'Watch', visible: false, priority: 2, render: () => ['Watch mode inactive.'] },
      { name: 'plugins', title: 'Plugins', visible: false, priority: 3, render: () => ['No plugins loaded.'] },
      { name: 'memory', title: 'Memory', visible: false, priority: 4, render: () => ['No memory entries.'] },
      { name: 'actions', title: 'Recent Actions', visible: true, priority: 5, render: () => ['No recent actions.'] },
      { name: 'recipes', title: 'Recipes', visible: false, priority: 6, render: () => ['No recipes available.'] }
    ],
    maxWidth: process.stdout.columns || 80,
    maxHeight: process.stdout.rows || 24
  };
}

/**
 * Toggle a pane's visibility.
 */
export function togglePane(layout: PaneLayout, name: PaneName): void {
  const pane = layout.panes.find(p => p.name === name);
  if (pane) pane.visible = !pane.visible;
}

/**
 * Set a pane's render function.
 */
export function setPaneRenderer(layout: PaneLayout, name: PaneName, render: () => string[]): void {
  const pane = layout.panes.find(p => p.name === name);
  if (pane) pane.render = render;
}

/**
 * Render the visible panes as a combined ANSI string.
 */
export function renderLayout(layout: PaneLayout): string {
  const visiblePanes = layout.panes
    .filter(p => p.visible)
    .sort((a, b) => a.priority - b.priority);

  if (visiblePanes.length === 0) return '';

  const width = Math.min(layout.maxWidth, 60);
  const h = '─'.repeat(width - 2);
  const lines: string[] = [];

  for (const pane of visiblePanes) {
    // Pane header
    const titlePad = ' '.repeat(Math.max(0, width - 4 - pane.title.length));
    lines.push(`\x1b[1;36m┌─ ${pane.title} ${titlePad}─┐\x1b[0m`);

    // Pane content
    const content = pane.render();
    for (const line of content.slice(0, 10)) { // Max 10 lines per pane
      const visible = stripAnsi(line).length;
      const padding = ' '.repeat(Math.max(0, width - 4 - visible));
      lines.push(`\x1b[1;36m│\x1b[0m ${line}${padding} \x1b[1;36m│\x1b[0m`);
    }

    lines.push(`\x1b[1;36m└${h}┘\x1b[0m`);
  }

  return lines.join('\n');
}
