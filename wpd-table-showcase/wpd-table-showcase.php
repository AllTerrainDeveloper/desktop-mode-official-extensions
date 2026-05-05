<?php
/**
 * Plugin Name:       WPD Table Showcase
 * Description:       A native desktop window that exercises every documented `<wpd-table>` feature — filters, sort, selection, sticky, custom cells, sub-tables, loading, empty, theming.
 * Version:           1.0.0
 * Requires Plugins:  desktop-mode
 * Author:            Alcázaba
 * License:           GPL-2.0-or-later
 * Text Domain:       wpd-table-showcase
 *
 * @package WpdTableShowcase
 */

defined( 'ABSPATH' ) || exit;

define( 'WPD_TABLE_SHOWCASE_VERSION', '1.0.0' );
define( 'WPD_TABLE_SHOWCASE_FILE', __FILE__ );
define( 'WPD_TABLE_SHOWCASE_DIR', plugin_dir_path( __FILE__ ) );
define( 'WPD_TABLE_SHOWCASE_URL', plugin_dir_url( __FILE__ ) );
define( 'WPD_TABLE_SHOWCASE_WINDOW_ID', 'wpd-table-showcase' );
define( 'WPD_TABLE_SHOWCASE_SCRIPT_HANDLE', 'wpd-table-showcase' );
define( 'WPD_TABLE_SHOWCASE_STYLE_HANDLE', 'wpd-table-showcase' );

require_once WPD_TABLE_SHOWCASE_DIR . 'includes/data.php';
require_once WPD_TABLE_SHOWCASE_DIR . 'includes/assets.php';
require_once WPD_TABLE_SHOWCASE_DIR . 'includes/register.php';
