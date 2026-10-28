import { z } from 'zod';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 900;
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const frameName = z.string().regex(/^f_\d{4}\.jpg$/);
export const timecode = z.string().regex(/^\d{2}:[0-5]\d$/);
export const seconds = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const formatTime = (time: number) =>
  `${Math.floor(time / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(time % 60)
    .toString()
    .padStart(2, '0')}`;
const text = (max: number) => z.string().max(max);
export const proposalSchema = z.strictObject({
  id: z.string().regex(/^T[1-9]\d*$/),
  title: text(240).min(1),
  type: z.enum(['bug', 'feature', 'change', 'data', 'question', 'other']),
  priority: z.enum(['high', 'medium', 'low']),
  description: text(12000),
  acceptance_criteria: z.array(text(1000).min(1)).max(40),
  location: text(1000),
  time: timecode,
  frames: z.array(frameName).max(60),
  quote: text(6000),
  assignee: text(200),
  due: text(200),
  confidence: z.enum(['high', 'medium', 'low']),
});
export const analysisSchema = z.strictObject({
  title: text(240).min(1),
  summary: text(6000),
  screens: z
    .array(z.strictObject({ time: timecode, frame: frameName, description: text(3000) }))
    .max(60),
  tasks: z.array(proposalSchema).max(100),
  open_questions: z.array(text(1000)).max(60),
  entities: z.array(text(500)).max(200),
});
export const frameSchema = z.strictObject({
  name: frameName,
  time: z.number().min(0).max(MAX_VIDEO_SECONDS),
});
export const segmentSchema = z
  .strictObject({
    start: z.number().min(0).max(MAX_VIDEO_SECONDS),
    end: z.number().min(0).max(MAX_VIDEO_SECONDS),
    text: text(10000),
  })
  .refine((s) => s.end >= s.start, 'Конец фразы раньше начала');
export const settingsSchema = z.object({
  window_seconds: z.number().min(1).max(15).default(3),
  duplicate_bits: z.number().int().min(0).max(64).default(6),
  max_frames: z.number().int().min(1).max(60).default(60),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type VideoState =
  'uploading' | 'uploaded' | 'transcription' | 'frames' | 'analysis' | 'ready' | 'error';
export const STATE_LABEL: Record<VideoState, string> = {
  uploading: 'Загрузка видео',
  uploaded: 'В очереди',
  transcription: 'Расшифровка речи',
  frames: 'Отбор кадров',
  analysis: 'Анализ видео',
  ready: 'Готово к проверке',
  error: 'Ошибка обработки',
};
export const TYPE_LABEL = {
  bug: 'Ошибка',
  feature: 'Новая функция',
  change: 'Изменение',
  data: 'Данные',
  question: 'Вопрос',
  other: 'Другое',
};
export type TaskDraft = Proposal & {
  selected: boolean;
  assignee_id: string | null;
  approver_id: string | null;
  due_date: string | null;
  existing_task_id?: string | null;
};
export type VideoJob = {
  id: string;
  video_id: string;
  project_id: string;
  user_id: string;
  filename: string;
  context: string;
  status: VideoState;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  duration: number | null;
  has_audio: number | null;
  result?: Analysis | null;
  frames?: Frame[];
  transcript?: Segment[];
  drafts?: TaskDraft[];
  metrics?: Record<string, unknown>;
  comments?: { id: string; user_id: string; body: string; created_at: string }[];
};

export function validateAnalysis(
  input: unknown,
  frames: Frame[],
  duration: number,
  transcript: Segment[],
  hasAudio: boolean,
): Analysis {
  const result = analysisSchema.parse(input);
  const names = new Set(frames.map((f) => f.name));
  if (new Set(result.tasks.map((t) => t.id)).size !== result.tasks.length)
    throw new Error('Повторяющиеся ID предложенных задач');
  for (const screen of result.screens) {
    if (!names.has(screen.frame) || seconds(screen.time) > duration)
      throw new Error('Модель сослалась на неизвестный кадр или таймкод');
  }
  const speech = transcript
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const task of result.tasks) {
    if (seconds(task.time) > duration || task.frames.some((f) => !names.has(f)))
      throw new Error('Модель сослалась на неизвестный кадр или таймкод');
    if (task.quote && !speech.includes(task.quote.replace(/\s+/g, ' ').trim()))
      throw new Error('Цитата не найдена в расшифровке');
    if (!hasAudio || !speech || !task.quote) task.confidence = 'low';
  }
  return result;
}

export const normalize = (value: string) =>
  value
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function matchingMember(
  name: string,
  members: { id: string; name: string; active: number }[],
): string | null {
  if (!name.trim()) return null;
  const target = normalize(name),
    active = members.filter((m) => m.active);
  const exact = active.filter((m) => normalize(m.name) === target);
  if (exact.length === 1) return exact[0].id;
  const words = target.split(' ');
  const partial = active.filter((m) =>
    words.every((w) => normalize(m.name).split(' ').includes(w)),
  );
  if (partial.length === 1) return partial[0].id;
  // One typo is accepted only for a unique name, never for short/ambiguous names.
  if (target.length < 5) return null;
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + Number(a[i - 1] !== b[j - 1]));
        prev = old;
      }
    }
    return row[b.length];
  };
  const fuzzy = active.filter((m) => distance(target, normalize(m.name)) <= 1);
  return fuzzy.length === 1 ? fuzzy[0].id : null;
}
export function matchingDate(value: string, referenceDate: string): string | null {
  const v = normalize(value),
    base = new Date(`${referenceDate}T12:00:00Z`);
  if (!v || !Number.isFinite(base.getTime())) return null;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null;
  }
  const relative = ({ сегодня: 0, завтра: 1, послезавтра: 2 } as Record<string, number>)[v];
  if (relative !== undefined) {
    base.setUTCDate(base.getUTCDate() + relative);
    return base.toISOString().slice(0, 10);
  }
  const days = v.match(/^через (\d{1,2}) (?:день|дня|дней)$/);
  if (days) {
    base.setUTCDate(base.getUTCDate() + Number(days[1]));
    return base.toISOString().slice(0, 10);
  }
  const date = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return date
    ? matchingDate(
        `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`,
        referenceDate,
      )
    : null;
}
