import { z } from 'zod';

import { LOG_LEVELS, type LogLevel } from './runtime/logger.js';

const positiveInt = (envName: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${envName} 必须是正整数，收到 "${v}"`,
        });
        return z.NEVER;
      }
      return n;
    });

const portInt = (envName: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${envName} 必须是 1-65535 间的整数，收到 "${v}"`,
        });
        return z.NEVER;
      }
      return n;
    });

const logLevelSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === '') return undefined;
    if (!(LOG_LEVELS as readonly string[]).includes(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `TAPD_LOG_LEVEL 必须是 ${LOG_LEVELS.join(' / ')} 之一，收到 "${v}"`,
      });
      return z.NEVER;
    }
    return v as LogLevel;
  });

export const RawEnvSchema = z.object({
  TAPD_TOKEN: z.string().optional(),
  TAPD_API_BASE: z.string().url().optional(),
  TAPD_CONCURRENCY: positiveInt('TAPD_CONCURRENCY'),
  TAPD_TIMEOUT_MS: positiveInt('TAPD_TIMEOUT_MS'),
  TAPD_LOG_LEVEL: logLevelSchema,
  TAPD_PERMISSION_TTL_SEC: positiveInt('TAPD_PERMISSION_TTL_SEC'),
  TAPD_MCP_HTTP_PORT: portInt('TAPD_MCP_HTTP_PORT'),
  TAPD_WEB_COOKIE: z.string().optional(),
  TAPD_WEB_BASE: z.string().url().optional(),
  TAPD_FILE_BASE: z.string().url().optional(),
  TAPD_WEB_CONCURRENCY: positiveInt('TAPD_WEB_CONCURRENCY'),
});

export interface CliArgs {
  token?: string;
  apiBase?: string;
  httpPort?: number;
}

export interface AppConfig {
  token: string;
  apiBase: string;
  concurrency: number;
  timeoutMs: number;
  logLevel: LogLevel;
  permissionTtlSec: number;
  /** 未设置即不启用 HTTP 传输 */
  httpPort: number | undefined;
  /** 未设置即不启用网页 cookie 客户端，附件下载工具不会注册 */
  webCookie: string | undefined;
  /** 主站基地址（用于 referer 等头部） */
  webBase: string;
  /** 文件 CDN 基地址（附件下载实际域） */
  fileBase: string;
  /** 网页客户端独立并发上限 */
  webConcurrency: number;
}

export interface ResolveConfigInput {
  env: NodeJS.ProcessEnv;
  cli: CliArgs;
  /**
   * 读取用户级配置文件中的令牌（如有）。
   * 由调用方负责权限检查与读取；返回 undefined 表示不可用。
   */
  fileToken?: () => string | undefined;
}

export const EXIT_CODE_CONFIG = 78; // EX_CONFIG

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  apiBase: 'https://api.tapd.cn',
  concurrency: 8,
  timeoutMs: 30_000,
  logLevel: 'info' as LogLevel,
  permissionTtlSec: 600,
  webBase: 'https://www.tapd.cn',
  fileBase: 'https://file.tapd.cn',
  webConcurrency: 4,
};

export function resolveConfig(input: ResolveConfigInput): AppConfig {
  const parsed = RawEnvSchema.safeParse(input.env);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `- ${i.message}`).join('\n');
    throw new ConfigError(`配置项校验失败:\n${messages}`);
  }
  const env = parsed.data;

  const token = input.cli.token ?? env.TAPD_TOKEN ?? input.fileToken?.();
  if (!token) {
    throw new ConfigError(
      'TAPD_TOKEN 未提供。请通过 --token 参数、TAPD_TOKEN 环境变量，' +
        '或 ~/.config/tapd-mcp/token 文件（权限 600）之一提供个人访问令牌。',
    );
  }

  const apiBase = input.cli.apiBase ?? env.TAPD_API_BASE ?? DEFAULTS.apiBase;
  const httpPort = input.cli.httpPort ?? env.TAPD_MCP_HTTP_PORT;
  const webBase = env.TAPD_WEB_BASE ?? DEFAULTS.webBase;
  const fileBase = env.TAPD_FILE_BASE ?? DEFAULTS.fileBase;
  const webCookie = env.TAPD_WEB_COOKIE && env.TAPD_WEB_COOKIE.length > 0 ? env.TAPD_WEB_COOKIE : undefined;

  return {
    token,
    apiBase: apiBase.replace(/\/$/, ''),
    concurrency: env.TAPD_CONCURRENCY ?? DEFAULTS.concurrency,
    timeoutMs: env.TAPD_TIMEOUT_MS ?? DEFAULTS.timeoutMs,
    logLevel: env.TAPD_LOG_LEVEL ?? DEFAULTS.logLevel,
    permissionTtlSec: env.TAPD_PERMISSION_TTL_SEC ?? DEFAULTS.permissionTtlSec,
    httpPort,
    webCookie,
    webBase: webBase.replace(/\/$/, ''),
    fileBase: fileBase.replace(/\/$/, ''),
    webConcurrency: env.TAPD_WEB_CONCURRENCY ?? DEFAULTS.webConcurrency,
  };
}
