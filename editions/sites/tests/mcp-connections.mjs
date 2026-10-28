import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const base = process.env.TEST_URL || 'http://127.0.0.1:5178';
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
  'Local preview only: test identities must never be used against production',
);
const owner = {
  'oai-authenticated-user-id': 'local_seedy',
  'oai-authenticated-user-email': 'seedy@sites.test',
};
const suffix = randomUUID().slice(0, 6);
const member = {
  'oai-authenticated-user-id': `mcp_${suffix}`,
  'oai-authenticated-user-email': `mcp_${suffix}@example.test`,
};
async function req(url, method = 'GET', body, headers = owner) {
  const r = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
const rpc = (headers, name, args = {}) =>
  req(
    '/api/mcp/rpc',
    'POST',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    headers,
  );
const payload = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.data.result.isError, JSON.stringify(r.data));
  return JSON.parse(r.data.result.content[0].text);
};
assert.equal(
  (await req('/api/mcp/rpc', 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }, {})).status,
  401,
);
const status = (await req('/api/auth/status')).data;
if (!status.initialized)
  assert.equal((await req('/api/auth/setup', 'POST', { name: 'QA', workspace: 'QA' })).status, 201);
const p = (await req('/api/projects', 'POST', { name: 'MCP QA', key: 'M' + suffix.toUpperCase() }))
  .data;
const t = (
  await req('/api/tasks', 'POST', {
    project_id: p.id,
    title: 'MCP lifecycle',
    description: 'Implement the requested change and verify it.',
  })
).data;
const invitation = (
  await req('/api/invites', 'POST', { email: member['oai-authenticated-user-email'] })
).data;
const joined = await req(
  '/api/auth/join',
  'POST',
  { token: invitation.token, name: 'MCP teammate' },
  member,
);
assert.equal(joined.status, 201);
const memberId = (await req('/api/auth/status', 'GET', undefined, member)).data.user.id;
const pair = (
  await req('/api/mcp/connect/request', 'POST', { name: 'Claude Code QA', scope: 'tasks' }, {})
).data;
assert.match(pair.token, /^fj_mcp_[a-f0-9]{64}$/);
const headers = { Authorization: `Bearer ${pair.token}` };
assert.equal(
  (await req('/api/mcp/connect/status', 'GET', undefined, headers)).data.status,
  'pending',
);
assert.equal((await rpc(headers, 'list_tasks')).status, 401);
assert.equal(
  (await req(`/api/mcp/connections/${pair.id}`, 'POST', { approve: true }, {})).status,
  401,
);
assert.equal(
  (
    await req(`/api/mcp/connections/${pair.id}`, 'POST', {
      approve: true,
      scope: 'write',
      user_id: memberId,
    })
  ).status,
  200,
);
assert.equal((await req('/api/mcp/connect/status', 'GET', undefined, headers)).data.scope, 'tasks');
const entries = (await req('/api/mcp/connections')).data;
assert.ok(entries.some((c) => c.id === pair.id));
assert.ok(!JSON.stringify(entries).includes(pair.token));
assert.ok(!JSON.stringify(entries).includes(createHash('sha256').update(pair.token).digest('hex')));
assert.equal(
  (await req(`/api/mcp/connections/${pair.id}`, 'DELETE', undefined, member)).status,
  404,
);
assert.equal(
  (await req('/api/snapshot', 'GET', undefined, headers)).status,
  401,
  'MCP token cannot act as browser identity',
);
const catalog = (
  await req('/api/mcp/rpc', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers)
).data.result.tools;
assert.ok(catalog.some((t) => t.name === 'update_task'));
assert.ok(catalog.some((t) => t.name === 'get_task_frame'));
assert.ok(
  !catalog.some(
    (t) => t.name === 'create_project' || t.name === 'create_task' || t.name === 'update_project',
  ),
);
assert.equal(
  (await rpc(headers, 'create_project', { name: 'Denied', key: 'DENIED' })).data.result.isError,
  true,
);
for (const ref of [t.id, `${p.key}-${t.number}`, `${base}/?task=${t.id}#project/${p.id}`])
  assert.equal(payload(await rpc(headers, 'get_task', { task_id: ref })).task.id, t.id);
assert.equal(
  (await rpc(headers, 'get_task_frame', { task_id: t.id, frame: 'f_0001.jpg' })).data.result
    .isError,
  true,
);
const doing = payload(
  await rpc(headers, 'update_task', { task_id: t.id, revision: 1, status: 'doing' }),
);
assert.equal(doing.status, 'doing');
const stale = await rpc(headers, 'update_task', { task_id: t.id, revision: 1, status: 'done' });
assert.equal(stale.data.result.isError, true);
const writes = await Promise.all(
  ['review', 'done'].map((status) =>
    rpc(headers, 'update_task', { task_id: t.id, revision: doing.revision, status }),
  ),
);
assert.equal(
  writes.filter((r) => r.data.result.isError).length,
  1,
  'one simultaneous writer must lose',
);
const current = payload(await rpc(headers, 'get_task', { task_id: t.id })).task;
payload(
  await rpc(headers, 'add_comment', {
    task_id: t.id,
    body: 'Implemented and checked in local QA.',
  }),
);
const final = payload(
  await rpc(headers, 'update_task', {
    task_id: t.id,
    revision: current.revision,
    status: 'review',
  }),
);
assert.equal(final.status, 'review');
assert.equal(payload(await rpc(headers, 'get_task', { task_id: t.id })).comments.length, 1);
assert.ok(
  (await req('/api/snapshot')).data.activities.some(
    (a) => a.task_id === t.id && a.source === 'mcp',
  ),
);
const readPair = (
  await req('/api/mcp/connect/request', 'POST', { name: 'Read only', scope: 'read' }, {})
).data;
await req(`/api/mcp/connections/${readPair.id}`, 'POST', { approve: true });
const readHeaders = { Authorization: `Bearer ${readPair.token}` };
payload(await rpc(readHeaders, 'list_tasks'));
assert.equal(
  (await rpc(readHeaders, 'add_comment', { task_id: t.id, body: 'Forbidden' })).data.result.isError,
  true,
);
// Real stdio transport: exercise the exact standalone adapter used by Claude Code.
const dir = await mkdtemp(path.join(os.tmpdir(), 'freejira-mcp-test-'));
try {
  const config = path.join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ siteUrl: base, token: pair.token }), { mode: 0o600 });
  const child = spawn(process.execPath, ['mcp/connector.mjs'], {
    env: { ...process.env, FREEJIRA_MCP_CONFIG: config },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  child.stdin.end(
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_task', arguments: { task_id: `${p.key}-${t.number}` } },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join('\n') + '\n',
  );
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 0, err);
  const replies = out.trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    replies.map((r) => r.id),
    [1, 2, 3],
  );
  assert.equal(replies[0].result.protocolVersion, '2025-06-18');
  assert.equal(JSON.parse(replies[2].result.content[0].text).task.id, t.id);
  assert.ok(!out.includes(pair.token));
} finally {
  await rm(dir, { recursive: true, force: true });
}
const memberPair = (await req('/api/mcp/connect/request', 'POST', { name: 'Member device' }, {}))
  .data;
await req(`/api/mcp/connections/${memberPair.id}`, 'POST', { approve: true }, member);
const memberHeaders = { Authorization: `Bearer ${memberPair.token}` };
payload(await rpc(memberHeaders, 'list_projects'));
await req(`/api/members/${memberId}`, 'PATCH', { active: false });
assert.equal((await rpc(memberHeaders, 'list_projects')).status, 403);
await req(`/api/mcp/connections/${pair.id}`, 'DELETE');
assert.equal((await rpc(headers, 'list_projects')).status, 401);
assert.equal((await req(`/api/mcp/connections/${pair.id}`, 'POST', { approve: true })).status, 410);
assert.equal(
  (
    await req('/api/mcp/connect/status', 'GET', undefined, {
      Authorization: `Bearer fj_mcp_${'a'.repeat(64)}`,
    })
  ).status,
  401,
);
await req(`/api/mcp/connections/${readPair.id}`, 'DELETE');
await req(`/api/projects/${p.id}`, 'PATCH', { revision: p.revision, status: 'archived' });
console.log(
  'PASS: pairing, consent/ownership, scoped tool catalog, full task references, real stdio, task transitions/comments, revision race, read-only scope, invalid/revoked tokens and disabled member.',
);
