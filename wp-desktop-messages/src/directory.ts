/**
 * "Start a new chat" user picker — a small modal-ish sheet
 * inside the messages window. List all messageable users with a
 * search box; clicking a row creates a conversation and opens it.
 *
 * @since 0.22.0
 */

import { __ } from './wp';
import { listUsers, startConversation } from './transport/rest';
import { upsertConversation, setFocusedConversation } from './state';
import type { UserSummary } from './types';

export interface DirectoryProps {
	host: HTMLElement;
	onClose(): void;
}

export function mountDirectory( props: DirectoryProps ): () => void {
	props.host.innerHTML = '';

	const sheet = document.createElement( 'div' );
	sheet.className = 'wpdm-messages__directory';

	const header = document.createElement( 'header' );
	header.className = 'wpdm-messages__directory-header';

	const title = document.createElement( 'h3' );
	title.textContent = __( 'Start a chat' );
	header.appendChild( title );

	const closeBtn = document.createElement( 'wpd-button' );
	closeBtn.setAttribute( 'variant', 'ghost' );
	closeBtn.innerHTML = '<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>';
	closeBtn.addEventListener( 'click', () => props.onClose() );
	header.appendChild( closeBtn );

	const search = document.createElement( 'wpd-text-field' );
	search.setAttribute( 'placeholder', __( 'Search by name…' ) );
	search.classList.add( 'wpdm-messages__directory-search' );

	const list = document.createElement( 'ul' );
	list.className = 'wpdm-messages__directory-list';

	sheet.appendChild( header );
	sheet.appendChild( search );
	sheet.appendChild( list );
	props.host.appendChild( sheet );

	let lastSearch = '';
	let debounce: number | null = null;

	const load = async ( q: string ): Promise< void > => {
		try {
			list.innerHTML = '';
			const out = await listUsers( { search: q, perPage: 50 } );
			if ( out.users.length === 0 ) {
				const empty = document.createElement( 'li' );
				empty.className = 'wpdm-messages__directory-empty';
				empty.textContent = __( 'No matching users.' );
				list.appendChild( empty );
				return;
			}
			for ( const u of out.users ) {
				list.appendChild( buildRow( u, props ) );
			}
		} catch ( _err ) {
			list.innerHTML = '';
			const errLi = document.createElement( 'li' );
			errLi.className = 'wpdm-messages__directory-empty';
			errLi.textContent = __( 'Could not load users.' );
			list.appendChild( errLi );
		}
	};

	search.addEventListener( 'wpd-input-change', ( ev ) => {
		const detail = ( ev as CustomEvent< { value: string } > ).detail;
		const next = ( detail?.value ?? '' ).trim();
		if ( next === lastSearch ) {
			return;
		}
		lastSearch = next;
		if ( debounce !== null ) {
			window.clearTimeout( debounce );
		}
		debounce = window.setTimeout( () => {
			void load( next );
		}, 200 );
	} );

	void load( '' );

	return () => {
		if ( debounce !== null ) {
			window.clearTimeout( debounce );
		}
		props.host.innerHTML = '';
	};
}

function buildRow( user: UserSummary, props: DirectoryProps ): HTMLLIElement {
	const li = document.createElement( 'li' );
	li.className = 'wpdm-messages__directory-row';

	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '32' );
	avatar.setAttribute( 'name', user.displayName );
	avatar.setAttribute( 'user-id', String( user.id ) );
	if ( user.avatarUrl ) {
		avatar.setAttribute( 'src', user.avatarUrl );
	}
	if ( user.presence ) {
		avatar.setAttribute( 'presence', user.presence );
	}

	const text = document.createElement( 'div' );
	text.className = 'wpdm-messages__directory-row-text';

	const name = document.createElement( 'div' );
	name.className = 'wpdm-messages__directory-row-name';
	name.textContent = user.displayName;
	text.appendChild( name );

	const role = document.createElement( 'div' );
	role.className = 'wpdm-messages__directory-row-role';
	role.textContent = user.role;
	text.appendChild( role );

	li.appendChild( avatar );
	li.appendChild( text );

	li.addEventListener( 'click', async () => {
		try {
			const out = await startConversation( user.id );
			upsertConversation( out.conversation );
			setFocusedConversation( out.conversation.id );
			props.onClose();
		} catch ( _err ) {
			// silent
		}
	} );

	return li;
}
