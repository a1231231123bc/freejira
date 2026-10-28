import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const mcpConnections = sqliteTable(
  'mcp_connections',
  {
    id: text('id').primaryKey(),
    token_hash: text('token_hash').notNull().unique(),
    user_id: text('user_id').references(() => users.id),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    created_at: text('created_at').notNull(),
    pair_expires_at: text('pair_expires_at').notNull(),
    expires_at: text('expires_at').notNull(),
    last_used_at: text('last_used_at'),
    revoked_at: text('revoked_at'),
  },
  (t) => [index('mcp_connection_user').on(t.user_id)],
);
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    external_id: text('external_id').notNull().unique(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    role: text('role').notNull(),
    active: integer('active').notNull().default(1),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('one_owner')
      .on(t.role)
      .where(sql`${t.role} = 'owner'`),
  ],
);
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  hash: text('hash').notNull().unique(),
  email: text('email').notNull(),
  created_by: text('created_by')
    .notNull()
    .references(() => users.id),
  expires_at: text('expires_at').notNull(),
  used_at: text('used_at'),
  created_at: text('created_at').notNull(),
});
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  description: text('description').notNull(),
  color: text('color').notNull(),
  status: text('status').notNull(),
  target_date: text('target_date'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  revision: integer('revision').notNull().default(1),
});
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull(),
    priority: text('priority').notNull(),
    assignee_id: text('assignee_id').references(() => users.id),
    due_date: text('due_date'),
    tags: text('tags').notNull().default('[]'),
    position: integer('position').notNull().default(0),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    revision: integer('revision').notNull().default(1),
    deleted_at: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('task_number').on(t.project_id, t.number),
    index('tasks_project').on(t.project_id, t.deleted_at),
    index('tasks_assignee').on(t.assignee_id),
  ],
);
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('comments_task').on(t.task_id)],
);
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    project_id: text('project_id').references(() => projects.id),
    task_id: text('task_id').references(() => tasks.id),
    action: text('action').notNull(),
    detail: text('detail').notNull(),
    source: text('source').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('activity_time').on(t.created_at)],
);
export const favorites = sqliteTable(
  'favorites',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (t) => [uniqueIndex('favorite_unique').on(t.user_id, t.project_id)],
);

export const videoAssets = sqliteTable('video_assets', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .references(() => projects.id),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id),
  filename: text('filename').notNull(),
  content_type: text('content_type').notNull(),
  size: integer('size').notNull(),
  object_key: text('object_key').notNull(),
  upload_id: text('upload_id'),
  sha256: text('sha256'),
  duration: integer('duration'),
  has_audio: integer('has_audio'),
  playback_key: text('playback_key'),
  created_at: text('created_at').notNull(),
});
export const videoJobs = sqliteTable(
  'video_jobs',
  {
    id: text('id').primaryKey(),
    video_id: text('video_id')
      .notNull()
      .references(() => videoAssets.id),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    context: text('context').notNull().default(''),
    status: text('status').notNull().default('uploading'),
    progress: integer('progress').notNull().default(0),
    error: text('error'),
    result_json: text('result_json'),
    transcript_json: text('transcript_json').notNull().default('[]'),
    frames_json: text('frames_json').notNull().default('[]'),
    metrics_json: text('metrics_json').notNull().default('{}'),
    lease_token: text('lease_token'),
    lease_until: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    completed_at: text('completed_at'),
  },
  (t) => [
    index('video_queue').on(t.status, t.created_at),
    index('video_project').on(t.project_id, t.created_at),
  ],
);
export const videoTaskLinks = sqliteTable(
  'video_task_links',
  {
    task_id: text('task_id')
      .primaryKey()
      .references(() => tasks.id),
    job_id: text('job_id')
      .notNull()
      .references(() => videoJobs.id),
    video_id: text('video_id')
      .notNull()
      .references(() => videoAssets.id),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
    fingerprint: text('fingerprint').notNull(),
    proposal_json: text('proposal_json').notNull(),
    detail_json: text('detail_json').notNull(),
  },
  (t) => [uniqueIndex('video_task_once').on(t.project_id, t.fingerprint)],
);
export const videoComments = sqliteTable('video_comments', {
  id: text('id').primaryKey(),
  video_id: text('video_id')
    .notNull()
    .references(() => videoAssets.id),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  created_at: text('created_at').notNull(),
});
export const videoSeen = sqliteTable(
  'video_seen',
  {
    job_id: text('job_id')
      .notNull()
      .references(() => videoJobs.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex('video_seen_once').on(t.job_id, t.user_id)],
);
