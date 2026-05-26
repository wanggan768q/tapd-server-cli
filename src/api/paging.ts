/**
 * TAPD 列表接口通用分页参数。
 * 首版透传 page/limit，不做自动跨页聚合。
 */

import { z } from 'zod';

export const PagingSchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type PagingInput = z.infer<typeof PagingSchema>;

export function pagingToQuery(input: PagingInput | undefined): Record<string, string> {
  if (!input) return {};
  const q: Record<string, string> = {};
  if (input.page !== undefined) q.page = String(input.page);
  if (input.limit !== undefined) q.limit = String(input.limit);
  return q;
}
