<?php
/**
 * Live preview hook.
 *
 * The preview window in the desktop shell loads the *real* post
 * preview URL (`?p=X&preview=true&preview_nonce=…`) so the theme's
 * single-post template renders normally. We then inject a tiny
 * `wp_footer` listener that swaps the post title + content in
 * place on each `wpglp:render` message arriving from the desktop
 * shell — keystroke updates land directly inside the live theme
 * markup.
 *
 * Trade-off: we only update title + body markup. Dynamic blocks
 * (Latest Posts, Query Loop, etc.) keep showing whatever the
 * server-side render produced for the autosaved revision; static
 * blocks update on every keystroke.
 *
 * @package WP_Gutenberg_Live_Preview
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inject the live-update listener into preview responses that
 * carry the `wpglp_live=1` flag. Capability-gated to `edit_posts`
 * so we can't be tricked into echoing markup for anonymous users.
 */
function wpglp_inject_live_listener() {
	if ( empty( $_GET['wpglp_live'] ) ) {
		return;
	}
	if ( ! is_preview() && empty( $_GET['preview'] ) && empty( $_GET['preview_id'] ) ) {
		return;
	}
	if ( ! is_user_logged_in() || ! current_user_can( 'edit_posts' ) ) {
		return;
	}
	?>
	<script>
	( function () {
		if ( window.parent === window ) {
			return;
		}

		function pickFirst( selectors, exclude ) {
			for ( var i = 0; i < selectors.length; i++ ) {
				var matches = document.querySelectorAll( selectors[ i ] );
				for ( var j = 0; j < matches.length; j++ ) {
					if ( exclude && exclude.contains( matches[ j ] ) ) {
						continue;
					}
					if ( exclude && matches[ j ].contains( exclude ) ) {
						continue;
					}
					return matches[ j ];
				}
			}
			return null;
		}

		var titleEl = pickFirst( [
			'.wp-block-post-title',
			'.entry-title',
			'.post-title',
			'article header h1',
			'main h1',
			'h1'
		] );

		// Pass `titleEl` as exclude so we never pick a content
		// container that wraps the title (or vice versa).
		var contentEl = pickFirst( [
			'.wp-block-post-content',
			'.entry-content',
			'.post-content',
			'.single-content',
			'.article-content',
			'article .content',
			'article > .wp-block-group',
			'main article'
		], titleEl );

		// Fallback: when the post was empty at page render, the
		// theme often emits no `.entry-content` / `.wp-block-post-
		// content` wrapper at all (there's nothing for `the_content`
		// to wrap). Inject one ourselves so keystroke updates have
		// a target — placed inside the closest article/main, right
		// after the title element when we found one.
		if ( ! contentEl ) {
			contentEl = document.createElement( 'div' );
			contentEl.className = 'entry-content wp-block-post-content wpglp-injected-content';
			var anchor = titleEl
				|| document.querySelector( 'article' )
				|| document.querySelector( 'main' )
				|| document.body;
			if ( titleEl && titleEl.parentNode ) {
				titleEl.parentNode.insertBefore( contentEl, titleEl.nextSibling );
			} else if ( anchor ) {
				anchor.appendChild( contentEl );
			}
			console.log( '[wpglp:frame] injected fallback contentEl into', anchor );
		}

		console.log( '[wpglp:frame] picked title:', titleEl, 'content:', contentEl );
		console.log( '[wpglp:frame] article structure:', ( document.querySelector( 'article' ) || document.querySelector( 'main' ) || document.body ).outerHTML.slice( 0, 1200 ) );

		window.addEventListener( 'message', function ( ev ) {
			if ( ev.source !== window.parent ) {
				return;
			}
			var data = ev.data;
			if ( ! data || data.type !== 'wpglp:render' ) {
				return;
			}
			console.log( '[wpglp:frame] render received, title len:', ( data.title || '' ).length, 'content len:', ( data.content || '' ).length );
			if ( titleEl && typeof data.title === 'string' ) {
				titleEl.textContent = data.title || titleEl.textContent;
			}
			if ( contentEl && typeof data.content === 'string' ) {
				contentEl.innerHTML = data.content;
			}
		} );
	} )();
	</script>
	<?php
}
add_action( 'wp_footer', 'wpglp_inject_live_listener', 99 );
