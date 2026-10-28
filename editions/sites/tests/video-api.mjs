import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
const base = process.env.TEST_URL || 'http://127.0.0.1:5178';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Only local preview is allowed');
const actor = {
  'oai-authenticated-user-id': 'local_seedy',
  'oai-authenticated-user-email': 'seedy@sites.test',
};
const worker = { Authorization: 'Bearer local-video-test-only' };
async function call(path, method = 'GET', data, headers = actor, bytes) {
  const r = await fetch(base + '/api/video/' + path, {
    method,
    headers: {
      ...headers,
      'Content-Type': bytes ? 'application/octet-stream' : 'application/json',
    },
    body: bytes || (data === undefined ? undefined : JSON.stringify(data)),
  });
  const value = await r.json();
  return { status: r.status, value };
}
const pr = await fetch(base + '/api/projects', {
  method: 'POST',
  headers: { ...actor, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Видео · проверка',
    key: 'V' + randomUUID().slice(0, 6).toUpperCase(),
  }),
});
const project = await pr.json();
assert.equal(pr.status, 201);
assert.equal((await call('jobs', 'GET', undefined, {})).status, 401);
assert.equal((await call('worker/claim', 'POST', {}, {})).status, 401);
assert.equal(
  (await call('jobs', 'POST', { project_id: project.id, filename: 'test.exe', size: 9 })).status,
  400,
);
assert.equal(
  (
    await call('jobs', 'POST', {
      project_id: project.id,
      filename: 'test.mp4',
      size: 501 * 1024 * 1024,
    })
  ).status,
  400,
);
const bytes = Buffer.from('video fixture');
const created = await call('jobs', 'POST', {
  project_id: project.id,
  filename: 'test.mp4',
  size: bytes.length,
});
assert.equal(created.status, 201, JSON.stringify(created.value));
const jid = created.value.id;
const part = await call(`jobs/${jid}/parts/1`, 'PUT', undefined, actor, bytes);
assert.equal(part.status, 200, JSON.stringify(part.value));
assert.equal((await call(`jobs/${jid}/complete`, 'POST', { parts: [part.value] })).status, 200);
async function finish(jobId, proposalId = 'T1') {
  const claim = await call('worker/claim', 'POST', {}, worker);
  assert.equal(claim.value.job.id, jobId);
  const h = { ...worker, 'X-Video-Lease': claim.value.job.lease };
  assert.equal(
    (
      await call(
        `worker/jobs/${jobId}/metadata`,
        'POST',
        {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          duration: 10,
          has_audio: false,
        },
        h,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `worker/jobs/${jobId}/frames/f_0000.jpg`,
        'PUT',
        undefined,
        h,
        Buffer.from([255, 216, 255, 217]),
      )
    ).status,
    200,
  );
  const preview = await call(`worker/jobs/${jobId}/playback/start`, 'POST', {}, h);
  assert.equal(preview.status, 200);
  const previewPart = await call(
    `worker/jobs/${jobId}/playback/parts/1?upload_id=${encodeURIComponent(preview.value.upload_id)}`,
    'PUT',
    undefined,
    h,
    bytes,
  );
  assert.equal(previewPart.status, 200);
  assert.equal(
    (
      await call(
        `worker/jobs/${jobId}/playback/complete`,
        'POST',
        { upload_id: preview.value.upload_id, parts: [previewPart.value] },
        h,
      )
    ).status,
    200,
  );
  const proposal = {
    id: proposalId,
    title: 'Исправить сохранение',
    type: 'bug',
    priority: 'high',
    description: 'Сохранение выдаёт ошибку',
    acceptance_criteria: ['Данные сохраняются'],
    location: 'Карточка',
    time: '00:00',
    frames: ['f_0000.jpg'],
    quote: '',
    assignee: '',
    due: '',
    confidence: 'high',
  };
  const analysis = {
    title: 'Проблема сохранения',
    summary: 'Проверка.',
    screens: [{ time: '00:00', frame: 'f_0000.jpg', description: 'Карточка' }],
    tasks: [proposal],
    open_questions: ['Какая версия?'],
    entities: [],
  };
  assert.equal(
    (
      await call(
        `worker/jobs/${jobId}/complete`,
        'POST',
        {
          result: analysis,
          frames: [{ name: 'f_0000.jpg', time: 0 }],
          transcript: [],
          metrics: { total_seconds: 1 },
        },
        h,
      )
    ).status,
    200,
  );
  const job = (await call(`jobs/${jobId}`)).value;
  assert.equal(job.drafts[0].confidence, 'low');
  assert.equal(job.drafts[0].selected, false);
  return job;
}
const job = await finish(jid);
const selection = { confirmed: true, tasks: [{ ...job.drafts[0], selected: true }] };
assert.equal(
  (await call(`jobs/${jid}/tasks`, 'POST', { ...selection, confirmed: false })).status,
  400,
);
const concurrent = await Promise.all([
  call(`jobs/${jid}/tasks`, 'POST', selection),
  call(`jobs/${jid}/tasks`, 'POST', selection),
]);
concurrent.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.value)));
assert.equal(
  concurrent.reduce((n, r) => n + r.value.created, 0),
  1,
);
const taskId = concurrent[0].value.tasks[0].task_id;
const task = await (await fetch(base + '/api/tasks/' + taskId, { headers: actor })).json();
assert.equal(task.status, 'todo');
assert.ok(task.description.includes('Видео (00:00)'));
const mcpFrame = await (
  await fetch(base + '/mcp', {
    method: 'POST',
    headers: { ...actor, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_task_frame', arguments: { task_id: taskId, frame: 'f_0000.jpg' } },
    }),
  })
).json();
assert.ok(!mcpFrame.result.isError, JSON.stringify(mcpFrame));
assert.equal(mcpFrame.result.content[1].type, 'image');
assert.equal(mcpFrame.result.content[1].mimeType, 'image/jpeg');
assert.deepEqual(
  Buffer.from(mcpFrame.result.content[1].data, 'base64'),
  Buffer.from([255, 216, 255, 217]),
);
const detail = (await call(`tasks/${taskId}`)).value;
assert.equal(detail.source, 'Из видео');
assert.equal(detail.checklist.length, 1);
assert.deepEqual(detail.frames, ['f_0000.jpg']);
assert.equal(
  (
    await call(`tasks/${taskId}`, 'PATCH', {
      revision: task.revision,
      checklist: [true],
      approver_id: null,
    })
  ).status,
  200,
);
assert.equal(
  (
    await call(`tasks/${taskId}`, 'PATCH', {
      revision: task.revision,
      checklist: [false],
      approver_id: null,
    })
  ).status,
  409,
);
const retry = await call(`jobs/${jid}/retry`, 'POST', { context: 'другой контекст' });
const rerun = await finish(retry.value.id, 'T7');
assert.equal(rerun.drafts[0].existing_task_id, taskId);
const duplicate = await call(`jobs/${rerun.id}/tasks`, 'POST', {
  confirmed: true,
  tasks: [rerun.drafts[0]],
});
assert.equal(duplicate.value.created, 0);
const ranged = await fetch(base + `/api/video/jobs/${jid}/media`, {
  headers: { ...actor, Range: 'bytes=2-5' },
});
assert.equal(ranged.status, 206);
assert.equal(await ranged.text(), bytes.subarray(2, 6).toString());
console.log(
  'PASS: uploads, auth, validation, silent confidence, human confirmation, concurrent idempotency, rerun deduplication, checklist revision, source metadata and byte ranges.',
);
