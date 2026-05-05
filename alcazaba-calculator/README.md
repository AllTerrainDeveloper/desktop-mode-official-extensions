# Alcazaba Calculator

A four-function calculator companion for **WP Desktop Mode**.
Registered end-to-end in PHP via a single
`desktop_mode_register_window()` call, with every tag in the UI
composed from shell-shipped web components — `<wpd-panel>`,
`<wpd-display>`, `<wpd-grid>`, `<wpd-key>`. The plugin defines no
custom elements of its own, writes no CSS, and contains no
`innerHTML = '<wpd-…>'` string tricks. PHP owns the registration,
the enqueue, the `<template>`, and the tile lifecycle. JS owns the
arithmetic.

This plugin exists for three reasons:

1. **Smoke-test the WP-first native-window path.** If this small
   plugin works (one PHP `desktop_mode_register_window()` call →
   shell-printed template → shell-owned tile → shell-invoked
   render → interactive calculator), every other author shipping
   a desktop-first UI can reproduce the recipe in an afternoon.
2. **Prove the shell's component kit is enough.** Between round
   one and round two the maintainers shipped almost everything
   the first draft of this calculator had to fake with raw HTML
   and scoped CSS. The plugin has shipped with **zero lines of
   CSS** since v0.2.0.
3. **Prove the PHP helpers close the DX loop.** Round-three work
   shipped `desktop_mode_register_window()` + `desktop_mode_component()`,
   which collapses the enqueue / localize / footer / escape
   boilerplate every native-window plugin used to rebuild from
   scratch. v0.3.0 consumes both.

The second half of this document is the
**developer-experience report**. The ask list is now down to
housekeeping only.

---

## Table of contents

1. [Install & activate](#install--activate)
2. [How it's wired](#how-its-wired)
3. [What this plugin consumes from the shell](#what-this-plugin-consumes-from-the-shell)
4. [Developer-experience report](#developer-experience-report)
    1. [What shipped — thank you](#what-shipped--thank-you)
    2. [Still on the asks list](#still-on-the-asks-list)
5. [Summary](#summary)

---

## Install & activate

Drop into `wp-content/plugins/alcazaba-calculator/`, activate at
**Plugins → Alcazaba Calculator**, turn **Desktop Mode** on from
the admin-bar toggle. A **Calculator** tile appears in the
taskbar — no page reload required, the shell diffs the server-side
registry on every boot. Pass `'placement' => 'dock'` to
`desktop_mode_register_window()` if you want it on the left rail
instead.

Deactivating the plugin removes the tile automatically; activating
it surfaces one. No orphaned UI, no stale localStorage entries.

Keyboard shortcuts work while the window has focus:

| Key | Action |
|---|---|
| `0`–`9`, `.` | Digits |
| `+`, `-`, `*`, `/` | Operators |
| `Enter` | Equals |
| `Escape` | Clear |
| `%` | Percent |
| `s` | Toggle sign |

Every shortcut is bound via a first-class `key=""` attribute on
the corresponding `<wpd-key>`. The shell does the `event.key`
matching internally; there is no JS-side keyboard handler in this
plugin.

---

## How it's wired

```
┌──────────────────────────────────────────────────────────────┐
│ PHP                                                          │
│  init                                                        │
│   ↳ wp_register_script( 'alcazaba-calculator', …js,          │
│                          deps: [ 'wp-desktop' ] )            │
│   ↳ desktop_mode_register_window( 'alcazaba-calculator', [     │
│         'title'      => 'Calculator',                        │
│         'icon'       => 'dashicons-calculator',              │
│         'script'     => 'alcazaba-calculator',               │
│         'template'   => 'alcazaba_calc_render_template',     │
│         'width'      => 320,  'height'     => 460,           │
│         'min_width'  => 280,  'min_height' => 380,           │
│         'autofocus'  => true, 'placement'  => 'taskbar',     │
│     ] )                                                      │
│                                                              │
│  ↓ the shell handles the rest:                               │
│    • admin_enqueue_scripts — enqueue + localize              │
│        wpDesktopNativeWindow_alcazaba_calculator             │
│    • admin_footer — print                                    │
│        <template id="wpdm-native-window-                     │
│                    alcazaba-calculator">                     │
│          …alcazaba_calc_render_template() output…            │
│        </template>                                           │
│    • dock/taskbar tile with activation-aware lifecycle       │
│                                                              │
│  alcazaba_calc_render_template() (our template callback)     │
│    └─ desktop_mode_component( 'wpd-panel', [ 'role' => 'group' │
│                                            'aria-label' => … │
│         ], $body )                                           │
│         where $body buffers:                                 │
│           desktop_mode_component( 'wpd-display', …, '0' );     │
│           desktop_mode_component( 'wpd-grid',                  │
│                                 [ 'columns' => 4,            │
│                                   'gap'     => 8 ], $keys ); │
│         where $keys buffers 19 × desktop_mode_component(       │
│                                 'wpd-key', …, $label );      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ JS                                                           │
│  window.wpDesktopNativeWindows[ 'alcazaba-calculator' ] =    │
│      function renderCalculator( body ) {                     │
│          body.appendChild(                                   │
│              wp.desktop.cloneTemplate( templateId )          │
│          );                                                  │
│          keypad.addEventListener( 'wpd-key', dispatch );     │
│      };                                                      │
└──────────────────────────────────────────────────────────────┘
```

No `admin_enqueue_scripts` hook in this plugin. No `admin_footer`
hook. No `wp_localize_script` call. No JS `whenReady` / `registerSystemTile`
/ `registerWindow` dance. No `customElements.define`, no
`innerHTML = '<wpd-…>'`, no scoped CSS.

The critical invariant: **every tag is shipped by
`wp-desktop-mode`, every registration flows through the PHP
helper, every lifecycle transition is shell-owned.** Plugin
activation / deactivation / upgrade never leaves orphaned UI.

---

## What this plugin consumes from the shell

| Surface | Source | Used for |
|---|---|---|
| `desktop_mode_register_window( $id, $args )` | `includes/components.php` | Declares the window end-to-end — tile, template wrapper, enqueue, localize, open/close lifecycle. |
| `desktop_mode_component( $tag, $attrs, $content )` | `includes/components.php` | Prints every `<wpd-*>` tag with `esc_attr()` discipline baked in. |
| `window.wpDesktopNativeWindows[ <id> ]` | `src/native-windows.ts` | Global render-callback registry. We attach ours at file-load; shell invokes it on tile click. |
| `window.wpDesktopNativeWindow_<id-underscored>` | Localized by the shell | Per-window config blob (we read `templateId`). |
| `wp.desktop.cloneTemplate( id )` | `src/public-api.ts` | Clone the PHP-printed template into the window body. |
| `<wpd-panel>` | `src/ui/components/wpd-panel` | Window body safe-area + vertical rhythm. |
| `<wpd-display>` | `src/ui/components/wpd-display` | Calculator readout (live-region, tabular-nums, auto-ellipsis). |
| `<wpd-grid>` | `src/ui/components/wpd-grid` | 4-column keypad layout. |
| `<wpd-key>` | `src/ui/components/wpd-key` | Every key — first-class `key=""`, `span=""`, `variant=""`. Fires `wpd-key` on click + matching keydown. |
| `<wpd-empty-state>` | `src/ui/components/wpd-empty-state` | Fallback when the template is missing. |

Ten public surfaces, every one documented in the wp-desktop-mode
plugin's `docs/` directory with a `Stable` label. The calculator
does not touch any shell-internal API.

Things the calculator used to consume and **no longer needs**:

- `wp.desktop.whenReady( cb )` — we don't boot JS-side; PHP does.
- `wp.desktop.registerSystemTile( { … } )` — tile comes from PHP.
- `wp.desktop.registerWindow( def )` — shell wires this on click.
- `wp.desktop.windowManager.getById( id )` — `isOpen` is shell-owned.
- `wp_enqueue_script()` inside a custom `admin_enqueue_scripts`
  callback — the shell enqueues the registered handle.
- `wp_localize_script()` — the shell localizes the per-window config.
- A `<template>` printer hooked on `admin_footer` — the shell
  prints the wrapper and calls our template callback to fill it.
- `wp-hooks` script dependency — no runtime hook listeners in this
  plugin's JS.

---

## Developer-experience report

### What shipped — thank you

The journey from round one to round three is dramatic. Every item
in the table below was on a previous asks list and has since
landed:

| Ask | Surface | Impact on this plugin |
|---|---|---|
| Promote the `<wpd-*>` kit to the public API | Every `Wpd*` class + `WPD_*_TAG` constant re-exported from `src/public-api.ts` with `Stable` labels | The 10 public surfaces above are now a contract, not a convention. |
| `<wpd-display>` | New component | Replaced the custom `<output>` + 20 lines of CSS. |
| `<wpd-grid>` | New component | Replaced the custom `<div>` + inline `display: grid` CSS; `columns` and `gap` are first-class attributes. |
| `<wpd-panel>` | New component | Replaced the custom `<div class="alcazaba-calc">`. Every native-window plugin agrees on inner spacing now. |
| `<wpd-empty-state>` | New component | The fallback-when-template-missing branch is now an `<wpd-empty-state>` with a heading + description, not a bare `<p>`. |
| `<wpd-key>` | New component | The single biggest kit win: `<wpd-key key="Escape">` owns its own `event.key` matcher and fires `wpd-key` on click and keydown. Dropped the plugin's cssEscape polyfill, the `querySelector( 'wpd-button[data-key="…"]' )` lookup, the separate keydown handler, and the `tabindex="-1"` root-focus dance. One `wpd-key` listener on the keypad is all that's left. |
| `<wpd-key span="2">` as first-class | Grid span promoted from `data-span` | `<wpd-grid>` reads its children's `span` directly. |
| `<wpd-button>` v2: `secondary` variant + `::part(button)` + fill-cell | `<wpd-button>` / `<wpd-key>` props | AC, ±, % use `variant="secondary"`. Every host-widening and min-height CSS override is gone — the component fills the cell by default. |
| `NativeWindowDef.autofocus` | Native window def field | Replaced the `requestAnimationFrame( () => root.focus() )` dance. PHP passes `'autofocus' => true` and the shell focuses the body after render. |
| Native-window hooks: `NATIVE_WINDOW_BEFORE_RENDER`, `NATIVE_WINDOW_AFTER_RENDER`, `NATIVE_WINDOW_BEFORE_CLOSE`, `WINDOW_BODY_RESIZED` | `HOOKS.*` constants | Theming plugins can decorate our window without any awareness from us. |
| `wp.desktop.onWindow( id, events )` | Helper | Available for cross-plugin code that wants scoped lifecycle subscriptions. |
| `COMPONENTS_REGISTERED` + `DOCK_ITEM_APPENDED` hooks | Action hooks | Cover the registration cycle. |
| `url` auto-derived for native windows | `NativeWindowDef` | Stub `url: '#' + WINDOW_ID` never needed. |
| **`desktop_mode_register_window( $id, $args )`** | New PHP helper | **This release.** Replaced a bespoke `admin_enqueue_scripts` callback, a bespoke `admin_footer` template printer, `wp_enqueue_script` + `wp_localize_script` glue, the plugin-specific `alcazabaCalcConfig` global, the JS `registerSystemTile` + `registerWindow` calls, and the `whenReady` wait-loop. One PHP call now handles all of that. Activation / deactivation lifecycle is shell-owned. |
| **`desktop_mode_component( $tag, $attrs, $content )`** | New PHP helper | **This release.** Replaced every `printf( '<wpd-key … >%s</wpd-key>', esc_attr(…), esc_attr(…), … )` in the template printer with one typed call. Attribute escape is automatic; boolean attributes render bare; non-`wpd-*` tags fail loud in debug. |

**What this collapsed in v0.3.0 specifically**

- The `alcazaba_calc_is_active()` detection helper — gone; the
  shell's own `desktop_mode_is_enabled()` / `desktop_mode_is_chromeless_request()`
  gates already run before anything this plugin registered would
  fire.
- The `alcazaba_calc_enqueue_assets()` callback + its
  `admin_enqueue_scripts` hook — gone; `desktop_mode_register_window()`
  enqueues the registered handle itself.
- The custom `alcazabaCalcConfig` global via
  `wp_localize_script()` — gone; the shell localizes
  `wpDesktopNativeWindow_alcazaba_calculator` with the template
  id, dimensions, placement, and autofocus flag.
- The `alcazaba_calc_render_template` `admin_footer` hook — gone;
  `desktop_mode_register_window()` prints the `<template>` wrapper
  and calls our callback to fill it.
- The plugin-local `ALCAZABA_CALCULATOR_TEMPLATE_ID` constant —
  gone; the shell's deterministic `wpdm-native-window-<id>`
  naming scheme is public contract, and the localized
  `templateId` is the runtime source of truth.
- The JS `bootCalculator()` function and its `whenReady()`
  wrapper, the `api.registerSystemTile(…)` call inside, and the
  inline `onOpen: () => api.registerWindow(…)` block — all gone.
  JS now just attaches the render callback to
  `window.wpDesktopNativeWindows[ 'alcazaba-calculator' ]` and
  exits.
- The `DOMContentLoaded` listener at the bottom of
  `calculator.js` — gone; the shell invokes the render callback
  on demand, not at boot.
- Every hand-rolled `esc_attr()` / `esc_html()` call inside the
  `<wpd-key>` printer — replaced by `desktop_mode_component()`'s
  built-in escape loop.

The plugin's PHP is now ~385 lines including docblocks (down from
~480); excluding the 19-entry keypad descriptor and its
per-entry docblocks it's ~80 lines of actual plumbing. The JS
render callback is ~25 lines end-to-end including the
template-missing fallback. The total non-descriptor, non-comment
code in this plugin is under 150 lines.

---

### Still on the asks list

With `desktop_mode_register_window()` + `desktop_mode_component()`
shipped, only housekeeping items remain — nice-to-haves rather
than DX blockers.

#### 1. Lazy-load the UI kit

Most native-window plugins won't notice, because the kit is
small and the shell is already active on the page that loads it.
Big-bundle authors who ship on classic-admin pages that never
touch the desktop shell would benefit from conditionally loading
the kit. Optional.

#### 2. CLI scaffold

`wp scaffold desktop-window my-plugin` emitting a PHP + JS +
template skeleton would halve the time to first pixel. The
primitives are now so small (one PHP call, one JS render
callback, one template function) that a 40-line scaffold would
produce a runnable plugin. Acknowledged as a non-goal for now —
the PHP helper made this low-priority.

#### 3. `url` optional on `WindowConfig` itself

Still tricky architecturally — the window manager uses `url` as
a cache key even for native windows, and `NativeWindowDef` hides
this behind a sensible default. Leaving the ask on record in
case a later refactor makes it possible; today the shell's
auto-derivation inside `desktop_mode_register_window()` means no
plugin has to think about it.

#### 4. Template-fragment discovery in DevTools

A `wp.desktop.debug.listTemplates()` helper that dumps every
registered `<template>` id, the plugin that registered it, and
whether a render callback is attached. Would make mismatched-id
debugging trivial. Low priority; the deterministic
`wpdm-native-window-<id>` scheme already makes the right id
obvious.

None of the four items above blocks a plugin author from shipping
a first-class native desktop window today.

---

## Summary

The shell is **done** from the perspective of a native-window
calculator plugin. The delta across three rounds of DX work is:

| | Round 1 | Round 2 | Round 3 (this release) |
|---|---|---|---|
| PHP lines | ~300 (hand-rolled enqueue, footer, escape) | ~300 (same) | **~385 including a 19-entry keypad descriptor, ~80 of actual plumbing** |
| JS lines | ~150 | ~200 (state machine + keyboard + render) | **~185 (identical state machine; boot dance removed)** |
| CSS lines | ~80 scoped | **0** | **0** |
| Lifecycle ownership | Plugin | Plugin (JS) | **Shell** |
| Tile stays after deactivate? | Yes (orphan) | Yes (orphan) | **No (shell removes it)** |
| PHP calls plugin makes to register | 0 | 0 | **1** |
| Custom globals | `alcazabaCalcConfig` | `alcazabaCalcConfig` | **0 (shell localizes per-window blob)** |

Same look and feel across every native-window plugin is the
default when you use the shipped kit. Zero orphaned UI across
plugin activation is the default when you use
`desktop_mode_register_window()`. The only thing a plugin author
writes now is the interesting part — the descriptor, the template
callback, and the render callback. Everything that used to be
glue is someone else's problem.
