import { z } from 'zod';
import { pagination } from './common.js';

export const listCuentasQuery = z.object({
  page: pagination.page,
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
