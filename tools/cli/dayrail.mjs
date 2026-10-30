#!/usr/bin/env node
// Dependency-free client for the running DayRail desktop app. Node.js >=18.
import net from 'node:net';
import { readFile, mkdir, writeFile, chmod, lstat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const usage = `DayRail CLI (Node.js >=18)
Usage: dayrail <resource> <action> [id] [--field value] [--input JSON|@file]
       dayrail status | schema [resource.action] | data export
       dayrail install [--dir PATH]

Global flags:
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
export async function main(args = process.argv.slice(2)) {
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
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
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
