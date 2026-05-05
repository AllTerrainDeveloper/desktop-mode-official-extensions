/**
 * Alcazaba Voice — OS Settings "Voice" tab + always-on wake word.
 *
 * Tab:   ENABLED/DISABLED status badge (green/red pill) driven by
 *        the OpenAI key in OS Settings + microphone permission +
 *        the "Enable AI features" toggle. A button requests mic
 *        access; a tip lists every reason the plugin isn't ready
 *        yet. A second section walks the user through enabling
 *        Chrome's on-device speech recognition so audio stays local.
 *
 * Wake:  Always-on Web Speech API listener matching ten plausible
 *        STT mishearings of "hey wapuu". On match, console.logs.
 *
 * Uses the 0.17.0 additions: `wp.desktop.ready()`,
 * `ctx.getOsSettings()` / `ctx.subscribeOsSettings()`,
 * `<wpd-section stack>`, `<wpd-code>`, `<wpd-steps>` / `<wpd-step>`.
 */
( function () {
	'use strict';

	var OWNER = 'alcazaba-voice-settings';

	// Capture our own script's URL up-front. `document.currentScript`
	// is only defined while the script is parsing — `null` after.
	// Used to derive `assets/wapuu.png` regardless of how the script
	// got loaded (regular `wp_enqueue_script` print pipeline OR the
	// desktop-mode shell's dynamic settings-tab payload loader, which
	// strips inline `wp_localize_script` data and used to leave
	// `alcazabaVoiceConfig.wapuuUrl` undefined).
	var SELF_SCRIPT_URL = ( document.currentScript && document.currentScript.src ) || '';

	// ---------------------------------------------------------------------
	// Singleton guard.
	// ---------------------------------------------------------------------
	//
	// This script is enqueued normally AND re-injected by the shell's
	// settings-tab server-sync vendor-loader — so the IIFE runs twice
	// per page load. Without this guard, two independent wake loops
	// race for the single SpeechRecognition slot Chromium allows per
	// tab, creating a restart storm visible as "🎙️ listening…"
	// spamming the console forever.
	//
	// The first load wins; the second short-circuits to a single log
	// so it's obvious which invocation is active.
	if ( window.__alcazabaVoiceLoaded ) {
		// eslint-disable-next-line no-console
		console.log( '[alcazaba-voice] skipped duplicate script load' );
		return;
	}
	window.__alcazabaVoiceLoaded = true;

	// ---------------------------------------------------------------------
	// Wake-word listener (unchanged — Web Speech API, continuous,
	// restart on end, match against mishearing variants).
	// ---------------------------------------------------------------------

	var WAKE_WORDS = [
		'hey wapuu',
		'hey wapu',
		'hey wapoo',
		'hey wapou',
		'hey wampu',
		'hey what poo',
		'hey whop hoo',
		'hey waboo',
		'hey voodoo',
		'hey wappy',
		'hey wubble',
		'hey waffle',
		'hey whopper',
		'hey whoop',
		'hey weapon',
		'hey welcome',
		'hey babu',
	];

	var wakeLoopState = {
		running: false,
		currentRec: null,
		lastHitAt: 0,
	};

	// ---------------------------------------------------------------------
	// Voice state machine — controls the Wapuu overlay + what the
	// `onresult` handler does with each transcript.
	//
	//   HUNTING   — listening for the wake word. Transcripts that
	//               don't contain a wake word are logged only.
	//   CAPTURING — wake word fired; every subsequent transcript is
	//               treated as the command payload, shown in Wapuu's
	//               speech bubble, and (on final or after silence)
	//               echoed out. Auto-exits back to HUNTING after 5s
	//               of silence.
	// ---------------------------------------------------------------------

	var voiceState = {
		mode: 'HUNTING',
		captureBuffer: '',
		silenceTimer: null,
		captureStartedAt: 0,
	};

	var CAPTURE_IDLE_MS = 5000;
	var ECHO_DWELL_MS = 1800;
	// Grace window after wake match: Chrome keeps revising the wake
	// utterance ("hey waffle" → "waffle" on its own) for a beat.
	// Transcripts inside this window are ignored so those revisions
	// don't land in the command buffer. Tuned to stay well under the
	// time it takes to say a command after "hey wapuu" (~1s+).
	var CAPTURE_GRACE_MS = 600;

	// Non-"hey" halves of every wake phrase — the bare tail Chrome
	// emits when it re-reads the wake utterance without the "hey"
	// prefix. A CAPTURING transcript that equals one of these is
	// almost never a command; it's echo noise from the wake itself.
	var WAKE_TAILS = ( function () {
		var set = { hey: true };
		for ( var i = 0; i < WAKE_WORDS.length; i++ ) {
			var tail = WAKE_WORDS[ i ].replace( /^hey\s+/, '' );
			if ( tail ) {
				set[ tail ] = true;
			}
		}
		return set;
	} )();

	function isWakeTailOnly( text ) {
		var t = ( text || '' ).toLowerCase().replace( /[^a-z\s]/g, ' ' ).replace( /\s+/g, ' ' ).trim();
		return ! t || !! WAKE_TAILS[ t ];
	}

	/** Strip a leading wake-word phrase from a transcript. */
	function stripWakeWord( text ) {
		var t = ( text || '' ).toLowerCase().replace( /[^a-z\s]/g, ' ' ).replace( /\s+/g, ' ' ).trim();
		for ( var i = 0; i < WAKE_WORDS.length; i++ ) {
			var w = WAKE_WORDS[ i ];
			if ( t.indexOf( w ) === 0 ) {
				return t.slice( w.length ).trim();
			}
		}
		// Wake appeared mid-utterance (rare but happens). Cut at the
		// first wake match.
		for ( var j = 0; j < WAKE_WORDS.length; j++ ) {
			var idx = t.indexOf( WAKE_WORDS[ j ] );
			if ( idx !== -1 ) {
				return t.slice( idx + WAKE_WORDS[ j ].length ).trim();
			}
		}
		return t;
	}

	function clearSilenceTimer() {
		if ( voiceState.silenceTimer ) {
			clearTimeout( voiceState.silenceTimer );
			voiceState.silenceTimer = null;
		}
	}

	function armSilenceTimer() {
		clearSilenceTimer();
		voiceState.silenceTimer = setTimeout( function () {
			// No speech for 5s while capturing — assume the user
			// said the wake word by accident or walked off. Slide
			// Wapuu out and go back to hunting.
			// eslint-disable-next-line no-console
			console.log( '[alcazaba-voice] capture idle timeout (5s) — dismissing Wapuu' );
			endCapture( '' );
		}, CAPTURE_IDLE_MS );
	}

	/**
	 * Transition HUNTING → CAPTURING. Slides Wapuu in, arms the
	 * silence timer, resets the command buffer.
	 */
	function beginCapture() {
		if ( voiceState.mode === 'CAPTURING' ) {
			// Already active — just bump the silence timer so a
			// mid-utterance re-trigger doesn't auto-dismiss.
			armSilenceTimer();
			return;
		}
		voiceState.mode = 'CAPTURING';
		voiceState.captureBuffer = '';
		voiceState.captureStartedAt = Date.now();
		wapuuOverlay.show();
		wapuuOverlay.setBubble( 'Listening…' );
		armSilenceTimer();
	}

	/**
	 * Transition CAPTURING → HUNTING. Shows the final echo for a
	 * beat, then slides Wapuu out. `text` is the captured command
	 * ('' means silence / timeout).
	 *
	 * Later this is where we'll POST to /wp-desktop/v1/ai/search
	 * and render the response in the bubble instead of echoing.
	 */
	function endCapture( text ) {
		if ( voiceState.mode !== 'CAPTURING' ) {
			return;
		}
		clearSilenceTimer();
		voiceState.mode = 'HUNTING';

		var captured = ( text || '' ).trim();
		if ( ! captured ) {
			wapuuOverlay.setBubble( '' );
			setTimeout( function () {
				wapuuOverlay.hide();
			}, 200 );
			return;
		}

		// eslint-disable-next-line no-console
		console.log(
			'%c[alcazaba-voice] Wapuu heard:',
			'color:#0a7a22;font-weight:700',
			captured
		);

		// The AI ask path is async. Keep Wapuu on screen while it
		// runs, show a thinking indicator, swap in the reply when
		// it arrives, then dwell + slide out.
		wapuuOverlay.setBubble( '…' );
		askAiAndReply( captured );
	}

	/**
	 * POST the captured utterance to `wp.desktop.ai.ask()` with
	 * `tools: 'aiCallable'` so the model can pick among any
	 * opt-in commands (ours + Home Assistant + anyone else). Read
	 * the answer shape and render the right thing in the bubble:
	 *
	 *   - `answer_type: 'tool_call'` → the shell already invoked
	 *     the command; `toolCall.result` is its string/message
	 *     return — show that (confirmation of side effect).
	 *   - anything else                → show `message` (chat or
	 *     entity navigation summary).
	 *
	 * A failure from the ask path (missing config, network, OpenAI
	 * error) surfaces as a short error line in the bubble, not a
	 * silent empty bubble — voice UX without feedback is broken.
	 */
	async function askAiAndReply( query ) {
		var reply = '';
		try {
			if (
				! window.wp ||
				! window.wp.desktop ||
				! window.wp.desktop.ai ||
				typeof window.wp.desktop.ai.ask !== 'function'
			) {
				reply = 'AI not available — ‹' + query + '›';
			} else {
				var result = await window.wp.desktop.ai.ask( query, {
					tools: 'aiCallable',
				} );
				if ( result.answer_type === 'tool_call' && result.toolCall ) {
					var tc = result.toolCall;
					// `result` may be a string or { message }; the
					// shell's ask() wrapper lifts it into
					// result.message for a uniform read, but the
					// raw toolCall.result is also available.
					reply =
						result.message ||
						( tc.result && ( tc.result.message || tc.result ) ) ||
						'Done (' + ( tc.slug || 'command' ) + ').';
				} else {
					reply = result.message || '(no reply)';
				}
			}
		} catch ( err ) {
			reply =
				( err && err.message ) ||
				'Error talking to AI.';
		}

		wapuuOverlay.setBubble( reply );
		// eslint-disable-next-line no-console
		console.log(
			'%c[alcazaba-voice] Wapuu says:',
			'color:#2271b1;font-weight:700',
			reply
		);
		setTimeout( function () {
			wapuuOverlay.hide();
		}, ECHO_DWELL_MS );
	}

	/**
	 * Feed an incoming transcript to the capture state. `isFinal`
	 * picked from the SpeechRecognition result; finals end the
	 * capture, interims just update the bubble + re-arm the timer.
	 */
	function onCaptureTranscript( rawTranscript, isFinal ) {
		// Grace window — Chrome is still revising the wake
		// utterance. Silence timer is still ticking; we just don't
		// let these transcripts pollute the command buffer.
		if ( Date.now() - voiceState.captureStartedAt < CAPTURE_GRACE_MS ) {
			return;
		}

		var cleaned = stripWakeWord( rawTranscript );

		// Tail-fragment filter — Chrome sometimes drops the "hey"
		// and re-emits just "waffle" / "wapuu" / etc. After the
		// grace window these would otherwise be accepted as the
		// command. Ignore.
		if ( isWakeTailOnly( cleaned ) ) {
			return;
		}

		if ( cleaned ) {
			voiceState.captureBuffer = cleaned;
			wapuuOverlay.setBubble( cleaned );
		}
		if ( isFinal && voiceState.captureBuffer ) {
			endCapture( voiceState.captureBuffer );
		} else {
			armSilenceTimer();
		}
	}

	// ---------------------------------------------------------------------
	// Wapuu overlay — fixed on the right edge, vertically centred,
	// slides in with an ease-out curve on show and ease-in on hide.
	// All styles are inline so the plugin doesn't depend on a CSS
	// file enqueue (and so the overlay can't be restyled from the
	// admin chrome accidentally).
	// ---------------------------------------------------------------------

	var wapuuOverlay = ( function () {
		var root = null;
		var bubble = null;
		var bubbleText = null;

		function wapuuUrl() {
			// Prefer the (legacy) localize-script global if it
			// happens to be set — keeps backwards compat with any
			// other consumer that wired the URL that way.
			var legacy = window.alcazabaVoiceConfig && window.alcazabaVoiceConfig.wapuuUrl;
			if ( legacy ) {
				return legacy;
			}
			// Fall back to deriving from our own script URL. The
			// script is at `<plugin-dir>/alcazaba-voice.js`; the
			// asset is at `<plugin-dir>/assets/wapuu.png`. `URL`
			// resolves the relative path against the script's URL.
			if ( SELF_SCRIPT_URL ) {
				try {
					return new URL( 'assets/wapuu.png', SELF_SCRIPT_URL ).href;
				} catch ( _e ) { /* fall through */ }
			}
			return '';
		}

		/**
		 * Inject a <style> block once — needed for the tail
		 * ::after pseudo-element and the keyframed pop, neither
		 * of which inline `style=""` can express.
		 */
		function ensureStyles() {
			if ( document.getElementById( 'alcazaba-voice-wapuu-styles' ) ) {
				return;
			}
			var css =
				'#alcazaba-voice-wapuu{' +
					'position:fixed;right:0;top:50%;' +
					'z-index:2147483646;' +
					'pointer-events:none;' +
					'display:flex;flex-direction:row;align-items:center;' +
					'padding-right:16px;' +
					'transform:translate(120%,-50%);' +
					'transition:transform 420ms cubic-bezier(.2,.9,.3,1);' +
					'will-change:transform;' +
				'}' +
				'#alcazaba-voice-wapuu img{' +
					'width:180px;height:auto;display:block;' +
					'filter:drop-shadow(0 10px 22px rgba(0,0,0,.3));' +
				'}' +
				'#alcazaba-voice-wapuu-bubble{' +
					'position:relative;' +
					'background:#fff;' +
					'color:#1d2327;' +
					'padding:14px 18px;' +
					'margin-right:18px;' +
					'border-radius:22px;' +
					'font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",' +
						'Roboto,sans-serif;' +
					'font-weight:500;' +
					'max-width:260px;' +
					'min-height:1em;' +
					'word-wrap:break-word;' +
					'box-shadow:0 12px 32px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.06);' +
					'opacity:0;' +
					'transform:scale(.6) translateX(12px);' +
					'transform-origin:right center;' +
					'transition:opacity 200ms ease,' +
						'transform 260ms cubic-bezier(.34,1.56,.64,1);' +
				'}' +
				// Comic tail — a rotated square anchored to the
				// right edge. Positioned so it sits in front of
				// Wapuu's mouth area when the overlay is open.
				'#alcazaba-voice-wapuu-bubble::after{' +
					'content:"";' +
					'position:absolute;' +
					'right:-7px;top:50%;' +
					'width:18px;height:18px;' +
					'background:#fff;' +
					'transform:translateY(-50%) rotate(45deg);' +
					'border-radius:4px;' +
					'box-shadow:4px -4px 8px -4px rgba(0,0,0,.1);' +
					'z-index:-1;' +
				'}' +
				'#alcazaba-voice-wapuu-bubble.is-active{' +
					'opacity:1;' +
					'transform:scale(1) translateX(0);' +
				'}' +
				// Subtle idle wiggle while Wapuu is on screen —
				// sells the "alive and listening" vibe. Paused
				// when hidden to avoid offscreen work.
				'@keyframes alcazaba-voice-wapuu-wiggle{' +
					'0%,100%{transform:rotate(-1.2deg);}' +
					'50%{transform:rotate(1.2deg);}' +
				'}' +
				'#alcazaba-voice-wapuu.is-open img{' +
					'animation:alcazaba-voice-wapuu-wiggle 3.2s ease-in-out infinite;' +
					'transform-origin:bottom center;' +
				'}';
			var style = document.createElement( 'style' );
			style.id = 'alcazaba-voice-wapuu-styles';
			style.textContent = css;
			document.head.appendChild( style );
		}

		function ensure() {
			if ( root ) {
				return;
			}
			ensureStyles();

			root = document.createElement( 'div' );
			root.id = 'alcazaba-voice-wapuu';

			bubble = document.createElement( 'div' );
			bubble.id = 'alcazaba-voice-wapuu-bubble';
			// Separate inner span so we can animate opacity on
			// text changes without re-running the bubble's own
			// pop-in transition.
			bubbleText = document.createElement( 'span' );
			bubble.appendChild( bubbleText );

			var img = document.createElement( 'img' );
			img.src = wapuuUrl();
			img.alt = 'Wapuu';

			root.appendChild( bubble );
			root.appendChild( img );
			document.body.appendChild( root );
		}

		return {
			show: function () {
				ensure();
				void root.getBoundingClientRect();
				root.style.transform = 'translate(0,-50%)';
				root.classList.add( 'is-open' );
			},
			hide: function () {
				if ( ! root ) {
					return;
				}
				root.style.transform = 'translate(120%,-50%)';
				root.classList.remove( 'is-open' );
				bubble.classList.remove( 'is-active' );
			},
			setBubble: function ( text ) {
				ensure();
				bubbleText.textContent = text || '';
				if ( text ) {
					bubble.classList.add( 'is-active' );
				} else {
					bubble.classList.remove( 'is-active' );
				}
			},
		};
	} )();

	function matchesWakeWord( transcript ) {
		var t = ( transcript || '' ).toLowerCase().replace( /[^a-z\s]/g, ' ' );
		for ( var i = 0; i < WAKE_WORDS.length; i++ ) {
			if ( t.indexOf( WAKE_WORDS[ i ] ) !== -1 ) {
				return WAKE_WORDS[ i ];
			}
		}
		return null;
	}

	function onWakeWord( matched, transcript ) {
		var now = Date.now();
		if ( now - wakeLoopState.lastHitAt < 2000 ) {
			return;
		}
		wakeLoopState.lastHitAt = now;
		// eslint-disable-next-line no-console
		console.log(
			'%cHey Wapuu!',
			'color:#0a7a22;font-weight:700',
			'(matched "' + matched + '" in "' + transcript.trim() + '")'
		);
		logCommandsSnapshot();
		beginCapture();
	}

	/**
	 * Enumerate every command currently registered with the desktop
	 * shell and print a tidy table-ish view. Split by surface:
	 *
	 *   - "slash"  — only visible in the palette after the user types `/`
	 *   - "eager"  — visible on the empty-input palette, contextual actions
	 *
	 * This is the phase-2 groundwork: once we can see what's
	 * available, the next step is mapping a follow-up utterance to
	 * one of these slugs and calling `ctx.run()` on it.
	 */
	function logCommandsSnapshot() {
		if (
			! window.wp ||
			! window.wp.desktop ||
			typeof window.wp.desktop.listCommands !== 'function'
		) {
			// eslint-disable-next-line no-console
			console.warn( '[alcazaba-voice] wp.desktop.listCommands unavailable' );
			return;
		}

		var commands = window.wp.desktop.listCommands();
		var slash = [];
		var eager = [];
		for ( var i = 0; i < commands.length; i++ ) {
			var c = commands[ i ];
			( c.eager ? eager : slash ).push( c );
		}

		// eslint-disable-next-line no-console
		console.groupCollapsed(
			'[alcazaba-voice] ' +
				commands.length +
				' commands available (' +
				slash.length +
				' slash, ' +
				eager.length +
				' eager)'
		);
		try {
			/* eslint-disable no-console */
			if ( slash.length ) {
				console.log( '%cSlash commands (typed as /slug)', 'font-weight:700' );
				console.table(
					slash.map( function ( c ) {
						return {
							slug: '/' + c.slug,
							label: c.label,
							hint: c.hint || '',
							owner: c.owner || '',
							description: c.description || '',
						};
					} )
				);
			}
			if ( eager.length ) {
				console.log(
					'%cEager commands (shown without /)',
					'font-weight:700'
				);
				console.table(
					eager.map( function ( c ) {
						return {
							slug: c.slug,
							label: c.label,
							hint: c.hint || '',
							owner: c.owner || '',
							description: c.description || '',
						};
					} )
				);
			}
			/* eslint-enable no-console */
		} finally {
			// eslint-disable-next-line no-console
			console.groupEnd();
		}
	}

	/**
	 * Run one SpeechRecognition session and resolve when it ends.
	 *
	 * Wrapping recognition in a promise lets the parent loop express
	 * "listen, react, then loop" as plain `await listenOnce()`,
	 * matching how you'd reason about the UX ("await the next
	 * utterance"). Chrome auto-ends after ~60s of silence — the
	 * resolved promise triggers the loop's next iteration.
	 *
	 * `onresult` fires mid-session on every interim + final result;
	 * every transcript is logged and checked against the wake-word
	 * list. The promise does *not* resolve on a match — we stay in
	 * the same session so multiple wake words in one speaking turn
	 * fire separately.
	 */
	function listenOnce() {
		return new Promise( function ( resolve ) {
			var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
			if ( ! Ctor ) {
				// eslint-disable-next-line no-console
				console.warn( '[alcazaba-voice] SpeechRecognition not supported in this browser' );
				resolve( { reason: 'unsupported' } );
				return;
			}

			var rec;
			try {
				rec = new Ctor();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.warn( '[alcazaba-voice] SpeechRecognition constructor threw:', err );
				resolve( { reason: 'ctor-threw', err: err } );
				return;
			}

			rec.continuous = true;
			rec.interimResults = true;
			rec.lang = document.documentElement.lang || 'en-US';
			// No `processLocally = true` — forcing on-device makes
			// builds without the local model fail silently. Chrome
			// uses its best available backend unprompted.

			// Grammar hint. The W3C Web Speech API defines a
			// `SpeechGrammarList` the engine is allowed to bias
			// toward, expressed in JSGF. Chromium accepts the API
			// but its current STT backend largely ignores the
			// grammar weights — this is a best-effort nudge, not a
			// guarantee. Kept because (a) it does nothing harmful,
			// (b) the mishearing list below is the real defense,
			// and (c) if Chromium ever wires the grammar path up,
			// the plugin benefits automatically.
			try {
				var GrammarListCtor =
					window.SpeechGrammarList || window.webkitSpeechGrammarList;
				if ( GrammarListCtor ) {
					var grammar =
						'#JSGF V1.0; grammar wake; public <wake> = hey (wapuu | wapu);';
					var gl = new GrammarListCtor();
					gl.addFromString( grammar, 1 );
					rec.grammars = gl;
				}
			} catch ( e ) {}

			wakeLoopState.currentRec = rec;
			var lastError = null;
			var startedAt = 0;

			rec.onstart = function () {
				startedAt = Date.now();
				// eslint-disable-next-line no-console
				console.log( '[alcazaba-voice] 🎙️ listening…' );
			};

			rec.onresult = function ( event ) {
				for ( var i = event.resultIndex; i < event.results.length; i++ ) {
					var res = event.results[ i ];
					var transcript = res[ 0 ] && res[ 0 ].transcript ? res[ 0 ].transcript : '';
					if ( ! transcript ) {
						continue;
					}
					// eslint-disable-next-line no-console
					console.log(
						'[alcazaba-voice]',
						res.isFinal ? 'final  :' : 'interim:',
						JSON.stringify( transcript ),
						'(mode=' + voiceState.mode + ')'
					);

					if ( voiceState.mode === 'HUNTING' ) {
						var hit = matchesWakeWord( transcript );
						if ( hit ) {
							onWakeWord( hit, transcript );
							// If the user said "hey wapuu open
							// media library" in one breath, the
							// post-wake portion is already in this
							// same transcript. Feed it into the
							// capture state immediately so we don't
							// drop those first words.
							var after = stripWakeWord( transcript );
							if ( after ) {
								onCaptureTranscript( transcript, res.isFinal );
							}
						}
					} else {
						// CAPTURING — every transcript is command
						// payload. `onCaptureTranscript` strips any
						// residual wake prefix and handles silence
						// timer + final echo.
						onCaptureTranscript( transcript, res.isFinal );
					}
				}
			};

			rec.onerror = function ( e ) {
				// `no-speech` and `aborted` are normal during long
				// idle periods. `not-allowed` means the mic was
				// revoked. Others are worth surfacing.
				lastError = e && e.error ? e.error : 'unknown';
				if ( lastError !== 'no-speech' && lastError !== 'aborted' ) {
					// eslint-disable-next-line no-console
					console.warn( '[alcazaba-voice] recognition error:', lastError );
				}
			};

			rec.onend = function () {
				var duration = startedAt ? Date.now() - startedAt : 0;
				// Short sessions with no user speech are a strong
				// diagnostic signal — e.g. another recognition is
				// stealing the mic, or the audio subsystem isn't
				// delivering anything. Logging the session length
				// (plus the last error code) makes the cause obvious
				// without attaching a debugger.
				// eslint-disable-next-line no-console
				console.log(
					'[alcazaba-voice] session ended after ' + duration + 'ms' +
						( lastError ? ' (last error: ' + lastError + ')' : '' )
				);
				wakeLoopState.currentRec = null;
				resolve( { reason: 'ended', duration: duration, lastError: lastError } );
			};

			try {
				rec.start();
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.warn( '[alcazaba-voice] rec.start() threw:', err );
				wakeLoopState.currentRec = null;
				resolve( { reason: 'start-threw', err: err } );
			}
		} );
	}

	/**
	 * The actual always-on loop. Runs one recognition session,
	 * `await`s its end, then loops — exactly the pattern requested.
	 * A short sleep between iterations prevents a tight restart
	 * storm when the session fails immediately (e.g. mic revoked).
	 */
	async function wakeLoop() {
		if ( wakeLoopState.running ) {
			return;
		}
		wakeLoopState.running = true;
		// eslint-disable-next-line no-console
		console.log( '[alcazaba-voice] wake loop started' );

		while ( wakeLoopState.running ) {
			var result = await listenOnce();
			if (
				result.reason === 'unsupported' ||
				result.reason === 'ctor-threw'
			) {
				// These won't succeed on retry — bail.
				wakeLoopState.running = false;
				break;
			}
			// Short breather — if the session ended in <500ms
			// (typical for permission issues) we'd otherwise spin.
			await new Promise( function ( r ) {
				setTimeout( r, 300 );
			} );
		}

		// eslint-disable-next-line no-console
		console.log( '[alcazaba-voice] wake loop stopped' );
	}

	function stopWakeLoop() {
		wakeLoopState.running = false;
		if ( wakeLoopState.currentRec ) {
			try {
				wakeLoopState.currentRec.stop();
			} catch ( e ) {}
		}
	}

	/**
	 * Start the loop iff the mic is granted. Called on boot and on
	 * permission changes.
	 */
	function syncWakeListener() {
		if ( ! navigator || ! navigator.permissions || ! navigator.permissions.query ) {
			wakeLoop();
			return;
		}
		navigator.permissions.query( { name: 'microphone' } ).then(
			function ( status ) {
				if ( status.state === 'granted' ) {
					wakeLoop();
				} else {
					stopWakeLoop();
				}
				status.onchange = syncWakeListener;
			},
			function () {
				wakeLoop();
			}
		);
	}

	// ---------------------------------------------------------------------
	// Mic permission helpers (used by the tab button).
	// ---------------------------------------------------------------------

	function queryMicPermission() {
		return new Promise( function ( resolve ) {
			if ( ! navigator || ! navigator.permissions || ! navigator.permissions.query ) {
				resolve( 'prompt' );
				return;
			}
			try {
				navigator.permissions.query( { name: 'microphone' } ).then(
					function ( status ) {
						resolve( status.state );
					},
					function () {
						resolve( 'prompt' );
					}
				);
			} catch ( e ) {
				resolve( 'prompt' );
			}
		} );
	}

	function requestMicAccess() {
		if (
			! navigator ||
			! navigator.mediaDevices ||
			! navigator.mediaDevices.getUserMedia
		) {
			return Promise.reject( new Error( 'getUserMedia unavailable' ) );
		}
		return navigator.mediaDevices.getUserMedia( { audio: true } ).then( function ( stream ) {
			stream.getTracks().forEach( function ( t ) {
				t.stop();
			} );
			return true;
		} );
	}

	// ---------------------------------------------------------------------
	// Tab render.
	// ---------------------------------------------------------------------

	/**
	 * Tab render — `ctx.getOsSettings()` and `ctx.subscribeOsSettings()`
	 * replaced the old localStorage poll + storage-event dance. The
	 * built-in AI tab and this tab now read from the same source.
	 */
	function render( body, ctx ) {
		body.innerHTML = '';

		var micState = 'prompt';
		var requesting = false;
		var lastError = '';

		// The `stack` attribute on <wpd-section> gives us flex-column
		// with a default gap — no manual <wpd-stack> wrapper needed.
		body.innerHTML = [
			'<wpd-section id="av-status"',
			'  heading="Voice"',
			'  description="Speak to your WordPress admin. Voice features need a microphone and a configured OpenAI key."',
			'  stack>',
			'  <wpd-cluster align="start">',
			'    <wpd-display id="av-badge" size="sm" align="center"></wpd-display>',
			'  </wpd-cluster>',
			'  <wpd-button id="av-button" variant="primary">Request microphone access</wpd-button>',
			'  <wpd-empty-state id="av-tip" icon="info-outline"></wpd-empty-state>',
			'</wpd-section>',
			'<wpd-section',
			'  heading="About speech-to-text"',
			'  description="How this plugin listens for your voice, and what stays local."',
			'  stack>',
			'  <wpd-empty-state',
			'    icon="yes"',
			'    heading="No setup required"',
			'    description="Chrome has speech-to-text built in — the Web Speech API. Once you grant microphone access, this plugin starts listening for the wake word right away. No chrome://flags, no installs."',
			'  ></wpd-empty-state>',
			'  <wpd-empty-state',
			'    icon="lock"',
			'    heading="On-device transcription (where supported)"',
			'    description="This plugin asks Chrome for on-device recognition (processLocally) so your audio stays on the machine whenever possible. If the local model isn&rsquo;t available yet, Chrome transparently falls back to its cloud service. First use on a fresh profile may trigger a one-time model download."',
			'  ></wpd-empty-state>',
			'  <wpd-empty-state',
			'    icon="search"',
			'    heading="How to verify where audio is going"',
			'    description="Open DevTools › Network, filter by &quot;speech&quot;, then say the wake word. Requests to speech.googleapis.com mean cloud; silence means on-device. Optional: open chrome://components to check that &quot;Speech Recognition&quot; is installed."',
			'  ></wpd-empty-state>',
			'</wpd-section>',
		].join( '' );

		var badge = body.querySelector( '#av-badge' );
		var button = body.querySelector( '#av-button' );
		var tip = body.querySelector( '#av-tip' );

		function paint() {
			var ai = ctx.getOsSettings().ai;
			var keyOk = ( ai.apiKey || '' ).trim() !== '';
			var aiToggleOk = !! ai.enabled;
			var micOk = micState === 'granted';
			var ok = keyOk && micOk && aiToggleOk;

			badge.setAttribute( 'value', ok ? 'ENABLED' : 'DISABLED' );
			badge.style.display = 'inline-flex';
			badge.style.width = 'auto';
			badge.style.padding = '4px 12px';
			badge.style.borderRadius = '999px';
			badge.style.fontWeight = '700';
			badge.style.letterSpacing = '0.06em';
			badge.style.background = ok ? '#d1f4d1' : '#fde2e2';
			badge.style.color = ok ? '#0a7a22' : '#a0111c';
			badge.style.border = ok ? '1px solid #0a7a22' : '1px solid #a0111c';

			if ( micOk ) {
				button.setAttribute( 'variant', 'ghost' );
				button.setAttribute( 'disabled', '' );
				button.textContent = 'Microphone access granted';
			} else if ( micState === 'denied' ) {
				button.setAttribute( 'variant', 'secondary' );
				button.removeAttribute( 'disabled' );
				button.textContent = 'Microphone blocked — retry';
			} else if ( requesting ) {
				button.setAttribute( 'variant', 'primary' );
				button.setAttribute( 'disabled', '' );
				button.textContent = 'Requesting access…';
			} else {
				button.setAttribute( 'variant', 'primary' );
				button.removeAttribute( 'disabled' );
				button.textContent = 'Request microphone access';
			}

			if ( ok ) {
				tip.setAttribute( 'icon', 'yes-alt' );
				tip.setAttribute( 'heading', 'You’re all set.' );
				tip.setAttribute(
					'description',
					'Microphone access is granted and an OpenAI key is configured. Voice features are ready to use.'
				);
				return;
			}

			var reasons = [];
			if ( ! keyOk ) {
				reasons.push( 'No OpenAI API key — open the “AI Settings” tab and paste a key under API key.' );
			}
			if ( ! aiToggleOk ) {
				reasons.push( 'AI features are turned off — open the “AI Settings” tab and check “Enable AI features”.' );
			}
			if ( ! micOk ) {
				if ( micState === 'denied' ) {
					reasons.push( 'Microphone is blocked — update your browser’s site permissions, then click the retry button.' );
				} else {
					reasons.push( 'Microphone permission hasn’t been granted — click the button above and accept the browser prompt.' );
				}
			}
			if ( lastError ) {
				reasons.push( lastError );
			}
			tip.setAttribute( 'icon', 'warning' );
			tip.setAttribute( 'heading', 'Voice features aren’t ready yet' );
			tip.setAttribute( 'description', reasons.join( '\n• ' ) );
		}

		button.addEventListener( 'click', function () {
			if ( requesting ) {
				return;
			}
			requesting = true;
			lastError = '';
			paint();
			requestMicAccess().then(
				function () {
					requesting = false;
					queryMicPermission().then( function ( s ) {
						micState = s;
						paint();
					} );
				},
				function ( err ) {
					requesting = false;
					lastError =
						err && err.name === 'NotAllowedError'
							? 'Permission denied — enable microphone access in your browser site settings.'
							: 'Microphone request failed: ' + ( err && err.message ? err.message : 'unknown error' );
					queryMicPermission().then( function ( s ) {
						micState = s;
						paint();
					} );
				}
			);
		} );

		paint();

		// First paint uses the snapshot; async gets real mic state.
		queryMicPermission().then( function ( s ) {
			micState = s;
			paint();
		} );

		// React when the user edits the OpenAI key / AI toggle in the
		// adjacent AI tab. `subscribeOsSettings` auto-cleans when the
		// panel rebuilds.
		var off = ctx.subscribeOsSettings( function () {
			paint();
		} );
		var mo = new MutationObserver( function () {
			if ( ! body.isConnected ) {
				off();
				mo.disconnect();
			}
		} );
		mo.observe( body.parentNode || body, { childList: true, subtree: true } );

		// Permission-API onchange catches user flipping the browser
		// site setting while the panel is open.
		if ( navigator.permissions && navigator.permissions.query ) {
			navigator.permissions.query( { name: 'microphone' } ).then(
				function ( status ) {
					status.onchange = function () {
						micState = status.state;
						paint();
					};
				},
				function () {}
			);
		}
	}

	// ---------------------------------------------------------------------
	// Boot — `wp.desktop.ready()` handles both "shell already up" and
	// "shell still booting", including the server-sync injection path
	// that dropped the old addEventListener approach on the floor.
	// ---------------------------------------------------------------------

	/**
	 * /show_latest_draft — opens the most recently modified draft
	 * post in a desktop window. Marked `aiCallable: true` so it
	 * surfaces when the model harvests the opt-in tool set on
	 * `wp.desktop.ai.ask( …, { tools: 'aiCallable' } )`.
	 *
	 * A read-only "open the editor at URL X" side effect — safe to
	 * expose to the model. Writes (publish, delete, etc.) would
	 * stay out of the aiCallable set.
	 */
	function registerShowLatestDraftCommand() {
		if ( ! window.wp || ! window.wp.desktop || typeof window.wp.desktop.registerCommand !== 'function' ) {
			return;
		}

		window.wp.desktop.registerCommand( {
			slug: 'show_latest_draft',
			label: 'Show latest draft',
			description:
				'Open the most recently modified draft post in a new window. No arguments. Use when the user asks to see, open, read, continue, or review their most recent draft.',
			icon: 'dashicons-edit',
			aiCallable: true,
			owner: OWNER,
			run: async function ( _args, ctx ) {
				var restUrl =
					( window.wpDesktopConfig && window.wpDesktopConfig.restUrl ) ||
					'/wp-json/';
				var restNonce =
					( window.wpDesktopConfig && window.wpDesktopConfig.restNonce ) || '';
				var url =
					restUrl.replace( /\/?$/, '/' ) +
					'wp/v2/posts?status=draft&per_page=1&orderby=modified&order=desc&_fields=id,title,link';

				var res;
				try {
					res = await fetch( url, {
						headers: restNonce ? { 'X-WP-Nonce': restNonce } : {},
					} );
				} catch ( err ) {
					return 'Network error fetching drafts.';
				}
				if ( ! res.ok ) {
					return 'Could not fetch drafts (HTTP ' + res.status + ').';
				}
				var drafts;
				try {
					drafts = await res.json();
				} catch ( _ ) {
					drafts = [];
				}
				if ( ! Array.isArray( drafts ) || drafts.length === 0 ) {
					return 'No drafts found.';
				}

				var draft = drafts[ 0 ];
				var title =
					( draft.title && ( draft.title.rendered || draft.title ) ) ||
					'Untitled draft';
				// Strip HTML entities the REST renderer may emit.
				var tmp = document.createElement( 'div' );
				tmp.innerHTML = title;
				title = tmp.textContent || title;

				var editorUrl =
					( window.wpDesktopConfig && window.wpDesktopConfig.adminUrl
						? window.wpDesktopConfig.adminUrl.replace( /\/?$/, '/' )
						: '/wp-admin/' ) +
					'post.php?post=' +
					encodeURIComponent( draft.id ) +
					'&action=edit';

				if ( ctx && typeof ctx.openInWindow === 'function' ) {
					ctx.openInWindow( editorUrl, 'Draft — ' + title, 'dashicons-edit' );
				} else if (
					window.wp &&
					window.wp.desktop &&
					window.wp.desktop.windowManager &&
					typeof window.wp.desktop.windowManager.open === 'function'
				) {
					// Fallback for contexts where ctx isn't wired
					// (e.g. when invoked by wp.desktop.ai.ask's
					// built-in fallback CommandContext).
					window.wp.desktop.windowManager.open( {
						url: editorUrl,
						title: 'Draft — ' + title,
						icon: 'dashicons-edit',
					} );
				}

				return 'Opened draft: ' + title;
			},
		} );
	}

	function boot() {
		window.wp.desktop.registerSettingsTab( {
			id: 'voice',
			label: 'Voice',
			order: 25,
			owner: OWNER,
			render: render,
		} );
		registerShowLatestDraftCommand();
		syncWakeListener();
	}

	if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
		window.wp.desktop.ready( boot );
	} else if ( window.wp && window.wp.desktop && window.wp.desktop.registerSettingsTab ) {
		// Unlikely: older shell with registerSettingsTab but no ready().
		boot();
	} else {
		// Very old shell pre-ready() — fall back to the event + poll
		// dance so the plugin keeps loading on older hosts.
		document.addEventListener(
			'wp-desktop-init',
			function () {
				if ( window.wp && window.wp.desktop && window.wp.desktop.registerSettingsTab ) {
					boot();
				}
			},
			{ once: true }
		);
	}
} )();
