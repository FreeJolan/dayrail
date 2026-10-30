import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  cp,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from './dayrail.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('./dayrail.mjs', import.meta.url));
const canonical = fileURLToPath(
  new URL('../../skills/dayrail/', import.meta.url),
);

async function isolated(callback) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'dayrail-skills-'));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: '',
    CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    DAYRAIL_BRIDGE_FILE: path.join(home, 'missing-bridge.json'),
  };
  const run = async (args, entry = cli, extraEnv = {}) => {
    try {
      const result = await execute(process.execPath, [entry, ...args], {
        env: { ...env, ...extraEnv },
      });
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  try {
    await callback({ home, run });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('installs for every explicit agent offline and repeated installs are unchanged', () =>
  isolated(async ({ home, run }) => {
    const response = await run([
      'skills',
      'install',
      '--agent',
      'all',
      '--json',
    ]);
    assert.equal(response.code, 0, response.stdout);
    const installed = JSON.parse(response.stdout).result.installations;
    assert.deepEqual(
      installed.map((item) => item.agent),
      ['codex', 'claude', 'gemini', 'opencode'],
    );
    assert.deepEqual(
      installed.map((item) => item.path),
      [
        '.agents/skills/dayrail',
        '.claude/skills/dayrail',
        '.agents/skills/dayrail',
        '.config/opencode/skills/dayrail',
      ].map((relative) => path.join(home, relative)),
    );
    for (const item of installed) {
      assert.equal(
        item.status,
        item.agent === 'gemini' ? 'unchanged' : 'installed',
      );
      for (const file of [
        'SKILL.md',
        'references/model.md',
        'references/usage.md',
      ])
        assert.equal(
          await readFile(path.join(item.path, file), 'utf8'),
          await readFile(path.join(canonical, file), 'utf8'),
        );
      assert.equal(
        JSON.parse(
          await readFile(path.join(item.path, '.dayrail-skill.json'), 'utf8'),
        ).version,
        CLI_VERSION,
      );
    }
    const again = await run(['skills', 'update', '--agent=all']);
    assert.equal(again.code, 0, again.stdout);
    assert.ok(
      JSON.parse(again.stdout).result.installations.every(
        (item) => item.status === 'unchanged' && !item.backup,
      ),
    );
  }));

test('detects configured agents, preserves custom configuration paths, and detects PATH executables', () =>
  isolated(async ({ home, run }) => {
    const customClaude = path.join(home, 'custom claude');
    await mkdir(customClaude);
    await mkdir(path.join(home, '.config/opencode'), { recursive: true });
    const bin = path.join(home, 'bin');
    await mkdir(bin);
    await writeFile(
      path.join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex'),
      '#!/bin/sh\nexit 1\n',
      { mode: 0o755 },
    );
    const response = await run(['skills', 'install'], cli, {
      CLAUDE_CONFIG_DIR: customClaude,
      PATH: bin,
    });
    assert.equal(response.code, 0, response.stdout);
    const installed = JSON.parse(response.stdout).result.installations;
    assert.deepEqual(
      installed.map((item) => item.agent),
      ['codex', 'claude', 'opencode'],
    );
    assert.equal(installed[1].path, path.join(customClaude, 'skills/dayrail'));
    await assert.rejects(
      readFile(path.join(home, '.gemini/skills/dayrail/SKILL.md')),
      { code: 'ENOENT' },
    );
  }));

test('updates an old or customized copy and preserves its complete contents outside skill discovery', () =>
  isolated(async ({ home, run }) => {
    const directory = path.join(home, 'custom skills');
    const target = path.join(directory, 'dayrail');
    await mkdir(path.join(target, 'references'), { recursive: true });
    await writeFile(
      path.join(target, 'SKILL.md'),
      'My customized DayRail instructions',
    );
    await writeFile(
      path.join(target, 'references/old.md'),
      'Keep this private customization',
    );
    await writeFile(
      path.join(target, '.dayrail-skill.json'),
      JSON.stringify({ package: 'dayrail-cli', version: '0.16.0' }),
    );
    const response = await run(['skills', 'update', '--dir', directory]);
    assert.equal(response.code, 0, response.stdout);
    const [updated] = JSON.parse(response.stdout).result.installations;
    assert.equal(updated.status, 'updated');
    assert.equal(
      path.dirname(updated.backup),
      path.join(home, '.dayrail-skill-backups'),
    );
    assert.equal(
      await readFile(path.join(updated.backup, 'SKILL.md'), 'utf8'),
      'My customized DayRail instructions',
    );
    assert.equal(
      await readFile(path.join(updated.backup, 'references/old.md'), 'utf8'),
      'Keep this private customization',
    );
    await assert.rejects(readFile(path.join(target, 'references/old.md')), {
      code: 'ENOENT',
    });
    assert.equal(
      await readFile(path.join(target, 'SKILL.md'), 'utf8'),
      await readFile(path.join(canonical, 'SKILL.md'), 'utf8'),
    );
    assert.deepEqual(await readdir(directory), ['dayrail']);
  }));

test('invalid arguments and absent agent detection fail before changing any skill directories', () =>
  isolated(async ({ home, run }) => {
    for (const args of [
      ['skills', 'install'],
      ['skills', 'remove'],
      ['skills', 'install', '--agent', 'unknown'],
      ['skills', 'install', '--agent', 'all', '--dir', home],
      ['skills', 'install', '--agent'],
      ['skills', 'install', '--force'],
    ]) {
      const response = await run(args);
      assert.equal(response.code, 1, response.stdout);
      assert.equal(JSON.parse(response.stdout).ok, false);
    }
    assert.deepEqual(await readdir(home), []);
    for (const args of [
      ['skills'],
      ['skills', '--help'],
      ['skills', 'install', '--help'],
    ]) {
      const response = await run(args);
      assert.equal(response.code, 0);
      assert.match(response.stdout, /Usage: dayrail skills/);
    }
  }));

test('a locked installation reports partial results and leaves its old skill intact', () =>
  isolated(async ({ home, run }) => {
    const target = path.join(home, '.agents/skills/dayrail');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'SKILL.md'), 'Original content');
    await mkdir(path.join(home, '.agents/skills/.dayrail-skill-install.lock'));
    const response = await run([
      'skills',
      'install',
      '--agent',
      'codex,claude-code',
    ]);
    assert.equal(response.code, 1);
    const installations = JSON.parse(response.stdout).error.details
      .installations;
    assert.equal(installations[0].error.code, 'SKILL_INSTALL_BUSY');
    assert.equal(installations[1].status, 'installed');
    assert.equal(
      await readFile(path.join(target, 'SKILL.md'), 'utf8'),
      'Original content',
    );
  }));

test('a failed backup leaves the original skill intact and removes staging files', () =>
  isolated(async ({ home, run }) => {
    const directory = path.join(home, 'skills');
    const target = path.join(directory, 'dayrail');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'SKILL.md'), 'Keep the original');
    await writeFile(
      path.join(home, '.dayrail-skill-backups'),
      'Blocked backup directory',
    );
    const response = await run(['skills', 'update', '--dir', directory]);
    assert.equal(response.code, 1);
    assert.equal(
      await readFile(path.join(target, 'SKILL.md'), 'utf8'),
      'Keep the original',
    );
    assert.deepEqual(await readdir(directory), ['dayrail']);
  }));

test('an older CLI cannot downgrade a skill installed by a newer version', () =>
  isolated(async ({ home, run }) => {
    const directory = path.join(home, 'skills');
    assert.equal(
      (await run(['skills', 'install', '--dir', directory])).code,
      0,
    );
    const target = path.join(directory, 'dayrail');
    const metadata = path.join(target, '.dayrail-skill.json');
    const newer = JSON.stringify({
      package: 'dayrail-cli',
      version: '999.0.0',
    });
    await writeFile(metadata, newer);
    const response = await run(['skills', 'update', '--dir', directory]);
    assert.equal(response.code, 1);
    assert.equal(
      JSON.parse(response.stdout).error.details.installations[0].error.code,
      'SKILL_NEWER',
    );
    assert.equal(await readFile(metadata, 'utf8'), newer);
    await assert.rejects(readdir(path.join(home, '.dayrail-skill-backups')), {
      code: 'ENOENT',
    });
  }));

test(
  'never follows an existing skill symlink or a link inside its contents',
  { skip: process.platform === 'win32' },
  () =>
    isolated(async ({ home, run }) => {
      const outside = path.join(home, 'original');
      await mkdir(outside);
      await writeFile(path.join(outside, 'SKILL.md'), 'Do not replace');
      const directory = path.join(home, 'skills');
      await mkdir(directory);
      await symlink(outside, path.join(directory, 'dayrail'));
      const response = await run(['skills', 'install', '--dir', directory]);
      assert.equal(response.code, 1);
      assert.equal(
        JSON.parse(response.stdout).error.details.installations[0].error.code,
        'SKILL_CONFLICT',
      );
      assert.equal(
        await readFile(path.join(outside, 'SKILL.md'), 'utf8'),
        'Do not replace',
      );
      await rm(path.join(directory, 'dayrail'));
      await mkdir(path.join(directory, 'dayrail'));
      await symlink(
        path.join(outside, 'SKILL.md'),
        path.join(directory, 'dayrail/SKILL.md'),
      );
      assert.equal(
        (await run(['skills', 'install', '--dir', directory])).code,
        1,
      );
      assert.equal(
        await readFile(path.join(outside, 'SKILL.md'), 'utf8'),
        'Do not replace',
      );
    }),
);

test('the standalone desktop resource finds its adjacent skill and fails clearly if missing', () =>
  isolated(async ({ home, run }) => {
    const resource = path.join(home, 'Resources');
    await mkdir(path.join(resource, 'cli'), { recursive: true });
    const entry = path.join(resource, 'cli/dayrail.mjs');
    await cp(cli, entry);
    const args = ['skills', 'install', '--dir', path.join(home, 'target')];
    const missing = await run(args, entry);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.stdout).error.code, 'SKILL_NOT_FOUND');
    await cp(canonical, path.join(resource, 'skills/dayrail'), {
      recursive: true,
    });
    const response = await run(args, entry);
    assert.equal(response.code, 0, response.stdout);
    assert.equal(
      await readFile(path.join(home, 'target/dayrail/SKILL.md'), 'utf8'),
      await readFile(path.join(canonical, 'SKILL.md'), 'utf8'),
    );
  }));
