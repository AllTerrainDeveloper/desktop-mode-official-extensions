<?php
/**
 * Plugin Name: Gutenberg Live Preview (Desktop Mode)
 * Description: Adds a Live Preview eye-button to the Gutenberg editor that opens a native desktop window mirroring the draft per keystroke (500 ms debounce) over the wp-desktop-mode connection bridge. Requires wp-desktop-mode 0.17+.
 * Version:     0.6.12
 * Author:      Desktop Mode
 * License:     GPL-2.0-or-later
 *
 * @package WP_Gutenberg_Live_Preview
 */

defined( 'ABSPATH' ) || exit;

const WPGLP_VERSION = '0.6.12';

require_once __DIR__ . '/includes/preview-frame.php';
require_once __DIR__ . '/includes/render-endpoint.php';

/**
 * Editor (iframe) side: Gutenberg PluginSidebar with the eye icon
 * + the always-on publisher that emits `wpglp:content` over the
 * desktop bridge.
 */
function wpglp_enqueue_block_editor_assets() {
	// `wp.desktop.iframe.*` is auto-enqueued for every desktop-mode
	// user, but presence ≠ load order. We declare the bridge as a
	// hard dep when it's registered so the iframe API exists at the
	// moment our script evaluates and our `onConnection` listener
	// registers reliably. Without the dep, the first publish only
	// fires on the first wp.data tick (i.e. the first keystroke),
	// leaving the preview frame stuck on its placeholder for posts
	// that already had content.
	$deps = array( 'wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-i18n', 'wp-api-fetch', 'wp-url' );
	if ( wp_script_is( 'wp-desktop-iframe-bridge', 'registered' ) ) {
		$deps[] = 'wp-desktop-iframe-bridge';
	}
	wp_enqueue_script(
		'wpglp-editor',
		plugins_url( 'assets/editor.js', __FILE__ ),
		$deps,
		WPGLP_VERSION,
		true
	);
	wp_enqueue_style(
		'wpglp-editor',
		plugins_url( 'assets/editor.css', __FILE__ ),
		array(),
		WPGLP_VERSION
	);
}
add_action( 'enqueue_block_editor_assets', 'wpglp_enqueue_block_editor_assets' );

/**
 * Parent shell side: a small coordinator the editor calls into via
 * the same-origin shortcut (`window.top.wpglpShell.openPreviewFor`)
 * to open the native preview window and the bridge connection.
 *
 * Loaded only in the desktop shell context (not inside chromeless
 * iframes).
 */
/**
 * Register the `wpglp-shell` script handle and tell wp-desktop-mode
 * it's a title-bar-button-script provider — both on `init`, in the
 * same callback, so the handle exists at the moment
 * `desktop_mode_register_titlebar_button_script()` runs its
 * `wp_script_is( $handle, 'registered' )` validator. Doing the
 * `wp_register_script()` in `admin_enqueue_scripts` (the obvious-
 * looking choice) registers too late and trips a `_doing_it_wrong`
 * since wp-desktop-mode 0.18.0.
 */
function wpglp_register_shell_script() {
	wp_register_script(
		'wpglp-shell',
		plugins_url( 'assets/shell.js', __FILE__ ),
		array(),
		WPGLP_VERSION,
		true
	);

	if ( function_exists( 'desktop_mode_register_titlebar_button_script' ) ) {
		desktop_mode_register_titlebar_button_script( 'wpglp-shell' );
	}
}
add_action( 'init', 'wpglp_register_shell_script' );

/**
 * Enqueue the (already-registered) shell script in the parent
 * shell context only — not inside chromeless iframes. Splitting
 * the registration from the enqueue lets the desktop-mode
 * validator find the handle at `init` time while keeping the
 * enqueue context-aware.
 */
function wpglp_enqueue_shell_assets() {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}

	wp_enqueue_script( 'wpglp-shell' );
	wp_localize_script(
		'wpglp-shell',
		'wpglpShellConfig',
		array(
			'version'   => WPGLP_VERSION,
			'renderUrl' => esc_url_raw( rest_url( 'wpglp/v1/render' ) ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
		)
	);
}
add_action( 'admin_enqueue_scripts', 'wpglp_enqueue_shell_assets' );
