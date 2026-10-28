import { z } from 'zod';
import { Store } from '../freejira/store';
import { AppError, id, now, type Actor } from '../freejira/validation';
import { digest } from '../freejira/api';
import {
  analysisSchema,
  matchingDate,
  matchingMember,
  normalize,
  proposalSchema,
  type Analysis,
  type Proposal,
  type TaskDraft,
  type VideoJob,
} from './contract';
import type { TaskVideo } from '../../shared/types';

const selectedSchema = z.object({
  id: proposalSchema.shape.id,
  title: proposalSchema.shape.title,
  type: proposalSchema.shape.type,
  priority: proposalSchema.shape.priority,
  description: proposalSchema.shape.description,
  acceptance_criteria: proposalSchema.shape.acceptance_criteria,
  frames: proposalSchema.shape.frames,
  assignee_id: z.string().uuid().nullable(),
  approver_id: z.string().uuid().nullable(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export class VideoStore {
  constructor(public store: Store) {}
  async raw(jid: string) {
    const job = await this.store.one<any>(
      'SELECT j.*,v.filename,v.size,v.content_type,v.object_key,v.upload_id,v.sha256,v.duration,v.has_audio,v.playback_key FROM video_jobs j JOIN video_assets v ON v.id=j.video_id WHERE j.id=?',
      jid,
    );
    if (!job) throw new AppError(404, 'Разбор видео не найден');
    return job;
  }
  async links(job: any) {
    return this.store.all<any>(
      'SELECT l.*,t.deleted_at FROM video_task_links l JOIN tasks t ON t.id=l.task_id JOIN video_assets v ON v.id=l.video_id WHERE l.project_id=? AND (l.video_id=? OR v.sha256=?)',
      job.project_id,
      job.video_id,
      job.sha256,
    );
  }
  duplicate(task: Proposal, links: any[]) {
    const title = normalize(task.title);
    return links.find((l) => {
      const old = JSON.parse(l.proposal_json) as Proposal;
      if (normalize(old.title) === title) return true;
      // Same evidence and near-identical action survives regenerated T1/T2 IDs and wording.
      if (!task.quote || normalize(task.quote) !== normalize(old.quote) || task.time !== old.time)
        return false;
      const a = new Set(title.split(' ')),
        b = new Set(normalize(old.title).split(' '));
      const overlap = [...a].filter((w) => b.has(w)).length;
      return overlap / Math.max(a.size, b.size) >= 0.75;
    });
  }
  async publicJob(jid: string): Promise<VideoJob> {
    const j = await this.raw(jid),
      result: Analysis | null = j.result_json
        ? analysisSchema.parse(JSON.parse(j.result_json))
        : null;
    const [members, links, comments] = await Promise.all([
      this.store.members(),
      this.links(j),
      this.store.all<any>(
        'SELECT * FROM video_comments WHERE video_id=? ORDER BY created_at',
        j.video_id,
      ),
    ]);
    const drafts: TaskDraft[] =
      result?.tasks.map((t) => ({
        ...t,
        selected: t.confidence !== 'low' && !this.duplicate(t, links),
        assignee_id: matchingMember(t.assignee, members),
        approver_id: null,
        due_date: matchingDate(t.due, j.created_at.slice(0, 10)),
        existing_task_id: this.duplicate(t, links)?.task_id || null,
      })) || [];
    return {
      id: j.id,
      video_id: j.video_id,
      project_id: j.project_id,
      user_id: j.user_id,
      filename: j.filename,
      context: j.context,
      status: j.status,
      progress: j.progress,
      error: j.error,
      created_at: j.created_at,
      updated_at: j.updated_at,
      completed_at: j.completed_at,
      duration: j.duration,
      has_audio: j.has_audio,
      result,
      frames: JSON.parse(j.frames_json),
      transcript: JSON.parse(j.transcript_json),
      metrics: JSON.parse(j.metrics_json),
      drafts,
      comments,
    };
  }
  async createTasks(actor: Actor, jid: string, input: unknown) {
    this.store.writable(actor);
    const selection = z
      .object({ confirmed: z.literal(true), tasks: z.array(selectedSchema).min(1).max(100) })
      .parse(input);
    if (new Set(selection.tasks.map((t) => t.id)).size !== selection.tasks.length)
      throw new AppError(400, 'Задача выбрана дважды');
    const job = await this.raw(jid);
    if (job.status !== 'ready' || !job.sha256)
      throw new AppError(409, 'Сначала дождитесь завершения разбора');
    const result = analysisSchema.parse(JSON.parse(job.result_json));
    const project = await this.store.project(job.project_id);
    if (project.status === 'archived') throw new AppError(400, 'Восстановите проект из архива');
    const links = await this.links(job),
      out: { task_id: string; created: boolean }[] = [];
    const available = new Set(JSON.parse(job.frames_json).map((f: any) => f.name));
    // Validate the entire submission before any writes.
    for (const t of selection.tasks) {
      if (!result.tasks.some((p) => p.id === t.id) || t.frames.some((f) => !available.has(f)))
        throw new AppError(400, 'Предложение или кадр не принадлежит этому разбору');
      await this.store.validateAssignee(t.assignee_id);
      await this.store.validateAssignee(t.approver_id);
      if (t.due_date && matchingDate(t.due_date, job.created_at.slice(0, 10)) !== t.due_date)
        throw new AppError(400, 'Некорректная дата');
    }
    for (const t of selection.tasks) {
      const original = result.tasks.find((p) => p.id === t.id)!;
      const duplicate = this.duplicate(original, links);
      if (duplicate) {
        out.push({ task_id: duplicate.task_id, created: false });
        continue;
      }
      const fingerprint = await digest(`${job.sha256}\n${normalize(original.title)}`),
        tid = id(),
        timestamp = now();
      const detail: TaskVideo = {
        job_id: jid,
        video_id: job.video_id,
        source: 'Из видео',
        type: t.type,
        approver_id: t.approver_id,
        time: original.time,
        quote: original.quote,
        frames: t.frames,
        checklist: t.acceptance_criteria.map((text) => ({ text, done: false })),
        description_doc: [
          { type: 'paragraph', text: t.description },
          ...(original.quote ? [{ type: 'quote' as const, text: original.quote }] : []),
        ],
      };
      const description = `${t.description}${original.location ? `\n\nГде: ${original.location}` : ''}${original.quote ? `\n\nЦитата: «${original.quote}»` : ''}\n\nВидео (${original.time}): #video/${jid}?t=${original.time}`;
      const sql =
        "INSERT INTO tasks (id,project_id,number,title,description,status,priority,assignee_id,due_date,tags,created_at,updated_at) SELECT ?,?,COALESCE(MAX(number),0)+1,?,?,'todo',?,?,?,'[\"Из видео\"]',?,? FROM tasks WHERE project_id=? HAVING NOT EXISTS(SELECT 1 FROM video_task_links WHERE project_id=? AND fingerprint=?) AND EXISTS(SELECT 1 FROM projects WHERE id=? AND status!='archived')";
      const rows = await this.store.db.batch([
        this.store.statement(
          sql,
          tid,
          project.id,
          t.title,
          description,
          t.priority,
          t.assignee_id,
          t.due_date,
          timestamp,
          timestamp,
          project.id,
          project.id,
          fingerprint,
          project.id,
        ),
        this.store.statement(
          'INSERT INTO video_task_links SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=?)',
          tid,
          jid,
          job.video_id,
          project.id,
          fingerprint,
          JSON.stringify(original),
          JSON.stringify(detail),
          tid,
        ),
        this.store.log(
          actor,
          'task_created_from_video',
          `Создана из видео «${job.filename}», ${original.time}: ${t.title}`,
          project.id,
          tid,
          { sql: 'EXISTS(SELECT 1 FROM tasks WHERE id=?)', args: [tid] },
        ),
      ]);
      const link = await this.store.one<any>(
        'SELECT * FROM video_task_links WHERE project_id=? AND fingerprint=?',
        project.id,
        fingerprint,
      );
      if (!link) throw new AppError(409, 'Проект изменён. Обновите страницу');
      links.push(link);
      out.push({ task_id: link.task_id, created: !!rows[0].meta.changes });
    }
    return { tasks: out, created: out.filter((t) => t.created).length };
  }
}
