import { LogLevel, setLogExtension, setLogLevel } from '../../src';
import type { Config, LibraryLogRecord } from './types';

/**
 * Applies `?loglevel=` and records what the library logs at it.
 *
 * Both halves belong together. `setLogExtension` is the library's own sink for its internal
 * records, so it answers "what did the *library* log" by origin — the console cannot, because
 * loglevel binds `console.error` directly and the line it writes carries no logger name, which
 * makes it indistinguishable from one livekit-client or the harness wrote.
 *
 * Only installed when the parameter is present: a log extension costs the browser console its
 * stack traces (see the note on `setLogExtension` in src/logger.ts), and no other spec should
 * pay that.
 */

const MAX_RECORDS = 500;

const records: LibraryLogRecord[] = [];

export function installLogCapture(config: Config) {
  if (!config.logLevel) return;

  // Extension first, then the level: `setLogExtension` rebuilds each logger's methods at its
  // current level, and `setLogLevel` rebuilds them again at the requested one, so either order
  // works — but this way the very first record the requested level permits is already captured.
  setLogExtension((level, msg) => {
    records.push({ level, levelName: LogLevel[level] ?? String(level), msg: String(msg) });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  });

  setLogLevel(config.logLevel);
}

export function libraryLogRecords(): LibraryLogRecord[] {
  return [...records];
}

export function clearLibraryLogRecords() {
  records.length = 0;
}
