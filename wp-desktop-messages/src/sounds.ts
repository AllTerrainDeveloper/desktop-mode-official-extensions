/**
 * Sound registry + autoplay-policy primer.
 *
 * Each registered sound preloads an `<Audio>` element. Modern
 * browsers reject `play()` until a user gesture has happened on
 * the page; we prime every audio element on the first
 * `pointerdown` so subsequent `play()` calls succeed.
 *
 * @since 0.22.0
 */

import type { SoundDef } from './types';

class SoundRegistry {
	private cache = new Map< string, HTMLAudioElement >();
	private muted = false;
	private primed = false;

	register( s: SoundDef ): void {
		if ( this.cache.has( s.id ) ) {
			return;
		}
		try {
			const el = new Audio( s.url );
			el.preload = 'auto';
			el.volume = clamp01( s.volume ?? 1 );
			this.cache.set( s.id, el );
		} catch ( _err ) {
			// AudioContext or environment refused — silent.
		}
	}

	registerAll( list: SoundDef[] ): void {
		for ( const s of list ) {
			this.register( s );
		}
	}

	play( id: string | null, volumeOverride?: number ): void {
		if ( ! id || this.muted ) {
			return;
		}
		const el = this.cache.get( id );
		if ( ! el ) {
			return;
		}
		try {
			el.currentTime = 0;
			if ( typeof volumeOverride === 'number' ) {
				el.volume = clamp01( volumeOverride );
			}
			const result = el.play();
			if ( result && typeof result.catch === 'function' ) {
				// Autoplay rejected — silent. Will work after the next
				// user gesture which the primer handles.
				result.catch( () => undefined );
			}
		} catch ( _err ) {
			// swallow
		}
	}

	setMuted( muted: boolean ): void {
		this.muted = muted;
	}

	primeOnce(): void {
		if ( this.primed ) {
			return;
		}
		this.primed = true;
		for ( const el of this.cache.values() ) {
			try {
				const result = el.play();
				if ( result && typeof result.catch === 'function' ) {
					result.catch( () => undefined );
				}
				el.pause();
				el.currentTime = 0;
			} catch ( _err ) {
				// swallow
			}
		}
	}

	/** Used in tests. */
	_size(): number {
		return this.cache.size;
	}
}

function clamp01( v: number ): number {
	if ( ! Number.isFinite( v ) ) {
		return 1;
	}
	return Math.max( 0, Math.min( 1, v ) );
}

export const soundRegistry = new SoundRegistry();

/**
 * Install a one-shot user-gesture listener that primes every
 * registered audio element so a later `play()` triggered by a
 * server event isn't blocked by the browser's autoplay policy.
 */
export function installAutoplayPrimer(): void {
	const handler = (): void => {
		soundRegistry.primeOnce();
		document.removeEventListener( 'pointerdown', handler, true );
		document.removeEventListener( 'keydown', handler, true );
	};
	document.addEventListener( 'pointerdown', handler, true );
	document.addEventListener( 'keydown', handler, true );
}
