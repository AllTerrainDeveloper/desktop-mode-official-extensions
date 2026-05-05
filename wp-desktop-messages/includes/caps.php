<?php
/**
 * Desktop Mode — Messages: capability gate.
 *
 * Four predicates every other module file consults before doing
 * anything: `_user_can_use` (feature-level), `_user_can_message`
 * (dyad-level), `_is_participant` (per-conversation), and
 * `_allowed_roles` (the role list backing `_user_can_use`). All
 * filterable so plugins can extend the audience without forking.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default roles allowed to use messaging. Matches the user's
 * stated audience — admins + editors only — and is filterable.
 *
 * @since 0.22.0
 *
 * @return string[] Sanitized list of role slugs.
 */
function wpdm_messages_allowed_roles() {
	$default = array( 'administrator', 'editor' );

	/**
	 * Filter the roles allowed to use the messages feature.
	 *
	 * @since 0.22.0
	 *
	 * @param string[] $roles Default `[ 'administrator', 'editor' ]`.
	 */
	$roles = (array) apply_filters( 'wp_desktop_messages_allowed_roles', $default );

	$clean = array();
	foreach ( $roles as $role ) {
		$slug = sanitize_key( (string) $role );
		if ( '' !== $slug ) {
			$clean[] = $slug;
		}
	}
	return array_values( array_unique( $clean ) );
}

/**
 * Master kill-switch and per-user role gate. A user can use
 * messaging when (a) the feature isn't disabled, (b) they're
 * logged in, (c) they hold one of the allowed roles, AND (d) the
 * per-user filter doesn't veto.
 *
 * @since 0.22.0
 *
 * @param int|null $user_id Defaults to the current user.
 * @return bool
 */
function wpdm_messages_user_can_use( $user_id = null ) {
	/**
	 * Master enable filter. Return false to disable the feature
	 * entirely (REST 403, SSE 403, no native window registration,
	 * no Heartbeat hooks).
	 *
	 * @since 0.22.0
	 *
	 * @param bool $enabled Default true.
	 */
	if ( ! apply_filters( 'wp_desktop_messages_enabled', true ) ) {
		return false;
	}

	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	$user = get_userdata( $user_id );
	if ( ! $user instanceof WP_User ) {
		return false;
	}

	$roles   = wpdm_messages_allowed_roles();
	$has_role = false;
	foreach ( $user->roles as $r ) {
		if ( in_array( (string) $r, $roles, true ) ) {
			$has_role = true;
			break;
		}
	}

	$can = $has_role;

	/**
	 * Per-user gate. Lets plugins veto messaging for specific users
	 * (compliance, naughty list) or grant it to users outside the
	 * allowed-roles set without altering the role list.
	 *
	 * @since 0.22.0
	 *
	 * @param bool $can     Whether the user can use messaging.
	 * @param int  $user_id The user being checked.
	 */
	return (bool) apply_filters( 'wp_desktop_messages_user_can_use', $can, $user_id );
}

/**
 * Dyad-level gate. Used by the "start a conversation" REST route +
 * the send route to enforce per-recipient permissions.
 *
 * Both users must individually pass `_user_can_use`; this filter
 * runs ON TOP of that, so plugins can implement allow-lists,
 * mute-lists, "admins-only" inbox preferences, etc.
 *
 * @since 0.22.0
 *
 * @param int $sender_id    The user attempting to send.
 * @param int $recipient_id The intended recipient.
 * @return bool
 */
function wpdm_messages_user_can_message( $sender_id, $recipient_id ) {
	$sender_id    = (int) $sender_id;
	$recipient_id = (int) $recipient_id;
	if ( $sender_id <= 0 || $recipient_id <= 0 ) {
		return false;
	}
	if ( $sender_id === $recipient_id ) {
		// Self-DMs are out of scope for v1 — the directory excludes
		// the current user; this is a defense-in-depth check for
		// callers that bypass the directory.
		return false;
	}
	if ( ! wpdm_messages_user_can_use( $sender_id ) ) {
		return false;
	}
	if ( ! wpdm_messages_user_can_use( $recipient_id ) ) {
		return false;
	}

	$can = true;

	/**
	 * Dyad-level filter. Lets plugins implement allow-lists or
	 * mute-lists. Default: any two messaging-eligible users may DM
	 * each other.
	 *
	 * @since 0.22.0
	 *
	 * @param bool $can          Default true.
	 * @param int  $sender_id    The user attempting to send.
	 * @param int  $recipient_id The intended recipient.
	 */
	return (bool) apply_filters(
		'wp_desktop_messages_user_can_message',
		$can,
		$sender_id,
		$recipient_id
	);
}

/**
 * Whether a user is a participant in a given conversation. Reads
 * the authoritative `_wpdm_conv_participants` post meta — never
 * parses the slug.
 *
 * @since 0.22.0
 *
 * @param int $conversation_id wpdm_conversation post ID.
 * @param int $user_id         User to check.
 * @return bool
 */
function wpdm_messages_is_participant( $conversation_id, $user_id ) {
	$conversation_id = (int) $conversation_id;
	$user_id         = (int) $user_id;
	if ( $conversation_id <= 0 || $user_id <= 0 ) {
		return false;
	}
	$post = get_post( $conversation_id );
	if ( ! $post instanceof WP_Post || 'wpdm_conversation' !== $post->post_type ) {
		return false;
	}
	$participants = get_post_meta( $conversation_id, '_wpdm_conv_participants', true );
	if ( ! is_array( $participants ) ) {
		return false;
	}
	return in_array( $user_id, array_map( 'intval', $participants ), true );
}
