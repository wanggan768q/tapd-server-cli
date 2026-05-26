/**
 * MCP 传输绑定：stdio（默认）+ streamable HTTP（可选）。
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Logger } from 'pino';

import type { ServerBundle } from './server.js';

export interface TransportBindings {
  stdio: { kind: 'stdio'; transport: StdioServerTransport };
  http?: { kind: 'http'; server: HttpServer; port: number };
}

export interface BindStdioInput {
  bundle: ServerBundle;
  logger: Logger;
}

export async function bindStdio(input: BindStdioInput): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await input.bundle.mcp.connect(transport);
  input.logger.info({ msg: 'startup', step: 'stdio_ready' }, 'MCP stdio transport ready');
  return transport;
}

export interface BindHttpInput {
  bundle: ServerBundle;
  port: number;
  startedAt: number;
  logger: Logger;
}

export interface HttpBinding {
  server: HttpServer;
}

/**
 * Streamable HTTP 传输。
 * - POST /mcp：处理 JSON-RPC 请求 / 通知
 * - GET  /mcp：SSE 流（持续接收服务端事件）
 * - GET  /healthz：健康检查
 */
export async function bindHttp(input: BindHttpInput): Promise<HttpBinding> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await input.bundle.mcp.connect(transport);

  const httpServer = createServer((req, res) => handle(req, res, transport, input));
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(input.port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  input.logger.info(
    { msg: 'startup', step: 'http_ready', port: input.port },
    `MCP streamable HTTP transport ready on :${input.port}`,
  );
  return { server: httpServer };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  transport: StreamableHTTPServerTransport,
  input: BindHttpInput,
) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime_sec: Math.round((Date.now() - input.startedAt) / 1000),
        snapshot_at: input.bundle.snapshot.snapshotAt,
      }),
    );
    return;
  }
  if (url.pathname !== '/mcp') {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      await transport.handleRequest(req, res, body);
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (err) {
    input.logger.error({ err: { message: (err as Error).message } }, 'http handler error');
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('internal error');
    }
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
