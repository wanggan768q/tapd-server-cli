/**
 * Server 当前版本号（编译时内联）。
 *
 * 由 `scripts/sync-plugin-version.mjs` 在 `npm version` 钩子时同步更新——
 * 决议见 openspec/changes/add-tapd-update-command/design.md D3：运行时
 * 读 package.json 在 plugin 沙箱里 cwd / dist 关系不稳，编译时内联更可靠。
 *
 * 唯一的真相来源：scripts/sync-plugin-version.mjs。手动改这个值会被下次
 * `npm version` 覆盖，应改 package.json 然后跑 `npm version` 触发同步。
 */
export const VERSION = '0.2.0';
