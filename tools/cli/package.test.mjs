import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import net from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const directory = fileURLToPath(new URL('./', import.meta.url));
const nodeDirectory = path.dirname(process.execPath);
const npmCli = [
  path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  path.resolve(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
].find(existsSync);

test('the npm tarball installs an executable client, includes the canonical skill, and talks to a local bridge', async () => {
  assert.ok(npmCli, 'npm must be installed alongside Node.js');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dayrail-npm-'));
  const prefix = path.join(temporary, 'global');
  const config = path.join(temporary, 'npmrc');
  await writeFile(config, 'registry=https://registry.npmjs.org/\n');
  const environment = { ...process.env, npm_config_userconfig: config };
  const npm = (...args) =>
    execute(process.execPath, [npmCli, ...args], {
      cwd: directory,
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    });
  let server;
  try {
    const packed = JSON.parse(
      (await npm('pack', '--json', '--pack-destination', temporary)).stdout,
    )[0];
    assert.deepEqual(
      packed.files.map((file) => file.path).sort(),
      [
        'LICENSE',
        'README.md',
        'dayrail.mjs',
        'package.json',
        'skill/SKILL.md',
        'skill/references/model.md',
        'skill/references/usage.md',
      ].sort(),
    );
    await npm(
      'install',
      '--global',
      '--prefix',
      prefix,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(temporary, packed.filename),
    );
    const packageDirectory = path.join(
      prefix,
      process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
      'dayrail-cli',
    );
    const binary = path.join(
      prefix,
      process.platform === 'win32' ? 'dayrail.cmd' : 'bin/dayrail',
    );
    await lstat(binary);
    const entry =
      process.platform === 'win32'
        ? path.join(packageDirectory, 'dayrail.mjs')
        : binary;
    const run = (...args) =>
      execute(process.execPath, [entry, ...args], { env: environment });
    const metadata = JSON.parse(
      await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
    );
    assert.equal((await run('--version')).stdout.trim(), metadata.version);
    assert.match((await run('--help')).stdout, /Usage: dayrail/);
    const skillDirectory = path.join(temporary, 'agent-skills');
    const installed = JSON.parse(
      (await run('skills', 'install', '--dir', skillDirectory, '--json'))
        .stdout,
    );
    assert.equal(installed.result.installations[0].status, 'installed');
    const repeated = JSON.parse(
      (await run('skills', 'update', '--dir', skillDirectory, '--json')).stdout,
    );
    assert.equal(repeated.result.installations[0].status, 'unchanged');
    for (const relative of [
      'SKILL.md',
      'references/model.md',
      'references/usage.md',
    ]) {
      assert.equal(
        await readFile(path.join(packageDirectory, 'skill', relative), 'utf8'),
        await readFile(
          path.resolve(directory, '../../skills/dayrail', relative),
          'utf8',
        ),
      );
      assert.equal(
        await readFile(path.join(skillDirectory, 'dayrail', relative), 'utf8'),
        await readFile(path.join(packageDirectory, 'skill', relative), 'utf8'),
      );
    }
    const received = [];
    server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        const request = JSON.parse(buffer);
        received.push(request);
        socket.end(
          JSON.stringify({
            ok: true,
            revision: 'package:1',
            result: { ready: true },
          }) + '\n',
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const discovery = path.join(temporary, 'bridge.json');
    await writeFile(
      discovery,
      JSON.stringify({
        protocolVersion: 1,
        port: server.address().port,
        token: 'package-test-token',
      }),
    );
    const response = await execute(
      process.execPath,
      [entry, 'status', '--json'],
      { env: { ...environment, DAYRAIL_BRIDGE_FILE: discovery } },
    );
    assert.equal(JSON.parse(response.stdout).result.ready, true);
    assert.equal(received[0].method, 'system.status');
    assert.equal(received[0].token, 'package-test-token');
  } finally {
    server?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
