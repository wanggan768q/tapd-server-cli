import { z } from 'zod';

import type { TapdHttpClient } from '../api/client.js';

import { maskToken } from './mask.js';

/**
 * /users/info 的响应体（仅声明我们使用到的字段；TAPD 可能返回更多）
 */
const UserInfoSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  name: z.string(),
  email: z.string().optional(),
  user_email: z.string().optional(),
  nick: z.string().optional(),
  current_company_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

export type RawUserInfo = z.infer<typeof UserInfoSchema>;

export interface Identity {
  userId: string;
  userName: string;
  email: string | undefined;
  currentCompanyId: string;
  tokenPreview: string;
}

/**
 * 调用 TAPD `/users/info` 拉取当前令牌身份。
 * 由 HTTP 客户端处理鉴权头与错误归一化（包括 401 → unauthenticated）。
 */
export async function fetchIdentity(client: TapdHttpClient, token: string): Promise<Identity> {
  const raw = await client.get('/users/info');
  const parsed = UserInfoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `TAPD /users/info 响应结构与预期不符: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const u = parsed.data;
  return {
    userId: u.id,
    userName: u.name,
    email: u.user_email ?? u.email,
    currentCompanyId: u.current_company_id,
    tokenPreview: maskToken(token),
  };
}
