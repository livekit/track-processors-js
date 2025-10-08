import { getLogger as clientGetLogger } from 'livekit-client';

export enum LogLevel {
  trace = 0,
  debug = 1,
  info = 2,
  warn = 3,
  error = 4,
  silent = 5,
}

export enum LoggerNames {
  ProcessorWrapper = 'livekit-processor-wrapper',
  BackgroundProcessor = 'livekit-background-processor',
  WebGl = 'livekit-track-processor-web-gl',
}

type LogLevelString = keyof typeof LogLevel;

export type StructuredLogger = ReturnType<typeof clientGetLogger>;

let livekitLogger = getLogger('livekit');
const livekitLoggers = Object.values(LoggerNames).map((name) => getLogger(name));

livekitLogger.setDefaultLevel(LogLevel.info);

export default livekitLogger as StructuredLogger;

/**
 * @internal
 */
export function getLogger(name: string) {
  return clientGetLogger(name);
}

export function setLogLevel(level: LogLevel | LogLevelString, loggerName?: LoggerNames) {
  if (loggerName) {
    getLogger(loggerName).setLevel(level);
  } else {
    for (const logger of livekitLoggers) {
      logger.setLevel(level);
    }
  }
}

export type LogExtension = (level: LogLevel, msg: string, context?: object) => void;

/**
 * use this to hook into the logging function to allow sending internal livekit logs to third party services
 * if set, the browser logs will lose their stacktrace information (see https://github.com/pimterry/loglevel#writing-plugins)
 */
export function setLogExtension(extension: LogExtension, logger?: StructuredLogger) {
  const loggers = logger ? [logger] : livekitLoggers;

  loggers.forEach((logR) => {
    const originalFactory = logR.methodFactory;

    logR.methodFactory = (methodName, configLevel, loggerName) => {
      const rawMethod = originalFactory(methodName, configLevel, loggerName);

      const logLevel = LogLevel[methodName as LogLevelString];
      const needLog = logLevel >= configLevel && logLevel < LogLevel.silent;

      return (msg, context?: [msg: string, context: object]) => {
        if (context) rawMethod(msg, context);
        else rawMethod(msg);
        if (needLog) {
          extension(logLevel, msg, context);
        }
      };
    };
    logR.setLevel(logR.getLevel());
  });
}
