<?php
/**
 * Desktop Mode — Messages: per-user settings.
 *
 * Persisted in `user_meta['wp_desktop_messages_user_settings']`.
 * Sanitization round-trip mirrors `desktop_mode_sanitize_os_settings`
 * — known keys are coerced field-by-field; unknown keys are dropped;
 * partial saves merge with defaults.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

const WPDM_MESSAGES_USER_SETTINGS_META = 'wp_desktop_messages_user_settings';

/**
 * Default per-user settings.
 *
 * @since 0.22.0
 *
 * @return array
 */
function wpdm_messages_default_user_settings() {
	return array(
		'nudgeSoundId'         => '',     // resolved to default at read time
		'volume'               => 0.7,
		'showToast'            => true,
		'soundWhileFocused'    => false,
		'inactiveAfterSeconds' => 300,
		'acceptFrom'           => 'everyone',
	);
}

/**
 * Read sanitized settings for a user.
 *
 * @since 0.22.0
 *
 * @param int $user_id
 * @return array
 */
function wpdm_messages_get_user_settings( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return wpdm_messages_default_user_settings();
	}
	$raw = get_user_meta( $user_id, WPDM_MESSAGES_USER_SETTINGS_META, true );
	if ( ! is_array( $raw ) ) {
		return wpdm_messages_default_user_settings();
	}
	return wpdm_messages_sanitize_user_settings( $raw );
}

/**
 * Persist sanitized settings for a user.
 *
 * @since 0.22.0
 *
 * @param int   $user_id
 * @param mixed $settings Raw payload.
 * @return bool
 */
function wpdm_messages_save_user_settings( $user_id, $settings ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	$clean = wpdm_messages_sanitize_user_settings( $settings );
	return false !== update_user_meta( $user_id, WPDM_MESSAGES_USER_SETTINGS_META, $clean );
}

/**
 * Sanitize a raw user-settings payload field-by-field.
 *
 * @since 0.22.0
 *
 * @param mixed $raw
 * @return array
 */
function wpdm_messages_sanitize_user_settings( $raw ) {
	$defaults = wpdm_messages_default_user_settings();
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}

	// Sound id: must be a registered sound, the literal `'silent'`,
	// or empty (resolves to default at play time).
	$sound_ids = wp_list_pluck( wpdm_messages_get_registered_sounds(), 'id' );
	$sound_id  = '';
	if ( isset( $raw['nudgeSoundId'] ) && is_string( $raw['nudgeSoundId'] ) ) {
		$candidate = sanitize_key( $raw['nudgeSoundId'] );
		if ( '' === $candidate || 'silent' === $candidate || in_array( $candidate, $sound_ids, true ) ) {
			$sound_id = $candidate;
		}
	}

	$volume = isset( $raw['volume'] ) && is_numeric( $raw['volume'] )
		? max( 0.0, min( 1.0, (float) $raw['volume'] ) )
		: $defaults['volume'];

	$show_toast = isset( $raw['showToast'] ) ? (bool) $raw['showToast'] : $defaults['showToast'];
	$sound_focused = isset( $raw['soundWhileFocused'] ) ? (bool) $raw['soundWhileFocused'] : $defaults['soundWhileFocused'];

	$inactive = isset( $raw['inactiveAfterSeconds'] ) && is_numeric( $raw['inactiveAfterSeconds'] )
		? max( 60, min( 3600, (int) $raw['inactiveAfterSeconds'] ) )
		: $defaults['inactiveAfterSeconds'];

	$accept_from = $defaults['acceptFrom'];
	if ( isset( $raw['acceptFrom'] ) && in_array( $raw['acceptFrom'], array( 'everyone', 'admins-only' ), true ) ) {
		$accept_from = (string) $raw['acceptFrom'];
	}

	return array(
		'nudgeSoundId'         => $sound_id,
		'volume'               => $volume,
		'showToast'            => $show_toast,
		'soundWhileFocused'    => $sound_focused,
		'inactiveAfterSeconds' => $inactive,
		'acceptFrom'           => $accept_from,
	);
}
