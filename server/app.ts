import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppError, id, now, Store } from './store.ts';
import {
  authenticate,
  cookie,
  credentials,
  createUser,
  hash,
  passwordMatches,
  passwordHash,
  registration,
  secret,
  session,
} from './auth.ts';
import { createMcpServer } from './mcp.ts';

export function createApp(store: Store) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              directives: {
                'script-src': ["'self'"],
                'style-src': ["'self'", "'unsafe-inline'"],
                'img-src': ["'self'", 'data:'],
                'connect-src': ["'self'"],
                'upgrade-insecure-requests': null,
              },
            }
          : false,
    }),
  );
  app.use(express.json({ limit: '128kb' }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/mcp')
      res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const expected = process.env.PUBLIC_URL
      ? new URL(process.env.PUBLIC_URL).origin
      : `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== expected)
      return res.status(403).json({ error: 'Запрос с другого сайта запрещён' });
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Слишком много попыток. Повторите через 15 минут.' },
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/status', (req, res) => {
    let user = null;
    try {
      user = authenticate(store, req).user;
    } catch {}
    res.json({ initialized: store.members().length > 0, user, workspace: store.workspace() });
  });
  app.post('/api/auth/setup', authLimit, (req, res) => {
    const input = registration
      .extend({ workspace: z.string().trim().min(1).max(80), demo: z.boolean().default(false) })
      .parse(req.body);
    const user = store.transaction(() => {
      if (store.members().length) throw new AppError(409, 'Пространство уже создано');
      const user = createUser(store, input, 'owner');
      store.run('INSERT INTO settings VALUES (?,?)', 'workspace', input.workspace);
      return user;
    });
    if (input.demo) store.seed({ user, source: 'web' });
    session(store, user, res);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', authLimit, (req, res) => {
    const input = credentials.parse(req.body);
    const row = store.one<{ id: string; password: string; active: number }>(
      'SELECT id,password,active FROM users WHERE email=?',
      input.email,
    );
    if (!row || !row.active || !passwordMatches(input.password, row.password))
      throw new AppError(401, 'Неверный email или пароль');
    const user = store.members().find((u) => u.id === row.id)!;
    session(store, user, res);
    res.json({ user });
  });
  app.post('/api/auth/logout', (req, res) => {
    store.run('DELETE FROM sessions WHERE hash=?', hash(cookie(req)));
    res.clearCookie('fj_session', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/auth/invite/:token', authLimit, (req, res) => {
    const invite = store.one<{ email: string }>(
      'SELECT email FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>?',
      hash(String(req.params.token)),
      now(),
    );
    if (!invite) throw new AppError(404, 'Приглашение истекло или уже использовано');
    res.json({ ...invite, workspace: store.workspace() });
  });
  app.post('/api/auth/join', authLimit, (req, res) => {
    const input = registration.extend({ token: z.string().min(20).max(100) }).parse(req.body);
    const user = store.transaction(() => {
      const invite = store.one<{ id: string; email: string }>(
        'SELECT id,email FROM invites WHERE hash=? AND used_at IS NULL AND expires_at>?',
        hash(input.token),
        now(),
      );
      if (!invite || invite.email.toLowerCase() !== input.email)
        throw new AppError(400, 'Приглашение недействительно для этого email');
      const user = createUser(store, input, 'member');
      store.run('UPDATE invites SET used_at=? WHERE id=?', now(), invite.id);
      store.log({ user, source: 'web' }, 'member_joined', `${user.name} присоединился к команде`);
      return user;
    });
    session(store, user, res);
    res.status(201).json({ user });
  });
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next(new AppError(404, 'Метод не найден'));
    try {
      res.locals.actor = authenticate(store, req);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/snapshot', (_req, res) => res.json(store.snapshot(res.locals.actor.user)));
  app.post('/api/projects', (req, res) =>
    res.status(201).json(store.createProject(res.locals.actor, req.body)),
  );
  app.patch('/api/projects/:id', (req, res) =>
    res.json(store.updateProject(res.locals.actor, req.params.id, req.body)),
  );
  app.post('/api/tasks', (req, res) =>
    res.status(201).json(store.createTask(res.locals.actor, req.body)),
  );
  app.get('/api/tasks/:id', (req, res) => res.json(store.task(req.params.id)));
  app.patch('/api/tasks/:id', (req, res) =>
    res.json(store.updateTask(res.locals.actor, req.params.id, req.body)),
  );
  app.delete('/api/tasks/:id', (req, res) =>
    res.json(
      store.deleteTask(
        res.locals.actor,
        req.params.id,
        z.number().int().positive().parse(req.body.revision),
      ),
    ),
  );
  app.get('/api/tasks/:id/comments', (req, res) => res.json(store.comments(req.params.id)));
  app.post('/api/tasks/:id/comments', (req, res) =>
    res.status(201).json(store.addComment(res.locals.actor, req.params.id, req.body.body)),
  );
  app.put('/api/favorites/:id', (req, res) => {
    store.project(req.params.id);
    const { favorite } = z.object({ favorite: z.boolean() }).parse(req.body);
    if (favorite)
      store.run(
        'INSERT OR IGNORE INTO favorites VALUES (?,?)',
        res.locals.actor.user.id,
        req.params.id,
      );
    else
      store.run(
        'DELETE FROM favorites WHERE user_id=? AND project_id=?',
        res.locals.actor.user.id,
        req.params.id,
      );
    res.json({ ok: true });
  });
  app.patch('/api/profile', (req, res) => {
    const name = z.string().trim().min(1).max(80).parse(req.body.name);
    store.run('UPDATE users SET name=? WHERE id=?', name, res.locals.actor.user.id);
    res.json({ ok: true });
  });
  app.post('/api/profile/password', (req, res) => {
    const input = z
      .object({ current: z.string().max(128), password: credentials.shape.password })
      .parse(req.body);
    const row = store.one<{ password: string }>(
      'SELECT password FROM users WHERE id=?',
      res.locals.actor.user.id,
    )!;
    if (!passwordMatches(input.current, row.password))
      throw new AppError(400, 'Текущий пароль неверен');
    store.transaction(() => {
      store.run(
        'UPDATE users SET password=? WHERE id=?',
        passwordHash(input.password),
        res.locals.actor.user.id,
      );
      store.run('DELETE FROM sessions WHERE user_id=?', res.locals.actor.user.id);
    });
    session(store, res.locals.actor.user, res);
    res.json({ ok: true });
  });
  app.patch('/api/workspace', (req, res) => {
    store.owner(res.locals.actor);
    const name = z.string().trim().min(1).max(80).parse(req.body.name);
    store.run('UPDATE settings SET value=? WHERE key=?', name, 'workspace');
    res.json({ ok: true });
  });
  app.get('/api/invites', (_req, res) => {
    store.owner(res.locals.actor);
    res.json(
      store.all(
        'SELECT id,email,expires_at,created_at FROM invites WHERE used_at IS NULL AND expires_at>?',
        now(),
      ),
    );
  });
  app.post('/api/invites', (req, res) => {
    store.owner(res.locals.actor);
    const email = z.email().max(254).parse(req.body.email).toLowerCase();
    if (store.one('SELECT id FROM users WHERE email=?', email))
      throw new AppError(409, 'Участник уже зарегистрирован');
    const token = secret();
    store.run('DELETE FROM invites WHERE email=? AND used_at IS NULL', email);
    const iid = id();
    store.run(
      'INSERT INTO invites (id,hash,email,created_by,expires_at,created_at) VALUES (?,?,?,?,?,?)',
      iid,
      hash(token),
      email,
      res.locals.actor.user.id,
      new Date(Date.now() + 7 * 86400000).toISOString(),
      now(),
    );
    res.status(201).json({ id: iid, token });
  });
  app.delete('/api/invites/:id', (req, res) => {
    store.owner(res.locals.actor);
    store.run('DELETE FROM invites WHERE id=?', req.params.id);
    res.json({ ok: true });
  });
  app.patch('/api/members/:id', (req, res) => {
    store.owner(res.locals.actor);
    const active = z.boolean().parse(req.body.active);
    const user = store.members().find((u) => u.id === req.params.id);
    if (!user) throw new AppError(404, 'Участник не найден');
    if (user.role === 'owner') throw new AppError(400, 'Нельзя отключить владельца');
    store.transaction(() => {
      store.run('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, user.id);
      if (!active) {
        store.run('DELETE FROM sessions WHERE user_id=?', user.id);
        store.run('DELETE FROM tokens WHERE user_id=?', user.id);
      }
      store.log(
        res.locals.actor,
        'member_updated',
        `${user.name}: доступ ${active ? 'восстановлен' : 'отключён'}`,
      );
    });
    res.json({ ok: true });
  });
  app.get('/api/tokens', (_req, res) =>
    res.json(
      store.all(
        'SELECT id,name,scope,last_used_at,created_at FROM tokens WHERE user_id=? ORDER BY created_at DESC',
        res.locals.actor.user.id,
      ),
    ),
  );
  app.post('/api/tokens', (req, res) => {
    const { name, scope } = z
      .object({ name: z.string().trim().min(1).max(80), scope: z.enum(['read', 'write']) })
      .parse(req.body);
    const token = `fj_${secret()}`,
      tid = id();
    store.run(
      'INSERT INTO tokens (id,hash,user_id,name,scope,created_at) VALUES (?,?,?,?,?,?)',
      tid,
      hash(token),
      res.locals.actor.user.id,
      name,
      scope,
      now(),
    );
    res.status(201).json({ id: tid, token });
  });
  app.delete('/api/tokens/:id', (req, res) => {
    store.run(
      'DELETE FROM tokens WHERE id=? AND user_id=?',
      req.params.id,
      res.locals.actor.user.id,
    );
    res.json({ ok: true });
  });
  app.get('/api/export', (_req, res) => {
    const s = store.snapshot(res.locals.actor.user);
    res.setHeader('Content-Disposition', 'attachment; filename="freejira-export.json"');
    res.json({
      version: 1,
      exported_at: now(),
      ...s,
      comments: store.all(
        'SELECT c.* FROM comments c JOIN tasks t ON c.task_id=t.id WHERE t.deleted_at IS NULL',
      ),
    });
  });
  app.all('/mcp', async (req, res, next) => {
    try {
      const actor = authenticate(store, req, true);
      if (req.method !== 'POST')
        return res
          .status(405)
          .setHeader('Allow', 'POST')
          .json({ error: 'Use Streamable HTTP POST' });
      const server = createMcpServer(store, actor);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      next(e);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод не найден' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Некорректный JSON' });
    console.error(err);
    res.status(500).json({ error: 'Не удалось выполнить запрос' });
  });
  return app;
}
