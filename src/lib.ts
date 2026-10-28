import type { Task, User } from '../shared/types';
export async function api<T = any>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Нет связи с сервером');
  }
  return res.json();
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const overdue = (t: Task) => !!t.due_date && t.due_date < today() && t.status !== 'done';
export const dateLabel = (date: string | null) =>
  date
    ? new Date(`${date}T12:00:00`)
        .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
        .replace('.', '')
    : 'Без срока';
export const timeLabel = (date: string) =>
  new Date(date).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const person = (members: User[], id: string | null) => members.find((u) => u.id === id);
export const colors = ['#8b7bf3', '#4c9c87', '#e1a058', '#da7793', '#5e9cce', '#b986bd', '#778296'];
export const avatarColor = (name: string) =>
  colors[Array.from(name).reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length];
