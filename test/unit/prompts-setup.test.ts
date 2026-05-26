import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { registerSetupPrompt, SETUP_PROMPT_NAME } from '../../src/prompts/setup.js';

function makeServer() {
  return new McpServer({ name: 'tapd-mcp-test', version: '0.0.0' });
}

function getRegisteredPrompts(server: McpServer) {
  return (server as unknown as { _registeredPrompts: Record<string, { callback: Function }> })
    ._registeredPrompts;
}

describe('registerSetupPrompt', () => {
  it('registers a prompt named "setup"', () => {
    const server = makeServer();
    registerSetupPrompt(server);
    const prompts = getRegisteredPrompts(server);
    expect(prompts[SETUP_PROMPT_NAME]).toBeDefined();
  });

  it('prompt callback returns a single user-role text message', async () => {
    const server = makeServer();
    registerSetupPrompt(server);
    const prompts = getRegisteredPrompts(server);
    const result = await prompts[SETUP_PROMPT_NAME].callback({}, {} as never);
    expect(result.messages).toHaveLength(1);
    const m = result.messages[0];
    expect(m.role).toBe('user');
    expect(m.content.type).toBe('text');
    expect(typeof m.content.text).toBe('string');
    expect(m.content.text.length).toBeGreaterThan(100);
  });

  it('prompt text mentions all three orchestrated tool names', async () => {
    const server = makeServer();
    registerSetupPrompt(server);
    const prompts = getRegisteredPrompts(server);
    const result = await prompts[SETUP_PROMPT_NAME].callback({}, {} as never);
    const text = result.messages[0].content.text as string;
    expect(text).toContain('tapd.whoami');
    expect(text).toContain('tapd.list_capabilities');
    expect(text).toContain('tapd.login');
  });

  it('prompt text includes fallback hints for the three known failure modes', async () => {
    const server = makeServer();
    registerSetupPrompt(server);
    const prompts = getRegisteredPrompts(server);
    const result = await prompts[SETUP_PROMPT_NAME].callback({}, {} as never);
    const text = result.messages[0].content.text as string;
    // PAT 无效 → 指引改 ~/.claude.json
    expect(text).toContain('TAPD_TOKEN');
    // 找不到 Chrome
    expect(text).toMatch(/Chrome|Edge|BROWSER/);
    // HTTP 模式
    expect(text).toContain('HTTP');
  });

  it('prompt config has non-empty title and description', () => {
    const server = makeServer();
    registerSetupPrompt(server);
    const prompts = getRegisteredPrompts(server);
    const entry = prompts[SETUP_PROMPT_NAME] as unknown as {
      title?: string;
      description?: string;
    };
    expect(entry.title).toBeTruthy();
    expect(entry.description).toBeTruthy();
  });
});
