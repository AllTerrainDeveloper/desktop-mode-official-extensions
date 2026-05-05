<?php
/**
 * Plugin Name:       WP Desktop Messages
 * Plugin URI:        https://github.com/wp-desktop-mode/wp-desktop-messages
 * Description:       Built-in 1-on-1 instant messaging for WP Desktop Mode. Native chat window, SSE-while-active + Heartbeat-fallback delivery, toasts, nudges, presence.
 * Version:           0.23.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            wp-desktop-mode
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-desktop-messages
 * Requires Plugins:  desktop-mode
 *
 * Ported out of `wp-desktop-mode` core in 0.23.0; consumes only the
 * Stable public surface documented in `wp-desktop-mode/docs/`.
 *
 * @package WPDesktopMessages
 */

defined( 'ABSPATH' ) || exit;

define( 'WPDM_MESSAGES_VERSION', '0.23.0' );
define( 'WPDM_MESSAGES_FILE', __FILE__ );
define( 'WPDM_MESSAGES_PATH', plugin_dir_path( __FILE__ ) );
define( 'WPDM_MESSAGES_URL', plugin_dir_url( __FILE__ ) );

require_once WPDM_MESSAGES_PATH . 'includes/bootstrap.php';
