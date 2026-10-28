import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AppError,
  projectInput,
  projectPatch,
  taskInput,
  taskPatch,
  type Store,
  type Actor,
} from './store.ts';
export function createMcpServer(store: Store, actor: Actor) {
  const server = new McpServer(
    { name: 'freejira', version: '1.0.0' },
    {
      instructions:
        'Shared team project manager. Read current task/project revision before updates. Dates are YYYY-MM-DD. Every write is attributed to the authenticated user. Never infer completion without evidence.',
    },
  );
  const wrap = (fn: (args: any) => unknown) => async (args: any) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(fn(args)) }] };
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text:
              e instanceof AppError || e instanceof z.ZodError
                ? e.message
                : 'Не удалось выполнить операцию',
          },
        ],
      };
    }
  };
  const register = (
    name: string,
    description: string,
    schema: z.ZodObject<any>,
    fn: (args: any) => unknown,
    read = true,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: read, destructiveHint: !read, openWorldHint: false },
      },
      wrap(fn),
    );
  register(
    'list_projects',
    'List all workspace projects, including archived projects.',
    z.object({}),
    () => store.projects(),
  );
  register(
    'get_project',
    'Get a project and its tasks.',
    z.object({ project_id: z.string().uuid() }),
    (a) => ({
      project: store.project(a.project_id),
      tasks: store.tasks({ project_id: a.project_id, include_archived: true }),
    }),
  );
  register(
    'create_project',
    'Create a project. key must be unique, uppercase, 2–8 characters.',
    projectInput,
    (a) => store.createProject(actor, a),
    false,
  );
  register(
    'update_project',
    'Update or archive a project. Read its latest revision first.',
    projectPatch.extend({ project_id: z.string().uuid() }),
    ({ project_id, ...a }) => store.updateProject(actor, project_id, a),
    false,
  );
  register(
    'list_tasks',
    'Search tasks across projects. Archived projects are excluded unless requested.',
    z.object({
      project_id: z.string().uuid().optional(),
      status: z.enum(['backlog', 'todo', 'doing', 'review', 'done']).optional(),
      assignee_id: z.string().uuid().optional(),
      query: z.string().max(200).optional(),
      include_archived: z.boolean().optional(),
    }),
    (a) => store.tasks(a),
  );
  register(
    'get_task',
    'Read a task, its revision and comments before editing.',
    z.object({ task_id: z.string().uuid() }),
    (a) => ({ task: store.task(a.task_id), comments: store.comments(a.task_id) }),
  );
  register(
    'create_task',
    'Create a task in a project. Dates use YYYY-MM-DD; assignee_id must be an active member.',
    taskInput,
    (a) => store.createTask(actor, a),
    false,
  );
  register(
    'update_task',
    'Update task status, assignee, priority, due date, description or tags. A current revision is required to prevent overwriting another user.',
    taskPatch.extend({ task_id: z.string().uuid() }),
    ({ task_id, ...a }) => store.updateTask(actor, task_id, a),
    false,
  );
  register(
    'add_comment',
    'Add a comment to a task.',
    z.object({ task_id: z.string().uuid(), body: z.string().trim().min(1).max(10000) }),
    (a) => store.addComment(actor, a.task_id, a.body),
    false,
  );
  register(
    'list_members',
    'List active team members and IDs for task assignment.',
    z.object({}),
    () => store.members().filter((u) => u.active),
  );
  const summary = () => {
    const tasks = store.tasks(),
      today = new Date().toISOString().slice(0, 10);
    return {
      workspace: store.workspace(),
      projects: store.projects().filter((p) => p.status !== 'archived'),
      counts: {
        total: tasks.length,
        done: tasks.filter((t) => t.status === 'done').length,
        in_progress: tasks.filter((t) => t.status === 'doing').length,
      },
      overdue: tasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'done'),
      activity: store.activities(25),
    };
  };
  register(
    'workspace_summary',
    'Overview of all projects, overdue tasks, progress and recent activity.',
    z.object({}),
    summary,
  );
  server.registerResource(
    'workspace',
    'freejira://workspace/summary',
    { mimeType: 'application/json', description: 'Current workspace progress and overdue tasks' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summary()) }],
    }),
  );
  return server;
}
