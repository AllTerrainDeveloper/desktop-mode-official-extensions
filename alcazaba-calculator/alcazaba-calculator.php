<?php

/**
 * Plugin Name:       Alcazaba Calculator
 * Description:       A four-function calculator companion for WP Desktop Mode. Registered end-to-end in PHP via `desktop_mode_register_window()` — the shell owns the <template>, the script enqueue, the dock/taskbar tile, and the open/close lifecycle. The plugin only ships a keypad descriptor, a template callback, and a JS render callback.
 * Version:           0.5.7
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 * Text Domain:       alcazaba-calculator
 *
 * @package AlcazabaCalculator
 *
 * ============================================================
 * What this plugin is
 * ============================================================
 *
 * A smoke test for the WP-first native-window path:
 *
 *   1. PHP calls `desktop_mode_register_window()` on `init`. That
 *      single call emits the `<template>` on `admin_footer`,
 *      auto-enqueues this plugin's JS, localizes a per-window
 *      config blob, and registers the dock/taskbar tile — with
 *      activation/deactivation lifecycle handled by the shell.
 *
 *   2. PHP's template callback composes the UI from shell-shipped
 *      components — `<wpd-panel>`, `<wpd-display>`, `<wpd-grid>`,
 *      `<wpd-key>` — via `desktop_mode_component()`, so every
 *      attribute flows through `esc_attr()` automatically.
 *
 *   3. JS attaches a render callback to
 *      `window.wpDesktopNativeWindows[ 'alcazaba-calculator' ]`.
 *      The shell calls it with the empty window body when the
 *      user clicks the tile.
 *
 * No manual `admin_enqueue_scripts`, no manual `admin_footer`, no
 * `wp_localize_script`, no JS `registerSystemTile` +
 * `registerWindow` dance, no plugin-local custom elements, no
 * scoped CSS.
 */

defined('ABSPATH') || exit;

define('ALCAZABA_CALCULATOR_VERSION', '0.5.7');
define('ALCAZABA_CALCULATOR_URL', plugin_dir_url(__FILE__));
define('ALCAZABA_CALCULATOR_DIR', plugin_dir_path(__FILE__));

/**
 * Register the calculator as a PHP-owned native desktop window.
 *
 * The single `desktop_mode_register_window()` call below is
 * everything — the shell takes responsibility for the rest:
 *
 *   * Emits `<template id="wpdm-native-window-alcazaba-calculator">`
 *     on `admin_footer`, calling our `template` callback to fill
 *     it with the `<wpd-panel>` tree.
 *   * Enqueues our `alcazaba-calculator` script handle on
 *     `admin_enqueue_scripts` once the shell is active.
 *   * Localizes the per-window config under
 *     `window.wpDesktopNativeWindow_alcazaba_calculator` so the
 *     JS side knows the chosen `templateId`, dimensions, and
 *     autofocus flag.
 *   * Inserts a taskbar tile whose `onOpen` handler calls
 *     `wp.desktop.registerWindow()` internally with the native
 *     defaults; on click the shell invokes our render callback
 *     via `window.wpDesktopNativeWindows[ 'alcazaba-calculator' ]`.
 *   * **Removes the tile automatically on plugin deactivation,
 *     surfaces it on activation.** The shell diffs the server
 *     registry on every boot, so state stays coherent with
 *     whatever plugins are active right now.
 *
 * Compare with the JS-only path (`wp.desktop.registerSystemTile`):
 * that's the "draw the tile yourself" escape hatch and self-
 * manages tile lifecycle across plugin activation. Everything
 * about this plugin is declarative PHP, so we take the
 * recommended path.
 *
 * @since 0.3.0
 */
function alcazaba_calc_register()
{
	// Defensive guard — `Requires Plugins:  desktop-mode` in the
	// plugin header handles this on WP 6.5+, but the function-exists
	// check keeps older WP (or a deactivated shell) fatal-safe.
	if (! function_exists('desktop_mode_register_window')) {
		return;
	}

	wp_register_script(
		'alcazaba-calculator',
		ALCAZABA_CALCULATOR_URL . 'assets/js/calculator.js',
		array('wp-desktop'),
		ALCAZABA_CALCULATOR_VERSION,
		true
	);

	desktop_mode_register_window(
		'alcazaba-calculator',
		array(
			'title'          => __('Calculator', 'alcazaba-calculator'),
			'main_tab_label' => __('Calc', 'alcazaba-calculator'),
			'icon'           => 'dashicons-calculator',
			'main_tab_padding' => 0,
			'script'         => 'alcazaba-calculator',
			'template'       => 'alcazaba_calc_render_template',
			'width'          => 320,
			'height'         => 520,
			'min_width'      => 280,
			'min_height'     => 420,
			'autofocus'      => true,
			'placement'      => 'taskbar',
		)
	);

	// Convert tab — registering it here (rather than weaving panes
	// through the main template) lights up the shell's auto-tab
	// pipeline: `<wpd-tabs>` + two `<wpd-tabpanel>`s appear around the
	// combined markup with zero template boilerplate, and a companion
	// plugin could attach a third tab later with the same call.
	desktop_mode_register_window_tab(
		'alcazaba-calculator',
		array(
			'value'    => 'convert',
			'label'    => __('Convert', 'alcazaba-calculator'),
			'position' => 10,
			'template' => 'alcazaba_calc_render_convert_template',
		)
	);
}
add_action('init', 'alcazaba_calc_register');

/**
 * Keypad descriptor — the single source of truth for the key
 * layout. Each entry becomes one `<wpd-key>`.
 *
 *   digit / op / action  — mutually exclusive. The JS state
 *                          machine branches on whichever
 *                          `data-*` attribute is present on the
 *                          `<wpd-key>` that fired `wpd-key`.
 *   variant              — maps directly to `<wpd-key>`'s
 *                          (inherited from `<wpd-button>`)
 *                          `variant` prop. We use `primary` for
 *                          operators + equals and `secondary`
 *                          for the quiet control keys (AC, ±, %).
 *   key                  — physical keyboard shortcut. First-
 *                          class attribute on `<wpd-key>`; the
 *                          component owns the `event.key` matcher.
 *   span                 — `<wpd-grid>` cell span (first-class).
 *
 * @since 0.1.0
 *
 * @return array<int, array<string, string|int>>
 */
function alcazaba_calc_keypad_buttons()
{
	return array(
		// Row 1 — control keys + divide.
		array(
			'label'   => __('All clear', 'alcazaba-calculator'),
			'display' => 'AC',
			'action'  => 'clear',
			'variant' => 'secondary',
			'key'     => 'Escape',
		),
		array(
			'label'   => __('Toggle sign', 'alcazaba-calculator'),
			'display' => "\xC2\xB1",
			'action'  => 'sign',
			'variant' => 'secondary',
			'key'     => 's',
		),
		array(
			'label'   => __('Percent', 'alcazaba-calculator'),
			'display' => '%',
			'action'  => 'percent',
			'variant' => 'secondary',
			'key'     => '%',
		),
		array(
			'label'   => __('Divide', 'alcazaba-calculator'),
			'display' => "\xC3\xB7",
			'op'      => 'divide',
			'variant' => 'primary',
			'key'     => '/',
		),

		// Row 2.
		array(
			'label'   => '7',
			'display' => '7',
			'digit'   => '7',
			'key'     => '7',
		),
		array(
			'label'   => '8',
			'display' => '8',
			'digit'   => '8',
			'key'     => '8',
		),
		array(
			'label'   => '9',
			'display' => '9',
			'digit'   => '9',
			'key'     => '9',
		),
		array(
			'label'   => __('Multiply', 'alcazaba-calculator'),
			'display' => "\xC3\x97",
			'op'      => 'multiply',
			'variant' => 'primary',
			'key'     => '*',
		),

		// Row 3.
		array(
			'label'   => '4',
			'display' => '4',
			'digit'   => '4',
			'key'     => '4',
		),
		array(
			'label'   => '5',
			'display' => '5',
			'digit'   => '5',
			'key'     => '5',
		),
		array(
			'label'   => '6',
			'display' => '6',
			'digit'   => '6',
			'key'     => '6',
		),
		array(
			'label'   => __('Subtract', 'alcazaba-calculator'),
			'display' => "\xE2\x88\x92",
			'op'      => 'subtract',
			'variant' => 'primary',
			'key'     => '-',
		),

		// Row 4.
		array(
			'label'   => '1',
			'display' => '1',
			'digit'   => '1',
			'key'     => '1',
		),
		array(
			'label'   => '2',
			'display' => '2',
			'digit'   => '2',
			'key'     => '2',
		),
		array(
			'label'   => '3',
			'display' => '3',
			'digit'   => '3',
			'key'     => '3',
		),
		array(
			'label'   => __('Add', 'alcazaba-calculator'),
			'display' => '+',
			'op'      => 'add',
			'variant' => 'primary',
			'key'     => '+',
		),

		// Row 5 — zero spans two columns.
		array(
			'label'   => '0',
			'display' => '0',
			'digit'   => '0',
			'span'    => 2,
			'key'     => '0',
		),
		array(
			'label'   => __('Decimal point', 'alcazaba-calculator'),
			'display' => '.',
			'digit'   => '.',
			'key'     => '.',
		),
		array(
			'label'   => __('Equals', 'alcazaba-calculator'),
			'display' => '=',
			'action'  => 'equals',
			'variant' => 'primary',
			'key'     => 'Enter',
		),
	);
}

/**
 * Translate one keypad-descriptor entry into the attribute map
 * `desktop_mode_component()` needs for a `<wpd-key>` tag.
 *
 * Intent-carrying attributes (`data-digit` / `data-op` /
 * `data-action`) are mutually exclusive; the first one present on
 * the descriptor wins. Missing optional fields (`variant`, `span`,
 * `key`) are omitted from the output so the rendered tag stays
 * minimal.
 *
 * @since 0.3.0
 *
 * @param array $button One entry from `alcazaba_calc_keypad_buttons()`.
 * @return array<string, string|int>
 */
function alcazaba_calc_button_to_attrs(array $button)
{
	$attrs = array(
		'aria-label' => (string) $button['label'],
	);

	if (! empty($button['variant'])) {
		$attrs['variant'] = (string) $button['variant'];
	}

	if (isset($button['digit'])) {
		$attrs['data-digit'] = (string) $button['digit'];
	} elseif (isset($button['op'])) {
		$attrs['data-op'] = (string) $button['op'];
	} elseif (isset($button['action'])) {
		$attrs['data-action'] = (string) $button['action'];
	}

	if (! empty($button['span']) && (int) $button['span'] > 1) {
		$attrs['span'] = (int) $button['span'];
	}

	if (! empty($button['key'])) {
		$attrs['key'] = (string) $button['key'];
	}

	return $attrs;
}

/**
 * Emit the Calc tab's component tree. Because a Convert tab is
 * registered via `desktop_mode_register_window_tab()`, the shell
 * wraps this output in `<wpd-tabpanel for="main">` automatically —
 * the plugin no longer writes tab markup, pane toggling, or
 * `data-pane` conventions of its own.
 *
 *   <wpd-panel role="group" aria-label="Calculator">
 *     <wpd-display data-role="display">0</wpd-display>
 *     <wpd-grid data-role="keypad" columns="4" gap="8">
 *       <wpd-key …>…</wpd-key>  × 19
 *     </wpd-grid>
 *   </wpd-panel>
 *
 * @since 0.3.0
 */
function alcazaba_calc_render_template()
{
	ob_start();
	foreach (alcazaba_calc_keypad_buttons() as $button) {
		desktop_mode_component(
			'wpd-key',
			alcazaba_calc_button_to_attrs($button),
			esc_html((string) $button['display'])
		);
	}
	$keys_html = ob_get_clean();

	ob_start();
	desktop_mode_component(
		'wpd-display',
		array(
			'data-role'   => 'display',
			'aria-live'   => 'polite',
			'aria-atomic' => 'true',
		),
		'0'
	);
	desktop_mode_component(
		'wpd-grid',
		array(
			'data-role' => 'keypad',
			'columns'   => 4,
			'gap'       => 8,
		),
		$keys_html
	);
	$panel_children = ob_get_clean();

	desktop_mode_component(
		'wpd-panel',
		array(
			'role'       => 'group',
			'aria-label' => __('Calculator', 'alcazaba-calculator'),
		),
		$panel_children
	);
}

/**
 * Emit the Convert tab's component tree — unit converter across
 * Length / Temperature / Mass.
 *
 *   <wpd-panel role="group" aria-label="Unit converter">
 *     <wpd-stack gap="12">
 *       <wpd-segmented data-role="category" value="length">…</wpd-segmented>
 *       <wpd-row>
 *         <wpd-select data-role="from" col="6" label="From unit"></wpd-select>
 *         <wpd-select data-role="to"   col="6" label="To unit"></wpd-select>
 *       </wpd-row>
 *       <wpd-number-field data-role="value" label="Value" value="1" step="any"></wpd-number-field>
 *       <wpd-display      data-role="convert-output">—</wpd-display>
 *     </wpd-stack>
 *   </wpd-panel>
 *
 * The From / To selects pair up in a `<wpd-row>` 12-col grid (6+6)
 * so the user sees both dropdowns at a glance instead of scanning a
 * vertical stack. Value field + output display stay full-row — they
 * carry more visual weight and shouldn't share horizontal space.
 *
 * The `<wpd-select>`s are intentionally emitted without children —
 * JS owns the canonical unit list so the conversion formulas and
 * the option labels can't drift. `.items = [...]` populates them
 * declaratively on mount and on every category change.
 *
 * @since 0.5.3
 */
function alcazaba_calc_render_convert_template()
{
	// Category pill bar — three entries, fits `<wpd-segmented>`.
	ob_start();
	desktop_mode_component('wpd-segment', array('value' => 'length'), esc_html__('Length', 'alcazaba-calculator'));
	desktop_mode_component('wpd-segment', array('value' => 'temp'),   esc_html__('Temp', 'alcazaba-calculator'));
	desktop_mode_component('wpd-segment', array('value' => 'mass'),   esc_html__('Mass', 'alcazaba-calculator'));
	$category_segments = ob_get_clean();

	// From / To selects — paired 6+6 inside a 12-col `<wpd-row>`.
	ob_start();
	desktop_mode_component(
		'wpd-select',
		array(
			'data-role' => 'from',
			'col'       => 6,
			'label'     => __('From unit', 'alcazaba-calculator'),
		)
	);
	desktop_mode_component(
		'wpd-select',
		array(
			'data-role' => 'to',
			'col'       => 6,
			'label'     => __('To unit', 'alcazaba-calculator'),
		)
	);
	$from_to_row = ob_get_clean();

	ob_start();
	desktop_mode_component(
		'wpd-segmented',
		array(
			'data-role' => 'category',
			'value'     => 'length',
			'label'     => __('Unit category', 'alcazaba-calculator'),
		),
		$category_segments
	);
	desktop_mode_component('wpd-row', array(), $from_to_row);
	desktop_mode_component(
		'wpd-number-field',
		array(
			'data-role' => 'value',
			'label'     => __('Value', 'alcazaba-calculator'),
			'value'     => '1',
			'step'      => 'any',
		)
	);
	desktop_mode_component(
		'wpd-display',
		array(
			'data-role'   => 'convert-output',
			'aria-live'   => 'polite',
			'aria-atomic' => 'true',
			'size'        => 'md',
			'style'		=> [ 'color' => 'red' ],
		),
		"\xE2\x80\x94"
	);
	$stack_children = ob_get_clean();

	ob_start();
	desktop_mode_component(
		'wpd-stack',
		array('gap' => 12),
		$stack_children
	);
	$panel_children = ob_get_clean();

	desktop_mode_component(
		'wpd-panel',
		array(
			'role'       => 'group',
			'aria-label' => __('Unit converter', 'alcazaba-calculator'),
		),
		$panel_children
	);
}
