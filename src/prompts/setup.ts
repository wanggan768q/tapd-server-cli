/**
 * MCP Prompt: setup
 *
 * 注册为 server prompt，客户端会渲染成 slash 命令（Claude Code: /mcp__tapd__setup）。
 * 内容是一段中文指令，引导 AI 顺序调用 tapd.whoami / tapd.list_capabilities /
 * tapd.login（视情况）完成首次设置或状态诊断。
 *
 * 不接受参数（D2 决策）—— 自定义 timeout 等让用户走自然语言。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SETUP_PROMPT_NAME = 'setup';

const SETUP_PROMPT_TEXT = `你是 TAPD MCP server 的设置向导。请按下面的编号顺序，依次调用工具，并在每一步把要点信息回报给我（用户）。

**步骤 1**：调用 \`tapd.whoami\` 验证 TAPD 个人访问令牌（PAT）。
- 成功 → 给我一行简短确认：用户名 + token_preview（已脱敏）。继续步骤 2。
- 失败（unauthenticated / 报错） → 告诉我："PAT 已失效或未配置。请打开 \`~/.claude.json\`，把 \`projects[<工程绝对路径>].mcpServers.tapd.env.TAPD_TOKEN\` 改成有效的 TAPD 个人访问令牌后重启 Claude Code。" 然后停止后续步骤。

**步骤 2**：调用 \`tapd.list_capabilities\`，只从返回里挑出 \`web_client\` 字段和 \`attachment_tools\` 字段（其它不要重复展示），告诉我：
- \`web_client.enabled\`（true / false）
- \`web_client.cookie_source\`（env / file / none）
- \`attachment_tools\` 数组

**步骤 3**：根据 \`web_client.enabled\` 分支处理：

- 如果 \`enabled = false\`（未装配 cookie）：
  - 先告诉我："即将弹出一个独立的浏览器窗口（不影响日常 Chrome），请在窗口里登录 TAPD。登录完成后窗口会自动关闭，cookie 会被保存到 \`~/.config/tapd-mcp/cookie\`。"
  - 调用 \`tapd.login\`（不带参数，默认 5 分钟超时）。
  - 调用成功 → 再次调用 \`tapd.list_capabilities\` 确认 \`tapd.attachments.download\` 已出现在 \`attachment_tools\` 里。继续步骤 4。
  - 调用失败：
    - 错误信息包含"找不到 Chrome"或 "BrowserNotFoundError" → 告诉我："本机没装 Chrome / Edge。请安装 Chrome 或 Edge，或者设置环境变量 \`BROWSER=<浏览器可执行文件绝对路径>\` 后重启 Claude Code。"
    - 错误信息包含"仅支持 stdio"或 "HTTP" → 告诉我："当前 server 以 HTTP 远程模式启动，无法弹出本地浏览器。请改用 stdio 模式启动，或者把 cookie 字符串放到 \`TAPD_WEB_COOKIE\` 环境变量里。"
    - 其它失败 → 把错误的 \`info\` 字段原样告诉我，并提示可以重试 \`tapd.login\`。
    - 失败后停止后续步骤。

- 如果 \`enabled = true\`（已装配 cookie）：
  - 告诉我："TAPD MCP 已就绪，附件下载工具 \`tapd.attachments.download\` 可用。"
  - 给我一行调用示例（参数：workspace_id、attachment_id、type、save_to），不要实际调用下载。
  - 提示："如果 cookie 过期，再次运行这条 slash 命令，或者直接对我说'重新登录 TAPD'。"
  - 继续步骤 4。

**步骤 4**：用一两句话总结当前状态（PAT 用户、cookie 来源、附件下载工具是否可用）。结束。

重要约束：
- 不要在用户没明确要求的情况下反复调用 \`tapd.login\`；步骤 3 里"已 enabled"分支不要触发 login。
- 步骤之间如果遇到错误，按上面提示告诉我后停止，等我确认再继续，不要自己反复重试。
- 整条流程的所有回应使用中文。`;

export function registerSetupPrompt(server: McpServer): void {
  server.registerPrompt(
    SETUP_PROMPT_NAME,
    {
      title: 'TAPD 首次设置 / 状态诊断向导',
      description:
        '一键完成 TAPD MCP 的安装后设置：验证 PAT、检查 cookie 状态、必要时弹出浏览器登录并装配附件下载工具。cookie 过期后重跑同一条命令即可恢复。',
    },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: SETUP_PROMPT_TEXT },
        },
      ],
    }),
  );
}

// 导出文本常量便于单测断言关键字
export const __test_setup_prompt_text = SETUP_PROMPT_TEXT;
