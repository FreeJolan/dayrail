// Copy canonical documentation into the npm staging directory. No install hooks.
import { cp, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(directory, '../..');
await rm(path.join(directory, 'skill'), { recursive: true, force: true });
await cp(path.join(root, 'skills/dayrail'), path.join(directory, 'skill'), {
  recursive: true,
});
await copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
