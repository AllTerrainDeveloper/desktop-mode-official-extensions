<?php
/**
 * Plugin Name: Alcazaba Voice
 * Description: Adds a "Voice" tab to the OS Settings window, an always-on wake-word listener, and a sliding Wapuu overlay that echoes captured commands.
 * Version:     0.7.2
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * @package AlcazabaVoice
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the script handle AND opt it into the desktop-mode
 * settings-tab pipeline in the same `init` callback. wp-desktop-
 * mode 0.18+ validates that the handle exists at the moment
 * `desktop_mode_register_settings_tab( … 'script' => $handle … )`
 * runs — registering the script later (on `admin_enqueue_scripts`)
 * trips a `_doing_it_wrong`.
 *
 * The wapuu image URL used to be passed via `wp_localize_script`,
 * but the shell's settings-tab pipeline loads the script via
 * dynamic `<script src>` injection from its server payload, NOT
 * through `wp_print_scripts`. `wp_localize_script`'s inline `var`
 * only survives the regular print pipeline, so the global was
 * arriving undefined inside the OS Settings window — that's the
 * broken-image symptom. The JS now derives the URL from its own
 * `document.currentScript.src`, so no inline localize data is
 * required.
 */
add_action(
	'init',
	function () {
		wp_register_script(
			'alcazaba-voice-settings',
			plugins_url( 'alcazaba-voice.js', __FILE__ ),
			array(),
			'0.7.2',
			true
		);

		if ( function_exists( 'desktop_mode_register_settings_tab' ) ) {
			desktop_mode_register_settings_tab(
				array(
					'id'     => 'voice',
					'label'  => __( 'Voice', 'alcazaba-voice' ),
					'order'  => 25,
					'script' => 'alcazaba-voice-settings',
				)
			);
		} elseif ( function_exists( 'desktop_mode_register_settings_tab_script' ) ) {
			desktop_mode_register_settings_tab_script( 'alcazaba-voice-settings' );
		}
	}
);

/**
 * Enqueue the already-registered script in the parent admin shell
 * context. The desktop-mode shell auto-loads it again inside the
 * OS Settings window via its payload pipeline, but enqueuing here
 * ensures the always-on wake-word listener boots on every admin
 * page even when the Settings window is never opened.
 */
add_action(
	'admin_enqueue_scripts',
	function () {
		wp_enqueue_script( 'alcazaba-voice-settings' );
	}
);
