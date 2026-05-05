<?php
/**
 * Desktop Mode — Messages: presence (back-compat shims).
 *
 * **As of 0.5.5 the canonical presence implementation lives at
 * framework level** in `includes/presence.php` (storage, state
 * machine, REST, Heartbeat). The functions in this file are thin
 * wrappers that delegate to the framework helpers and exist purely
 * so plugins built against the pre-0.5.5 messages-only presence
 * API keep working without edits.
 *
 * New plugin code should call the framework functions directly:
 *
 *   desktop_mode_presence_record()           // was wpdm_messages_record_presence()
 *   desktop_mode_presence_status_for_user()  // was wpdm_messages_presence_status_for_user()
 *   desktop_mode_presence_get_all()          // was wpdm_messages_presence_get_all()
 *
 * The `wp_desktop_messages_presence_changed` action still fires
 * (the framework re-fires it alongside `wp_desktop_presence_changed`)
 * so existing listeners keep working.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

// Back-compat constant: callers reading the option name directly
// (some test fixtures do) need a stable symbol. Mirrors the
// framework's `WP_DESKTOP_PRESENCE_OPTION` value but defined
// without referencing it — this plugin loads before the framework
// in alphabetical plugin order, so the framework constant isn't
// available at file-include time.
defined( 'WPDM_MESSAGES_PRESENCE_OPTION' )
	|| define( 'WPDM_MESSAGES_PRESENCE_OPTION', '_wp_desktop_presence' );

/**
 * @deprecated 0.5.5 Use {@see desktop_mode_presence_get_all()}.
 *
 * @return array<int,array{last_seen_ms:int,last_active_ms:int}>
 */
function wpdm_messages_presence_get_all() {
	return desktop_mode_presence_get_all();
}

/**
 * @deprecated 0.5.5 Use {@see desktop_mode_presence_record()}.
 *
 * @param int  $user_id
 * @param bool $active
 */
function wpdm_messages_record_presence( $user_id, $active = true ) {
	desktop_mode_presence_record( $user_id, $active );
}

/**
 * @deprecated 0.5.5 Use {@see desktop_mode_presence_status_from_record()}.
 *
 * @param array $record
 * @return string
 */
function wpdm_messages_status_from_record( $record ) {
	return desktop_mode_presence_status_from_record( $record );
}

/**
 * @deprecated 0.5.5 Use {@see desktop_mode_presence_status_for_user()}.
 *
 * @param int $user_id
 * @return string
 */
function wpdm_messages_presence_status_for_user( $user_id ) {
	return desktop_mode_presence_status_for_user( $user_id );
}

/**
 * Build a presence snapshot scoped to a user's conversation
 * participants. Wraps the framework's snapshot with the
 * messages-specific "users I'm in a conversation with" filter so
 * the chat UI only sees presence for relevant peers.
 *
 * @since 0.22.0
 *
 * @param int $user_id
 * @return array<string,array{ status:string, lastSeenMs:int }>
 */
function wpdm_messages_presence_snapshot_for_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}
	if ( ! function_exists( 'wpdm_messages_query_conversations_for_user' ) ) {
		return array();
	}
	$convos    = wpdm_messages_query_conversations_for_user(
		$user_id,
		array( 'per_page' => 100 )
	);
	$other_ids = array();
	foreach ( $convos['conversations'] as $c ) {
		if ( ! empty( $c['otherUserId'] ) ) {
			$other_ids[] = (int) $c['otherUserId'];
		}
	}
	if ( empty( $other_ids ) ) {
		return array();
	}
	$snapshot = desktop_mode_presence_snapshot( $other_ids );

	// The messages snapshot historically returned `{ status, lastSeenMs }`
	// only — strip the framework's extra `lastActiveMs` field so existing
	// JS consumers don't see an unexpected shape.
	$out = array();
	foreach ( $snapshot as $uid => $entry ) {
		$out[ $uid ] = array(
			'status'     => isset( $entry['status'] ) ? (string) $entry['status'] : 'offline',
			'lastSeenMs' => isset( $entry['lastSeenMs'] ) ? (int) $entry['lastSeenMs'] : 0,
		);
	}
	return $out;
}

/**
 * @deprecated 0.5.5 The framework owns the prune cron now
 * (`wp_desktop_presence_daily_prune`). Kept as a no-op alias for
 * back-compat.
 */
function wpdm_messages_presence_cron_prune() {
	desktop_mode_presence_cron_prune();
}

/* -------------------------------------------------------------------------
 * Threshold filter aliases
 * ----------------------------------------------------------------------- */

/**
 * Forward `wp_desktop_messages_presence_inactive_after` filters
 * onto the framework filter so plugins built against the messages
 * surface keep tuning the same threshold.
 */
add_filter(
	'wp_desktop_presence_inactive_after',
	function ( $seconds ) {
		/** @var int $seconds */
		return (int) apply_filters(
			'wp_desktop_messages_presence_inactive_after',
			$seconds
		);
	},
	5
);

/**
 * Same forwarding for the offline threshold.
 */
add_filter(
	'wp_desktop_presence_offline_after',
	function ( $seconds ) {
		/** @var int $seconds */
		return (int) apply_filters(
			'wp_desktop_messages_presence_offline_after',
			$seconds
		);
	},
	5
);
