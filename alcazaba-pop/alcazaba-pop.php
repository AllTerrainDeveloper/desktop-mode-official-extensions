<?php
/**
 * Plugin Name:       Alcazaba POP
 * Description:       A pop-art skin for WP Desktop Mode — bright flat colors, thick black borders, chunky offset shadows. Themes every window and ships a handful of pop-art wallpapers.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 *
 * @package AlcazabaPop
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the POP window theme.
 *
 * Stylesheet-only theme — the wp-desktop-mode chrome server-sync turns this
 * into a sitewide `match: () => true` registration. Priority 200 outranks
 * the default 100 used by other registered themes.
 */
add_action( 'init', static function () {
	if ( ! function_exists( 'desktop_mode_register_window_theme' ) ) {
		return;
	}

	desktop_mode_register_window_theme(
		array(
			'id'       => 'alcazaba-pop/pop',
			'label'    => __( 'Alcazaba POP', 'alcazaba-pop' ),
			'priority' => 200,
			'tokens'   => array(
				// Window body.
				'--wp-desktop-window-bg'              => '#fffdf2',
				'--wp-desktop-window-border'          => '#0a0a0a',
				'--wp-desktop-window-radius'          => '6px',
				'--wp-desktop-window-shadow'          => '6px 6px 0 0 #0a0a0a',
				'--wp-desktop-window-shadow-focused'  => '10px 10px 0 0 #0a0a0a',

				// Title bar.
				'--wp-desktop-titlebar-height'        => '34px',
				'--wp-desktop-titlebar-bg'            => '#ffd9e8',
				'--wp-desktop-titlebar-bg-focused'    => '#ff2e93',
				'--wp-desktop-titlebar-color'         => '#0a0a0a',
				'--wp-desktop-titlebar-color-focused' => '#ffffff',

				// Title-bar buttons.
				'--wpd-btn-color'                     => '#0a0a0a',
				'--wpd-btn-color-hover'               => '#ffffff',
				'--wpd-btn-bg-hover'                  => '#0a0a0a',
				'--wpd-btn-bg-active'                 => '#3a3a3a',
				'--wpd-btn-outline'                   => '#ffd93d',
				'--wpd-btn-danger-hover'              => '#ff2e93',
			),
		)
	);
} );

/**
 * Enqueue the wallpapers JS in the parent shell only.
 *
 * `wpdm_is_chromeless_request()` is true inside the iframe; we want shell-side.
 */
add_action( 'admin_enqueue_scripts', static function () {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}

	$base = plugin_dir_path( __FILE__ ) . 'assets/';
	wp_enqueue_script(
		'alcazaba-pop-wallpapers',
		plugins_url( 'assets/wallpapers.js', __FILE__ ),
		array( 'wp-desktop' ),
		(string) filemtime( $base . 'wallpapers.js' ),
		true
	);

	wp_enqueue_script(
		'alcazaba-pop-slots',
		plugins_url( 'assets/slots.js', __FILE__ ),
		array( 'wp-desktop' ),
		(string) filemtime( $base . 'slots.js' ),
		true
	);

	wp_enqueue_script(
		'alcazaba-pop-chrome',
		plugins_url( 'assets/chrome.js', __FILE__ ),
		array( 'wp-desktop' ),
		(string) filemtime( $base . 'chrome.js' ),
		true
	);

	wp_enqueue_script(
		'alcazaba-pop-loader',
		plugins_url( 'assets/loader.js', __FILE__ ),
		array( 'wp-desktop' ),
		(string) filemtime( $base . 'loader.js' ),
		true
	);
} );

/**
 * Tag the slot + chrome scripts so the chrome server-sync can
 * live-unregister our entries when this plugin is deactivated.
 */
if ( function_exists( 'desktop_mode_register_window_slot_script' ) ) {
	desktop_mode_register_window_slot_script( 'alcazaba-pop-slots' );
}
if ( function_exists( 'desktop_mode_register_window_chrome_script' ) ) {
	desktop_mode_register_window_chrome_script( 'alcazaba-pop-chrome' );
}

/**
 * Append pop-art accent swatches to the OS Settings accent picker.
 * The shell writes the chosen value to `--wp-admin-theme-color` on
 * the desktop's <html>, so components that key off that variable
 * (links, focus rings, primary buttons in chromeless pages) follow.
 */
add_filter( 'desktop_mode_accent_colors', static function ( $colors ) {
	$colors[] = array( 'id' => 'pop-magenta', 'label' => __( 'POP Magenta', 'alcazaba-pop' ), 'value' => '#ff2e93' );
	$colors[] = array( 'id' => 'pop-yellow',  'label' => __( 'POP Yellow',  'alcazaba-pop' ), 'value' => '#ffd93d' );
	$colors[] = array( 'id' => 'pop-cyan',    'label' => __( 'POP Cyan',    'alcazaba-pop' ), 'value' => '#00d4ff' );
	$colors[] = array( 'id' => 'pop-violet',  'label' => __( 'POP Violet',  'alcazaba-pop' ), 'value' => '#7a00ff' );
	return $colors;
} );

/**
 * First-boot default wallpaper — POP Sunburst. Existing users keep
 * whatever they picked; only new users (or users whose saved
 * wallpaper plugin is gone) land on this one.
 */
add_filter( 'desktop_mode_default_wallpaper', static function () {
	return 'alcazaba-pop/sunburst';
} );

/**
 * Pop-art the inside of every chromeless iframe — buttons get thick
 * black borders + offset shadows, primary buttons go magenta, links
 * go magenta, focus outlines pop yellow.
 */
add_action( 'desktop_mode_chromeless_styles', static function () {
	$css = "
		/* Links + accents */
		.wp-desktop-chromeless a { color: #ff2e93; }
		.wp-desktop-chromeless a:hover,
		.wp-desktop-chromeless a:focus { color: #7a00ff; }

		/* Buttons — hard borders, chunky offset shadow, no rounded mush */
		.wp-desktop-chromeless .button,
		.wp-desktop-chromeless .button-secondary {
			border: 2px solid #0a0a0a !important;
			border-radius: 4px !important;
			box-shadow: 3px 3px 0 0 #0a0a0a !important;
			background: #fffdf2 !important;
			color: #0a0a0a !important;
			font-weight: 700;
			transition: transform 80ms ease, box-shadow 80ms ease;
		}
		.wp-desktop-chromeless .button:hover {
			transform: translate( -1px, -1px );
			box-shadow: 4px 4px 0 0 #0a0a0a !important;
		}
		.wp-desktop-chromeless .button:active {
			transform: translate( 2px, 2px );
			box-shadow: 1px 1px 0 0 #0a0a0a !important;
		}
		.wp-desktop-chromeless .button-primary {
			background: #ff2e93 !important;
			color: #ffffff !important;
			border: 2px solid #0a0a0a !important;
			border-radius: 4px !important;
			box-shadow: 3px 3px 0 0 #0a0a0a !important;
			text-shadow: none !important;
		}

		/* Inputs — black borders, no rounding */
		.wp-desktop-chromeless input[type='text'],
		.wp-desktop-chromeless input[type='email'],
		.wp-desktop-chromeless input[type='url'],
		.wp-desktop-chromeless input[type='password'],
		.wp-desktop-chromeless input[type='search'],
		.wp-desktop-chromeless input[type='number'],
		.wp-desktop-chromeless textarea,
		.wp-desktop-chromeless select {
			border: 2px solid #0a0a0a !important;
			border-radius: 4px !important;
			box-shadow: none !important;
		}
		.wp-desktop-chromeless input:focus,
		.wp-desktop-chromeless textarea:focus,
		.wp-desktop-chromeless select:focus {
			outline: 3px solid #ffd93d !important;
			outline-offset: 1px;
			border-color: #0a0a0a !important;
		}

		/* Headings — bold, no fluff */
		.wp-desktop-chromeless h1,
		.wp-desktop-chromeless h2,
		.wp-desktop-chromeless h3 {
			font-weight: 900;
			letter-spacing: -0.01em;
		}

		/* List tables — chunky borders */
		.wp-desktop-chromeless .wp-list-table {
			border: 2px solid #0a0a0a !important;
			border-radius: 6px;
			overflow: hidden;
		}
		.wp-desktop-chromeless .wp-list-table thead {
			background: #ffd93d !important;
		}
		.wp-desktop-chromeless .wp-list-table thead th {
			color: #0a0a0a !important;
			font-weight: 900 !important;
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
	";
	wp_add_inline_style( 'wp-desktop-chromeless', $css );
} );
