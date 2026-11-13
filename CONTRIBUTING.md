# Contributing

Use Node.js 22 or newer. No dependency installation is needed beyond `npm ci` to check the lockfile.

Before submitting a change:

```sh
npm run check
npm test
npm run build
```

Use a scratch vault for manual testing. For changes to file explorer interactions, run the optional desktop/touch tests documented in the README and check Obsidian's developer console. Be careful with compatibility across Obsidian versions, themes, and mobile WebViews.

Do not commit `data.json`, vault files, backups, `.local.json`, credentials, `node_modules`, or generated artifacts. Configuration migrations must preserve saved orders, pins, and hidden rules. Changes to the explorer should leave untouched folders using native sorting.

## Releasing

1. Update `package.json` and `manifest.json` to the same version, and add the minimum Obsidian version to `versions.json`.
2. Add release notes in `releases/<version>.md` and update `CHANGELOG.md`.
3. Run the checks above. Verify the plugin in Obsidian when behavior changes.
4. Commit and push the change to `main`. Wait for CI to pass.
5. Tag the release with the exact version, **without a `v` prefix**:

```sh
git tag -a 0.1.1 -m "Sparse Sort 0.1.1"
git push origin 0.1.1
```

The Release workflow verifies versions, runs tests, builds, and uploads `main.js`, `manifest.json`, `styles.css`, `LICENSE`, and an installation ZIP to a public GitHub release. Root `manifest.json` and `versions.json` are required for Obsidian/BRAT discovery.

Publishing a GitHub release does not submit the plugin to Obsidian's community directory. That is a separate review process.
