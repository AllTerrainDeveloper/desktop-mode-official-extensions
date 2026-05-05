<?php
/**
 * Plugin Name:       Desktop Mode — Routines
 * Plugin URI:        https://github.com/WordPress/desktop-mode-routines
 * Description:       Visual automation engine for Desktop Mode: "when X happens, do Y". Extracted from the Desktop Mode core plugin.
 * Version:           0.22.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Daniel López Sánchez
 * Author URI:        https://github.com/allterraindeveloper
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       desktop-mode-routines
 *
 * @package DesktopModeRoutines
 */

defined( 'ABSPATH' ) || exit;

define( 'DMR_VERSION', '0.22.0' );
define( 'DMR_FILE', __FILE__ );
define( 'DMR_DIR', plugin_dir_path( __FILE__ ) );
define( 'DMR_URL', plugin_dir_url( __FILE__ ) );

/**
 * Bail with an admin notice if the parent Desktop Mode plugin isn't loaded.
 *
 * `Requires Plugins: desktop-mode` (WP 6.5+) prevents activation without it,
 * but on older WP versions or if desktop-mode is deactivated mid-flight we
 * still need a graceful fallback.
 */
add_action(
	'plugins_loaded',
	static function () {
		if ( ! defined( 'DESKTOP_MODE_VERSION' ) ) {
			add_action(
				'admin_notices',
				static function () {
					echo '<div class="notice notice-error"><p>';
					esc_html_e(
						'Desktop Mode — Routines requires the Desktop Mode plugin to be installed and active.',
						'desktop-mode-routines'
					);
					echo '</p></div>';
				}
			);
			return;
		}

		require_once DMR_DIR . 'includes/bootstrap.php';
	},
	5
);
