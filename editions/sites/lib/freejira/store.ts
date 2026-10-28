import { z } from 'zod';
import type { Project, Task, User, Activity, Comment } from '../../shared/types';
import {
  AppError,
  id,
  now,
  projectInput,
  projectPatch,
  taskInput,
  taskPatch,
  type Actor,
} from './validation';
export class Store {
  constructor(public db: D1Database) {}
  statement(sql: string, ...args: any[]) {
    return this.db.prepare(sql).bind(...args);
  }
  async all<T = any>(sql: string, ...args: any[]): Promise<T[]> {
    return (await this.statement(sql, ...args).all<T>()).results;
  }
  async one<T = any>(sql: string, ...args: any[]): Promise<T | null> {
    return this.statement(sql, ...args).first<T>();
  }
  async run(sql: string, ...args: any[]) {
    return this.statement(sql, ...args).run();
  }
  async workspace() {
    return {
      name:
        (await this.one('SELECT value FROM settings WHERE key=?', 'workspace'))?.value ||
        'Моя команда',
    };
  }
  async members() {
    return this.all<User>(
      'SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at',
    );
  }
  async projects() {
    return this.all<Project>('SELECT * FROM projects ORDER BY created_at DESC');
  }
  async project(pid: string) {
    const p = await this.one<Project>('SELECT * FROM projects WHERE id=?', pid);
    if (!p) throw new AppError(404, 'Проект не найден');
    return p;
  }
  async tasks(
    filters: {
      project_id?: string;
      status?: string;
      assignee_id?: string;
      query?: string;
      include_archived?: boolean;
    } = {},
  ) {
    const clauses = ['t.deleted_at IS NULL'];
    const args: any[] = [];
    if (!filters.include_archived) clauses.push("p.status!='archived'");
    for (const key of ['project_id', 'status', 'assignee_id'] as const)
      if (filters[key]) {
        clauses.push(`t.${key}=?`);
        args.push(filters[key]);
      }
    const rows = await this.all<any>(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE ${clauses.join(' AND ')} ORDER BY t.position,t.created_at DESC`,
      ...args,
    );
    let tasks: Task[] = rows.map((t) => ({ ...t, tags: JSON.parse(t.tags) }));
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const projects = await this.projects();
      tasks = tasks.filter((t) =>
        `${projects.find((p) => p.id === t.project_id)?.key}-${t.number} ${t.title} ${t.description} ${t.tags.join(' ')}`
          .toLowerCase()
          .includes(q),
      );
    }
    return tasks;
  }
  async task(tid: string): Promise<Task> {
    const t = await this.one<any>('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL', tid);
    if (!t) throw new AppError(404, 'Задача не найдена');
    return { ...t, tags: JSON.parse(t.tags) };
  }
  async comments(tid: string) {
    await this.task(tid);
    return this.all<Comment>('SELECT * FROM comments WHERE task_id=? ORDER BY created_at', tid);
  }
  async activities(limit = 100) {
    return this.all<Activity>('SELECT * FROM activity ORDER BY rowid DESC LIMIT ?', limit);
  }
  writable(actor: Actor) {
    if (actor.scope === 'read') throw new AppError(403, 'Разрешено только чтение');
  }
  owner(actor: Actor) {
    this.writable(actor);
    if (actor.user.role !== 'owner') throw new AppError(403, 'Доступно только владельцу');
  }
  log(
    actor: Actor,
    action: string,
    detail: string,
    pid: string | null = null,
    tid: string | null = null,
    condition?: { sql: string; args: any[] },
  ) {
    const vals = [id(), actor.user.id, pid, tid, action, detail, actor.source, now()];
    return condition
      ? this.statement(
          `INSERT INTO activity SELECT ?,?,?,?,?,?,?,? WHERE ${condition.sql}`,
          ...vals,
          ...condition.args,
        )
      : this.statement('INSERT INTO activity VALUES (?,?,?,?,?,?,?,?)', ...vals);
  }
  async validateAssignee(uid?: string | null) {
    if (uid && !(await this.one('SELECT id FROM users WHERE id=? AND active=1', uid)))
      throw new AppError(400, 'Участник недоступен');
  }
  async createProject(actor: Actor, input: unknown) {
    this.writable(actor);
    const p = projectInput.parse(input),
      pid = id(),
      time = now();
    if (await this.one('SELECT id FROM projects WHERE key=?', p.key))
      throw new AppError(409, 'Код проекта уже используется');
    await this.db.batch([
      this.statement(
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
      ),
      this.log(actor, 'project_created', `Создан проект «${p.name}»`, pid),
    ]);
    return this.project(pid);
  }
  async updateProject(actor: Actor, pid: string, input: unknown) {
    this.writable(actor);
    const patch = projectPatch.parse(input),
      old = await this.project(pid),
      p = { ...old, ...patch };
    if (old.revision !== patch.revision)
      throw new AppError(409, 'Проект изменён другим участником. Откройте его заново.');
    const results = await this.db.batch([
      this.log(actor, 'project_updated', `Обновлён проект «${p.name}»`, pid, null, {
        sql: 'EXISTS(SELECT 1 FROM projects WHERE id=? AND revision=?)',
        args: [pid, patch.revision],
      }),
      this.statement(
        'UPDATE projects SET name=?,description=?,color=?,status=?,target_date=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',
        p.name,
        p.description,
        p.color,
        p.status,
        p.target_date,
        now(),
        pid,
        patch.revision,
      ),
    ]);
    if (!results[1].meta.changes)
      throw new AppError(409, 'Проект изменён другим участником. Откройте его заново.');
    return this.project(pid);
  }
  async createTask(actor: Actor, input: unknown) {
    this.writable(actor);
    const t = taskInput.parse(input);
    await this.validateAssignee(t.assignee_id);
    const p = await this.project(t.project_id);
    if (p.status === 'archived') throw new AppError(400, 'Восстановите проект из архива');
    const tid = id(),
      time = now();
    const results = await this.db.batch([
      this.statement(
        "INSERT INTO tasks (id,project_id,number,title,description,status,priority,assignee_id,due_date,tags,created_at,updated_at) SELECT ?,?,COALESCE(MAX(number),0)+1,?,?,?,?,?,?,?,?,? FROM tasks WHERE project_id=? HAVING EXISTS(SELECT 1 FROM projects WHERE id=? AND status!='archived')",
        tid,
        p.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.due_date,
        JSON.stringify(t.tags),
        time,
        time,
        p.id,
        p.id,
      ),
      this.log(actor, 'task_created', `Создана задача: ${t.title}`, p.id, tid, {
        sql: 'EXISTS(SELECT 1 FROM tasks WHERE id=?)',
        args: [tid],
      }),
    ]);
    if (!results[0].meta.changes) throw new AppError(409, 'Проект отправлен в архив');
    return this.task(tid);
  }
  async updateTask(actor: Actor, tid: string, input: unknown) {
    this.writable(actor);
    const patch = taskPatch.parse(input),
      old = await this.task(tid);
    if (patch.assignee_id !== old.assignee_id) await this.validateAssignee(patch.assignee_id);
    if (old.revision !== patch.revision)
      throw new AppError(409, 'Задачу изменил другой участник. Закройте её и откройте заново.');
    const t = { ...old, ...patch },
      p = await this.project(t.project_id);
    const results = await this.db.batch([
      this.log(
        actor,
        old.status === t.status ? 'task_updated' : 'status_changed',
        `${p.key}-${t.number}: ${old.status !== t.status ? `${old.status} → ${t.status}` : t.title}`,
        p.id,
        tid,
        {
          sql: 'EXISTS(SELECT 1 FROM tasks WHERE id=? AND revision=? AND deleted_at IS NULL)',
          args: [tid, patch.revision],
        },
      ),
      this.statement(
        'UPDATE tasks SET title=?,description=?,status=?,priority=?,assignee_id=?,due_date=?,tags=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL',
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assignee_id,
        t.due_date,
        JSON.stringify(t.tags),
        now(),
        tid,
        patch.revision,
      ),
    ]);
    if (!results[1].meta.changes)
      throw new AppError(409, 'Задачу изменил другой участник. Откройте её заново.');
    return this.task(tid);
  }
  async deleteTask(actor: Actor, tid: string, revision: number) {
    this.writable(actor);
    const t = await this.task(tid);
    const results = await this.db.batch([
      this.log(actor, 'task_deleted', `Удалена задача «${t.title}»`, t.project_id, tid, {
        sql: 'EXISTS(SELECT 1 FROM tasks WHERE id=? AND revision=? AND deleted_at IS NULL)',
        args: [tid, revision],
      }),
      this.statement(
        'UPDATE tasks SET deleted_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL',
        now(),
        tid,
        revision,
      ),
    ]);
    if (!results[1].meta.changes) throw new AppError(409, 'Задача уже изменена');
    return { ok: true };
  }
  async addComment(actor: Actor, tid: string, body: unknown) {
    this.writable(actor);
    const value = z.string().trim().min(1).max(10000).parse(body),
      t = await this.task(tid),
      cid = id();
    await this.db.batch([
      this.statement(
        'INSERT INTO comments SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND deleted_at IS NULL)',
        cid,
        tid,
        actor.user.id,
        value,
        now(),
        tid,
      ),
      this.log(actor, 'comment_added', `Комментарий к задаче «${t.title}»`, t.project_id, tid, {
        sql: 'EXISTS(SELECT 1 FROM comments WHERE id=?)',
        args: [cid],
      }),
    ]);
    const comment = await this.one<Comment>('SELECT * FROM comments WHERE id=?', cid);
    if (!comment) throw new AppError(404, 'Задача удалена');
    return comment;
  }
  async snapshot(user: User) {
    const [workspace, members, projects, tasks, activities, favorites] = await Promise.all([
      this.workspace(),
      this.members(),
      this.projects(),
      this.tasks({ include_archived: true }),
      this.activities(),
      this.all<{ project_id: string }>('SELECT project_id FROM favorites WHERE user_id=?', user.id),
    ]);
    return {
      workspace,
      user,
      members,
      projects,
      tasks,
      activities,
      favorites: favorites.map((f) => f.project_id),
    };
  }
  async seed(actor: Actor) {
    const a = await this.createProject(actor, {
        name: 'Запуск продукта',
        key: 'PRD',
        description:
          'От идеи до первых пользователей. Исследуем, собираем и запускаем первую версию.',
        color: '#8b7bf3',
      }),
      b = await this.createProject(actor, {
        name: 'Новый сайт',
        key: 'WEB',
        description: 'Понятный сайт, который рассказывает о продукте и помогает новым клиентам.',
        color: '#4c9c87',
      }),
      c = await this.createProject(actor, {
        name: 'Контент и рост',
        key: 'GRO',
        description: 'Полезные материалы, новые каналы и регулярная работа с аудиторией.',
        color: '#e1a058',
      });
    const rows: [Project, string, string, string, number, string[]][] = [
      [a, 'Собрать обратную связь от пользователей', 'doing', 'high', 2, ['Исследование']],
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
    for (const [p, title, status, priority, due, tags] of rows) {
      const d = new Date();
      d.setDate(d.getDate() + due);
      await this.createTask(actor, {
        project_id: p.id,
        title,
        status,
        priority,
        tags,
        due_date: d.toISOString().slice(0, 10),
        assignee_id: status === 'doing' ? actor.user.id : null,
        description: 'Пример задачи. Измените её под свой процесс или удалите.',
      });
    }
    await this.run('INSERT INTO favorites VALUES (?,?)', actor.user.id, a.id);
  }
}
