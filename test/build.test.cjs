'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('portable local install preserves existing settings and backups', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sparse-sort-build-'));
  try {
    const plugin = path.join(temp, '.obsidian', 'plugins', 'sparse-sort');
    fs.mkdirSync(path.join(plugin, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(plugin, 'data.json'), '{"keep":"settings"}');
    fs.writeFileSync(path.join(plugin, 'backups', 'keep.json'), 'backup');
    const result = spawnSync(process.execPath, ['build.cjs', '--install', '--vault', temp], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE']) assert.equal(
      fs.readFileSync(path.join(plugin, name), 'utf8'), fs.readFileSync(path.join(root, 'dist', name), 'utf8'));
    assert.equal(fs.readFileSync(path.join(plugin, 'data.json'), 'utf8'), '{"keep":"settings"}');
    assert.equal(fs.readFileSync(path.join(plugin, 'backups', 'keep.json'), 'utf8'), 'backup');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('install rejects a path without an Obsidian configuration directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sparse-sort-invalid-'));
  try {
    const result = spawnSync(process.execPath, ['build.cjs', '--install', '--vault', temp], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.equal(fs.existsSync(path.join(temp, '.obsidian')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('install rejects configuration traversal outside the selected vault', () => {
  const result = spawnSync(process.execPath, ['build.cjs', '--install', '--vault', os.tmpdir(), '--config-dir', '../outside'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /must stay inside/);
});
