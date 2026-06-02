/**
 * `tapd-server-cli switch-role <role>` 占位 handler。
 *
 * 当前 MVP 仅交付普通用户 + 共享 共 10 个 skill。管理者 skill 上线时再启用。
 * 任何 role 输入都直接以 exit code 2 + stderr 提示退出，绝不修改任何文件。
 */

export interface SwitchRoleInput {
  role: string;
  /** 测试用：拦截 stderr 输出，默认走 process.stderr.write。 */
  stderr?: NodeJS.WritableStream;
}

export interface SwitchRoleResult {
  exitCode: number;
}

export function switchRoleCommand(input: SwitchRoleInput): SwitchRoleResult {
  const stderr = input.stderr ?? process.stderr;
  stderr.write(
    `tapd-server-cli switch-role 暂不可用：当前版本只交付了普通用户 skill 集（共享 + 普通用户共 10 个）。\n` +
      `管理者 skill 上线后此命令才会启用。请等待后续版本。\n` +
      `（你输入的 role: "${input.role}"）\n`,
  );
  return { exitCode: 2 };
}
