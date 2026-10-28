'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Film,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import type { Snapshot, TaskVideo } from '../shared/types';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  STATE_LABEL,
  TYPE_LABEL,
  formatTime,
  seconds,
  type TaskDraft,
  type VideoJob,
} from '../lib/video/contract';
import { api, timeLabel } from './lib';
import './video.css';

type WorkerHealth = { name: string; ready: boolean; message: string; last_seen: string } | null;
type Listing = { jobs: VideoJob[]; unread: string[]; worker: WorkerHealth };
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие';
const jobUrl = (id: string) => `/video/jobs/${id}`;

export function VideoNotifications({
  userId,
  notify,
}: {
  userId: string;
  notify: (m: string) => void;
}) {
  const [count, setCount] = useState(0),
    announced = useRef(new Set<string>());
  useEffect(() => {
    const load = () =>
      api<Listing>('/video/jobs')
        .then((r) => {
          setCount(r.unread.length);
          for (const id of announced.current)
            if (!r.unread.includes(id)) announced.current.delete(id);
          for (const id of r.unread)
            if (!announced.current.has(id)) {
              announced.current.add(id);
              const j = r.jobs.find((j) => j.id === id);
              if (j)
                notify(
                  j.status === 'ready'
                    ? `Разбор «${j.filename}» готов или обновлён. Откройте «Задачи из видео»`
                    : `Не удалось разобрать «${j.filename}». Подробности в «Задачах из видео»`,
                );
            }
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [userId]);
  return (
    <a
      className="video-notifications icon-btn"
      href="#videos"
      aria-label={`Задачи из видео${count ? `, новых: ${count}` : ''}`}
    >
      <Film size={18} />
      {count > 0 && <b>{count}</b>}
    </a>
  );
}

export function VideoHub({
  data,
  route,
  notify,
  reload,
}: {
  data: Snapshot;
  route: string;
  notify: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const query = new URLSearchParams(route.split('?')[1] || ''),
    jid = route.split('?')[0].split('/')[1];
  const [listing, setListing] = useState<Listing>({ jobs: [], unread: [], worker: null }),
    [job, setJob] = useState<VideoJob | null>(null);
  const [error, setError] = useState(''),
    [uploadOpen, setUploadOpen] = useState(query.has('upload'));
  const projectId = query.get('project') || '';
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (jid) {
          const j = await api<VideoJob>(jobUrl(jid));
          if (live) setJob(j);
          if (['ready', 'error'].includes(j.status)) await api(`${jobUrl(jid)}/seen`, 'POST', {});
        } else {
          const r = await api<Listing>(`/video/jobs${projectId ? `?project_id=${projectId}` : ''}`);
          if (live) setListing(r);
        }
        if (live) setError('');
      } catch (e) {
        if (live) setError(message(e));
      }
    };
    setJob(null);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [jid, projectId]);
  if (jid)
    return (
      <section className="video-workspace">
        <a className="text-btn video-back" href="#videos">
          <ArrowLeft size={16} /> Все разборы
        </a>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {job ? (
          <VideoResult
            key={job.id}
            job={job}
            data={data}
            notify={notify}
            reload={reload}
            onRefresh={() => api<VideoJob>(jobUrl(jid)).then(setJob)}
          />
        ) : (
          <div className="empty">
            <Loader2 className="spin" /> Загружаем разбор…
          </div>
        )}
      </section>
    );
  const online = listing.worker && Date.now() - Date.parse(listing.worker.last_seen) < 90000;
  return (
    <section className="video-workspace">
      <div className="page-header">
        <div>
          <h1>Задачи из видео</h1>
          <p>
            Покажите проблему и расскажите, что нужно сделать. Мы подготовим задачи на проверку.
          </p>
        </div>
        <button className="btn primary" onClick={() => setUploadOpen(true)}>
          <Plus size={16} /> Загрузить видео
        </button>
      </div>
      <div className={`video-worker ${online && listing.worker?.ready ? 'online' : ''}`}>
        <i />
        <span>
          {online
            ? listing.worker?.ready
              ? 'Mac на связи · готов к обработке'
              : listing.worker?.message || 'Mac подключён, требуется настройка Codex'
            : 'Mac пока не на связи · загруженные видео останутся в очереди'}
        </span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {uploadOpen && (
        <VideoUpload data={data} initialProject={projectId} close={() => setUploadOpen(false)} />
      )}
      {!listing.jobs.length && !uploadOpen ? (
        <div className="video-empty">
          <div className="video-empty-icon">
            <Film size={32} />
          </div>
          <h2>От записи экрана до понятных задач</h2>
          <p>
            Загрузите видео с голосовым комментарием. Система выделит суть, найдёт кадры и предложит
            задачи. Вы решаете, что создать.
          </p>
          <button className="btn" onClick={() => setUploadOpen(true)}>
            <Upload size={16} /> Выбрать первое видео
          </button>
          <small>MP4, MOV или WebM · до 500 МБ · до 15 минут</small>
        </div>
      ) : (
        <div className="video-history">
          {listing.jobs.map((j) => (
            <a className="video-history-item" href={`#video/${j.id}`} key={j.id}>
              <span className="video-file-icon">
                <Film size={22} />
              </span>
              <div>
                <strong>{j.filename}</strong>
                <small>
                  {data.projects.find((p) => p.id === j.project_id)?.name} ·{' '}
                  {timeLabel(j.created_at)}
                </small>
                <span className={`video-state ${j.status}`}>
                  {STATE_LABEL[j.status]}
                  {!['ready', 'error', 'uploaded', 'uploading'].includes(j.status)
                    ? ` · ${j.progress}%`
                    : ''}
                </span>
              </div>
              {listing.unread.includes(j.id) && <span className="video-new">Новое</span>}
              <span className="video-chevron">→</span>
            </a>
          ))}
        </div>
      )}
      {data.user.role === 'owner' && <VideoSettings />}
    </section>
  );
}

function VideoUpload({
  data,
  initialProject,
  close,
}: {
  data: Snapshot;
  initialProject: string;
  close: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [project, setProject] = useState(
      initialProject || data.projects.find((p) => p.status !== 'archived')?.id || '',
    ),
    [context, setContext] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [busy]);
  function pick(value?: File) {
    setError('');
    if (!value) return;
    if (!/\.(mp4|mov|webm)$/i.test(value.name)) return setError('Выберите видео MP4, MOV или WebM');
    if (!value.size || value.size > MAX_VIDEO_BYTES)
      return setError('Максимальный размер видео — 500 МБ');
    setFile(value);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !project) return;
    setBusy(true);
    setError('');
    setProgress(0);
    let jid = '';
    try {
      // Metadata is checked again by ffprobe on the Mac; unsupported browser codecs may still upload.
      const duration = await new Promise<number | null>((resolve) => {
        const v = document.createElement('video'),
          url = URL.createObjectURL(file);
        const finish = (n: number | null) => {
          clearTimeout(timeout);
          URL.revokeObjectURL(url);
          v.removeAttribute('src');
          v.load();
          resolve(n);
        };
        const timeout = setTimeout(() => finish(null), 4000);
        v.onloadedmetadata = () => finish(v.duration);
        v.onerror = () => finish(null);
        v.preload = 'metadata';
        v.src = url;
      });
      if (duration !== null && duration > MAX_VIDEO_SECONDS)
        throw new Error('Видео длиннее 15 минут. Выберите более короткую запись');
      const init = await api<{ id: string; part_size: number }>('/video/jobs', 'POST', {
        project_id: project,
        filename: file.name,
        size: file.size,
        context,
      });
      jid = init.id;
      abort.current = new AbortController();
      const parts: { partNumber: number; etag: string }[] = [];
      for (let start = 0, n = 1; start < file.size; start += init.part_size, n++) {
        const chunk = file.slice(start, start + init.part_size);
        let response: Response | undefined;
        for (let retry = 0; retry < 3; retry++) {
          try {
            response = await fetch(`/api${jobUrl(jid)}/parts/${n}`, {
              method: 'PUT',
              body: chunk,
              signal: abort.current.signal,
              headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (response.ok || response.status < 500) break;
          } catch (e) {
            if (abort.current.signal.aborted || retry === 2) throw e;
          }
        }
        if (!response?.ok) {
          const failure = (await response?.json().catch(() => ({}))) as
            { error?: string } | undefined;
          throw new Error(failure?.error || 'Загрузка прервалась. Повторите попытку');
        }
        parts.push(await response.json());
        setProgress(Math.round((Math.min(start + init.part_size, file.size) / file.size) * 100));
      }
      await api(`${jobUrl(jid)}/complete`, 'POST', { parts });
      abort.current = null;
      location.hash = `video/${jid}`;
    } catch (e) {
      if (jid) void api(jobUrl(jid), 'DELETE').catch(() => {});
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="video-upload panel" onSubmit={submit}>
      <div className="section-heading">
        <h2>Новое видео</h2>
        <button
          className="icon-btn"
          type="button"
          aria-label="Закрыть загрузку"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <button
        type="button"
        className={`video-drop ${drag ? 'dragging' : ''}`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) pick(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={26} />
        <strong>{file ? file.name : 'Перетащите видео или выберите файл'}</strong>
        <span>
          {file
            ? `${(file.size / 1024 / 1024).toFixed(1)} МБ · нажмите, чтобы заменить`
            : 'MP4, MOV, WebM · до 500 МБ и 15 минут'}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
        className="video-file-input"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div className="form-grid">
        <label>
          Проект
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            required
            disabled={busy}
          >
            <option value="" disabled>
              Выберите проект
            </option>
            {data.projects
              .filter((p) => p.status !== 'archived')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          После вашего подтверждения
          <input value="К выполнению" readOnly />
        </label>
      </div>
      <label>
        Контекст <span className="muted">· необязательно</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          disabled={busy}
          placeholder="Например: ошибки в шаблонах задач, обсуждали с Машей"
        />
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="video-upload-progress">
          <progress max={100} value={progress} />
          <span>Загружаем: {progress}%. Пока оставайтесь на этой странице.</span>
        </div>
      )}
      <div className="video-upload-footer">
        <p>Задачи создадутся только после вашей проверки.</p>
        <button className="btn primary" disabled={busy || !file || !project} type="submit">
          {busy ? <Loader2 className="spin" size={16} /> : <Film size={16} />}{' '}
          {busy ? 'Загружаем…' : 'Разобрать видео'}
        </button>
      </div>
    </form>
  );
}

function VideoResult({
  job,
  data,
  notify,
  reload,
  onRefresh,
}: {
  job: VideoJob;
  data: Snapshot;
  notify: (m: string) => void;
  reload: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<TaskDraft[]>(job.drafts || []),
    [tab, setTab] = useState('tasks'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [context, setContext] = useState(job.context),
    [comment, setComment] = useState(''),
    [sent, setSent] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    loaded = useRef(!!job.result),
    completed = job.status === 'ready';
  useEffect(() => {
    if (!loaded.current && job.result) {
      loaded.current = true;
      setDrafts(job.drafts || []);
    }
  }, [job.result]);
  function seek(time: string) {
    if (video.current) {
      video.current.currentTime = seconds(time);
      video.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  const initialTime = new URLSearchParams(location.hash.split('?')[1] || '').get('t');
  const selected = drafts.filter((t) => t.selected && !t.existing_task_id);
  async function create() {
    if (!selected.length) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ created: number; tasks: { task_id: string }[] }>(
        `${jobUrl(job.id)}/tasks`,
        'POST',
        {
          confirmed: true,
          tasks: selected.map((t) => ({
            ...t,
            title: t.title.trim(),
            acceptance_criteria: t.acceptance_criteria.map((c) => c.trim()).filter(Boolean),
          })),
        },
      );
      await reload();
      await onRefresh();
      const fresh = await api<VideoJob>(jobUrl(job.id));
      setDrafts(fresh.drafts || []);
      notify(`Создано задач: ${r.created}. Они в «К выполнению»`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>(`${jobUrl(job.id)}/retry`, 'POST', { context });
      location.hash = `video/${r.id}`;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendQuestions() {
    setBusy(true);
    try {
      await api(`${jobUrl(job.id)}/comments`, 'POST', {
        body: `Вопросы к автору видео:\n${job.result?.open_questions.map((q) => `• ${q}`).join('\n')}`,
      });
      setSent(true);
      await onRefresh();
      notify('Вопросы добавлены в обсуждение видео');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-header video-result-heading">
        <div>
          <h1>{job.result?.title || job.filename}</h1>
          <p>
            {data.projects.find((p) => p.id === job.project_id)?.name} · {timeLabel(job.created_at)}
            {job.duration ? ` · ${formatTime(job.duration)}` : ''}
          </p>
        </div>
        <span className={`video-state ${job.status}`}>{STATE_LABEL[job.status]}</span>
      </div>
      <div className="video-result-layout">
        <aside className="video-evidence">
          <video
            ref={video}
            controls
            preload="metadata"
            playsInline
            src={`/api${jobUrl(job.id)}/media`}
            onLoadedMetadata={() => {
              if (initialTime && /^\d{2}:[0-5]\d$/.test(initialTime) && video.current)
                video.current.currentTime = seconds(initialTime);
            }}
          />
          <div className="video-summary">
            <h2>{completed ? 'Кратко о видео' : 'Ход обработки'}</h2>
            {job.result ? (
              <p>{job.result.summary}</p>
            ) : (
              <>
                <p>
                  {job.status === 'uploaded'
                    ? 'Видео сохранено. Mac заберёт его из очереди. Можно уйти с этой страницы — уведомим здесь, когда всё будет готово.'
                    : job.status === 'error'
                      ? job.error
                      : 'Обработка продолжается на Mac. Можно заниматься другими задачами.'}
                </p>
                {!['ready', 'error'].includes(job.status) && (
                  <progress max={100} value={job.progress} />
                )}
              </>
            )}
            {job.has_audio === 0 && (
              <p className="video-warning">
                В видео нет звука. Предложения основаны на кадрах и требуют внимательной проверки.
              </p>
            )}
          </div>
          <details className="video-rerun">
            <summary>Контекст и повторный разбор</summary>
            <label>
              Контекст
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                maxLength={4000}
              />
            </label>
            <button
              className="btn"
              disabled={busy || !['ready', 'error'].includes(job.status)}
              onClick={retry}
            >
              <RefreshCw size={15} /> Разобрать ещё раз
            </button>
            <small>Созданные задачи останутся привязаны к видео.</small>
          </details>
          {job.metrics && Object.keys(job.metrics).length > 0 && (
            <details className="video-rerun">
              <summary>Время и расход обработки</summary>
              <div className="video-metrics">
                {Object.entries(job.metrics)
                  .filter(([k]) => k !== 'raw')
                  .map(([k, v]) => (
                    <div key={k}>
                      <span>
                        {(
                          {
                            metadata_seconds: 'Метаданные, с',
                            transcription_seconds: 'Расшифровка, с',
                            frames_seconds: 'Кадры, с',
                            playback_seconds: 'Копия для браузера, с',
                            analysis_seconds: 'Анализ, с',
                            total_seconds: 'Всего, с',
                            input_tokens: 'Входные токены',
                            output_tokens: 'Выходные токены',
                            cached_input_tokens: 'Из кеша',
                            provider: 'Обработчик',
                            model: 'Модель',
                          } as Record<string, string>
                        )[k] || k}
                      </span>
                      <b>{String(v)}</b>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </aside>
        <div className="video-review">
          {completed && (
            <>
              <div className="video-tabs" role="tablist" aria-label="Материалы разбора">
                {[
                  ['tasks', `Задачи · ${drafts.length}`],
                  ['screens', 'Что на экранах'],
                  ['transcript', 'Расшифровка'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'tasks' && (
                <div className="video-drafts">
                  {drafts.length === 0 && (
                    <div className="video-summary">
                      <h2>Конкретных задач не найдено</h2>
                      <p>Посмотрите расшифровку, уточните контекст и повторите разбор.</p>
                    </div>
                  )}
                  {drafts.map((t, i) => (
                    <DraftCard
                      key={t.id}
                      task={t}
                      index={i}
                      data={data}
                      jid={job.id}
                      projectId={job.project_id}
                      frames={job.frames || []}
                      disabled={busy}
                      seek={seek}
                      update={(patch) =>
                        setDrafts((rows) => rows.map((r, n) => (i === n ? { ...r, ...patch } : r)))
                      }
                    />
                  ))}
                  {job.result!.open_questions.length > 0 && (
                    <section className="video-questions">
                      <h2>Вопросы к автору</h2>
                      <ul>
                        {job.result!.open_questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                      <button className="btn" disabled={busy || sent} onClick={sendQuestions}>
                        {sent ? <Check size={15} /> : null}
                        {sent ? 'Добавлены в обсуждение' : 'Отправить автору комментарием'}
                      </button>
                    </section>
                  )}
                </div>
              )}
              {tab === 'screens' && (
                <div className="video-screens">
                  {job.result!.screens.map((s, i) => (
                    <article key={i}>
                      <button className="video-frame-button" onClick={() => seek(s.time)}>
                        <img
                          src={`/api${jobUrl(job.id)}/frames/${s.frame}`}
                          alt={`Экран на ${s.time}`}
                          loading="lazy"
                        />
                        <span>
                          <Play size={12} /> {s.time}
                        </span>
                      </button>
                      <p>{s.description}</p>
                    </article>
                  ))}
                </div>
              )}
              {tab === 'transcript' && (
                <div className="video-transcript">
                  {job.transcript?.length ? (
                    job.transcript.map((s, i) => (
                      <button key={i} onClick={() => seek(formatTime(s.start))}>
                        <time>{formatTime(s.start)}</time>
                        <span>{s.text}</span>
                      </button>
                    ))
                  ) : (
                    <p className="muted">Речь не обнаружена. Разбор выполнен по кадрам.</p>
                  )}
                </div>
              )}
            </>
          )}
          <section className="video-discussion">
            <h2>Обсуждение видео</h2>
            {job.comments?.map((c) => (
              <article key={c.id}>
                <strong>{data.members.find((u) => u.id === c.user_id)?.name || 'Участник'}</strong>
                <small>{timeLabel(c.created_at)}</small>
                <p>{c.body}</p>
              </article>
            ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                setBusy(true);
                try {
                  await api(`${jobUrl(job.id)}/comments`, 'POST', { body: comment });
                  setComment('');
                  await onRefresh();
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Комментарий
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={10000}
                  placeholder="Уточните детали для автора видео"
                />
              </label>
              <button className="btn" disabled={busy || !comment.trim()}>
                Отправить
              </button>
            </form>
          </section>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {completed && (
        <div className="video-create-bar">
          <div>
            <strong>
              {selected.length ? `Выбрано: ${selected.length}` : 'Выберите задачи для создания'}
            </strong>
            <small>
              Проект «{data.projects.find((p) => p.id === job.project_id)?.name}» · К выполнению
            </small>
          </div>
          <button className="btn primary" disabled={busy || !selected.length} onClick={create}>
            {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Создать
            задачи · {selected.length}
          </button>
        </div>
      )}
    </>
  );
}

function DraftCard({
  task: t,
  index,
  data,
  jid,
  projectId,
  frames,
  disabled,
  seek,
  update,
}: {
  task: TaskDraft;
  index: number;
  data: Snapshot;
  jid: string;
  projectId: string;
  frames: { name: string; time: number }[];
  disabled: boolean;
  seek: (time: string) => void;
  update: (patch: Partial<TaskDraft>) => void;
}) {
  return (
    <article
      className={`video-draft ${t.selected ? 'selected' : ''} ${t.existing_task_id ? 'created' : ''}`}
    >
      <div className="video-draft-head">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={t.selected && !t.existing_task_id}
            disabled={disabled || !!t.existing_task_id}
            onChange={(e) => update({ selected: e.target.checked })}
          />
          {t.existing_task_id ? 'Уже создана' : `Создать задачу ${index + 1}`}
        </label>
        <button className="video-time" onClick={() => seek(t.time)}>
          <Play size={12} />
          {t.time}
        </button>
      </div>
      {t.existing_task_id ? (
        <a
          className="video-created-link"
          href={`/?task=${t.existing_task_id}#project/${projectId}`}
        >
          {t.title} <CheckCircle2 size={16} />
        </a>
      ) : (
        <>
          <label>
            Название
            <input
              value={t.title}
              maxLength={240}
              onChange={(e) => update({ title: e.target.value })}
              disabled={disabled}
            />
          </label>
          {t.confidence === 'low' && (
            <div className="video-warning">
              Низкая уверенность — проверьте по видео. Задача не выбрана автоматически.
            </div>
          )}
          <div className="form-grid">
            <label>
              Тип
              <select
                value={t.type}
                onChange={(e) => update({ type: e.target.value as TaskDraft['type'] })}
              >
                {Object.entries(TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Приоритет
              <select
                value={t.priority}
                onChange={(e) => update({ priority: e.target.value as TaskDraft['priority'] })}
              >
                <option value="high">Высокий</option>
                <option value="medium">Средний</option>
                <option value="low">Низкий</option>
              </select>
            </label>
          </div>
          <label>
            Описание
            <textarea
              rows={3}
              value={t.description}
              maxLength={12000}
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>
          <label>
            Критерии приёмки <span className="muted">· по одному на строку</span>
            <textarea
              rows={Math.min(6, Math.max(2, t.acceptance_criteria.length))}
              value={t.acceptance_criteria.join('\n')}
              onChange={(e) => update({ acceptance_criteria: e.target.value.split('\n') })}
            />
          </label>
          <div className="form-grid">
            <label className={t.assignee && !t.assignee_id ? 'video-unresolved' : ''}>
              Исполнитель
              <select
                value={t.assignee_id || ''}
                onChange={(e) => update({ assignee_id: e.target.value || null })}
              >
                <option value="">Не назначен</option>
                {data.members
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              {t.assignee && !t.assignee_id && <small>Уточните: «{t.assignee}»</small>}
            </label>
            <label>
              Принимающий
              <select
                value={t.approver_id || ''}
                onChange={(e) => update({ approver_id: e.target.value || null })}
              >
                <option value="">Не назначен</option>
                {data.members
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={t.due && !t.due_date ? 'video-unresolved' : ''}>
              Срок
              <input
                type="date"
                value={t.due_date || ''}
                onChange={(e) => update({ due_date: e.target.value || null })}
              />
              {t.due && !t.due_date && <small>Уточните: «{t.due}»</small>}
            </label>
            <label>
              Статус
              <input value="К выполнению" readOnly />
            </label>
          </div>
          {t.location && <p className="video-location">Где: {t.location}</p>}
          {t.quote && <blockquote>{t.quote}</blockquote>}
          <details className="video-frame-picker">
            <summary>Кадры для задачи · {t.frames.length}</summary>
            <div>
              {frames.map((f) => (
                <label key={f.name}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={t.frames.includes(f.name)}
                    onChange={(e) =>
                      update({
                        frames: e.target.checked
                          ? [...t.frames, f.name]
                          : t.frames.filter((n) => n !== f.name),
                      })
                    }
                  />
                  <img
                    src={`/api${jobUrl(jid)}/frames/${f.name}`}
                    alt={`Кадр ${formatTime(f.time)}`}
                    loading="lazy"
                  />
                  <span>{formatTime(f.time)}</span>
                </label>
              ))}
            </div>
          </details>
          <div className="video-frames-strip">
            {t.frames.map((name) => (
              <a
                href={`/api${jobUrl(jid)}/frames/${name}`}
                target="_blank"
                rel="noreferrer"
                key={name}
              >
                <img
                  src={`/api${jobUrl(jid)}/frames/${name}`}
                  alt={`Кадр ${name}`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

export function VideoTaskDetails({
  taskId,
  revision,
  members,
  onRevision,
}: {
  taskId: string;
  revision: number;
  members: Snapshot['members'];
  onRevision: (n: number) => void;
}) {
  const [detail, setDetail] = useState<TaskVideo | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<TaskVideo | null>(`/video/tasks/${taskId}`)
      .then(setDetail)
      .catch(() => {});
  }, [taskId]);
  if (!detail) return null;
  async function save(next: TaskVideo) {
    setBusy(true);
    try {
      const r = await api<TaskVideo & { revision: number }>(`/video/tasks/${taskId}`, 'PATCH', {
        revision,
        checklist: next.checklist.map((c) => c.done),
        approver_id: next.approver_id,
      });
      setDetail(r);
      onRevision(r.revision);
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="video-task-details">
      <div className="video-task-source">
        <span>
          <Film size={16} /> Из видео · {TYPE_LABEL[detail.type as keyof typeof TYPE_LABEL]}
        </span>
        <a href={`/#video/${detail.job_id}?t=${detail.time}`} target="_blank" rel="noreferrer">
          Открыть разбор · {detail.time} ↗
        </a>
      </div>
      {detail.quote && <blockquote>{detail.quote}</blockquote>}
      {detail.checklist.length > 0 && (
        <div className="video-task-checklist">
          <h3>Критерии приёмки</h3>
          {detail.checklist.map((c, i) => (
            <label className="checkbox-label" key={i}>
              <input
                type="checkbox"
                checked={c.done}
                disabled={busy}
                onChange={(e) =>
                  void save({
                    ...detail,
                    checklist: detail.checklist.map((x, n) =>
                      n === i ? { ...x, done: e.target.checked } : x,
                    ),
                  })
                }
              />
              <span>{c.text}</span>
            </label>
          ))}
        </div>
      )}
      <label>
        Принимающий
        <select
          disabled={busy}
          value={detail.approver_id || ''}
          onChange={(e) => void save({ ...detail, approver_id: e.target.value || null })}
        >
          <option value="">Не назначен</option>
          {members
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <div className="video-frames-strip">
        {detail.frames.map((name) => (
          <a
            key={name}
            href={`/api${jobUrl(detail.job_id)}/frames/${name}`}
            target="_blank"
            rel="noreferrer"
          >
            <img loading="lazy" alt={name} src={`/api${jobUrl(detail.job_id)}/frames/${name}`} />
          </a>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function VideoSettings() {
  const [settings, setSettings] = useState({
      window_seconds: 3,
      duplicate_bits: 6,
      max_frames: 60,
    }),
    [status, setStatus] = useState('');
  useEffect(() => {
    api<typeof settings>('/video/settings')
      .then(setSettings)
      .catch(() => {});
  }, []);
  return (
    <details className="video-settings">
      <summary>Настройки отбора кадров</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/video/settings', 'PUT', settings);
            setStatus('Настройки сохранены');
          } catch (e) {
            setStatus(message(e));
          }
        }}
      >
        <div className="form-grid">
          <label>
            Окно отбора, секунд
            <input
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={settings.window_seconds}
              onChange={(e) => setSettings({ ...settings, window_seconds: +e.target.value })}
            />
          </label>
          <label>
            Порог дублей, бит
            <input
              type="number"
              min={0}
              max={64}
              value={settings.duplicate_bits}
              onChange={(e) => setSettings({ ...settings, duplicate_bits: +e.target.value })}
            />
          </label>
          <label>
            Максимум кадров
            <input
              type="number"
              min={1}
              max={60}
              value={settings.max_frames}
              onChange={(e) => setSettings({ ...settings, max_frames: +e.target.value })}
            />
          </label>
        </div>
        <button className="btn">Сохранить</button>
        {status && <p role="status">{status}</p>}
      </form>
    </details>
  );
}
