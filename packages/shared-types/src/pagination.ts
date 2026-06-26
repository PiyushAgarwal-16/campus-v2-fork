import { z } from 'zod';

/**
 * Shared pagination query schema for cursor-based list endpoints (API_SPEC.md §2.4).
 * Default limit 20, max 100.
 */
export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
