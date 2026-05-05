=== WPD Table Showcase ===
Contributors: alcazaba
Tags: desktop-mode, table, showcase, demo
Requires at least: 6.5
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

A demo plugin that exercises every documented `<wpd-table>` feature inside a single native desktop-mode window.

== Description ==

Companion plugin for **wp-desktop-mode**. Adds a wallpaper icon and a tabbed native window. Each tab demos one capability of the `<wpd-table>` component:

* **Basics** — minimum viable `columns` + `data`.
* **Filters** — text and select filters, `clearFilters()`, pre-seeding via `table.filters`.
* **Sort** — `column.sortable`, custom `sortValue`, `wpd-table-sort-change`, `clearSort()`.
* **Selection** — `selectable="multi"`, stable ids via `getRowId`, bulk action API.
* **Sticky** — `sticky-columns` + `sticky-header` with RTL / bordered / compact toggles.
* **Custom cells** — string, `HTMLElement` (badge, SVG sparkline, image, action button) renderers.
* **Sub-tables** — three-level nesting with persistence to `localStorage` and programmatic expand/collapse.
* **States** — `loading` + `loading-rows`; the `empty` slot with a CTA.
* **Theming** — live binding of `--wpd-table-*` custom properties.
* **All-in-one** — every feature combined plus `scrollToRow()`.

== Installation ==

1. Activate **WP Desktop Mode**.
2. Activate **WPD Table Showcase**.
3. Toggle desktop mode on via the admin-bar button.
4. Click the *Table Showcase* icon on the wallpaper.

== Changelog ==

= 1.0.0 =
* Initial release. Targets `<wpd-table>` v2 (sort, selection, loading, slot, programmatic expand/collapse).
