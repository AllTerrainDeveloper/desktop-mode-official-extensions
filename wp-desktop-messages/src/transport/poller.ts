/**
 * Adaptive REST poller — the default delivery channel.
 *
 * Poll cadence shifts with three states:
 *   - **active**: chat window mounted AND focused. Fastest cadence
 *     (default 3s) so a typing→reply round-trip feels reasonable.
 *   - **idle**:   chat window closed/minimized, but the tab is
 *     visible. Slower cadence (default 20s) — the user is in the
 *     admin but not actively chatting; they just need a toast +
 *     dock badge when something arrives.
 *   - **hidden**: the browser tab is hidden (visibility API).
 *     Slowest (default 60s). The browser may throttle further; we
 *     don't fight it.
 *
 * Each poll hits `GET /messages/since?lastEventId=X`. The cursor is
 * advanced as messages flow through, so consecutive polls return
 * near-empty rows. Cheap on cheap hosts.
 *
 * Designed to share one cursor with the SSE client — when SSE is
 * the active transport, the poller idles. When SSE drops, the
 * poller is the safety net so messages still flow.
 *
 * @since 0.22.0
 */

import { fetchSince } from './rest';
import type { MessageRow } from '../types';

export type PollerState = 'active' | 'idle' | 'hidden';

export interface PollerHandlers {
	onMessage?: ( row: MessageRow ) => void;
	onNudge?: ( row: MessageRow ) => void;
}

export interface PollerOptions {
	activeMs: number;
	idleMs: number;
	hiddenMs: number;
	getCursor: () => number;
	setCursor: ( id: number ) => void;
	getState: () => PollerState;
}

export class MessagesPoller {
	private timer: number | null = null;
	private inFlight = false;
	private stopped = true;
	private currentDelay = 0;
	private opts: PollerOptions;
	private handlers: PollerHandlers;

	constructor( opts: PollerOptions, handlers: PollerHandlers = {} ) {
		this.opts = opts;
		this.handlers = handlers;
	}

	start(): void {
		if ( ! this.stopped ) {
			return;
		}
		this.stopped = false;
		this.scheduleNext( this.delayForState( this.opts.getState() ) );
	}

	stop(): void {
		this.stopped = true;
		if ( this.timer !== null ) {
			window.clearTimeout( this.timer );
			this.timer = null;
		}
	}

	/**
	 * Force an immediate poll (e.g., on visibility-change → visible
	 * to refresh quickly without waiting for the next tick).
	 */
	pokeNow(): void {
		if ( this.stopped || this.inFlight ) {
			return;
		}
		if ( this.timer !== null ) {
			window.clearTimeout( this.timer );
			this.timer = null;
		}
		void this.tick();
	}

	/**
	 * Cadence changed (state transition). Re-schedule the next tick.
	 */
	rescheduleForState(): void {
		if ( this.stopped ) {
			return;
		}
		const next = this.delayForState( this.opts.getState() );
		if ( next !== this.currentDelay ) {
			if ( this.timer !== null ) {
				window.clearTimeout( this.timer );
				this.timer = null;
			}
			this.scheduleNext( next );
		}
	}

	private delayForState( state: PollerState ): number {
		switch ( state ) {
			case 'active':
				return Math.max( 1000, this.opts.activeMs );
			case 'idle':
				return Math.max( 3000, this.opts.idleMs );
			case 'hidden':
				return Math.max( 5000, this.opts.hiddenMs );
		}
	}

	private scheduleNext( delay: number ): void {
		this.currentDelay = delay;
		this.timer = window.setTimeout( () => {
			this.timer = null;
			void this.tick();
		}, delay );
	}

	private async tick(): Promise< void > {
		if ( this.stopped || this.inFlight ) {
			return;
		}
		this.inFlight = true;
		try {
			const out = await fetchSince( this.opts.getCursor() );
			let maxId = this.opts.getCursor();
			for ( const row of out.messages ) {
				if ( row.id <= maxId ) {
					continue;
				}
				maxId = row.id;
				if ( row.kind === 'nudge' ) {
					this.handlers.onNudge?.( row );
				} else {
					this.handlers.onMessage?.( row );
				}
			}
			if ( out.cursor > maxId ) {
				maxId = out.cursor;
			}
			if ( maxId > this.opts.getCursor() ) {
				this.opts.setCursor( maxId );
			}
		} catch ( _err ) {
			// silent — next tick retries.
		} finally {
			this.inFlight = false;
			if ( ! this.stopped ) {
				this.scheduleNext( this.delayForState( this.opts.getState() ) );
			}
		}
	}
}
