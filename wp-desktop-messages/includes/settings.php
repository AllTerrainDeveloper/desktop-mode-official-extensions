<?php
/**
 * Desktop Mode — Messages: OS Settings tab registration.
 *
 * Built-in tab. Order 25 sits between AI (20) and extended (30).
 * The render callback lives in `src/messages/settings-tab.ts`;
 * this file just wires the PHP-side metadata + script handle so
 * the shell knows to inject the settings bundle into the OS
 * Settings window.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the messages settings tab.
 *
 * @since 0.22.0
 */
function wpdm_messages_register_settings_tab() {
	if ( ! function_exists( 'desktop_mode_register_settings_tab' ) ) {
		return;
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return;
	}

	$args = array(
		'id'         => 'messages',
		'label'      => __( 'Messages', 'wp-desktop-messages' ),
		'capability' => '',
		'order'      => 25,
		'script'     => 'wp-desktop-messages-shell',
	);

	/**
	 * Filter the args passed to `desktop_mode_register_settings_tab` for
	 * the messages tab.
	 *
	 * @since 0.22.0
	 *
	 * @param array $args
	 */
	$args = (array) apply_filters( 'wp_desktop_messages_settings_tab_args', $args );

	desktop_mode_register_settings_tab( $args );
	desktop_mode_register_settings_tab_script( 'wp-desktop-messages-shell' );
}
add_action( 'init', 'wpdm_messages_register_settings_tab', 25 );
