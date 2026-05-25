/**
 * @module watcher/notifications
 * @description Terminal notification system for watch mode events.
 *
 * Renders non-intrusive ANSI notifications in the terminal when watch
 * events fire, without interrupting the active REPL prompt.
 */
import { stripAnsi } from '../ui/layout.js';

export interface Notification {
  level: 'info' | 'warn' | 'error' | 'success';
  title: string;
  body: string;
  timestamp: number;
}

const NOTIFICATION_HISTORY: Notification[] = [];
const MAX_HISTORY = 50;

/**
 * Add a notification to history.
 */
export function addNotification(notification: Notification): void {
  NOTIFICATION_HISTORY.push(notification);
  if (NOTIFICATION_HISTORY.length > MAX_HISTORY) {
    NOTIFICATION_HISTORY.shift();
  }
}

/**
 * Get recent notifications.
 */
export function getNotifications(count: number = 10): Notification[] {
  return NOTIFICATION_HISTORY.slice(-count);
}

/**
 * Clear all notifications.
 */
export function clearNotifications(): void {
  NOTIFICATION_HISTORY.length = 0;
}

/**
 * Render a notification string for terminal output.
 * Uses subtle formatting to avoid disrupting the REPL.
 */
export function renderNotification(notification: Notification): string {
  const time = new Date(notification.timestamp).toLocaleTimeString();
  let color: string;
  let icon: string;

  switch (notification.level) {
    case 'success': color = '\x1b[32m'; icon = '✓'; break;
    case 'warn':    color = '\x1b[33m'; icon = '⚠'; break;
    case 'error':   color = '\x1b[31m'; icon = '✗'; break;
    default:        color = '\x1b[36m'; icon = 'ℹ'; break;
  }

  return `\r${color}${icon} [${time}] ${notification.title}\x1b[0m: ${notification.body}`;
}

/**
 * Render the notification history as an ANSI card.
 */
export function renderNotificationHistory(): string {
  if (NOTIFICATION_HISTORY.length === 0) {
    return '\x1b[2m  No notifications.\x1b[0m';
  }

  const lines: string[] = [
    '\x1b[1;36m┌── Watch Notifications ──────────────────────────────────┐\x1b[0m'
  ];

  for (const n of NOTIFICATION_HISTORY.slice(-10)) {
    const time = new Date(n.timestamp).toLocaleTimeString();
    let icon: string;
    switch (n.level) {
      case 'success': icon = '\x1b[32m✓\x1b[0m'; break;
      case 'warn':    icon = '\x1b[33m⚠\x1b[0m'; break;
      case 'error':   icon = '\x1b[31m✗\x1b[0m'; break;
      default:        icon = '\x1b[36mℹ\x1b[0m'; break;
    }
    lines.push(`\x1b[1;36m│\x1b[0m ${icon} ${time} ${n.title}: ${n.body}`);
  }

  lines.push('\x1b[1;36m└────────────────────────────────────────────────────────┘\x1b[0m');
  return lines.join('\n');
}
