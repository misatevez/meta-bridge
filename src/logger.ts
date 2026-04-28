import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from './config.js';

function buildOptions(): LoggerOptions {
  const base: LoggerOptions = {
    level: config.logLevel,
    base: { service: 'meta-bridge' },
  };

  if (config.nodeEnv === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    };
  }

  return base;
}

export const logger: Logger = pino(buildOptions());
