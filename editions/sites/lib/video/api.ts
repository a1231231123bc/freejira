import { z } from 'zod';
import { Store } from '../freejira/store';
import { actorFor, digest } from '../freejira/api';
import { AppError, id, now } from '../freejira/validation';
import { VideoStore } from './store';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  UPLOAD_PART_BYTES,
  analysisSchema,
  frameName,
  frameSchema,
  segmentSchema,
  settingsSchema,
  validateAnalysis,
} from './contract';

type Env = { DB?: D1Database; BUCKET?: R2Bucket; VIDEO_WORKER_TOKEN?: string };
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
async function body(request: Request, limit = 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, 'Слишком большой запрос');
    }
    chunks.push(r.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(400, 'Некорректный JSON');
  }
}
async function blob(request: Request, max = UPLOAD_PART_BYTES) {
  const length = Number(request.headers.get('content-length'));
  if (!Number.isInteger(length) || length < 1 || length > max)
    throw new AppError(413, 'Неверный размер части файла');
  const reader = request.body!.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, 'Слишком большой файл');
    }
    parts.push(r.value);
  }
  if (size !== length) throw new AppError(400, 'Файл передан не полностью');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return bytes;
}
async function media(bucket: R2Bucket, key: string, request: Request, filename: string) {
  const head = await bucket.head(key);
  if (!head) throw new AppError(404, 'Файл пока недоступен');
  const range = request.headers.get('range');
  let start = 0,
    end = head.size - 1;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${head.size}` },
      });
    if (!match[1]) start = Math.max(0, head.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= head.size)
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${head.size}` },
      });
  }
  const file = await bucket.get(
    key,
    range ? { range: { offset: start, length: end - start + 1 } } : undefined,
  );
  if (!file) throw new AppError(404, 'Файл не найден');
  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${head.size}`);
  return new Response(request.method === 'HEAD' ? null : file.body, {
    status: range ? 206 : 200,
    headers,
  });
}
export async function videoHandle(request: Request, env: Env) {
  const store = new Store(env.DB!),
    videos = new VideoStore(store),
    url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/video\/?/, ''),
    method = request.method;
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin)
      throw new AppError(403, 'Запрос с другого сайта запрещён');
    if (!env.BUCKET) throw new AppError(503, 'Хранилище видео ещё не подключено');
    const bucket = env.BUCKET;
    if (path.startsWith('worker/'))
      return await worker(request, path.slice(7), env, store, videos, bucket);
    const actor = await actorFor(store, request);
    if (path === 'jobs' && method === 'GET') {
      const pid = url.searchParams.get('project_id');
      const jobs = await store.all<any>(
        `SELECT j.id,j.video_id,j.project_id,j.user_id,j.context,j.status,j.progress,j.error,j.created_at,j.updated_at,j.completed_at,v.filename,v.duration,v.has_audio FROM video_jobs j JOIN video_assets v ON v.id=j.video_id ${pid ? 'WHERE j.project_id=?' : ''} ORDER BY j.created_at DESC LIMIT 100`,
        ...(pid ? [pid] : []),
      );
      const unread = await store.all<{ id: string }>(
        "SELECT id FROM video_jobs j WHERE user_id=? AND status IN ('ready','error') AND NOT EXISTS(SELECT 1 FROM video_seen s WHERE s.job_id=j.id AND s.user_id=?) ORDER BY created_at DESC LIMIT 100",
        actor.user.id,
        actor.user.id,
      );
      const health = await store.one<{ value: string }>(
        'SELECT value FROM settings WHERE key=?',
        'video_worker_health',
      );
      return reply({
        jobs,
        unread: unread.map((j) => j.id),
        worker: health ? JSON.parse(health.value) : null,
      });
    }
    if (path === 'settings') {
      if (method === 'GET') {
        const row = await store.one<any>(
          'SELECT value FROM settings WHERE key=?',
          'video_settings',
        );
        return reply(settingsSchema.parse(row ? JSON.parse(row.value) : {}));
      }
      if (method === 'PUT') {
        store.owner(actor);
        const settings = settingsSchema.parse(await body(request));
        await store.run(
          'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          'video_settings',
          JSON.stringify(settings),
        );
        return reply(settings);
      }
    }
    if (path === 'jobs' && method === 'POST') {
      store.writable(actor);
      const f = z
        .object({
          project_id: z.string().uuid(),
          filename: z
            .string()
            .min(1)
            .max(240)
            .regex(/\.(mp4|mov|webm)$/i),
          size: z.number().int().positive().max(MAX_VIDEO_BYTES),
          context: z.string().max(4000).default(''),
        })
        .parse(await body(request));
      const project = await store.project(f.project_id);
      if (project.status === 'archived') throw new AppError(400, 'Выберите активный проект');
      await store.run(
        "UPDATE video_jobs SET status='error',error='Загрузка прервана. Загрузите файл заново',completed_at=?,updated_at=? WHERE status='uploading' AND updated_at<?",
        now(),
        now(),
        new Date(Date.now() - 24 * 3600000).toISOString(),
      );
      const pending = await store.one<{ count: number }>(
        "SELECT count(*) count FROM video_jobs WHERE status NOT IN ('ready','error')",
      );
      if ((pending?.count || 0) >= 30)
        throw new AppError(429, 'В очереди уже 30 видео. Дождитесь обработки');
      const vid = id(),
        jid = id(),
        time = now(),
        key = `video/${vid}/original`,
        type = f.filename.toLowerCase().endsWith('.webm')
          ? 'video/webm'
          : f.filename.toLowerCase().endsWith('.mov')
            ? 'video/quicktime'
            : 'video/mp4';
      const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: type },
      });
      try {
        await store.db.batch([
          store.statement(
            'INSERT INTO video_assets (id,project_id,user_id,filename,content_type,size,object_key,upload_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            vid,
            f.project_id,
            actor.user.id,
            f.filename,
            type,
            f.size,
            key,
            upload.uploadId,
            time,
          ),
          store.statement(
            'INSERT INTO video_jobs (id,video_id,project_id,user_id,context,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
            jid,
            vid,
            f.project_id,
            actor.user.id,
            f.context,
            time,
            time,
          ),
        ]);
      } catch (error) {
        await upload.abort();
        throw error;
      }
      return reply({ id: jid, part_size: UPLOAD_PART_BYTES }, 201);
    }
    const match = path.match(/^jobs\/([\w-]+)(?:\/(.*))?$/);
    if (match) {
      const j = await videos.raw(match[1]),
        sub = match[2] || '';
      if (!sub && method === 'GET') return reply(await videos.publicJob(j.id));
      if (sub === 'seen' && method === 'POST') {
        await store.run('INSERT OR IGNORE INTO video_seen VALUES (?,?)', j.id, actor.user.id);
        return reply({ ok: true });
      }
      if (sub === 'media' && ['GET', 'HEAD'].includes(method))
        return media(bucket, j.playback_key || j.object_key, request, j.filename);
      if (sub.startsWith('frames/') && ['GET', 'HEAD'].includes(method)) {
        const name = frameName.parse(sub.slice(7));
        if (!JSON.parse(j.frames_json).some((f: any) => f.name === name))
          throw new AppError(404, 'Кадр не найден');
        return media(bucket, `video/${j.video_id}/${j.id}/${name}`, request, name);
      }
      if (sub.startsWith('parts/') && method === 'PUT') {
        if (j.user_id !== actor.user.id || j.status !== 'uploading')
          throw new AppError(409, 'Загрузка уже завершена или принадлежит другому участнику');
        const n = z.coerce
          .number()
          .int()
          .min(1)
          .max(Math.ceil(j.size / UPLOAD_PART_BYTES))
          .parse(sub.slice(6));
        const bytes = await blob(request);
        const expected = Math.min(UPLOAD_PART_BYTES, j.size - (n - 1) * UPLOAD_PART_BYTES);
        if (bytes.byteLength !== expected) throw new AppError(400, 'Неверный размер части');
        const part = await bucket
          .resumeMultipartUpload(j.object_key, j.upload_id)
          .uploadPart(n, bytes);
        return reply(part);
      }
      if (sub === 'complete' && method === 'POST') {
        if (j.user_id !== actor.user.id) throw new AppError(403, 'Чужая загрузка');
        if (j.status !== 'uploading') return reply({ id: j.id, status: j.status });
        const f = z
          .object({
            parts: z
              .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().max(200) }))
              .max(63),
          })
          .parse(await body(request));
        if (
          f.parts.length !== Math.ceil(j.size / UPLOAD_PART_BYTES) ||
          f.parts.some((p, i) => p.partNumber !== i + 1)
        )
          throw new AppError(400, 'Загружены не все части');
        let object = await bucket.head(j.object_key);
        if (!object)
          object = await bucket.resumeMultipartUpload(j.object_key, j.upload_id).complete(f.parts);
        if (object.size !== j.size) throw new AppError(400, 'Размер видео не совпадает');
        await store.db.batch([
          store.statement(
            "UPDATE video_jobs SET status='uploaded',progress=5,updated_at=? WHERE id=? AND status='uploading'",
            now(),
            j.id,
          ),
          store.statement('UPDATE video_assets SET upload_id=NULL WHERE id=?', j.video_id),
        ]);
        return reply({ id: j.id, status: 'uploaded' });
      }
      if (sub === 'retry' && method === 'POST') {
        store.writable(actor);
        if (!['ready', 'error'].includes(j.status))
          throw new AppError(409, 'Разбор ещё выполняется');
        if ((await store.project(j.project_id)).status === 'archived')
          throw new AppError(400, 'Восстановите проект из архива');
        if (j.upload_id || !(await bucket.head(j.object_key)))
          throw new AppError(400, 'Видео не было загружено полностью. Загрузите файл заново');
        const pending = await store.one<{ count: number }>(
          "SELECT count(*) count FROM video_jobs WHERE status NOT IN ('ready','error')",
        );
        if ((pending?.count || 0) >= 30)
          throw new AppError(429, 'В очереди уже 30 видео. Дождитесь обработки');
        const f = z.object({ context: z.string().max(4000) }).parse(await body(request)),
          jid = id(),
          time = now();
        await store.run(
          "INSERT INTO video_jobs (id,video_id,project_id,user_id,context,status,progress,created_at,updated_at) VALUES (?,?,?,?,?,'uploaded',5,?,?)",
          jid,
          j.video_id,
          j.project_id,
          actor.user.id,
          f.context,
          time,
          time,
        );
        return reply({ id: jid }, 201);
      }
      if (sub === 'tasks' && method === 'POST')
        return reply(await videos.createTasks(actor, j.id, await body(request)));
      if (sub === 'comments' && method === 'POST') {
        store.writable(actor);
        const f = z
          .object({ body: z.string().trim().min(1).max(10000) })
          .parse(await body(request));
        await store.db.batch([
          store.statement(
            'INSERT INTO video_comments VALUES (?,?,?,?,?)',
            id(),
            j.video_id,
            actor.user.id,
            f.body,
            now(),
          ),
          store.statement(
            'DELETE FROM video_seen WHERE job_id=? AND user_id=? AND user_id!=?',
            j.id,
            j.user_id,
            actor.user.id,
          ),
        ]);
        return reply({ ok: true });
      }
      if (!sub && method === 'DELETE') {
        if (j.user_id !== actor.user.id || j.status !== 'uploading')
          throw new AppError(409, 'Можно отменить только свою незавершённую загрузку');
        try {
          await bucket.resumeMultipartUpload(j.object_key, j.upload_id).abort();
        } catch {}
        await store.run(
          "UPDATE video_jobs SET status='error',error='Загрузка отменена',updated_at=?,completed_at=? WHERE id=?",
          now(),
          now(),
          j.id,
        );
        return reply({ ok: true });
      }
    }
    const task = path.match(/^tasks\/([\w-]+)$/);
    if (task) {
      const t = await store.task(task[1]),
        link = await store.one<any>(
          'SELECT detail_json FROM video_task_links WHERE task_id=?',
          t.id,
        );
      if (method === 'GET') return reply(link ? JSON.parse(link.detail_json) : null);
      if (method === 'PATCH' && link) {
        store.writable(actor);
        const f = z
          .object({
            revision: z.number().int().positive(),
            checklist: z.array(z.boolean()).max(40),
            approver_id: z.string().uuid().nullable(),
          })
          .parse(await body(request));
        const detail = JSON.parse(link.detail_json);
        if (f.checklist.length !== detail.checklist.length)
          throw new AppError(400, 'Чек-лист изменён');
        await store.validateAssignee(f.approver_id);
        detail.approver_id = f.approver_id;
        detail.checklist.forEach((c: any, i: number) => (c.done = f.checklist[i]));
        const r = await store.db.batch([
          store.statement(
            'UPDATE video_task_links SET detail_json=? WHERE task_id=? AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND revision=? AND deleted_at IS NULL)',
            JSON.stringify(detail),
            t.id,
            t.id,
            f.revision,
          ),
          store.log(
            actor,
            'task_updated',
            `Обновлены критерии приёмки или принимающий: ${t.title}`,
            t.project_id,
            t.id,
            {
              sql: 'EXISTS(SELECT 1 FROM tasks WHERE id=? AND revision=? AND deleted_at IS NULL)',
              args: [t.id, f.revision],
            },
          ),
          store.statement(
            'UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL',
            now(),
            t.id,
            f.revision,
          ),
        ]);
        if (!r[2].meta.changes) throw new AppError(409, 'Задача изменена. Откройте её заново');
        return reply({ ...detail, revision: f.revision + 1 });
      }
    }
    throw new AppError(404, 'Метод не найден');
  } catch (e) {
    if (e instanceof AppError) return reply({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return reply({ error: e.issues.map((i) => i.message).join('; ') }, 400);
    console.error('video_api', e);
    return reply({ error: 'Не удалось выполнить действие. Повторите попытку' }, 500);
  }
}

async function worker(
  request: Request,
  path: string,
  env: Env,
  store: Store,
  videos: VideoStore,
  bucket: R2Bucket,
) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (
    !env.VIDEO_WORKER_TOKEN ||
    !token ||
    (await digest(token)) !== (await digest(env.VIDEO_WORKER_TOKEN))
  )
    throw new AppError(401, 'Обработчик не авторизован');
  if (path === 'heartbeat' && request.method === 'POST') {
    const f = z
      .object({
        name: z.string().max(100),
        ready: z.boolean(),
        message: z.string().max(500).default(''),
      })
      .parse(await body(request));
    await store.run(
      'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      'video_worker_health',
      JSON.stringify({ ...f, last_seen: now() }),
    );
    return reply({ ok: true });
  }
  if (path === 'claim' && request.method === 'POST') {
    await store.run(
      "UPDATE video_jobs SET status='error',error='Обработчик прервался трижды. Проверьте Mac и повторите разбор',completed_at=?,updated_at=? WHERE attempts>=3 AND lease_until<? AND status IN ('transcription','frames','analysis')",
      now(),
      now(),
      now(),
    );
    const lease = id(),
      until = new Date(Date.now() + 120000).toISOString();
    const row = await store
      .statement(
        "UPDATE video_jobs SET status='transcription',progress=10,lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?,error=NULL WHERE id=(SELECT j.id FROM video_jobs j JOIN users u ON u.id=j.user_id JOIN projects p ON p.id=j.project_id WHERE u.active=1 AND p.status!='archived' AND (j.status='uploaded' OR (j.status IN ('transcription','frames','analysis') AND j.lease_until<? AND j.attempts<3)) ORDER BY j.created_at LIMIT 1) RETURNING id",
        lease,
        until,
        now(),
        now(),
      )
      .first<{ id: string }>();
    if (!row) return reply({ job: null });
    const j = await videos.raw(row.id),
      settings = await store.one<any>('SELECT value FROM settings WHERE key=?', 'video_settings');
    return reply({
      job: {
        id: j.id,
        video_id: j.video_id,
        filename: j.filename,
        size: j.size,
        context: j.context,
        project: (await store.project(j.project_id)).name,
        phase: 'К выполнению',
        lease,
        settings: settingsSchema.parse(settings ? JSON.parse(settings.value) : {}),
        previous_tasks: (await videos.links(j)).map((l) => JSON.parse(l.proposal_json)),
      },
    });
  }
  const match = path.match(/^jobs\/([\w-]+)\/(.+)$/);
  if (!match) throw new AppError(404, 'Метод не найден');
  const j = await videos.raw(match[1]),
    sub = match[2],
    lease = request.headers.get('x-video-lease');
  if (
    !lease ||
    lease !== j.lease_token ||
    j.lease_until < now() ||
    !['transcription', 'frames', 'analysis'].includes(j.status)
  )
    throw new AppError(409, 'Аренда задания истекла');
  if (sub === 'media' && request.method === 'GET')
    return media(bucket, j.object_key, request, j.filename);
  if (sub.startsWith('frames/') && request.method === 'PUT') {
    const filename = frameName.parse(sub.slice(7)),
      bytes = await blob(request, 5 * 1024 * 1024);
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw new AppError(400, 'Ожидается JPEG');
    await bucket.put(`video/${j.video_id}/${j.id}/${filename}`, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    return reply({ ok: true });
  }
  // A browser-compatible copy is uploaded in bounded chunks, just like the original.
  const playbackKey = `video/${j.video_id}/${j.id}/playback.mp4`;
  if (sub === 'playback/start' && request.method === 'POST') {
    const upload = await bucket.createMultipartUpload(playbackKey, {
      httpMetadata: { contentType: 'video/mp4' },
    });
    return reply({ upload_id: upload.uploadId });
  }
  if (sub.startsWith('playback/parts/') && request.method === 'PUT') {
    const n = z.coerce.number().int().min(1).max(63).parse(sub.slice(15));
    const uploadId = z
      .string()
      .min(1)
      .max(1000)
      .parse(new URL(request.url).searchParams.get('upload_id'));
    return reply(
      await bucket.resumeMultipartUpload(playbackKey, uploadId).uploadPart(n, await blob(request)),
    );
  }
  if (sub === 'playback/complete' && request.method === 'POST') {
    const f = z
      .object({
        upload_id: z.string().min(1).max(1000),
        parts: z
          .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().max(200) }))
          .min(1)
          .max(63),
      })
      .parse(await body(request));
    if (f.parts.some((p, i) => p.partNumber !== i + 1))
      throw new AppError(400, 'Некорректные части видео');
    await bucket.resumeMultipartUpload(playbackKey, f.upload_id).complete(f.parts);
    await store.run('UPDATE video_assets SET playback_key=? WHERE id=?', playbackKey, j.video_id);
    return reply({ ok: true });
  }
  if (sub === 'playback/abort' && request.method === 'POST') {
    const f = z.object({ upload_id: z.string().min(1).max(1000) }).parse(await body(request));
    await bucket.resumeMultipartUpload(playbackKey, f.upload_id).abort();
    return reply({ ok: true });
  }
  if (sub === 'progress' && request.method === 'POST') {
    const f = z
      .object({
        status: z.enum(['transcription', 'frames', 'analysis']),
        progress: z.number().int().min(10).max(95),
      })
      .parse(await body(request));
    await store.run(
      'UPDATE video_jobs SET status=?,progress=?,updated_at=?,lease_until=? WHERE id=? AND lease_token=?',
      f.status,
      f.progress,
      now(),
      new Date(Date.now() + 120000).toISOString(),
      j.id,
      lease,
    );
    return reply({ ok: true });
  }
  if (sub === 'metadata' && request.method === 'POST') {
    const f = z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        duration: z.number().positive().max(MAX_VIDEO_SECONDS),
        has_audio: z.boolean(),
      })
      .parse(await body(request));
    await store.run(
      'UPDATE video_assets SET sha256=?,duration=?,has_audio=? WHERE id=?',
      f.sha256,
      f.duration,
      Number(f.has_audio),
      j.video_id,
    );
    return reply({ ok: true });
  }
  if (sub === 'complete' && request.method === 'POST') {
    const f = z
      .object({
        result: analysisSchema,
        frames: z.array(frameSchema).min(1).max(60),
        transcript: z.array(segmentSchema).max(3000),
        metrics: z.record(z.string(), z.unknown()),
      })
      .parse(await body(request, 2 * 1024 * 1024));
    if (!j.sha256 || !j.duration) throw new AppError(409, 'Метаданные не сохранены');
    const result = validateAnalysis(f.result, f.frames, j.duration, f.transcript, !!j.has_audio);
    if (
      f.frames.some((fr) => fr.time > j.duration) ||
      f.transcript.some((s) => s.end > j.duration + 0.1)
    )
      throw new AppError(400, 'Таймкод за пределами видео');
    for (const frame of f.frames)
      if (!(await bucket.head(`video/${j.video_id}/${j.id}/${frame.name}`)))
        throw new AppError(400, 'Не все кадры загружены');
    await store.run(
      "UPDATE video_jobs SET status='ready',progress=100,result_json=?,frames_json=?,transcript_json=?,metrics_json=?,completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND lease_token=?",
      JSON.stringify(result),
      JSON.stringify(f.frames),
      JSON.stringify(f.transcript),
      JSON.stringify(f.metrics),
      now(),
      now(),
      j.id,
      lease,
    );
    return reply({ ok: true });
  }
  if (sub === 'error' && request.method === 'POST') {
    const f = z
      .object({
        error: z.string().max(1000),
        metrics: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(await body(request));
    await store.run(
      "UPDATE video_jobs SET status='error',error=?,metrics_json=?,completed_at=?,updated_at=?,lease_until=NULL WHERE id=? AND lease_token=?",
      f.error,
      JSON.stringify(f.metrics),
      now(),
      now(),
      j.id,
      lease,
    );
    return reply({ ok: true });
  }
  throw new AppError(404, 'Метод не найден');
}
