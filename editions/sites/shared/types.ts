export const STATUSES = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
  active: number;
  created_at: string;
};
export type Project = {
  id: string;
  name: string;
  key: string;
  description: string;
  color: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  target_date: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};
export type Task = {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee_id: string | null;
  due_date: string | null;
  tags: string[];
  position: number;
  created_at: string;
  updated_at: string;
  revision: number;
};
export type Activity = {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  action: string;
  detail: string;
  source: string;
  created_at: string;
};
export type Comment = {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
};
export type Snapshot = {
  workspace: { name: string };
  user: User;
  members: User[];
  projects: Project[];
  tasks: Task[];
  activities: Activity[];
  favorites: string[];
};
export type TaskVideo = {
  job_id: string;
  video_id: string;
  source: 'Из видео';
  type: string;
  approver_id: string | null;
  time: string;
  quote: string;
  frames: string[];
  checklist: { text: string; done: boolean }[];
  description_doc: { type: 'paragraph' | 'quote'; text: string }[];
};
export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  doing: 'В работе',
  review: 'На проверке',
  done: 'Готово',
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Срочный',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};
