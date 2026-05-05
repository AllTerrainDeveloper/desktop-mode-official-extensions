<?php
/**
 * Plugin Name:       Alcazaba Snow Wallpaper
 * Description:       A PixiJS-powered realistic snow wallpaper for WP Desktop Mode. Snowflakes fall, accumulate on the top edge of every visible window, then melt away. Registered end-to-end through `desktop_mode_register_wallpaper()` — the shell owns the swatch, the script enqueue, and mid-session activation / deactivation.
 * Version:           0.2.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 * Text Domain:       alcazaba-snow
 *
 * @package AlcazabaSnow
 */

defined( 'ABSPATH' ) || exit;

define( 'ALCAZABA_SNOW_VERSION', '0.2.0' );
define( 'ALCAZABA_SNOW_URL', plugin_dir_url( __FILE__ ) );
define( 'ALCAZABA_SNOW_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Backdrop preview used in the OS Settings wallpaper picker — a
 * deep midnight-to-dusk gradient that matches the CSS the JS side
 * paints behind the PixiJS canvas on mount. The swatch renders
 * before the wallpaper script has ever loaded, so this string is
 * the user's first impression of the wallpaper.
 *
 * Kept as a PHP constant so the preview stays in sync with the JS
 * `BACKDROP_CSS` value; a mismatch would show one gradient in the
 * swatch and a different one once selected.
 *
 * @since 0.2.0
 */
const ALCAZABA_SNOW_PREVIEW = 'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)';

/**
 * Register the snow wallpaper with the desktop shell.
 *
 * A single `desktop_mode_register_wallpaper()` call is everything —
 * the shell takes responsibility for the rest:
 *
 *   * Enqueues our `alcazaba-snow` script handle on
 *     `admin_enqueue_scripts` when the shell is active (same
 *     gating as the shell itself — Desktop Mode on, not in a
 *     chromeless iframe, not on a classic admin page).
 *   * Adds a swatch to the OS Settings wallpaper picker with our
 *     label, preview gradient, and `canvas` type hint so the
 *     picker knows to lazy-load our script before mount.
 *   * Resolves the script URL into the payload so mid-session
 *     activation can dynamically load our JS without a reload —
 *     the swatch appears the moment the plugin activates, even if
 *     the user was already sitting in OS Settings.
 *   * Invokes our JS wallpaper def — registered on
 *     `window.wpDesktopWallpapers[ 'alcazaba-snow' ]` — when the
 *     user clicks the swatch. If the user's currently-selected
 *     wallpaper was ours and the plugin deactivates, the shell
 *     falls back to a built-in default automatically; no dead id
 *     lingers in the picker.
 *
 * Compare with the JS-only path (`wp.desktop.registerWallpaper`):
 * that route is still supported, but it needs a `whenReady` dance
 * to avoid racing the shell boot, and leaves a dangling swatch if
 * the plugin deactivates mid-session. The
 * `desktop_mode_register_wallpaper()` flow gets both of those for
 * free.
 *
 * @since 0.2.0
 */
function alcazaba_snow_register() {
	// Defensive guard — `Requires Plugins:  desktop-mode` in the
	// plugin header handles this on WP 6.5+, but the function-exists
	// check keeps older WP (or a deactivated shell) fatal-safe.
	if ( ! function_exists( 'desktop_mode_register_wallpaper' ) ) {
		return;
	}

	// `wp-hooks` stays on the dep list because `mountSnow` subscribes
	// to `WALLPAPER_VISIBILITY`, `WINDOW_CLOSING`,
	// `WINDOW_BOUNDS_CHANGED`, and `WIDGET_UNMOUNTING` via
	// `wp.hooks.addAction()`. `wp-desktop` gives us the shell globals
	// (`wp.desktop.HOOKS`, `wp.desktop.getWallpaperSurfaces`) the mount
	// reads.
	wp_register_script(
		'alcazaba-snow',
		ALCAZABA_SNOW_URL . 'assets/js/snow.js',
		array( 'wp-desktop', 'wp-hooks' ),
		ALCAZABA_SNOW_VERSION,
		true
	);

	desktop_mode_register_wallpaper(
		'alcazaba-snow',
		array(
			'label'   => __( 'Snow', 'alcazaba-snow' ),
			'preview' => ALCAZABA_SNOW_PREVIEW,
			'type'    => 'canvas',
			'script'  => 'alcazaba-snow',
		)
	);
}
add_action( 'init', 'alcazaba_snow_register' );
