# Sparse Sort

Lightweight manual ordering for the Obsidian file explorer. Record only the folders you rearrange; let everything else follow Obsidian's native sort order.

[Download](https://github.com/Al-assad/obsidian-sparse-sort/releases/latest) · [Report an issue](https://github.com/Al-assad/obsidian-sparse-sort/issues)

## Features

- **Automatic saving:** drop an item to save its new position. No separate “save order” action.
- **Opt-in per folder:** the first effective reorder records that folder's direct children. No recursive vault inventory or per-file timestamps.
- **Native fallback:** untouched folders keep Obsidian's current sorting rules. New children appear after recorded items, in native order.
- **Desktop and touch controls:** drag between rows on desktop; enable touch handles on phones or tablets. Desktop supports selections from the same folder.
- **Pins and hiding:** pin items, hide items or subtrees, and use glob patterns.
- **Migration from Flexplorer:** preview folder choices, back up both configurations, and disable the old plugin after a successful import.

## Installation

Requires **Obsidian 1.13.0 or newer**. Sparse Sort is not yet listed in the community plugin directory.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Al-assad/obsidian-sparse-sort/releases/latest), or extract the release ZIP.
2. Place the files in `<vault>/.obsidian/plugins/sparse-sort/`.
3. Enable **Sparse Sort** in Settings → Community plugins.

The release includes an MIT license. If your vault uses a custom configuration folder, replace `.obsidian` accordingly.

### BRAT

In [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `Al-assad/obsidian-sparse-sort` as a beta plugin repository, then enable Sparse Sort.

## Usage

### Desktop

Drag a file or folder to the top or bottom edge of another row. Within a folder this reorders; across folders this moves the item into the indicated parent at the chosen position. A blue insertion line and destination hint identify the target. Release to save automatically.

The center of a folder row remains Obsidian's native **move into this folder** target. Folder-center drops during ordinary desktop dragging keep native behavior; handle dragging uses the guarded folder-center gesture described below. A desktop selection can be reordered together when all selected items share a parent and pin state.

### Mobile and touch

Click the **Reorder items** button in the file explorer toolbar, or run **Sparse Sort: Toggle move/reorder handles**. Drag the handle on the right of a row, then release to save. Normal row areas remain available for scrolling.

Handles also support **cross-folder insertion at an exact position**:

- Drop on a row's upper/lower edge to insert before/after it in that row's parent folder. This works inside an expanded destination folder, and for moving a child out into its parent between specific siblings.
- At the first/last row of a subtree, drag left by about 28 pixels per level to promote the insertion to an ancestor. The blue line follows the destination indentation and the hint names the target folder and neighbor.
- Hold over a folder's center for 600 ms to arm **Move into**. A quick pass does not move anything into that folder. Expand a destination before dragging if you want to choose one of its children as the insertion anchor.
- Release to move and save. A **12-second Undo action** restores moved items and their previous positions when the original paths remain available.

The destination path and Before/After hint are authoritative: check them before releasing. Moving folders moves their contents as well. Same-name conflicts (including case-only variants) and moves into a folder's own descendants are blocked. Moves use Obsidian's FileManager so internal links follow its normal update settings. Failed multi-item moves attempt to roll back completed renames; a partial rollback is reported instead of overwriting files.

### Reset, pin, and hide

- Right-click an item → **Sparse Sort** for pinning, hiding, and restoring a folder's native order.
- Right-click the toolbar reorder button for root-folder actions.
- Settings → **Sparse Sort** lists recorded folders and their reset buttons.
- Use **Toggle hidden items** to reveal hidden entries and unhide them through the menu.

Resetting a folder removes its stored order. It does not change files, notes, pins, or hidden settings.

Hide patterns accept `*` (within a path segment), `**` (across segments), and `?` (one character). Start with `/` to anchor a pattern at the vault root. Enter one pattern per line.

## Migrating from Flexplorer

1. Leave Flexplorer installed and enable Sparse Sort. Sparse Sort waits while Flexplorer is enabled.
2. Open Sparse Sort settings → **Preview import**.
3. Review the selected folders. Root and top-level folders are selected by default; select any deeper folders whose manual order you want to retain.
4. Choose **Import and switch**. Sparse Sort backs up both configurations, imports selected orders and all valid pins/hiding rules, then disables Flexplorer.
5. After checking the result, you can uninstall Flexplorer. Sparse Sort runs independently.

Flexplorer does not distinguish automatically generated orders from user edits, so the importer cannot infer every manually arranged folder. Unselected folders use native sorting. Later imports can read the most recent backup even after Flexplorer has been uninstalled.

Backups are stored in `<config-dir>/plugins/sparse-sort/backups/`. To roll back, disable Sparse Sort before enabling Flexplorer again. The importer does not modify Flexplorer's settings file.

Per-folder timestamp sorting and Flexplorer's copy-placement options are not migrated in this version.

## How it stays small

The settings file stores ordered child names only for opted-in folders, plus explicitly configured pins and hiding rules. Reading or creating an ordinary file does not add a settings entry. A new child stays in the native-order tail until another manual reorder captures the folder's current children.

For a manually ordered folder, sorting overlays its saved order onto the native result with a linear merge. Drag targeting reads the row under the pointer instead of measuring every tree item. Touch updates and edge scrolling use animation frames; handles are added only to mounted rows.

Changed settings are saved through a serialized queue with immutable snapshots and burst coalescing. Failed saves remain available in memory for **Retry saving order**. Entering the background also attempts a flush, although a process killed before a write finishes cannot guarantee persistence.

Renames, moves, and deletions update affected saved paths and flags without walking all vault files. Native external moves leave untracked destinations on native sorting. A deliberate cross-folder insertion through Sparse Sort records the destination order to preserve the chosen position.

## Development

Requires Node.js 22 or newer. There are no runtime or build dependencies.

```sh
git clone https://github.com/Al-assad/obsidian-sparse-sort.git
cd obsidian-sparse-sort
npm ci
npm run check
npm test
npm run build
```

Build output is in `dist/`. To deploy to an existing local vault:

```sh
npm run install:local -- --vault "/path/to/vault"
# A custom configuration folder is optional:
npm run install:local -- --vault "/path/to/vault" --config-dir ".obsidian-dev"
```

You can also set `SPARSE_SORT_VAULT` or create an ignored `.local.json`:

```json
{
  "vaultPath": "/path/to/vault",
  "configDir": ".obsidian"
}
```

Installation copies plugin code and metadata only; existing `data.json` and backups are preserved. Reload the plugin to apply changes:

```sh
obsidian vault="Test Vault" plugin:reload id=sparse-sort
```

Optional live tests require the official Obsidian CLI and an open test vault:

```sh
OBSIDIAN_TEST_VAULT="Test Vault" npm run test:desktop
OBSIDIAN_TEST_VAULT="Test Vault" npm run test:touch
OBSIDIAN_TEST_VAULT="Test Vault" npm run test:moves
```

They create isolated temporary fixture files, verify automatic saving and cross-folder moves/undo, and clean up those files and their saved order. The touch and move tests use Chromium touch emulation. Run live tests in a scratch vault.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release procedure.

## Compatibility and current limits

- The sorting hook uses Obsidian's internal file explorer interface. Missing interfaces are detected, but future Obsidian changes may require updates.
- Desktop dragging, persistence across plugin reloads, native fallback, and Chromium touch emulation have been tested. iOS hardware behavior and suspension/resume remain unverified.
- Settings use ordinary file synchronization. Concurrent edits on multiple devices are not merged; avoid rearranging items on two devices at once.
- Sparse Sort should be the only plugin actively handling manual explorer ordering.

## Credits and license

File explorer integration is informed by [Flexplorer](https://github.com/kh4f/flexplorer), by kh4f. Sparse storage, ordering, and drag/touch handling were rewritten for this plugin. The original MIT notice is retained in [LICENSE](LICENSE).

MIT © 2026 Assad.
