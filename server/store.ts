import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Project, Task, User, Activity, Comment } from '../shared/types.ts';
import { STATUSES, PRIORITIES } from '../shared/types.ts';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const id = () => randomUUID();
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
export type Actor = { user: User; source: 'web' | 'mcp'; scope?: 'read' | 'write' };

export class Store {
  db: DatabaseSync;
  constructor(path = resolve(process.env.DATA_DIR || 'data', 'freejira.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, email TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, scope TEXT NOT NULL, last_used_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT UNIQUE NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL, target_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, assignee_id TEXT REFERENCES users(id), due_date TEXT, tags TEXT NOT NULL DEFAULT '[]', position REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, UNIQUE(project_id, number));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT REFERENCES projects(id), task_id TEXT REFERENCES tasks(id), action TEXT NOT NULL, detail TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id), PRIMARY KEY(user_id, project_id));
      CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id, deleted_at);
      CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id);
      CREATE INDEX IF NOT EXISTS activity_time ON activity(created_at);
      CREATE INDEX IF NOT EXISTS comments_task ON comments(task_id);
      PRAGMA user_version=1;`);
  }
  all<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  workspace() {
    return {
      name:
        this.one<{ value: string }>('SELECT value FROM settings WHERE key=?', 'workspace')?.value ||
        'Моя команда',
    };
  }
  members() {
    return this.all<User>(
      'SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at',
    );
  }
  projects() {
    return this.all<Project>('SELECT * FROM projects ORDER BY created_at DESC');
  }
  project(projectId: string) {
    const p = this.one<Project>('SELECT * FROM projects WHERE id=?', projectId);
    if (!p) throw new AppError(404, 'Проект не найден');
    return p;
  }
  tasks(
    filters: {
      project_id?: string;
      status?: string;
      assignee_id?: string;
      query?: string;
      include_archived?: boolean;
    } = {},
  ) {
    let rows = this.all<Omit<Task, 'tags'> & { tags: string }>(
      'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY position, created_at DESC',
    ).map((t) => ({ ...t, tags: JSON.parse(t.tags) as string[] }));
    if (!filters.include_archived) {
      const visible = new Set(
        this.projects()
          .filter((p) => p.status !== 'archived')
          .map((p) => p.id),
      );
      rows = rows.filter((t) => visible.has(t.project_id));
    }
    if (filters.project_id) rows = rows.filter((t) => t.project_id === filters.project_id);
    if (filters.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters.assignee_id) rows = rows.filter((t) => t.assignee_id === filters.assignee_id);
    if (filters.query) {
      const q = filters.query.toLocaleLowerCase();
      const keys = new Map(this.projects().map((p) => [p.id, p.key]));
      rows = rows.filter((t) =>
        `${keys.get(t.project_id)}-${t.number} ${t.title} ${t.description} ${t.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(q),
      );
    }
    return rows;
  }
  task(taskId: string) {
    const row = this.one<Omit<Task, 'tags'> & { tags: string }>(
      'SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL',
      taskId,
    );
    if (!row) throw new AppError(404, 'Задача не найдена');
    return { ...row, tags: JSON.parse(row.tags) as string[] };
  }
  comments(taskId: string) {
    this.task(taskId);
    return this.all<Comment>('SELECT * FROM comments WHERE task_id=? ORDER BY created_at', taskId);
  }
  activities(limit = 100) {
    return this.all<Activity>('SELECT * FROM activity ORDER BY rowid DESC LIMIT ?', limit);
  }
  writable(actor: Actor) {
    if (actor.scope === 'read') throw new AppError(403, 'Токен разрешает только чтение');
  }
  owner(actor: Actor) {
    this.writable(actor);
    if (actor.user.role !== 'owner')
      throw new AppError(403, 'Доступно только владельцу пространства');
  }
  log(
    actor: Actor,
    action: string,
    detail: string,
    projectId: string | null = null,
    taskId: string | null = null,
  ) {
    this.run(
      'INSERT INTO activity VALUES (?,?,?,?,?,?,?,?)',
      id(),
      actor.user.id,
      projectId,
      taskId,
      action,
      detail,
      actor.source,
      now(),
    );
  }
  validateAssignee(assignee: string | null | undefined) {
    if (assignee && !this.one('SELECT id FROM users WHERE id=? AND active=1', assignee))
      throw new AppError(400, 'Участник недоступен');
  }
  createProject(actor: Actor, input: unknown) {
    this.writable(actor);
    const p = projectInput.parse(input);
    return this.transaction(() => {
      if (this.one('SELECT id FROM projects WHERE key=?', p.key))
        throw new AppError(409, 'Этот код проекта уже используется');
      const pid = id(),
        time = now();
      this.run(
        'INSERT INTO projects (id,name,key,description,color,status,target_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        pid,
        p.name,
        p.key,
        p.description,
        p.color,
        p.status,
        p.target_date,
        time,
        time,
      );
      this.log(actor, 'project_created', `Создан проект «${p.name}»`, pid);
      return this.project(pid);
    });
  }
  updateProject(actor: Actor, pid: string, input: unknown) {
    this.writable(actor);
    const p = projectPatch.parse(input);
    return this.transaction(() => {
      const old = this.project(pid);
      if (old.revision !== p.revision)
        throw new AppError(409, 'Проект уже изменён. Обновите страницу и повторите.');
      const v = { ...old, ...p };
      this.run(
        'UPDATE projects SET name=?,description=?,color=?,status=?,target_date=?,updated_at=?,revision=revision+1 WHERE id=?',
        v.name,
        v.description,
        v.color,
        v.status,
        v.target_date,
        now(),
        pid,
      );
      this.log(actor, 'project_updated', `Обновлён проект «${v.name}»`, pid);
      return this.project(pid);
    });
  }
  createTask(actor: Actor, input: unknown) {
    this.writable(actor);
    const t = taskInput.parse(input);
    this.validateAssignee(t.assignee_id);
    return this.transaction(() => {
      const p = this.project(t.project_id);
      if (p.status === 'archived') throw new AppError(400, 'Сначала восстановите проект из архива');
      const number = this.one<{ n: number }>(
        'SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE project_id=?',
        t.project_id,
      )!.n;
      const tid = id(),
        time = now();
      this.run(
        'INSERT INTO tasks (id,project_id,number,title,description,status,priority,assignee_id,due_date,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        tid,
        t.project_id,
        number,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.due_date,
        JSON.stringify(t.tags),
        time,
        time,
      );
      this.log(actor, 'task_created', `Создана ${p.key}-${number}: ${t.title}`, p.id, tid);
      return this.task(tid);
    });
  }
  updateTask(actor: Actor, tid: string, input: unknown) {
    this.writable(actor);
    const patch = taskPatch.parse(input);
    return this.transaction(() => {
      const old = this.task(tid);
      if (patch.assignee_id !== old.assignee_id) this.validateAssignee(patch.assignee_id);
      if (old.revision !== patch.revision)
        throw new AppError(
          409,
          'Задачу изменил другой участник. Закройте её и откройте заново, чтобы увидеть изменения.',
        );
      const t = { ...old, ...patch };
      this.run(
        'UPDATE tasks SET title=?,description=?,status=?,priority=?,assignee_id=?,due_date=?,tags=?,updated_at=?,revision=revision+1 WHERE id=?',
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.due_date,
        JSON.stringify(t.tags),
        now(),
        tid,
      );
      const p = this.project(t.project_id);
      this.log(
        actor,
        old.status !== t.status ? 'status_changed' : 'task_updated',
        `${p.key}-${t.number}: ${old.status !== t.status ? `${old.status} → ${t.status}` : t.title}`,
        p.id,
        tid,
      );
      return this.task(tid);
    });
  }
  deleteTask(actor: Actor, tid: string, revision: number) {
    this.writable(actor);
    return this.transaction(() => {
      const t = this.task(tid);
      if (t.revision !== revision) throw new AppError(409, 'Задача уже изменена');
      this.run('UPDATE tasks SET deleted_at=?,revision=revision+1 WHERE id=?', now(), tid);
      this.log(actor, 'task_deleted', `Удалена задача «${t.title}»`, t.project_id, tid);
      return { ok: true };
    });
  }
  addComment(actor: Actor, tid: string, body: unknown) {
    this.writable(actor);
    const text = z.string().trim().min(1).max(10000).parse(body);
    return this.transaction(() => {
      const t = this.task(tid),
        cid = id();
      this.run('INSERT INTO comments VALUES (?,?,?,?,?)', cid, tid, actor.user.id, text, now());
      this.log(actor, 'comment_added', `Комментарий к задаче «${t.title}»`, t.project_id, tid);
      return this.one<Comment>('SELECT * FROM comments WHERE id=?', cid)!;
    });
  }
  snapshot(user: User) {
    return {
      workspace: this.workspace(),
      user,
      members: this.members(),
      projects: this.projects(),
      tasks: this.tasks({ include_archived: true }),
      activities: this.activities(),
      favorites: this.all<{ project_id: string }>(
        'SELECT project_id FROM favorites WHERE user_id=?',
        user.id,
      ).map((x) => x.project_id),
    };
  }
  seed(actor: Actor) {
    const a = this.createProject(actor, {
      name: 'Запуск продукта',
      key: 'PRD',
      description:
        'От идеи до первых пользователей. Исследуем, собираем и запускаем первую версию.',
      color: '#8b7bf3',
    });
    const b = this.createProject(actor, {
      name: 'Новый сайт',
      key: 'WEB',
      description: 'Понятный сайт, который рассказывает о продукте и помогает новым клиентам.',
      color: '#4c9c87',
    });
    const c = this.createProject(actor, {
      name: 'Контент и рост',
      key: 'GRO',
      description: 'Полезные материалы, новые каналы и регулярная работа с аудиторией.',
      color: '#e1a058',
    });
    const day = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const rows: [Project, string, string, string, number, string[]][] = [
      [a, 'Собрать обратную связь от первых пользователей', 'doing', 'high', 2, ['Исследование']],
      [a, 'Спроектировать основной сценарий', 'review', 'high', 1, ['Дизайн']],
      [a, 'Подготовить план запуска', 'todo', 'medium', 5, ['Запуск']],
      [a, 'Определить метрики успеха', 'done', 'medium', -2, ['Аналитика']],
      [a, 'Проверить ключевые гипотезы', 'backlog', 'low', 12, ['Исследование']],
      [b, 'Собрать первый экран сайта', 'doing', 'high', 3, ['Дизайн']],
      [b, 'Написать тексты для страниц', 'todo', 'medium', 6, ['Контент']],
      [b, 'Подключить аналитику', 'backlog', 'low', 9, ['Разработка']],
      [b, 'Согласовать структуру сайта', 'done', 'medium', -3, ['Дизайн']],
      [c, 'Подготовить контент-план на месяц', 'doing', 'high', -1, ['Контент']],
      [c, 'Опубликовать историю продукта', 'todo', 'medium', 4, ['Соцсети']],
      [c, 'Собрать идеи для рассылки', 'backlog', 'low', 8, ['Email']],
    ];
    for (const [p, title, status, priority, due, tags] of rows)
      this.createTask(actor, {
        project_id: p.id,
        title,
        status,
        priority,
        due_date: day(due),
        tags,
        assignee_id: status === 'doing' ? actor.user.id : null,
        description:
          'Пример задачи. Измените её под свой процесс или удалите. Все демонстрационные проекты можно отправить в архив.',
      });
    this.run('INSERT INTO favorites VALUES (?,?)', actor.user.id, a.id);
  }
}
