<?php
/**
 * Desktop Mode — Messages: nudges.
 *
 * A nudge is an MSN-Messenger-style attention grab — shake the
 * window + play a sound on the recipient's side. Implemented as a
 * `kind = 'nudge'` system message with a `{ soundId }` payload, so
 * it rides the same SSE / Heartbeat delivery channel as a regular
 * text message and shows up in the thread (small affordance row).
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Send a nudge from `$sender_id` in `$conversation_id`. Validates
 * the dyad-level can-message gate.
 *
 * @since 0.22.0
 *
 * @param int    $conversation_id
 * @param int    $sender_id
 * @param string $sound_id Optional preferred sound; defaults to the
 *                          default registered sound.
 * @return int|WP_Error New message ID or error.
 */
function wpdm_messages_send_nudge( $conversation_id, $sender_id, $sound_id = '' ) {
	$conversation_id = (int) $conversation_id;
	$sender_id       = (int) $sender_id;
	if ( $conversation_id <= 0 || $sender_id <= 0 ) {
		return new WP_Error( 'wpdm_messages_invalid_args', __( 'Conversation and sender are required.', 'wp-desktop-messages' ) );
	}
	if ( ! wpdm_messages_is_participant( $conversation_id, $sender_id ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Not a participant.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}

	$sound_id = wpdm_messages_resolve_nudge_sound( (string) $sound_id );

	$msg_id = wpdm_messages_insert_message(
		$conversation_id,
		$sender_id,
		'',
		'nudge',
		array( 'soundId' => $sound_id )
	);
	if ( is_wp_error( $msg_id ) ) {
		return $msg_id;
	}

	$participants = (array) get_post_meta( $conversation_id, '_wpdm_conv_participants', true );
	foreach ( $participants as $uid ) {
		$uid = (int) $uid;
		if ( $uid === $sender_id ) {
			continue;
		}
		/**
		 * Fires once per recipient when a nudge is sent.
		 *
		 * @since 0.22.0
		 *
		 * @param int    $conversation_id
		 * @param int    $sender_id
		 * @param int    $recipient_id
		 * @param string $sound_id
		 */
		do_action( 'wp_desktop_messages_nudge_sent', $conversation_id, $sender_id, $uid, $sound_id );
	}
	return (int) $msg_id;
}

/**
 * Resolve the sound id to play for a nudge — caller's preference if
 * registered; else the default. Empty string when nothing is
 * registered (silent nudge).
 *
 * @since 0.22.0
 *
 * @param string $preferred Caller's preference.
 * @return string Sound id (possibly empty).
 */
function wpdm_messages_resolve_nudge_sound( $preferred ) {
	$sounds = wpdm_messages_get_registered_sounds();
	$ids    = wp_list_pluck( $sounds, 'id' );

	$pref = sanitize_key( (string) $preferred );
	if ( '' !== $pref && in_array( $pref, $ids, true ) ) {
		return $pref;
	}
	return wpdm_messages_default_sound_id();
}
