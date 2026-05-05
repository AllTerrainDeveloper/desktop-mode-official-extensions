<?php
/**
 * Desktop Mode — Messages: nudge-sound registry.
 *
 * Sound list is filterable via `wp_desktop_messages_nudge_sounds`.
 * The "default" sound auto-registers ONLY IF the file exists at the
 * canonical plugin path — matches the user's stated workflow: drop
 * `assets/audio/messages-nudge.mp3` later and registration becomes
 * live without a code change.
 *
 * Each entry: `{ id, label, url, volume }`. `id` is `sanitize_key()`-
 * safe; `url` runs through `esc_url_raw`; `volume` clamped 0..1.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve the registered nudge sounds, applying sanitization.
 *
 * @since 0.22.0
 *
 * @return array[] List of `{ id, label, url, volume }`.
 */
function wpdm_messages_get_registered_sounds() {
	$sounds = array();

	// Auto-register the "default" sound only if the file exists. The
	// plugin doesn't ship a sound file in v1; drop one in later and
	// registration becomes live with no code change.
	$default_path = WPDM_MESSAGES_PATH . 'assets/audio/messages-nudge.mp3';
	if ( file_exists( $default_path ) ) {
		$sounds[] = array(
			'id'     => 'default',
			'label'  => __( 'Default chime', 'wp-desktop-messages' ),
			'url'    => WPDM_MESSAGES_URL . 'assets/audio/messages-nudge.mp3',
			'volume' => 0.7,
		);
	}

	/**
	 * Filter the nudge-sound registry. Plugins shipping their own
	 * audio can append entries here. Each entry: `{ id, label, url,
	 * volume? }`. The id must be `sanitize_key()`-safe; collisions are
	 * resolved last-write-wins.
	 *
	 * @since 0.22.0
	 *
	 * @param array[] $sounds Default registry (may include `default`
	 *                        when the audio file is present).
	 */
	$sounds = (array) apply_filters( 'wp_desktop_messages_nudge_sounds', $sounds );

	$clean = array();
	$seen  = array();
	foreach ( $sounds as $s ) {
		if ( ! is_array( $s ) ) {
			continue;
		}
		$id = isset( $s['id'] ) ? sanitize_key( (string) $s['id'] ) : '';
		if ( '' === $id || isset( $seen[ $id ] ) ) {
			continue;
		}
		$url = isset( $s['url'] ) ? esc_url_raw( (string) $s['url'] ) : '';
		if ( '' === $url ) {
			continue;
		}
		$volume = isset( $s['volume'] ) && is_numeric( $s['volume'] )
			? max( 0.0, min( 1.0, (float) $s['volume'] ) )
			: 1.0;
		$clean[] = array(
			'id'     => $id,
			'label'  => isset( $s['label'] ) ? (string) $s['label'] : $id,
			'url'    => $url,
			'volume' => $volume,
		);
		$seen[ $id ] = true;
	}
	return $clean;
}

/**
 * Resolve the default sound id — first registered sound's id if no
 * explicit default is filtered.
 *
 * @since 0.22.0
 *
 * @return string Sound id, or empty string if none registered.
 */
function wpdm_messages_default_sound_id() {
	$sounds = wpdm_messages_get_registered_sounds();
	$ids    = wp_list_pluck( $sounds, 'id' );
	$first  = ! empty( $ids ) ? (string) $ids[0] : '';

	/**
	 * Filter the default nudge sound id used for new users.
	 *
	 * @since 0.22.0
	 *
	 * @param string $id     First registered sound by default.
	 * @param array  $sounds Full registered list.
	 */
	$id = (string) apply_filters( 'wp_desktop_messages_default_sound_id', $first, $sounds );
	if ( '' === $id ) {
		return $first;
	}
	if ( ! in_array( $id, $ids, true ) ) {
		return $first;
	}
	return $id;
}
