import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_URL || 'http://127.0.0.1:5178';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error(
    'This test uses simulated Sites identities and must run only against a local Worker preview.',
  );
const suffix = randomUUID().slice(0, 6),
  key = 'T' + suffix.toUpperCase();
const owner = {
  'oai-authenticated-user-id': 'local_seedy',
  'oai-authenticated-user-email': 'seedy@sites.test',
};
const member = {
  'oai-authenticated-user-id': `test_${suffix}`,
  'oai-authenticated-user-email': `test_${suffix}@example.test`,
};
async function req(path, method = 'GET', body, headers = owner) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
assert.equal((await req('/api/snapshot', 'GET', undefined, {})).status, 401);
assert.equal(
  (await req('/api/projects', 'POST', {}, { ...owner, Origin: 'https://evil.example' })).status,
  403,
);
let status = (await req('/api/auth/status')).data;
if (!status.initialized)
  assert.equal(
    (await req('/api/auth/setup', 'POST', { name: 'Павел', workspace: 'Студия Север' })).status,
    201,
  );
const p = await req('/api/projects', 'POST', { name: 'Cloud QA', key, color: '#4c9c87' });
assert.equal(p.status, 201, JSON.stringify(p.data));
const pid = p.data.id;
const invite = await req('/api/invites', 'POST', { email: member['oai-authenticated-user-email'] });
assert.equal(invite.status, 201);
assert.equal(
  (await req('/api/auth/join', 'POST', { name: 'Анна', token: invite.data.token }, member)).status,
  201,
);
assert.equal((await req('/api/invites', 'POST', { email: 'no@example.test' }, member)).status, 403);
const memberId = (await req('/api/auth/status', 'GET', undefined, member)).data.user.id;
const results = await Promise.all(
  Array.from({ length: 6 }, (_, i) =>
    req('/api/tasks', 'POST', {
      project_id: pid,
      title: `Concurrent ${i}`,
      assignee_id: memberId,
      tags: ['MVP'],
      due_date: '2026-12-05',
    }),
  ),
);
results.forEach((r) => assert.equal(r.status, 201, JSON.stringify(r.data)));
assert.equal(new Set(results.map((r) => r.data.number)).size, 6);
const tid = results[0].data.id;
const updates = await Promise.all([
  req(`/api/tasks/${tid}`, 'PATCH', { revision: 1, status: 'doing' }),
  req(`/api/tasks/${tid}`, 'PATCH', { revision: 1, status: 'review' }, member),
]);
assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
let task = (await req(`/api/tasks/${tid}`)).data;
assert.equal(task.assignee_id, memberId);
assert.equal(task.due_date, '2026-12-05');
assert.deepEqual(task.tags, ['MVP']);
assert.equal(
  (await req(`/api/tasks/${tid}/comments`, 'POST', { body: 'Cloud collaboration works' }, member))
    .status,
  201,
);
assert.equal((await req(`/api/tasks/${tid}/comments`)).data.length, 1);
const discover = await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'server/discover' });
assert.deepEqual(discover.data.result.supportedVersions, ['2026-07-28']);
const list = await req('/mcp', 'POST', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
assert.equal(list.data.result.tools.length, 12);
const denied = await req(
  '/mcp',
  'POST',
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } },
  {},
);
assert.equal(denied.data.result.isError, true);
const mcp = await req(
  '/mcp',
  'POST',
  {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'update_task', arguments: { task_id: tid, revision: 2, status: 'done' } },
  },
  member,
);
assert.ok(!mcp.data.result.isError, JSON.stringify(mcp.data));
assert.equal((await req(`/api/tasks/${tid}`)).data.status, 'done');
const snapshot = (await req('/api/snapshot')).data;
assert.ok(snapshot.activities.some((a) => a.task_id === tid && a.source === 'mcp'));
assert.equal((await req(`/api/members/${memberId}`, 'PATCH', { active: false })).status, 200);
assert.equal((await req('/api/snapshot', 'GET', undefined, member)).status, 403);
const blocked = await req(
  '/mcp',
  'POST',
  {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'workspace_summary', arguments: {} },
  },
  member,
);
assert.equal(blocked.data.result.isError, true);
assert.equal(
  (await req(`/api/projects/${pid}`, 'PATCH', { revision: 1, status: 'archived' })).status,
  200,
);
const exported = await req('/api/export');
assert.equal(exported.status, 200);
assert.ok(exported.data.comments.length);
console.log(
  'PASS: real D1, concurrent task numbering, revision conflicts, invitations, identity permissions, comments, export, MCP discovery/tools/writes and member deactivation.',
);
