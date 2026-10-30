import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, sendRequest } from './dayrail.mjs';
const cli = fileURLToPath(new URL('./dayrail.mjs', import.meta.url));
async function run(args, bridgeFile) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, DAYRAIL_BRIDGE_FILE: bridgeFile },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}
test('parses primitive flags, positional IDs, JSON patches and revision preconditions', async () => {
  const p = await parseArgs([
    'task',
    'update',
    'task-1',
    '--input',
    '{"patch":{"note":"$HOME `literal` 中文"}}',
    '--if-revision',
    'runtime:2',
    '--json',
  ]);
  assert.equal(p.method, 'task.update');
  assert.equal(p.params.id, 'task-1');
  assert.equal(p.params.patch.note, '$HOME `literal` 中文');
  assert.equal(p.global['if-revision'], 'runtime:2');
  assert.equal(
    (
      await parseArgs([
        'rail',
        'create',
        '--start-minutes',
        '540',
        '--show-in-checkin',
        'false',
      ])
    ).params.startMinutes,
    540,
  );
});
test('rejects incomplete arguments and non-object JSON', async () => {
  await assert.rejects(
    parseArgs(['task', 'create', '--title']),
    /requires a value/,
  );
  await assert.rejects(
    parseArgs(['task', 'create', '--input', '[]']),
    /JSON object/,
  );
});
test('real client discovers the app, authenticates, handles fragmented Unicode response, and reports domain errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dayrail-cli-'));
  const discovery = path.join(dir, 'bridge.json');
  const seen = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer);
      seen.push(request);
      assert.equal(request.token, 'test-token');
      const response = JSON.stringify(
        request.method === 'task.get'
          ? { ok: false, error: { code: 'NOT_FOUND', message: 'Missing' } }
          : { ok: true, revision: 'r:1', result: { title: '安排工作' } },
      );
      const bytes = Buffer.from(response + '\n');
      socket.write(bytes.subarray(0, bytes.length - 5));
      setImmediate(() => socket.end(bytes.subarray(bytes.length - 5)));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await writeFile(
      discovery,
      JSON.stringify({
        protocolVersion: 1,
        port: server.address().port,
        token: 'test-token',
      }),
    );
    const good = await run(
      [
        'task',
        'create',
        '--title',
        '安排工作',
        '--request-id',
        'known',
        '--json',
      ],
      discovery,
    );
    assert.equal(good.code, 0);
    assert.equal(JSON.parse(good.stdout).result.title, '安排工作');
    assert.equal(seen[0].id, 'known');
    assert.deepEqual(seen[0].params, { title: '安排工作' });
    const bad = await run(['task', 'get', 'missing', '--json'], discovery);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.stdout).error.code, 'NOT_FOUND');
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('missing discovery and invalid protocol produce machine-readable failures', async () => {
  const response = await run(
    ['status', '--json'],
    '/nonexistent/dayrail-test.json',
  );
  assert.equal(response.code, 1);
  assert.equal(JSON.parse(response.stdout).error.code, 'APP_UNAVAILABLE');
  await assert.rejects(
    sendRequest({ protocolVersion: 2, port: 1, token: 'x' }, {}),
    { code: 'INVALID_DISCOVERY' },
  );
});
test('connection closed after a write is an uncertain outcome and is never automatically retried', async () => {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    socket.on('data', () => socket.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(
      sendRequest(
        { protocolVersion: 1, port: server.address().port, token: 'x' },
        { id: 'keep-this-id', method: 'task.create' },
      ),
      { code: 'OUTCOME_UNKNOWN' },
    );
    assert.equal(connections, 1);
  } finally {
    server.close();
  }
});
