<?php
/**
 * Desktop Mode — Messages: `wpdm_conversation` custom post type.
 *
 * One post per conversation. Private (`'public' => false`) — no
 * front-end queryability, no admin UI, never exposed via core REST.
 * Custom capability_type + map_meta_cap so `read_post`/`edit_post`/
 * `delete_post` against a conversation resolve through our
 * `wpdm_messages_is_participant()` predicate, NOT core's universal
 * post caps. Without this override a `manage_options` admin would
 * inherit read access to every conversation site-wide.
 *
 * Slug shape: `wpdm-conv-{12-hex-random}`. Authoritative participants
 * live in post meta `_wpdm_conv_participants`; the slug never
 * encodes identity. Auth checks always read meta.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the conversation post type + meta + capability mapping.
 *
 * Hooked at `init` priority 5 — before any code that might query
 * the post type via REST.
 *
 * @since 0.22.0
 */
function wpdm_messages_register_post_type() {
	register_post_type(
		'wpdm_conversation',
		array(
			'labels'              => array(
				'name'          => __( 'Desktop conversations', 'wp-desktop-messages' ),
				'singular_name' => __( 'Desktop conversation', 'wp-desktop-messages' ),
			),
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_nav_menus'   => false,
			'show_in_admin_bar'   => false,
			'show_in_rest'        => false,
			'exclude_from_search' => true,
			'has_archive'         => false,
			'hierarchical'        => false,
			'rewrite'             => false,
			'query_var'           => false,
			'capability_type'     => array( 'wpdm_conversation', 'wpdm_conversations' ),
			'map_meta_cap'        => true,
			'supports'            => array(),
		)
	);

	$register_meta = function ( $key, $type = 'array' ) {
		register_post_meta(
			'wpdm_conversation',
			$key,
			array(
				'type'              => $type,
				'single'            => true,
				'show_in_rest'      => false,
				'auth_callback'     => '__return_false',
				'sanitize_callback' => null,
			)
		);
	};
	$register_meta( '_wpdm_conv_participants', 'array' );
	$register_meta( '_wpdm_conv_last_message_ts_ms', 'integer' );
	$register_meta( '_wpdm_conv_last_message_preview', 'string' );
	$register_meta( '_wpdm_conv_last_message_user_id', 'integer' );
	$register_meta( '_wpdm_conv_read_state', 'array' );
	$register_meta( '_wpdm_conv_typing_until_ms', 'array' );
}
add_action( 'init', 'wpdm_messages_register_post_type', 5 );

/**
 * Map per-conversation primitive caps onto our participant predicate.
 *
 * For `wpdm_conversation` posts, `read_post` / `edit_post` /
 * `delete_post` all collapse to "is the user a participant in this
 * conversation?". Without this override, `map_meta_cap` would defer
 * to `read_post`/`edit_others_posts`/etc., and a `manage_options`
 * admin would have universal access to every conversation.
 *
 * @since 0.22.0
 *
 * @param string[] $caps    Resolved primitive caps.
 * @param string   $cap     Requested cap.
 * @param int      $user_id User being checked.
 * @param array    $args    Optional args; `[ $post_id ]` for the post-level caps.
 * @return string[]
 */
function wpdm_messages_map_meta_cap( $caps, $cap, $user_id, $args ) {
	$mapped = array(
		'read_post',
		'edit_post',
		'delete_post',
		'edit_wpdm_conversation',
		'read_wpdm_conversation',
		'delete_wpdm_conversation',
	);
	if ( ! in_array( (string) $cap, $mapped, true ) ) {
		return $caps;
	}
	$post_id = isset( $args[0] ) ? (int) $args[0] : 0;
	if ( $post_id <= 0 ) {
		return $caps;
	}
	$post = get_post( $post_id );
	if ( ! $post instanceof WP_Post || 'wpdm_conversation' !== $post->post_type ) {
		return $caps;
	}

	// Force a deterministic answer regardless of any default caps the
	// caller may already have aggregated. `do_not_allow` is a primitive
	// cap that no role grants — returning it short-circuits the check.
	if ( wpdm_messages_is_participant( $post_id, (int) $user_id ) ) {
		return array( 'read' );
	}
	return array( 'do_not_allow' );
}
add_filter( 'map_meta_cap', 'wpdm_messages_map_meta_cap', 10, 4 );
