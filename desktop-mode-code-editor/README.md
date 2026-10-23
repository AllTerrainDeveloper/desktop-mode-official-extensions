# OpenStation — Code Editor

A Monaco-backed **Code** window for [OpenStation](https://github.com/WordPress/openstation) that browses and edits files inside `wp-content`. Editing requires the `edit_plugins` capability and is disabled entirely when `DISALLOW_FILE_EDIT` is set.

## Building

Monaco is vendored into `assets/vendor/monaco-editor/` (gitignored), so a checkout needs one step before it runs:

```bash
./bin/fetch-monaco.sh   # npm install + copy Monaco's min build into assets/vendor/
npm run build:bundle    # only after editing src/*.ts; the built bundle is committed
```

## Opening a file from elsewhere on the desktop

### Cmd / Ctrl + Shift + E

Pressing `Cmd+Shift+E` (macOS) / `Ctrl+Shift+E` (Linux/Windows) anywhere on the desktop opens the editor window, or focuses it if already open. The editor returns to its last-active tab.

The shortcut is gated by the same `edit_plugins` capability as the window, so users without it never get the affordance.

### `os-code-open` postMessage

Any frame on the desktop (an iframe-based plugin window, a chromeless wp-admin page, the shell itself) can ask the editor to open a path at a line:

```js
window.parent.postMessage(
    {
        type: 'os-code-open',
        path: 'plugins/my-plugin/main.php',
        line: 42, // optional, defaults to 1
    },
    window.location.origin,
);
```

- If the editor window is closed, it opens, and the message is replayed once the editor has mounted.
- If it is already open, the in-window listener fetches the file, opens (or focuses) a tab, and scrolls to the line.
- The path goes through `openstation_code_editor_resolve_path()`: `..` escapes, symlinks pointing outside the workspace, and disallowed extensions all fail closed.
- The listener rejects messages from any origin other than `window.location.origin`. The editor can read files, so a third-party origin must not be able to drive it.

A "View source" link on a plugin's admin page:

```php
?>
<a href="#" id="my-view-source" class="button">View source</a>
<script>
document.getElementById( 'my-view-source' ).addEventListener( 'click', ( e ) => {
    e.preventDefault();
    window.parent.postMessage(
        { type: 'os-code-open', path: 'plugins/my-plugin/admin/page.php', line: 1 },
        window.location.origin
    );
} );
</script>
<?php
```

### `wp.os.openWindow( 'wpdc-editor' )`

Code running in the shell's own realm can open the window directly. `openWindow()` returns `false` when the editor isn't registered for the current user.

## Hooks

The `openstation_code_editor_*` filters and actions (capability gate, workspace root, extension allowlist, save pipeline, PHP indexing, REST limits, template/window/icon args) are documented with a docblock at each call site under `includes/`.
