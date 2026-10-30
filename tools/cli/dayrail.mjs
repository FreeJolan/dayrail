#!/usr/bin/env node
// Dependency-free client for the running DayRail desktop app. Node.js >=18.
import net from 'node:net';
import {
  readFile,
  mkdir,
  writeFile,
  chmod,
  lstat,
  readdir,
  rename,
  rm,
  mkdtemp,
  access,
} from 'node:fs/promises';
import { realpathSync, constants } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const CLI_VERSION = '0.16.1';

const usage = `DayRail CLI ${CLI_VERSION} (Node.js >=18)
Usage: dayrail <resource> <action> [id] [--field value] [--input JSON|@file]
       dayrail status | schema [resource.action] | data export
       dayrail install [--dir PATH]
       dayrail skills install | update [--agent NAME[,NAME...]] [--dir PATH]

Global flags:
  --version               Print the CLI version without connecting
  --json                  Compact JSON (responses are JSON by default)
  --dev                   Connect to the isolated development app
  --request-id ID         Reuse this ID after an uncertain outcome (same runtime)
  --if-revision REVISION   Reject a mutation if the live data has changed
  --help                  Discover commands and their exact input schemas

Examples:
  dayrail task list --status pending --json
  dayrail task create --title "Write draft"
  dayrail occurrence add --task-id TASK_ID --label "Outline"
  dayrail task schedule TASK_ID --date 2026-11-03 --rail-id RAIL_ID
  dayrail task update TASK_ID --input '{"patch":{"note":"New note"}}'
  dayrail data export --json > dayrail-context.json

Enable local agent access in DayRail Settings > Advanced first.
Mutations use the live app, update its UI immediately, and await local saving.
No automatic retries. Deleted/archived rows are included in list/export.
`;
const skillsUsage = `Usage: dayrail skills install | update [--agent NAME[,NAME...]] [--dir PATH] [--json]

Install or upgrade the bundled DayRail skill without connecting to the app.
With no target flags, detect agents by their configuration directories or PATH.
--agent NAME   codex, claude, gemini, opencode, or all (also accepts claude-code, gemini-cli)
--dir PATH     Custom skills directory; installs into PATH/dayrail
--json         Compact JSON output

Changed installations are backed up outside the skills directory before replacement.
Identical installations are left unchanged. Symlinked skill folders are not replaced.
After upgrading the CLI, rerun this command to upgrade its installed skill.
Start a new agent session or reload skills if the skill does not appear.
`;
function fail(code, message, details) {
  const e = new Error(message);
  e.code = code;
  e.details = details;
  throw e;
}
function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
export async function parseArgs(args) {
  const positional = [];
  const fields = {};
  const global = {};
  let input = {};
  const globals = new Set([
    'json',
    'dev',
    'help',
    'request-id',
    'if-revision',
    'dir',
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const equal = arg.indexOf('=');
    const name = arg.slice(2, equal < 0 ? undefined : equal);
    let value = equal < 0 ? undefined : arg.slice(equal + 1);
    if (['json', 'dev', 'help'].includes(name)) {
      if (value !== undefined)
        fail('INVALID_INPUT', `--${name} does not take a value`);
      global[name] = true;
      continue;
    }
    if (value === undefined) {
      value = args[++i];
      if (value === undefined || value.startsWith('--'))
        fail('INVALID_INPUT', `--${name} requires a value`);
    }
    if (name === 'input') {
      try {
        input = JSON.parse(
          value.startsWith('@')
            ? await readFile(value.slice(1), 'utf8')
            : value,
        );
      } catch (e) {
        fail('INVALID_INPUT', `Cannot read --input: ${e.message}`);
      }
      if (!input || Array.isArray(input) || typeof input !== 'object')
        fail('INVALID_INPUT', '--input must be a JSON object');
    } else if (globals.has(name)) global[name] = value;
    else {
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const typed = new Set([
        'startMinutes',
        'durationMinutes',
        'percent',
        'order',
        'offset',
        'limit',
        'cycleLength',
        'isDefault',
        'showInCheckin',
      ]);
      fields[key] = typed.has(key) ? parseValue(value) : value;
    }
  }
  let method;
  if (positional[0] === 'status') method = 'system.status';
  else if (positional[0] === 'schema') {
    method = 'system.describe';
    if (positional[1]) fields.method = positional[1];
  } else if (positional[0] && positional[1]) {
    method = `${positional[0]}.${positional[1]}`;
    if (positional[2]) fields.id = positional[2];
    if (positional.length > 3)
      fail('INVALID_INPUT', 'Too many positional arguments');
  }
  if (global.help && positional.length) {
    method = 'system.describe';
    fields.method = positional.slice(0, 2).join('.');
  }
  return { method, params: { ...input, ...fields }, global, positional };
}
function discoveryPath(dev) {
  if (process.env.DAYRAIL_BRIDGE_FILE) return process.env.DAYRAIL_BRIDGE_FILE;
  const base =
    platform() === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support')
      : platform() === 'win32'
        ? process.env.APPDATA
        : process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(
    base,
    'app.dayrail.desktop',
    `agent-bridge${dev ? '-dev' : ''}.json`,
  );
}
export function sendRequest(discovery, request) {
  if (
    discovery.protocolVersion !== 1 ||
    !Number.isInteger(discovery.port) ||
    discovery.port < 1 ||
    discovery.port > 65535 ||
    typeof discovery.token !== 'string'
  )
    return Promise.reject(
      Object.assign(new Error('Unsupported or invalid bridge discovery file'), {
        code: 'INVALID_DISCOVERY',
      }),
    );
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port: discovery.port,
    });
    let buffer = '';
    let received = false;
    const abort = (code, message) => {
      socket.destroy();
      reject(
        Object.assign(new Error(message), {
          code,
          details: { requestId: request.id },
        }),
      );
    };
    socket.setEncoding('utf8');
    socket.setTimeout(125000);
    socket.on('connect', () =>
      socket.write(
        JSON.stringify({ ...request, token: discovery.token }) + '\n',
      ),
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 64 * 1024 * 1024)
        return abort('RESPONSE_TOO_LARGE', 'Response exceeds 64 MiB');
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      received = true;
      try {
        resolve(JSON.parse(buffer.slice(0, end)));
      } catch {
        reject(
          Object.assign(new Error('Invalid bridge response'), {
            code: 'INVALID_RESPONSE',
          }),
        );
      }
      socket.destroy();
    });
    socket.on('timeout', () =>
      abort(
        'OUTCOME_UNKNOWN',
        'No acknowledgement. Inspect current data before retrying; keep the same request ID.',
      ),
    );
    socket.on('error', (e) =>
      abort(
        e.code === 'ECONNREFUSED' ? 'APP_UNAVAILABLE' : 'OUTCOME_UNKNOWN',
        e.code === 'ECONNREFUSED'
          ? 'DayRail is not running or local agent access is disabled.'
          : 'Connection failed; the request outcome may be unknown.',
      ),
    );
    socket.on('close', () => {
      if (!received)
        reject(
          Object.assign(
            new Error(
              'Connection closed without acknowledgement; inspect state before retrying.',
            ),
            { code: 'OUTCOME_UNKNOWN', details: { requestId: request.id } },
          ),
        );
    });
  });
}
async function install(dir = path.join(homedir(), '.local', 'bin')) {
  const source = fileURLToPath(import.meta.url);
  await mkdir(dir, { recursive: true });
  if (platform() === 'win32') {
    const target = path.join(dir, 'dayrail.cmd');
    await writeFile(
      target,
      `@echo off\r\n"${process.execPath}" "${source}" %*\r\n`,
      { flag: 'wx' },
    );
    return { installed: target, addToPath: dir };
  }
  const target = path.join(dir, 'dayrail');
  try {
    await lstat(target);
    fail(
      'ALREADY_EXISTS',
      `${target} already exists; inspect it before replacing it`,
    );
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  // The signed app's resource need not be executable: a private wrapper invokes Node.
  await writeFile(
    target,
    `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${source.replaceAll("'", "'\\''")}' "$@"\n`,
    { flag: 'wx', mode: 0o755 },
  );
  await chmod(target, 0o755);
  return { installed: target, addToPath: dir };
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

async function skillFiles(directory, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of await skillFiles(absolute, relative))
        files.set(name, content);
    } else if (entry.isFile()) files.set(relative, await readFile(absolute));
    else
      fail(
        'SKILL_CONFLICT',
        `Cannot replace a skill containing links or special files: ${absolute}`,
      );
  }
  return files;
}

async function bundledSkill() {
  // npm package, standalone archive, signed desktop resource, and checkout.
  for (const relative of [
    './skill/',
    './skills/dayrail/',
    '../skills/dayrail/',
    '../../skills/dayrail/',
  ]) {
    const directory = fileURLToPath(new URL(relative, import.meta.url));
    if (await exists(path.join(directory, 'SKILL.md')))
      return skillFiles(directory);
  }
  fail(
    'SKILL_NOT_FOUND',
    'The bundled skill is missing. Install dayrail-cli from npm, or keep the release skill archive beside the standalone client under skills/dayrail.',
  );
}

async function executableOnPath(name) {
  for (const directory of (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)) {
    for (const suffix of platform() === 'win32'
      ? ['', '.exe', '.cmd', '.bat']
      : ['']) {
      try {
        const file = path.join(directory, name + suffix);
        await access(
          file,
          platform() === 'win32' ? constants.F_OK : constants.X_OK,
        );
        if ((await lstat(file)).isDirectory()) continue;
        return true;
      } catch (e) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(e.code)) throw e;
      }
    }
  }
  return false;
}

async function installSkillAt(target, files) {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const lock = path.join(parent, '.dayrail-skill-install.lock');
  try {
    await mkdir(lock);
  } catch (e) {
    if (e.code === 'EEXIST')
      fail(
        'SKILL_INSTALL_BUSY',
        `Another installation is using ${lock}. If its process stopped, remove that lock directory and retry.`,
      );
    throw e;
  }
  let staging;
  let backup;
  try {
    const present = await exists(target);
    if (present) {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink())
        fail(
          'SKILL_CONFLICT',
          `The skill path is not a regular directory: ${target}. Inspect it or choose another --dir.`,
        );
      const current = await skillFiles(target);
      let installed;
      try {
        installed = JSON.parse(
          current.get('.dayrail-skill.json')?.toString() || 'null',
        );
      } catch {
        /* Preserve malformed local metadata in the backup. */
      }
      if (
        installed?.package === 'dayrail-cli' &&
        /^\d+\.\d+\.\d+$/.test(installed.version)
      ) {
        const previous = installed.version.split('.').map(Number);
        const next = CLI_VERSION.split('.').map(Number);
        const difference = previous
          .map((value, index) => value - next[index])
          .find((value) => value !== 0);
        if (difference > 0)
          fail(
            'SKILL_NEWER',
            `${target} was installed by CLI ${installed.version}. Upgrade dayrail-cli before updating this skill.`,
          );
      }
      if (
        current.size === files.size &&
        [...files].every(([name, content]) =>
          current.get(name)?.equals(content),
        )
      )
        return { path: target, status: 'unchanged' };
    }
    staging = await mkdtemp(path.join(parent, '.dayrail-install-'));
    for (const [name, content] of files) {
      const file = path.join(staging, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { flag: 'wx' });
    }
    if (present) {
      const backups = path.join(path.dirname(parent), '.dayrail-skill-backups');
      await mkdir(backups, { recursive: true });
      const destination = path.join(backups, `${Date.now()}-${randomUUID()}`);
      await rename(target, destination);
      backup = destination;
    }
    try {
      await rename(staging, target);
      staging = undefined;
    } catch (e) {
      if (backup && !(await exists(target))) {
        await rename(backup, target);
        backup = undefined;
      }
      throw e;
    }
    return {
      path: target,
      status: present ? 'updated' : 'installed',
      ...(backup && { backup }),
    };
  } catch (e) {
    if (backup) e.details = { ...e.details, backup };
    throw e;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

async function skills(args) {
  if (!args.length || args.includes('--help')) {
    process.stdout.write(skillsUsage);
    return;
  }
  if (!['install', 'update'].includes(args[0]))
    fail('INVALID_INPUT', skillsUsage);
  const options = { agents: [], json: false };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--json') {
      options.json = true;
      continue;
    }
    const [flag, ...rest] = args[i].split('=');
    if (!['--agent', '--dir'].includes(flag))
      fail('INVALID_INPUT', `Unknown skills argument: ${args[i]}`);
    const value = rest.length ? rest.join('=') : args[++i];
    if (!value || value.startsWith('--'))
      fail('INVALID_INPUT', `${flag} requires a value`);
    if (flag === '--agent') options.agents.push(...value.split(','));
    else {
      if (options.dir) fail('INVALID_INPUT', '--dir may only be supplied once');
      options.dir = value;
    }
  }
  if (options.dir && options.agents.length)
    fail('INVALID_INPUT', 'Choose either --agent or --dir');
  const home = homedir();
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const opencode = path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
    'opencode',
  );
  const agents = [
    {
      agent: 'codex',
      root: process.env.CODEX_HOME || path.join(home, '.codex'),
      bin: 'codex',
      directory: path.join(home, '.agents', 'skills'),
    },
    {
      agent: 'claude',
      root: claude,
      bin: 'claude',
      directory: path.join(claude, 'skills'),
    },
    {
      agent: 'gemini',
      root: path.join(home, '.gemini'),
      bin: 'gemini',
      directory: path.join(home, '.agents', 'skills'),
    },
    {
      agent: 'opencode',
      root: opencode,
      bin: 'opencode',
      directory: path.join(opencode, 'skills'),
    },
  ];
  const aliases = { 'claude-code': 'claude', 'gemini-cli': 'gemini' };
  const names = new Set(options.agents.map((name) => aliases[name] || name));
  for (const name of names)
    if (name !== 'all' && !agents.some((agent) => agent.agent === name))
      fail(
        'INVALID_INPUT',
        `Unknown agent: ${name}. Choose codex, claude, gemini, opencode, or all.`,
      );
  let targets;
  if (options.dir) {
    const directory =
      options.dir === '~'
        ? home
        : options.dir.startsWith('~/')
          ? path.join(home, options.dir.slice(2))
          : options.dir;
    targets = [{ agent: 'custom', directory: path.resolve(directory) }];
  } else if (names.size)
    targets = agents.filter(
      (agent) => names.has('all') || names.has(agent.agent),
    );
  else {
    const detected = await Promise.all(
      agents.map(
        async (agent) =>
          (await exists(agent.root)) || (await executableOnPath(agent.bin)),
      ),
    );
    targets = agents.filter((_, index) => detected[index]);
  }
  if (!targets.length)
    fail(
      'NO_AGENTS_FOUND',
      'No supported agent was detected. Use --agent codex,claude,gemini,opencode, --agent all, or --dir PATH.',
    );
  const files = await bundledSkill();
  files.set(
    '.dayrail-skill.json',
    Buffer.from(
      JSON.stringify({ package: 'dayrail-cli', version: CLI_VERSION }) + '\n',
    ),
  );
  const installations = [];
  for (const target of targets) {
    try {
      installations.push({
        agent: target.agent,
        ...(await installSkillAt(
          path.join(target.directory, 'dayrail'),
          files,
        )),
      });
    } catch (e) {
      installations.push({
        agent: target.agent,
        path: path.join(target.directory, 'dayrail'),
        status: 'failed',
        error: {
          code: e.code || 'CLIENT_ERROR',
          message: e.message,
          details: e.details,
        },
      });
    }
  }
  if (installations.some((item) => item.status === 'failed'))
    fail(
      'SKILL_INSTALL_FAILED',
      'Some skills could not be installed. Inspect details.installations before retrying.',
      { installations },
    );
  process.stdout.write(
    JSON.stringify(
      { ok: true, result: { version: CLI_VERSION, installations } },
      null,
      options.json ? 0 : 2,
    ) + '\n',
  );
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    process.stdout.write(CLI_VERSION + '\n');
    return;
  }
  if (args[0] === 'skills') return skills(args.slice(1));
  const parsed = await parseArgs(args);
  if (!args.length || (parsed.global.help && !parsed.positional.length)) {
    process.stdout.write(usage);
    return;
  }
  if (parsed.positional[0] === 'install') {
    process.stdout.write(
      JSON.stringify(await install(parsed.global.dir), null, 2) + '\n',
    );
    return;
  }
  if (!parsed.method) fail('INVALID_INPUT', usage);
  const request = {
    id: parsed.global['request-id'] || randomUUID(),
    method: parsed.method,
    params: parsed.params,
    ...(parsed.global['if-revision'] && {
      ifRevision: parsed.global['if-revision'],
    }),
  };
  let discovery;
  try {
    discovery = JSON.parse(
      await readFile(discoveryPath(parsed.global.dev), 'utf8'),
    );
  } catch {
    fail(
      'APP_UNAVAILABLE',
      'Open DayRail and enable local agent access in Settings > Advanced.',
    );
  }
  const response = await sendRequest(discovery, request);
  process.stdout.write(
    JSON.stringify(
      { ...response, requestId: request.id },
      null,
      parsed.global.json ? 0 : 2,
    ) + '\n',
  );
  if (!response.ok) process.exitCode = 1;
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code: e.code || 'CLIENT_ERROR',
          message: e.message,
          details: e.details,
        },
      }) + '\n',
    );
    process.exitCode = 1;
  });
