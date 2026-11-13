# Changelog

## 0.2.0 — 2026-11-13

First public release, including the initial prototype and cross-folder insertion.

- Insert files and folders before/after a row in a different folder, including child-to-parent moves.
- Promote the insertion level with a deliberate left drag at subtree boundaries, including an only child.
- Show a destination path and a layer-aligned insertion line.
- Require a 600 ms dwell for folder-center drops; offer Undo after moves.
- Block name conflicts and self/descendant moves; roll back completed renames on failure.
- Use Obsidian FileManager to follow native link-update settings.

## 0.1.0 — 2026-11-13 (unreleased prototype)

- Record manual order only for rearranged folders, with automatic saving after each effective drag.
- Preserve native sorting for untouched folders and newly added items.
- Support desktop selection reordering, touch handles, and edge scrolling.
- Add pinning, hidden items/subtrees, glob hiding, and per-folder reset.
- Import selected Flexplorer orders with backups and a guarded plugin switch.
- Update saved paths on rename, move, and deletion without a vault-wide inventory.
- Provide portable local installation, automated checks, and GitHub release builds.

Known limits: internal explorer interfaces; no merge of concurrent device edits; iOS hardware behavior has not yet been verified.
