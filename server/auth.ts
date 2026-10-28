import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, id, now, type Store, type Actor } from './store.ts';
import type { User } from '../shared/types.ts';
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const passwordHash = (value: string) => {
  const salt = secret();
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
};
export function passwordMatches(value: string, stored: string) {
  const [salt, key] = stored.split(':');
  const actual = scryptSync(value, salt, 64);
  return timingSafeEqual(Buffer.from(key, 'hex'), actual);
}
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10, 'Пароль должен содержать не меньше 10 символов').max(128),
});
export const registration = credentials.extend({ name: z.string().trim().min(1).max(80) });
export function createUser(
  store: Store,
  input: z.infer<typeof registration>,
  role: 'owner' | 'member',
): User {
  const uid = id();
  if (store.one('SELECT id FROM users WHERE email=?', input.email))
    throw new AppError(409, 'Этот email уже зарегистрирован');
  store.run(
    'INSERT INTO users (id,name,email,password,role,created_at) VALUES (?,?,?,?,?,?)',
    uid,
    input.name,
    input.email,
    passwordHash(input.password),
    role,
    now(),
  );
  return store.members().find((u) => u.id === uid)!;
}
export function session(store: Store, user: User, res: Response) {
  const token = secret();
  store.run('DELETE FROM sessions WHERE expires_at<?', now());
  store.run(
    'INSERT INTO sessions VALUES (?,?,?)',
    hash(token),
    user.id,
    new Date(Date.now() + 30 * 86400000).toISOString(),
  );
  res.cookie('fj_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.SECURE_COOKIES === 'true',
    maxAge: 30 * 86400000,
    path: '/',
  });
}
export function cookie(req: Request) {
  const value = req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('fj_session='))
    ?.slice(11);
  return value || '';
}
export function authenticate(store: Store, req: Request, mcp = false): Actor {
  let uid: string | undefined, scope: 'read' | 'write' | undefined;
  if (mcp) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (token) {
      const row = store.one<{ user_id: string; scope: 'read' | 'write' }>(
        'SELECT user_id,scope FROM tokens WHERE hash=?',
        hash(token),
      );
      if (row) {
        uid = row.user_id;
        scope = row.scope;
        store.run('UPDATE tokens SET last_used_at=? WHERE hash=?', now(), hash(token));
      }
    }
  } else {
    uid = store.one<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE hash=? AND expires_at>?',
      hash(cookie(req)),
      now(),
    )?.user_id;
  }
  const user = uid ? store.members().find((u) => u.id === uid && u.active) : undefined;
  if (!user) throw new AppError(401, 'Войдите в рабочее пространство');
  return { user, source: mcp ? 'mcp' : 'web', scope };
}
