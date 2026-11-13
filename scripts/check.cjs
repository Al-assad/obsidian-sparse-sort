'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const pkg = read('package.json'), manifest = read('manifest.json'), versions = read('versions.json');
if (pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) {
  throw Error('package.json, manifest.json and versions.json are out of sync');
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Obsidian release versions must use x.y.z');
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== manifest.version) throw Error('Release tag must match manifest.version without a v prefix');
for (const name of ['core.cjs', 'plugin.cjs', 'build.cjs']) {
  new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
}
console.log(`Validated Sparse Sort ${manifest.version}`);
