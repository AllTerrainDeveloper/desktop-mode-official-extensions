( function () {
	function register() {
		window.wp.desktop.registerCommand( {
			slug:  'echo',
			label: 'Echo',
			icon:  'dashicons-format-chat',
			owner: 'my-echo-commands', // enables live-unregister on deactivate
			run:   ( args ) => args.trim() || 'Usage: /echo [text]',
		} );
	}
	if ( window.wp && window.wp.desktop && window.wp.desktop.registerCommand ) {
		register();
	} else {
		document.addEventListener( 'wp-desktop-init', register, { once: true } );
	}
} )();
