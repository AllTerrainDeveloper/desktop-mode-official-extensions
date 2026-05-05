/**
 * Messages SSE client. Wraps `EventSource` with reconnect,
 * `Last-Event-ID` plumbing, and a defensive catch-up REST call
 * after every error so dropped events while the worker was closing
 * never strand the client.
 *
 * @since 0.22.0
 */

import type { MessageRow, SsePresencePayload, SseTypingPayload } from '../types';
import { fetchSince } from './rest';

export interface SseHandlers {
	onMessage?: ( row: MessageRow ) => void;
	onNudge?: ( row: MessageRow ) => void;
	onTyping?: ( payload: SseTypingPayload ) => void;
	onPresence?: ( payload: SsePresencePayload ) => void;
	onState?: ( state: 'connecting' | 'open' | 'closed' ) => void;
	onError?: ( err: unknown ) => void;
	/**
	 * Lazy supplier for the cursor the next connection should send
	 * as `last_event_id`. Called every time the SSE opens (initial
	 * connect AND every reconnect) so the SSE picks up the SHELL's
	 * latest `lastSeenId` rather than its own stale per-instance
	 * counter. Without this, the SSE's first connect ships
	 * `last_event_id=0` and the server replays the user's entire
	 * inbox — which surfaces as a toast for every historical
	 * message on every page reload.
	 */
	initialLastEventId?: () => number;
}

export class MessagesSseClient {
	private es: EventSource | null = null;
	private lastEventId = 0;
	private reconnectMs = 1000;
	private url = '';
	private nonce = '';
	private handlers: SseHandlers;
	private reconnectTimer: number | null = null;
	private stopped = true;

	constructor( handlers: SseHandlers = {} ) {
		this.handlers = handlers;
	}

	configure( opts: { url: string; nonce: string; reconnectMs: number } ): void {
		this.url = opts.url;
		this.nonce = opts.nonce;
		this.reconnectMs = Math.max( 250, opts.reconnectMs || 1000 );
	}

	start(): void {
		this.stopped = false;
		this.openConnection();
	}

	stop(): void {
		this.stopped = true;
		if ( this.reconnectTimer !== null ) {
			window.clearTimeout( this.reconnectTimer );
			this.reconnectTimer = null;
		}
		this.closeConnection();
	}

	private openConnection(): void {
		if ( ! this.url || ! this.nonce ) {
			// No config yet — caller will start() again after configure.
			return;
		}
		// Sync from the shell's lazy supplier before we touch the URL —
		// the shell knows about a higher cursor (e.g. just-completed
		// bootstrap) than this instance's per-event counter.
		const supplied = this.handlers.initialLastEventId?.();
		if ( typeof supplied === 'number' && supplied > this.lastEventId ) {
			this.lastEventId = supplied;
		}
		this.handlers.onState?.( 'connecting' );
		const url = new URL( this.url, window.location.origin );
		url.searchParams.set( 'nonce', this.nonce );
		if ( this.lastEventId > 0 ) {
			url.searchParams.set( 'last_event_id', String( this.lastEventId ) );
		}
		try {
			this.es = new EventSource( url.toString() );
		} catch ( err ) {
			this.handlers.onError?.( err );
			this.scheduleReconnect();
			return;
		}

		this.es.addEventListener( 'open', () => {
			this.handlers.onState?.( 'open' );
		} );
		this.es.addEventListener( 'message', ( ev ) => this.dispatch( 'message', ev ) );
		this.es.addEventListener( 'nudge', ( ev ) => this.dispatch( 'nudge', ev ) );
		this.es.addEventListener( 'typing', ( ev ) => this.dispatch( 'typing', ev ) );
		this.es.addEventListener( 'presence', ( ev ) => this.dispatch( 'presence', ev ) );
		this.es.addEventListener( 'open', () => this.dispatch( 'open', undefined ) );
		this.es.addEventListener( 'close', () => this.dispatch( 'close', undefined ) );
		this.es.addEventListener( 'error', ( err ) => {
			this.handlers.onError?.( err );
			this.handlers.onState?.( 'closed' );
			this.closeConnection();
			// Defensively pull any messages we may have missed.
			void this.catchUp();
			this.scheduleReconnect();
		} );
	}

	private closeConnection(): void {
		if ( this.es ) {
			try {
				this.es.close();
			} catch ( _err ) {
				// already closed.
			}
			this.es = null;
		}
	}

	private scheduleReconnect(): void {
		if ( this.stopped ) {
			return;
		}
		if ( this.reconnectTimer !== null ) {
			return;
		}
		this.reconnectTimer = window.setTimeout( () => {
			this.reconnectTimer = null;
			if ( ! this.stopped ) {
				this.openConnection();
			}
		}, this.reconnectMs );
	}

	private async catchUp(): Promise< void > {
		try {
			const out = await fetchSince( this.lastEventId );
			for ( const row of out.messages ) {
				if ( row.id <= this.lastEventId ) {
					continue;
				}
				this.lastEventId = row.id;
				if ( row.kind === 'nudge' ) {
					this.handlers.onNudge?.( row );
				} else {
					this.handlers.onMessage?.( row );
				}
			}
			if ( out.cursor > this.lastEventId ) {
				this.lastEventId = out.cursor;
			}
		} catch ( err ) {
			this.handlers.onError?.( err );
		}
	}

	private dispatch( kind: string, ev: MessageEvent | undefined ): void {
		if ( ! ev ) {
			return;
		}
		let data: unknown = null;
		try {
			data = ev.data ? JSON.parse( ev.data ) : null;
		} catch ( _err ) {
			return;
		}
		if ( ev.lastEventId ) {
			const id = Number( ev.lastEventId );
			if ( Number.isFinite( id ) && id > this.lastEventId ) {
				this.lastEventId = id;
			}
		}

		switch ( kind ) {
			case 'message':
				this.handlers.onMessage?.( data as MessageRow );
				break;
			case 'nudge':
				this.handlers.onNudge?.( data as MessageRow );
				break;
			case 'typing':
				this.handlers.onTyping?.( data as SseTypingPayload );
				break;
			case 'presence':
				this.handlers.onPresence?.( data as SsePresencePayload );
				break;
			case 'close':
				// Server hit its time cap — `error` will fire next, which
				// triggers reconnect. Nothing to do here.
				break;
		}
	}
}
