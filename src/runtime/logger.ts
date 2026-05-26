import pino, { type Logger, type LoggerOptions } from 'pino';

import { maskToken } from '../auth/mask.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'] as const;

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LoggerOptionsInput {
  level: LogLevel;
  token?: string;
}

/**
 * 构造一个写入 stderr 的 pino logger。
 *
 * 关键约定：
 * - 所有日志输出到 stderr（stdio MCP 协议占用 stdout）
 * - 不允许出现完整 PAT；任何包含敏感字段的对象都经 redact 处理
 * - 同时把传入的 token 注册到 censor，使其在任何位置出现时都被脱敏
 */
export function createLogger(options: LoggerOptionsInput): Logger {
  const masked = options.token ? maskToken(options.token) : '';

  const baseOptions: LoggerOptions = {
    level: options.level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'token',
        'TAPD_TOKEN',
        '*.token',
        '*.TAPD_TOKEN',
        'headers.authorization',
        'headers.Authorization',
        '*.headers.authorization',
        '*.headers.Authorization',
        'config.token',
        'cookie',
        'Cookie',
        'webCookie',
        'TAPD_WEB_COOKIE',
        '*.cookie',
        '*.Cookie',
        '*.webCookie',
        '*.TAPD_WEB_COOKIE',
        'headers.cookie',
        'headers.Cookie',
        '*.headers.cookie',
        '*.headers.Cookie',
        'config.webCookie',
      ],
      censor: (value) => {
        if (typeof value === 'string' && options.token && value.includes(options.token)) {
          return value.replace(options.token, masked);
        }
        // cookie 与其它无 PAT 上下文的敏感字段都直接 ***
        return masked || '***';
      },
    },
  };

  const dest = pino.destination({ fd: 2, sync: false });
  return pino(baseOptions, dest);
}
