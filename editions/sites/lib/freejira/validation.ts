import { z } from 'zod';
import type { User } from '../../shared/types';
import { STATUSES, PRIORITIES } from '../../shared/types';
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Некорректная дата',
  )
  .nullable();
export const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  key: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/),
  description: z.string().max(10000).default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#8b7bf3'),
  status: z.enum(['active', 'paused', 'completed', 'archived']).default('active'),
  target_date: date.default(null),
});
export const taskInput = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(20000).default(''),
  status: z.enum(STATUSES).default('todo'),
  priority: z.enum(PRIORITIES).default('medium'),
  assignee_id: z.string().uuid().nullable().default(null),
  due_date: date.default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
});
export const taskPatch = z.object({
  title: taskInput.shape.title.optional(),
  description: taskInput.shape.description.removeDefault().optional(),
  status: taskInput.shape.status.removeDefault().optional(),
  priority: taskInput.shape.priority.removeDefault().optional(),
  assignee_id: taskInput.shape.assignee_id.removeDefault().optional(),
  due_date: taskInput.shape.due_date.removeDefault().optional(),
  tags: taskInput.shape.tags.removeDefault().optional(),
  revision: z.number().int().positive(),
});
export const projectPatch = z.object({
  name: projectInput.shape.name.optional(),
  description: projectInput.shape.description.removeDefault().optional(),
  color: projectInput.shape.color.removeDefault().optional(),
  status: projectInput.shape.status.removeDefault().optional(),
  target_date: projectInput.shape.target_date.removeDefault().optional(),
  revision: z.number().int().positive(),
});
export type Actor = { user: User; source: 'web' | 'mcp'; scope?: 'read' | 'write' | 'tasks' };
