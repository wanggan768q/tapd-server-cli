import { z } from 'zod';

import type { TapdHttpClient } from '../api/client.js';

import type { WorkspaceEntry } from './snapshot.js';

const WorkspaceItemSchema = z.object({
  Workspace: z.object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    name: z.string(),
    category: z.string(),
  }),
});

const WorkspaceListSchema = z.array(WorkspaceItemSchema);

/**
 * 拉取当前令牌可访问的全部 workspace（公司 + 项目）。
 *
 * TAPD 返回数组每一项形如 `{ Workspace: { id, name, category, ... } }`。
 */
export async function fetchAccessibleWorkspaces(
  client: TapdHttpClient,
): Promise<WorkspaceEntry[]> {
  const raw = await client.get('/workspaces/user_participant_projects');
  const parsed = WorkspaceListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `TAPD /workspaces/user_participant_projects 响应结构与预期不符: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data.map((it) => ({
    id: it.Workspace.id,
    name: it.Workspace.name,
    category: it.Workspace.category,
  }));
}
