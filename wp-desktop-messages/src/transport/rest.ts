/**
 * Messages REST client. Thin fetch wrappers — every call attaches
 * `X-WP-Nonce`, every response unwraps to the typed payload.
 *
 * @since 0.22.0
 */

import type {
	ConversationSummary,
	MessageRow,
	SoundDef,
	UserSettings,
	UserSummary,
} from '../types';

function config() {
	return window.wpDesktopMessagesConfig;
}

async function request< T >(
	path: string,
	init: RequestInit = {},
): Promise< T > {
	const cfg = config();
	if ( ! cfg ) {
		throw new Error( '[wpdm-messages] config missing' );
	}
	const url = path.startsWith( 'http' )
		? path
		: cfg.restRoot.replace( /\/$/, '' ) + path;
	const res = await fetch( url, {
		credentials: 'same-origin',
		...init,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'X-WP-Nonce': cfg.restNonce,
			...( init.headers || {} ),
		},
	} );
	if ( ! res.ok ) {
		const body = await res.text();
		throw new Error( `[wpdm-messages] ${ path } → ${ res.status }: ${ body }` );
	}
	return ( await res.json() ) as T;
}

export async function listUsers(
	opts: { search?: string; page?: number; perPage?: number } = {},
): Promise< { users: UserSummary[]; total: number } > {
	const params = new URLSearchParams();
	if ( opts.search ) {
		params.set( 'search', opts.search );
	}
	if ( opts.page ) {
		params.set( 'page', String( opts.page ) );
	}
	if ( opts.perPage ) {
		params.set( 'per_page', String( opts.perPage ) );
	}
	const qs = params.toString() ? `?${ params }` : '';
	return request( `/users${ qs }` );
}

export async function listConversations(): Promise< {
	conversations: ConversationSummary[];
	total: number;
} > {
	return request( '/conversations?per_page=100' );
}

export async function startConversation(
	recipientId: number,
): Promise< { conversation: ConversationSummary } > {
	return request( '/conversations', {
		method: 'POST',
		body: JSON.stringify( { recipientId } ),
	} );
}

export async function fetchMessages(
	conversationId: number,
	opts: { before?: number; limit?: number } = {},
): Promise< { messages: MessageRow[]; hasMore: boolean; oldestId: number } > {
	const params = new URLSearchParams();
	if ( opts.before ) {
		params.set( 'before', String( opts.before ) );
	}
	if ( opts.limit ) {
		params.set( 'limit', String( opts.limit ) );
	}
	const qs = params.toString() ? `?${ params }` : '';
	return request( `/conversations/${ conversationId }/messages${ qs }` );
}

export async function sendMessage(
	conversationId: number,
	content: string,
	opts: { kind?: 'text'; clientId?: string } = {},
): Promise< { message: MessageRow | null } > {
	return request( `/conversations/${ conversationId }/messages`, {
		method: 'POST',
		body: JSON.stringify( {
			content,
			kind: opts.kind ?? 'text',
			clientId: opts.clientId,
		} ),
	} );
}

export async function markRead(
	conversationId: number,
	lastReadId: number,
): Promise< { ok: boolean } > {
	return request( `/conversations/${ conversationId }/read`, {
		method: 'POST',
		body: JSON.stringify( { lastReadId } ),
	} );
}

export async function postTyping(
	conversationId: number,
): Promise< { ok: boolean; untilMs: number } > {
	return request( `/conversations/${ conversationId }/typing`, {
		method: 'POST',
		body: '{}',
	} );
}

export async function postNudge(
	conversationId: number,
	soundId?: string,
): Promise< { ok: boolean; message: MessageRow | null } > {
	return request( `/conversations/${ conversationId }/nudge`, {
		method: 'POST',
		body: JSON.stringify( { soundId: soundId ?? '' } ),
	} );
}

export async function fetchSince(
	lastEventId: number,
): Promise< { messages: MessageRow[]; cursor: number } > {
	return request( `/since?lastEventId=${ lastEventId }` );
}

export async function fetchSounds(): Promise< {
	sounds: SoundDef[];
	defaultSoundId: string;
} > {
	return request( '/sounds' );
}

export async function getSettings(): Promise< UserSettings > {
	return request( '/settings' );
}

export async function saveSettings(
	settings: Partial< UserSettings >,
): Promise< UserSettings > {
	return request( '/settings', {
		method: 'POST',
		body: JSON.stringify( { settings } ),
	} );
}

export async function postPresence( inactive: boolean ): Promise< { ok: boolean } > {
	return request( '/presence', {
		method: 'POST',
		body: JSON.stringify( { inactive } ),
	} );
}
