<?php
/**
 * Plugin Name:       Alcazaba System Monitor
 * Description:       Adds a "System Monitor" widget to WP Desktop Mode that shows a live feed of console errors, unhandled promise rejections, and failed network requests (4xx / 5xx / transport-level). Registered end-to-end through `desktop_mode_register_widget()` — the shell owns the enqueue, the picker entry, the mount lifecycle, and mid-session activation / deactivation.
 * Version:           0.2.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 * Text Domain:       alcazaba-monitor
 *
 * @package AlcazabaMonitor
 */

defined( 'ABSPATH' ) || exit;

define( 'ALCAZABA_MONITOR_VERSION', '0.2.0' );
define( 'ALCAZABA_MONITOR_URL', plugin_dir_url( __FILE__ ) );
define( 'ALCAZABA_MONITOR_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Register the monitor widget with the desktop shell.
 *
 * A single `desktop_mode_register_widget()` call is everything —
 * the shell takes responsibility for the rest:
 *
 *   * Enqueues our `alcazaba-monitor` script handle on
 *     `admin_enqueue_scripts` when the shell is active (same
 *     gating as the shell itself — Desktop Mode on, not in a
 *     chromeless iframe, not on a classic admin page).
 *   * Adds the widget to the right-column picker with our label,
 *     description, and icon.
 *   * Resolves the script URL into the payload so mid-session
 *     activation can dynamically load our JS without a reload.
 *   * Invokes our JS mount callback — registered on
 *     `window.wpDesktopWidgets[ 'alcazaba-monitor/system' ]` — when
 *     the user enables the widget from the picker.
 *
 * Compare with the JS-only path (`wp.desktop.registerWidget`): that
 * route is still supported, but it self-manages the picker across
 * plugin activation / deactivation, leaves dangling entries when a
 * plugin is deactivated mid-session, and needs a `whenReady`
 * dance to avoid racing the shell boot. The `desktop_mode_register_widget()`
 * flow gets all of that for free.
 *
 * @since 0.2.0
 */
function alcazaba_monitor_register() {
	// Defensive guard — `Requires Plugins:  desktop-mode` in the
	// plugin header handles this on WP 6.5+, but the function-exists
	// check keeps older WP (or a deactivated shell) fatal-safe.
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}

	// `wp-hooks` stays in the dep list because the mount callback
	// subscribes to `IFRAME_ERROR`, `IFRAME_NETWORK_COMPLETED`, and
	// `SHELL_ERROR` via `wp.hooks.addAction()`. `wp-desktop` is
	// transitively needed for the shell globals the mount reads
	// (`wp.desktop.HOOKS`).
	wp_register_script(
		'alcazaba-monitor',
		ALCAZABA_MONITOR_URL . 'assets/js/monitor.js',
		array( 'wp-desktop', 'wp-hooks' ),
		ALCAZABA_MONITOR_VERSION,
		true
	);

	desktop_mode_register_widget(
		'alcazaba-monitor/system',
		array(
			'label'          => __( 'System Monitor', 'alcazaba-monitor' ),
			'description'    => __( 'Live feed of console and network errors.', 'alcazaba-monitor' ),
			'icon'           => 'dashicons-warning',
			'script'         => 'alcazaba-monitor',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 160,
			'default_width'  => 340,
			'default_height' => 300,
		)
	);
}
add_action( 'init', 'alcazaba_monitor_register' );
