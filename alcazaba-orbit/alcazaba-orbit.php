<?php
/**
 * Plugin Name:       Alcazaba Orbit Dock
 * Description:       Replaces the dock rail with a slowly-rotating ring of icons orbiting a glowing pulsar in the middle of the desktop. Pure consumer of the dock-customization API shipped in desktop-mode 0.18.0.
 * Version:           0.21.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 * Text Domain:       alcazaba-orbit
 *
 * @package AlcazabaOrbit
 */

defined( 'ABSPATH' ) || exit;

const ALCAZABA_ORBIT_VERSION = '0.21.0';

/**
 * Register the orbit script + stylesheet handles, and tell desktop-mode
 * that the script contributes a dock rail renderer so the shell can
 * live-load it on plugin activate without an F5.
 *
 * The dock-rail-renderer registry (`desktop_mode_register_dock_rail_renderer_script`)
 * is read by desktop-mode's boot-payload builder; the shell loads each
 * registered handle's script after a `wp-desktop-plugins-changed` postMessage,
 * which runs our `wp.desktop.registerDockRailRenderer( ... )` JS call. The
 * `owner: 'alcazaba-orbit'` tag on that JS call lets desktop-mode sweep the
 * renderer cleanly on deactivate.
 */
function alcazaba_orbit_register_assets(): void {
	wp_register_script(
		'alcazaba-orbit',
		plugin_dir_url( __FILE__ ) . 'assets/orbit.js',
		array( 'wp-desktop', 'wp-hooks' ),
		ALCAZABA_ORBIT_VERSION,
		true
	);

	wp_register_style(
		'alcazaba-orbit',
		plugin_dir_url( __FILE__ ) . 'assets/orbit.css',
		array(),
		ALCAZABA_ORBIT_VERSION
	);

	if ( function_exists( 'desktop_mode_register_dock_rail_renderer_script' ) ) {
		desktop_mode_register_dock_rail_renderer_script( 'alcazaba-orbit' );
	}
}
add_action( 'init', 'alcazaba_orbit_register_assets' );

/**
 * Enqueue the orbit assets when desktop mode is active in the parent
 * shell (not chromeless, not classic admin).
 */
function alcazaba_orbit_enqueue(): void {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}

	wp_enqueue_script( 'alcazaba-orbit' );
	wp_enqueue_style( 'alcazaba-orbit' );
}
add_action( 'admin_enqueue_scripts', 'alcazaba_orbit_enqueue' );
