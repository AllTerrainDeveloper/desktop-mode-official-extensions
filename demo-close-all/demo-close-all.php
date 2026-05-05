<?php
/**
 * Plugin Name: Demo — Close All
 * Plugin URI:  https://github.com/Automattic/wp-desktop-mode
 * Description: Registers the <code>/close_all</code> slash-command in the WP Desktop Mode AI palette. Closes every open window and collapses all virtual desktops down to one.
 * Version:     0.3.0
 * Author:      WP Desktop Mode contributors
 * License:     GPL-2.0-or-later
 * Requires Plugins:  desktop-mode
 * Text Domain: demo-close-all
 *
 * Reference implementation of the 0.15.0 command-registration pattern:
 *   desktop_mode_register_command() declares the command server-side so the
 *   shell includes the script URL in its plugins-changed payload — enabling
 *   mid-session injection without a full page reload.
 */

defined( 'ABSPATH' ) || exit;

// ── Script enqueue ────────────────────────────────────────────────────────────

add_action( 'admin_enqueue_scripts', 'demo_close_all_enqueue' );

/**
 * Enqueue via wp_enqueue_desktop_script() (0.14.0+) which handles
 * is_admin(), desktop_mode_is_enabled(), chromeless guard, wp-desktop dep,
 * and in_footer placement automatically.
 */
function demo_close_all_enqueue(): void {
	if ( ! function_exists( 'wp_enqueue_desktop_script' ) ) {
		return;
	}
	wp_enqueue_desktop_script(
		'demo-close-all',
		plugin_dir_url( __FILE__ ) . 'demo-close-all.js',
		array(),
		'0.3.0'
	);
}

// ── Command registration ──────────────────────────────────────────────────────

// desktop_mode_register_command() (0.15.0+) stores command metadata server-side
// AND calls desktop_mode_register_command_script() implicitly, so the script URL
// lands in the plugins-changed payload for mid-session shell injection.
if ( function_exists( 'desktop_mode_register_command' ) ) {
	desktop_mode_register_command( array(
		'slug'        => 'close_all',
		'label'       => __( 'Close all windows', 'demo-close-all' ),
		'description' => __( 'Close every open window and collapse to a single desktop.', 'demo-close-all' ),
		'icon'        => 'dashicons-no-alt',
		'script'      => 'demo-close-all',
	) );
}
