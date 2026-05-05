<?php
/**
 * REST endpoint that runs draft block content through the full
 * content-rendering pipeline so dynamic blocks (Query Loop, Latest
 * Posts, `wp:icon`, third-party server-side blocks, …) resolve to
 * real HTML in the live preview.
 *
 * The shell.js subscribe handler hits this endpoint with the
 * latest serialized post_content from Gutenberg, gets back fully
 * rendered HTML, and forwards that to the preview iframe via
 * `iframeSend`. Without this round-trip, dynamic blocks render as
 * their HTML-comment placeholder and the preview looks broken.
 *
 * @package WP_Gutenberg_Live_Preview
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register `POST /wpglp/v1/render` — capability-gated to
 * `edit_posts`, nonce-authenticated via cookie auth.
 */
function wpglp_register_render_endpoint() {
	register_rest_route(
		'wpglp/v1',
		'/render',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'args' => array(
				'content' => array(
					'type'     => 'string',
					'required' => true,
				),
				'post_id' => array(
					'type'     => 'integer',
					'required' => false,
					'default'  => 0,
				),
			),
			'callback' => 'wpglp_rest_render',
		)
	);
}
add_action( 'rest_api_init', 'wpglp_register_render_endpoint' );

/**
 * Register `GET /wpglp/v1/preview-url?post_id=N` — returns the
 * proper nonce-authenticated preview URL for a post regardless of
 * its autosave state. Built on top of WP core's
 * `get_preview_post_link()` which is the canonical generator
 * (used by the classic admin's "Preview" button) and always
 * produces `?preview_id=N&preview_nonce=…&preview=true`.
 *
 * Why this exists: Gutenberg's `getEditedPostPreviewLink()` only
 * returns the nonce-bearing URL when an autosave entity exists.
 * Autosaves require the post to be "autosaveable" (has content +
 * dirty), so freshly-promoted blank drafts never have one — and
 * the selector falls back to the public permalink with
 * `?preview=true`, which has no nonce and 404s for non-public
 * statuses. This endpoint sidesteps that whole dance.
 */
function wpglp_register_preview_url_endpoint() {
	register_rest_route(
		'wpglp/v1',
		'/preview-url',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'args' => array(
				'post_id' => array(
					'type'     => 'integer',
					'required' => true,
				),
			),
			'callback' => 'wpglp_rest_preview_url',
		)
	);
}
add_action( 'rest_api_init', 'wpglp_register_preview_url_endpoint' );

/**
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function wpglp_rest_preview_url( WP_REST_Request $request ) {
	$post_id = (int) $request->get_param( 'post_id' );
	$post    = get_post( $post_id );
	if ( ! $post instanceof WP_Post ) {
		return new WP_Error( 'wpglp_post_not_found', 'Post not found.', array( 'status' => 404 ) );
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error( 'wpglp_forbidden', 'Cannot edit this post.', array( 'status' => 403 ) );
	}

	// Force-promote `auto-draft` to `draft` server-side. Gutenberg's
	// client-side `savePost()` no-ops when the post is empty
	// (`isEditedPostSaveable` returns false), so even after editing
	// the status field the change never reaches the database. We
	// bypass that by writing directly with `wp_update_post`, which
	// honours no emptiness heuristic. A non-empty `post_title`
	// fallback avoids triggering "empty post" issues in some hosts'
	// `wp_insert_post_data` filters.
	if ( 'auto-draft' === $post->post_status ) {
		wp_update_post( array(
			'ID'          => $post_id,
			'post_status' => 'draft',
			'post_title'  => '' === (string) $post->post_title ? __( 'Auto Draft', 'wpglp' ) : $post->post_title,
		) );
		// Re-fetch with the new status so `get_preview_post_link`
		// builds the URL against the post's new state.
		$post = get_post( $post_id );
	}

	// `get_preview_post_link()` doesn't add the nonce on its own —
	// callers must pass it via `$query_args`. The canonical action
	// name is `'post_preview_' . $post_id`.
	$nonce = wp_create_nonce( 'post_preview_' . $post_id );
	$url   = get_preview_post_link(
		$post,
		array(
			'preview_id'    => $post_id,
			'preview_nonce' => $nonce,
		)
	);

	if ( ! $url ) {
		return new WP_Error( 'wpglp_preview_unavailable', 'Preview URL unavailable.', array( 'status' => 500 ) );
	}

	return new WP_REST_Response( array( 'url' => $url ) );
}

/**
 * Render the supplied block content through the same pipeline that
 * `the_content` runs for a normal frontend request — `do_blocks()`,
 * `wpautop`, shortcode resolution, embed handling, etc.
 *
 * Sets up the post globals when a `post_id` is provided so blocks
 * that read `$post` (Query Loop's outer context, post-meta blocks)
 * resolve correctly.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function wpglp_rest_render( WP_REST_Request $request ) {
	$content = (string) $request->get_param( 'content' );
	$post_id = (int) $request->get_param( 'post_id' );

	if ( $post_id > 0 ) {
		$post = get_post( $post_id );
		if ( $post instanceof WP_Post ) {
			$GLOBALS['post'] = $post;
			setup_postdata( $post );
		}
	}

	$html = apply_filters( 'the_content', $content );
	$html = str_replace( ']]>', ']]&gt;', $html );

	if ( $post_id > 0 ) {
		wp_reset_postdata();
	}

	return new WP_REST_Response( array( 'html' => $html ) );
}
