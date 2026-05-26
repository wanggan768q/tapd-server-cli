/**
 * 附件下载工具：
 *
 * - `tapd.attachments.get_download_url`（始终注册）：构造网页下载 URL 字符串，不调网络
 * - `tapd.attachments.download`（仅当 webClient 已装配时注册）：用 web cookie 下载二进制
 *
 * 设计上独立于 RESOURCES factory：这两个工具的 schema 与字段语义都
 * 跟普通 list/get 资源工具不一致（不走 workspace_id enum 收紧，
 * 需要专用的 attachment_id / save_to / max_inline_mb 等字段）。
 *
 * 热加载：`AttachmentRegistry` 暴露 arm/disarm，可在运行期切换 webClient
 * 或下线 download 工具（被 tapd.login / tapd.logout 调用）。
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { TapdApiError } from '../api/errors.js';
import type { TapdWebClient } from '../api/web-client.js';

export interface AttachmentDownloadDeps {
  /** 主站基地址（用作 Referer 头部） */
  webBase: string;
  /** 文件 CDN 基地址（附件下载实际域，默认 https://file.tapd.cn） */
  fileBase: string;
  /** 仅在 cookie 已配置时存在；undefined 时不注册 download 工具 */
  webClient: TapdWebClient | undefined;
}

const DEFAULT_MAX_INLINE_MB = 5;
const ABS_MAX_INLINE_MB = 50;
export const DOWNLOAD_TOOL_NAME = 'tapd.attachments.download';
export const GET_URL_TOOL_NAME = 'tapd.attachments.get_download_url';

const TYPE_DESC =
  'TAPD 实体类型，与附件 entity 字段一致：bug / story / task / iteration / release 等。' +
  '默认 bug（最常见）。';

const downloadUrlInputShape = {
  workspace_id: z.string().min(1).describe('TAPD workspace ID'),
  attachment_id: z.string().min(1).describe('附件 ID'),
  type: z.string().min(1).optional().describe(TYPE_DESC),
} as const;

const downloadInputShape = {
  workspace_id: z.string().min(1).describe('TAPD workspace ID'),
  attachment_id: z.string().min(1).describe('附件 ID'),
  type: z.string().min(1).optional().describe(TYPE_DESC),
  save_to: z
    .string()
    .min(1)
    .optional()
    .describe('本地绝对路径；提供时直接落盘，返回路径；未提供则尝试 inline base64 返回'),
  max_inline_mb: z
    .number()
    .positive()
    .max(ABS_MAX_INLINE_MB)
    .optional()
    .describe(`inline base64 模式的大小上限（MB），默认 ${DEFAULT_MAX_INLINE_MB}`),
} as const;

export interface AttachmentToolHandle {
  name: string;
}

/**
 * 附件下载工具的注册中心。可被 tapd.login / tapd.logout 复用。
 *
 * 内部用 `currentWebClient` 间接持有 client 引用，调用时再取最新值，
 * 这样 `arm(newClient)` 不需要重新注册工具（避免 SDK 重复注册报错）。
 */
export interface AttachmentRegistry {
  /** 是否已注册 download 工具（即 cookie 可用） */
  isArmed(): boolean;
  /** cookie 可用 → 注册 download 工具（幂等） */
  arm(webClient: TapdWebClient): void;
  /** cookie 不可用 → 注销 download 工具（幂等） */
  disarm(): { previousClient: TapdWebClient | undefined };
  /** 当前注册的工具名列表（用于 list_capabilities） */
  currentTools(): string[];
  /** 仅在已装配时返回 webClient，便于 close 释放 */
  currentClient(): TapdWebClient | undefined;
}

export interface CreateRegistryOptions {
  server: McpServer;
  deps: AttachmentDownloadDeps;
  /** 在 arm/disarm 后调用；用于触发 tools/list_changed */
  notifyToolsChanged?: () => void;
}

interface InternalToolMap {
  _registeredTools: Record<string, unknown>;
}

/**
 * 工厂：注册 get_download_url（始终在线）+ 创建 AttachmentRegistry，
 * 启动期若 deps.webClient 存在则立刻 arm。
 */
export function createAttachmentRegistry(
  opts: CreateRegistryOptions,
): AttachmentRegistry {
  const { server, deps } = opts;
  const notify = opts.notifyToolsChanged ?? (() => {});

  // 始终注册：URL 构造（不依赖 cookie）
  server.registerTool(
    GET_URL_TOOL_NAME,
    {
      title: 'TAPD 附件下载 URL',
      description:
        '根据 workspace_id / attachment_id / type 构造 TAPD 网页下载 URL（file.tapd.cn 子域）；不发起网络请求，无需 cookie。' +
        ' 如果 MCP 客户端无法直接消费二进制，可以把 URL 给用户在浏览器手动打开。',
      inputSchema: downloadUrlInputShape,
      annotations: { readOnlyHint: true },
    },
    async (rawInput: unknown) => {
      try {
        const parsed = z.object(downloadUrlInputShape).parse(rawInput ?? {});
        const url = buildDownloadUrl(deps.fileBase, parsed);
        const data = {
          url,
          workspace_id: parsed.workspace_id,
          attachment_id: parsed.attachment_id,
          type: parsed.type ?? 'bug',
        };
        return ok(data);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  let currentClient: TapdWebClient | undefined = deps.webClient;
  let downloadRegistered = false;

  const registerDownload = () => {
    if (downloadRegistered) return;
    server.registerTool(
      DOWNLOAD_TOOL_NAME,
      {
        title: 'TAPD 附件下载（cookie 模式）',
        description:
          '[需要本地 cookie] 通过浏览器 cookie 下载 TAPD 附件二进制（走 file.tapd.cn）。提供 save_to（绝对路径）则落盘并返回 sha256；' +
          '否则尝试以 base64 内嵌返回（受 max_inline_mb 限制）。' +
          ' cookie 失效时返回 unauthenticated 错误并提示用户调用 tapd.login 重新登录。',
        inputSchema: downloadInputShape,
        annotations: { destructiveHint: false, readOnlyHint: true },
      },
      async (rawInput: unknown) => {
        const webClient = currentClient;
        if (!webClient) {
          return errorResult(
            new TapdApiError({
              kind: 'unauthenticated',
              tapdStatus: 0,
              httpStatus: 0,
              info: 'TAPD web client 未装配。请先调用 tapd.login 登录。',
            }),
          );
        }
        try {
          const parsed = z.object(downloadInputShape).parse(rawInput ?? {});
          const url = buildDownloadUrl(deps.fileBase, parsed);
          const path = toPathOnly(url);
          const extraHeaders = browserHeaders(deps.webBase);
          const result = await webClient.downloadBinary(path, undefined, {
            base: deps.fileBase,
            extraHeaders,
          });
          const filename = result.filename ?? `attachment-${parsed.attachment_id}.bin`;
          const bytes = result.bytes.byteLength;

          if (parsed.save_to) {
            if (!isAbsolute(parsed.save_to)) {
              throw new TapdApiError({
                kind: 'invalid_argument',
                tapdStatus: 0,
                httpStatus: 0,
                info: 'save_to 必须是绝对路径',
              });
            }
            await fs.mkdir(dirname(parsed.save_to), { recursive: true });
            await fs.writeFile(parsed.save_to, result.bytes);
            const sha256 = sha256Hex(result.bytes);
            return ok({
              mode: 'file' as const,
              path: parsed.save_to,
              filename,
              content_type: result.contentType,
              bytes,
              sha256,
              source_url: url,
            });
          }

          const inlineLimit =
            (parsed.max_inline_mb ?? DEFAULT_MAX_INLINE_MB) * 1024 * 1024;
          if (bytes > inlineLimit) {
            throw new TapdApiError({
              kind: 'invalid_argument',
              tapdStatus: 0,
              httpStatus: 0,
              info:
                `附件大小 ${bytes} 字节超过 inline 上限 ${inlineLimit} 字节（${parsed.max_inline_mb ?? DEFAULT_MAX_INLINE_MB} MB）。` +
                '请在调用参数中加入 save_to=<本地绝对路径> 落盘，或提高 max_inline_mb（最多 ' +
                ABS_MAX_INLINE_MB +
                '）。',
            });
          }

          const base64 = Buffer.from(result.bytes).toString('base64');
          return ok({
            mode: 'inline' as const,
            filename,
            content_type: result.contentType,
            bytes,
            base64,
            source_url: url,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );
    downloadRegistered = true;
  };

  const unregisterDownload = () => {
    if (!downloadRegistered) return;
    // SDK 没有公开 unregisterTool，直接 mutate 私有 map。
    // 单测会断言此行为；SDK 升级若改变 _registeredTools 结构会立刻 fail。
    const tools = (server as unknown as InternalToolMap)._registeredTools;
    if (tools && DOWNLOAD_TOOL_NAME in tools) {
      delete tools[DOWNLOAD_TOOL_NAME];
    }
    downloadRegistered = false;
  };

  // 启动期：若已有 webClient，立即注册（不发 tools/list_changed —— 这是首次注册）
  if (currentClient) {
    registerDownload();
  }

  return {
    isArmed() {
      return downloadRegistered;
    },
    arm(webClient) {
      currentClient = webClient;
      const wasArmed = downloadRegistered;
      if (!wasArmed) {
        registerDownload();
        notify();
      }
      // 若已 armed 但 client 替换了，不需要重新注册，闭包通过 currentClient 看到新值
    },
    disarm() {
      const previous = currentClient;
      currentClient = undefined;
      const wasArmed = downloadRegistered;
      if (wasArmed) {
        unregisterDownload();
        notify();
      }
      return { previousClient: previous };
    },
    currentTools() {
      return downloadRegistered
        ? [GET_URL_TOOL_NAME, DOWNLOAD_TOOL_NAME]
        : [GET_URL_TOOL_NAME];
    },
    currentClient() {
      return currentClient;
    },
  };
}

/**
 * 旧入口：保留向后兼容（单测在用）。新代码改用 `createAttachmentRegistry`。
 *
 * 返回当前注册的工具句柄数组（启动期一次性快照）。
 */
export function registerAttachmentDownloadTools(
  server: McpServer,
  deps: AttachmentDownloadDeps,
): AttachmentToolHandle[] {
  const registry = createAttachmentRegistry({ server, deps });
  return registry.currentTools().map((name) => ({ name }));
}

function buildDownloadUrl(
  fileBase: string,
  args: { workspace_id: string; attachment_id: string; type?: string },
): string {
  const type = encodeURIComponent(args.type ?? 'bug');
  const ws = encodeURIComponent(args.workspace_id);
  const id = encodeURIComponent(args.attachment_id);
  return `${fileBase.replace(/\/$/, '')}/${ws}/attachments/download/${id}/${type}`;
}

function browserHeaders(webBase: string): Record<string, string> {
  return {
    Referer: `${webBase.replace(/\/$/, '')}/`,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
  };
}

function toPathOnly(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(err: unknown) {
  if (err instanceof TapdApiError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: err.kind,
              tapdStatus: err.tapdStatus,
              info: err.info,
              requestId: err.requestId,
              message: err.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  if (err instanceof z.ZodError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'invalid_argument',
              issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: `Unexpected error: ${message}` }],
    isError: true,
  };
}
