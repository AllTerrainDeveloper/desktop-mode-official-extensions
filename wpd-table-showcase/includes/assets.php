<?php
/**
 * Asset registration for the showcase.
 *
 * Style and script are registered (not enqueued) on `admin_enqueue_scripts`
 * — the desktop shell handles the actual enqueue when the native window
 * opens, since `script` is named in `desktop_mode_register_window()`.
 *
 * @package WpdTableShowcase
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'admin_enqueue_scripts',
	function () {
		if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
			return;
		}

		wp_register_script(
			WPD_TABLE_SHOWCASE_SCRIPT_HANDLE,
			WPD_TABLE_SHOWCASE_URL . 'assets/js/showcase.js',
			array( 'wp-desktop' ),
			WPD_TABLE_SHOWCASE_VERSION,
			true
		);

		wp_localize_script(
			WPD_TABLE_SHOWCASE_SCRIPT_HANDLE,
			'wpdTableShowcase',
			array(
				'orders' => wpd_table_showcase_orders(),
			)
		);

		wp_register_style(
			WPD_TABLE_SHOWCASE_STYLE_HANDLE,
			WPD_TABLE_SHOWCASE_URL . 'assets/css/showcase.css',
			array(),
			WPD_TABLE_SHOWCASE_VERSION
		);

		// The shell enqueues the registered script for native windows;
		// the stylesheet is ours to enqueue when desktop mode is on.
		wp_enqueue_style( WPD_TABLE_SHOWCASE_STYLE_HANDLE );
	}
);
