<?php
/**
 * Desktop Mode — Messages: typing indicators.
 *
 * Ephemeral. Stored on the conversation post's `_wpdm_conv_typing_until_ms`
 * meta as `array<int user_id, int ms_epoch>`. Each typing event sets
 * `until_ms = now + visible_for_ms`; subscribers ignore entries whose
 * `until_ms < now`. Server throttles via `_typing_throttle_ms` so a
 * keystroke storm doesn't write the meta on every keypress.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Record a typing event for a user in a conversation. Throttled —
 * subsequent calls within `_typing_throttle_ms` (default 1500) are
 * no-ops to avoid meta-write storms.
 *
 * @since 0.22.0
 *
 * @param int $conversation_id
 * @param int $user_id
 * @return int|false `until_ms` on accepted record, false when throttled.
 */
function wpdm_messages_record_typing( $conversation_id, $user_id ) {
	$conversation_id = (int) $conversation_id;
	$user_id         = (int) $user_id;
	if ( $conversation_id <= 0 || $user_id <= 0 ) {
		return false;
	}

	/** Server-side de-dup window (ms). */
	$throttle = (int) apply_filters( 'wp_desktop_messages_typing_throttle_ms', 1500 );

	/** How long a typing indicator stays visible without renewal. */
	$visible_for = (int) apply_filters( 'wp_desktop_messages_typing_visible_for_ms', 4000 );

	$now_ms = (int) round( microtime( true ) * 1000 );
	$state  = get_post_meta( $conversation_id, '_wpdm_conv_typing_until_ms', true );
	if ( ! is_array( $state ) ) {
		$state = array();
	}
	$prev_until = isset( $state[ $user_id ] ) ? (int) $state[ $user_id ] : 0;

	// Throttle: if the indicator is already valid AND the most-recent
	// write happened within `$throttle` ms, drop the event.
	$prev_emitted = $prev_until - $visible_for;
	if ( $prev_emitted > 0 && ( $now_ms - $prev_emitted ) < $throttle ) {
		return false;
	}

	$until_ms          = $now_ms + $visible_for;
	$state[ $user_id ] = $until_ms;
	update_post_meta( $conversation_id, '_wpdm_conv_typing_until_ms', $state );

	/**
	 * Fires when a user's typing indicator is registered.
	 *
	 * @since 0.22.0
	 *
	 * @param int $conversation_id
	 * @param int $user_id
	 * @param int $until_ms
	 */
	do_action( 'wp_desktop_messages_typing_started', $conversation_id, $user_id, $until_ms );
	return $until_ms;
}

/**
 * Build the typing snapshot for the OTHER participants the given
 * user can observe — strips entries whose `until_ms` has elapsed
 * AND prunes the user's own typing record (callers don't see their
 * own indicator).
 *
 * @since 0.22.0
 *
 * @param int $user_id Observer.
 * @return array<int,array<int,array{conversationId:int,userId:int,untilMs:int}>>
 *         Map of `conversationId` → list of typing entries.
 */
function wpdm_messages_typing_snapshot_for_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}
	$convos = wpdm_messages_query_conversations_for_user( $user_id, array( 'per_page' => 100 ) );
	$now_ms = (int) round( microtime( true ) * 1000 );
	$out    = array();
	foreach ( $convos['conversations'] as $c ) {
		$conv_id = (int) $c['id'];
		$state   = get_post_meta( $conv_id, '_wpdm_conv_typing_until_ms', true );
		if ( ! is_array( $state ) || empty( $state ) ) {
			continue;
		}
		$entries = array();
		foreach ( $state as $uid => $until ) {
			$uid   = (int) $uid;
			$until = (int) $until;
			if ( $uid === $user_id ) {
				continue;
			}
			if ( $until <= $now_ms ) {
				continue;
			}
			$entries[] = array(
				'conversationId' => $conv_id,
				'userId'         => $uid,
				'untilMs'        => $until,
			);
		}
		if ( ! empty( $entries ) ) {
			$out[ (string) $conv_id ] = $entries;
		}
	}
	return $out;
}
