import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import type { Server } from 'node:http';
let server: Server,
  store: Store,
  url: string,
  ownerCookie: string,
  memberCookie: string,
  ownerId: string,
  memberId: string,
  pid: string,
  tid: string,
  inviteToken: string,
  writeToken: string,
  readToken: string,
  writeId: string;
const temp = mkdtempSync(join(tmpdir(), 'freejira-test-'));
async function req(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = ownerCookie,
  extra: Record<string, string> = {},
) {
  const res = await fetch(url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get('set-cookie')?.split(';')[0],
  };
}
before(async () => {
  store = new Store(join(temp, 'test.sqlite'));
  server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  store.db.close();
  rmSync(temp, { recursive: true, force: true });
});

test('complete shared workspace and MCP lifecycle', async (t) => {
  await t.test('authentication is required and cross-origin writes are rejected', async () => {
    assert.equal((await req('/api/snapshot')).status, 401);
    assert.equal(
      (await req('/api/auth/setup', 'POST', {}, undefined, { Origin: 'https://evil.example' }))
        .status,
      403,
    );
  });
  await t.test('first-run setup creates exactly one owner', async () => {
    const r = await req('/api/auth/setup', 'POST', {
      name: 'Владелец',
      email: 'owner@example.test',
      password: 'correct-password-123',
      workspace: 'Test team',
    });
    assert.equal(r.status, 201);
    ownerCookie = r.cookie!;
    ownerId = r.data.user.id;
    assert.ok(ownerCookie);
    assert.equal(
      (
        await req('/api/auth/setup', 'POST', {
          name: 'X',
          email: 'x@example.test',
          password: 'correct-password-123',
          workspace: 'Other',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req('/api/auth/login', 'POST', {
          email: 'owner@example.test',
          password: 'wrong-password',
        })
      ).status,
      401,
    );
  });
  await t.test('project keys and real calendar dates are validated', async () => {
    const r = await req('/api/projects', 'POST', { name: 'Launch', key: 'APP' });
    assert.equal(r.status, 201);
    pid = r.data.id;
    assert.equal(
      (await req('/api/projects', 'POST', { name: 'Duplicate', key: 'APP' })).status,
      409,
    );
    assert.equal(
      (await req('/api/projects', 'POST', { name: 'Date', key: 'DATE', target_date: '2026-02-30' }))
        .status,
      400,
    );
  });
  await t.test('invitation is email bound, one-time and creates a member', async () => {
    const inv = await req('/api/invites', 'POST', { email: 'member@example.test' });
    assert.equal(inv.status, 201);
    inviteToken = inv.data.token;
    assert.equal(
      (
        await req('/api/auth/join', 'POST', {
          name: 'No',
          email: 'wrong@example.test',
          password: 'correct-password-123',
          token: inviteToken,
        })
      ).status,
      400,
    );
    const joined = await req('/api/auth/join', 'POST', {
      name: 'Участник',
      email: 'member@example.test',
      password: 'correct-password-123',
      token: inviteToken,
    });
    assert.equal(joined.status, 201);
    memberCookie = joined.cookie!;
    memberId = joined.data.user.id;
    assert.equal(joined.data.user.role, 'member');
    assert.equal((await req(`/api/auth/invite/${inviteToken}`)).status, 404);
    assert.equal(
      (await req('/api/invites', 'POST', { email: 'other@example.test' }, memberCookie)).status,
      403,
    );
  });
  await t.test('shared tasks, assignments, comments and optimistic locking', async () => {
    const r = await req('/api/tasks', 'POST', {
      project_id: pid,
      title: 'First task',
      assignee_id: memberId,
      due_date: '2026-11-02',
      tags: ['release'],
    });
    assert.equal(r.status, 201);
    tid = r.data.id;
    assert.equal(r.data.number, 1);
    const s = await req('/api/snapshot', 'GET', undefined, memberCookie);
    assert.equal(s.data.tasks[0].title, 'First task');
    const update = await req(
      `/api/tasks/${tid}`,
      'PATCH',
      { revision: 1, status: 'doing' },
      memberCookie,
    );
    assert.equal(update.status, 200);
    assert.equal(update.data.revision, 2);
    assert.equal(update.data.assignee_id, memberId);
    assert.equal(update.data.due_date, '2026-11-02');
    assert.deepEqual(update.data.tags, ['release']);
    assert.equal(
      (await req(`/api/tasks/${tid}`, 'PATCH', { revision: 1, title: 'Would overwrite' })).status,
      409,
    );
    assert.equal(
      (
        await req(`/api/tasks/${tid}`, 'PATCH', {
          revision: 2,
          assignee_id: '00000000-0000-4000-8000-000000000001',
        })
      ).status,
      400,
    );
    assert.equal(
      (await req(`/api/tasks/${tid}/comments`, 'POST', { body: 'Ready for review' }, memberCookie))
        .status,
      201,
    );
    assert.equal((await req(`/api/tasks/${tid}/comments`)).data.length, 1);
  });
  await t.test('archive hides tasks from default MCP queries and can be reversed', async () => {
    await req(`/api/projects/${pid}`, 'PATCH', { revision: 1, status: 'archived' });
    assert.equal(store.tasks().length, 0);
    assert.equal(store.tasks({ include_archived: true }).length, 1);
    assert.equal(
      (await req('/api/tasks', 'POST', { project_id: pid, title: 'Archived task' })).status,
      400,
    );
    assert.equal(
      (await req(`/api/projects/${pid}`, 'PATCH', { revision: 2, status: 'active' })).status,
      200,
    );
  });
  await t.test('export contains collaboration data and no credentials', async () => {
    const r = await req('/api/export');
    assert.equal(r.status, 200);
    assert.equal(r.data.comments.length, 1);
    assert.equal(r.data.members.length, 2);
    const text = JSON.stringify(r.data);
    assert.ok(!text.includes('correct-password'));
    assert.ok(!text.includes('password'));
    assert.ok(!text.includes('fj_session'));
  });
  await t.test('MCP uses authenticated Streamable HTTP and real SDK negotiation', async () => {
    const w = await req('/api/tokens', 'POST', { name: 'Test write', scope: 'write' });
    writeToken = w.data.token;
    writeId = w.data.id;
    const r = await req('/api/tokens', 'POST', { name: 'Test read', scope: 'read' });
    readToken = r.data.token;
    assert.equal(
      (await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status,
      401,
    );
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', url), {
        requestInit: { headers: { Authorization: `Bearer ${writeToken}` } },
      }),
    );
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 11);
    const result = await client.callTool({
      name: 'create_task',
      arguments: { project_id: pid, title: 'Created from MCP', assignee_id: ownerId },
    });
    assert.ok(!result.isError);
    const task = JSON.parse((result.content as { text: string }[])[0].text);
    assert.equal(task.number, 2);
    const snapshot = await req('/api/snapshot');
    assert.ok(snapshot.data.tasks.some((t: any) => t.id === task.id));
    assert.ok(
      snapshot.data.activities.some((a: any) => a.task_id === task.id && a.source === 'mcp'),
    );
    assert.equal((await client.listResources()).resources.length, 1);
    await client.close();
  });
  await t.test('read-only MCP tokens can read but cannot mutate', async () => {
    const client = new Client({ name: 'readonly-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', url), {
        requestInit: { headers: { Authorization: `Bearer ${readToken}` } },
      }),
    );
    assert.ok(!(await client.callTool({ name: 'list_projects', arguments: {} })).isError);
    const r = await client.callTool({
      name: 'create_project',
      arguments: { name: 'Forbidden', key: 'NOPE' },
    });
    assert.equal(r.isError, true);
    assert.ok(!store.projects().some((p) => p.key === 'NOPE'));
    await client.close();
  });
  await t.test('stdio bridge works against the same HTTP server', async () => {
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'server/stdio.ts'],
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined),
        ) as Record<string, string>),
        FREEJIRA_URL: url,
        FREEJIRA_TOKEN: readToken,
      },
      stderr: 'pipe',
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 11);
    assert.ok(!(await client.callTool({ name: 'workspace_summary', arguments: {} })).isError);
    await client.close();
  });
  await t.test('revoked tokens stop working immediately', async () => {
    assert.equal((await req(`/api/tokens/${writeId}`, 'DELETE')).status, 200);
    const r = await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, '', {
      Authorization: `Bearer ${writeToken}`,
    });
    assert.equal(r.status, 401);
  });
  await t.test('deactivation revokes both sessions and MCP tokens', async () => {
    const token = await req(
      '/api/tokens',
      'POST',
      { name: 'Member AI', scope: 'write' },
      memberCookie,
    );
    assert.equal((await req(`/api/members/${memberId}`, 'PATCH', { active: false })).status, 200);
    assert.equal((await req('/api/snapshot', 'GET', undefined, memberCookie)).status, 401);
    assert.equal(
      (
        await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, '', {
          Authorization: `Bearer ${token.data.token}`,
        })
      ).status,
      401,
    );
    assert.equal((await req(`/api/members/${ownerId}`, 'PATCH', { active: false })).status, 400);
    assert.equal(
      (
        await req(`/api/tasks/${tid}`, 'PATCH', {
          revision: 2,
          title: 'Still editable',
          assignee_id: memberId,
        })
      ).status,
      200,
    );
  });
  await t.test('soft deletion keeps task numbers unique', async () => {
    assert.equal((await req(`/api/tasks/${tid}`, 'DELETE', { revision: 3 })).status, 200);
    assert.equal((await req(`/api/tasks/${tid}/comments`)).status, 404);
    const task = await req('/api/tasks', 'POST', { project_id: pid, title: 'Next number' });
    assert.equal(task.data.number, 3);
  });
  await t.test('SQLite data survives reopening from disk', async () => {
    const reopened = new Store(join(temp, 'test.sqlite'));
    assert.equal(reopened.projects()[0].key, 'APP');
    assert.equal(reopened.members().length, 2);
    assert.equal(reopened.tasks().length, 2);
    reopened.db.close();
  });
});
