=== Desktop Mode — Routines ===
Contributors: alcazaba
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.22.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Visual automation engine for the Desktop Mode plugin: "when X happens, do Y".

== Description ==

Routines is the automation companion for the Desktop Mode plugin. Triggers
come from broadcast topics or WordPress hooks; actions come from registered
slash-commands, AI tools, or built-in steps (email, http, branch, log, …).
Every routine is a stored CPT entry plus a JSON definition; the engine reads
the definition, listens to the trigger, and executes the steps when it fires.

This plugin requires the Desktop Mode plugin to be installed and active.

== Installation ==

1. Make sure the Desktop Mode plugin is installed and active.
2. Upload this plugin to `wp-content/plugins/desktop-mode-routines`.
3. Activate it through the Plugins screen.

== Changelog ==

= 0.22.0 =
* Initial extraction from the Desktop Mode core plugin.
