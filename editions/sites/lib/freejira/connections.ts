import { z } from 'zod';
import { Store } from './store';
import { AppError, id, now, type Actor } from './validation';
import type { User } from '../../shared/types';

const hash = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
type Connection = {
  id: string;
  user_id: string | null;
  name: string;
  scope: 'read' | 'tasks';
  expires_at: string;
  pair_expires_at: string;
  revoked_at: string | null;
};
const metadata = 'id,name,scope,created_at,last_used_at,expires_at,revoked_at';
export async function requestConnection(store: Store, input: unknown) {
  const { name, scope } = z
    .object({
      name: z.string().trim().min(1).max(80),
      scope: z.enum(['read', 'tasks']).default('tasks'),
    })
    .parse(input);
  await store.run('DELETE FROM mcp_connections WHERE user_id IS NULL AND pair_expires_at<?', now());
  const cid = id(),
    token =
      'fj_mcp_' +
      Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
  const time = now(),
    pairExpires = new Date(Date.now() + 10 * 60_000).toISOString(),
    expires = new Date(Date.now() + 365 * 86400_000).toISOString();
  const result = await store.run(
    'INSERT INTO mcp_connections (id,token_hash,name,scope,created_at,pair_expires_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM mcp_connections WHERE user_id IS NULL)<100',
    cid,
    await hash(token),
    name,
    scope,
    time,
    pairExpires,
    expires,
  );
  if (!result.meta.changes)
    throw new AppError(429, 'Слишком много запросов на подключение. Повторите позже.');
  return {
    id: cid,
    token,
    pair_expires_at: pairExpires,
    approval_path: `/?connect=${cid}#integrations`,
  };
}
async function byToken(store: Store, request: Request): Promise<Connection> {
  const token = request.headers.get('authorization')?.match(/^Bearer (fj_mcp_[a-f0-9]{64})$/)?.[1];
  const row = token
    ? await store.one<Connection>(
        'SELECT * FROM mcp_connections WHERE token_hash=?',
        await hash(token),
      )
    : null;
  if (!row || row.revoked_at || row.expires_at <= now())
    throw new AppError(
      401,
      'Подключение MCP недействительно, отозвано или истекло. Подключите Claude Code заново.',
    );
  return row;
}
export async function connectionStatus(store: Store, request: Request) {
  const row = await byToken(store, request);
  if (!row.user_id) {
    if (row.pair_expires_at <= now()) throw new AppError(410, 'Время подключения истекло');
    return { status: 'pending' };
  }
  const user = await store.one<User>(
    'SELECT id,name,email,role,active,created_at FROM users WHERE id=? AND active=1',
    row.user_id,
  );
  if (!user) throw new AppError(403, 'Доступ участника отключён');
  return {
    status: 'connected',
    id: row.id,
    name: row.name,
    scope: row.scope,
    user: { id: user.id, name: user.name },
    expires_at: row.expires_at,
  };
}
export async function connectionActor(store: Store, request: Request): Promise<Actor> {
  const row = await byToken(store, request);
  if (!row.user_id) throw new AppError(401, 'Сначала подтвердите подключение на сайте Freejira');
  const user = await store.one<User>(
    'SELECT id,name,email,role,active,created_at FROM users WHERE id=? AND active=1',
    row.user_id,
  );
  if (!user) throw new AppError(403, 'Доступ участника отключён');
  await store.run('UPDATE mcp_connections SET last_used_at=? WHERE id=?', now(), row.id);
  return { user, source: 'mcp', scope: row.scope };
}
export async function connectionRoutes(
  store: Store,
  actor: Actor,
  path: string,
  method: string,
  input: any,
) {
  if (path === '/api/mcp/connections' && method === 'GET')
    return store.all(
      `SELECT ${metadata} FROM mcp_connections WHERE user_id=? ORDER BY created_at DESC`,
      actor.user.id,
    );
  const match = path.match(/^\/api\/mcp\/connections\/([^/]+)$/);
  if (!match) throw new AppError(404, 'Подключение не найдено');
  const cid = z.string().uuid().parse(match[1]);
  const row = await store.one<Connection>('SELECT * FROM mcp_connections WHERE id=?', cid);
  if (!row || (row.user_id && row.user_id !== actor.user.id))
    throw new AppError(404, 'Подключение не найдено');
  if (method === 'DELETE') {
    await store.db.batch([
      store.statement('UPDATE mcp_connections SET revoked_at=? WHERE id=?', now(), cid),
      store.log(actor, 'mcp_disconnected', `Отключён MCP: ${row.name}`),
    ]);
    return { ok: true };
  }
  if (row.revoked_at || row.expires_at <= now() || (!row.user_id && row.pair_expires_at <= now()))
    throw new AppError(410, 'Запрос подключения истёк или отозван');
  if (method === 'GET')
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      connected: !!row.user_id,
      expires_at: row.expires_at,
      pair_expires_at: row.pair_expires_at,
    };
  if (method === 'POST') {
    z.object({ approve: z.literal(true) }).parse(input);
    if (row.user_id) return { ok: true };
    const result = await store.db.batch([
      store.log(actor, 'mcp_connected', `Подключён MCP: ${row.name}`, null, null, {
        sql: 'EXISTS(SELECT 1 FROM mcp_connections WHERE id=? AND user_id IS NULL AND revoked_at IS NULL AND pair_expires_at>?)',
        args: [cid, now()],
      }),
      store.statement(
        'UPDATE mcp_connections SET user_id=? WHERE id=? AND user_id IS NULL AND revoked_at IS NULL AND pair_expires_at>?',
        actor.user.id,
        cid,
        now(),
      ),
    ]);
    if (!result[1].meta.changes) throw new AppError(409, 'Запрос подключения уже обработан');
    return { ok: true };
  }
  throw new AppError(405, 'Метод не поддерживается');
}

export function allowedTool(actor: Actor, name: string, read: boolean) {
  return (
    !actor.scope ||
    actor.scope === 'write' ||
    read ||
    (actor.scope === 'tasks' && ['update_task', 'add_comment'].includes(name))
  );
}
