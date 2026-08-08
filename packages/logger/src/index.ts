// ──────────────────────────────────────────────
// @x402/logger — Structured logging
// ──────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.timestamp}]`, entry.level.toUpperCase().padEnd(5)];
  if (entry.traceId) {
    parts.push(`[trace=${entry.traceId}]`);
  }
  parts.push(entry.message);
  if (entry.context && Object.keys(entry.context).length > 0) {
    parts.push(JSON.stringify(entry.context));
  }
  return parts.join(' ');
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
  const formatted = formatEntry(entry);
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
};

/** Create a child logger with a trace ID for request tracing */
export function createTraceLogger(traceId: string) {
  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      log('debug', message, { ...context, traceId }),
    info: (message: string, context?: Record<string, unknown>) =>
      log('info', message, { ...context, traceId }),
    warn: (message: string, context?: Record<string, unknown>) =>
      log('warn', message, { ...context, traceId }),
    error: (message: string, context?: Record<string, unknown>) =>
      log('error', message, { ...context, traceId }),
  };
}
