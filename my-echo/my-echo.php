<?php
/**
 * Plugin Name: My Echo Command
 *
 * Registers a tiny `/echo` slash command.
 *
 * Hook ordering matters here: wp-desktop-mode 0.18+ validates that
 * the script handle passed to `desktop_mode_register_command_script()`
 * has been registered with WordPress at the moment of the call.
 * That means `wp_register_script()` and the desktop-mode opt-in
 * must run in the same `init` callback. Doing the
 * `wp_register_script()` on `admin_enqueue_scripts` (the obvious-
 * looking place) registers too late and trips a
 * `_doing_it_wrong` notice.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
	wp_register_script(
		'my-echo-commands',
		plugins_url( 'echo.js', __FILE__ ),
		array(),
		'1.0.0',
		true
	);

	if ( function_exists( 'desktop_mode_register_command_script' ) ) {
		desktop_mode_register_command_script( 'my-echo-commands' );
	}
} );

add_action( 'admin_enqueue_scripts', function () {
	wp_enqueue_script( 'my-echo-commands' );
} );
