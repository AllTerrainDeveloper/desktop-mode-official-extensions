<?php
/**
 * Mock orders dataset for the showcase.
 *
 * Deterministic — same call always produces the same rows so screenshots
 * and tests stay stable. No DB, no Woo dependency. Generation is gated
 * behind a static cache so we pay it once per request.
 *
 * Shape (single order):
 *
 *     array(
 *         'id'         => 'ORD-1042',
 *         'customer'   => 'Alice Stone',
 *         'email'      => 'alice@example.com',
 *         'country'    => 'ES',
 *         'status'     => 'paid',
 *         'payment'    => 'card',
 *         'total'      => 142.50,
 *         'currency'   => 'EUR',
 *         'created'    => '2026-04-12',
 *         'tracking'   => '1Z999AA10123456784',
 *         'logins'     => 7,                         // sparkline source
 *         'history'    => array( 5, 7, 4, 9, 12, 6, 8 ),
 *         'items'      => array(
 *             array(
 *                 'sku'       => 'SKU-100',
 *                 'name'      => 'Widget',
 *                 'qty'       => 2,
 *                 'price'     => 39.00,
 *                 'movements' => array(
 *                     array(
 *                         'id'       => 'MOV-1',
 *                         'type'     => 'out',
 *                         'qty'      => 2,
 *                         'location' => 'Madrid-A',
 *                         'at'       => '2026-04-12T09:14:00Z',
 *                     ),
 *                 ),
 *             ),
 *         ),
 *     )
 *
 * @package WpdTableShowcase
 */

defined( 'ABSPATH' ) || exit;

/**
 * Returns the showcase dataset.
 *
 * @return array<int, array<string, mixed>>
 */
function wpd_table_showcase_orders() {
	static $cache = null;
	if ( null !== $cache ) {
		return $cache;
	}

	$customers = array(
		array( 'Alice Stone',     'alice@example.com',   'ES' ),
		array( 'Bob Marlowe',     'bob@example.com',     'GB' ),
		array( 'Camila Ruiz',     'camila@example.com',  'MX' ),
		array( 'Daichi Sato',     'daichi@example.com',  'JP' ),
		array( 'Elena Petrova',   'elena@example.com',   'DE' ),
		array( 'Faisal Karim',    'faisal@example.com',  'AE' ),
		array( 'Greta Olsen',     'greta@example.com',   'NO' ),
		array( 'Hugo Almeida',    'hugo@example.com',    'PT' ),
		array( 'Inés Vega',       'ines@example.com',    'ES' ),
		array( 'Jonas Weber',     'jonas@example.com',   'DE' ),
		array( 'Kira Nakamura',   'kira@example.com',    'JP' ),
		array( 'Liam O\'Connor',  'liam@example.com',    'IE' ),
	);

	$skus = array(
		array( 'SKU-100', 'Bluetooth Widget',       39.00 ),
		array( 'SKU-200', 'USB-C Cable 1m',          9.50 ),
		array( 'SKU-300', 'Mechanical Keyboard',   129.00 ),
		array( 'SKU-400', 'Desk Lamp',              49.90 ),
		array( 'SKU-500', 'Notebook A5',             6.20 ),
		array( 'SKU-600', 'Wireless Mouse',         29.00 ),
		array( 'SKU-700', '4K Monitor 27"',        389.00 ),
		array( 'SKU-800', 'Coffee Mug',             14.00 ),
	);

	$statuses    = array( 'pending', 'paid', 'shipped', 'refunded' );
	$payments    = array( 'card', 'paypal', 'wire' );
	$currencies  = array( 'EUR', 'USD', 'GBP' );
	$locations   = array( 'Madrid-A', 'Madrid-B', 'Berlin-1', 'Tokyo-3', 'London-Hub' );
	$movement_kn = array( 'in', 'out' );

	mt_srand( 20260427 );

	$orders = array();
	for ( $i = 0; $i < 42; $i++ ) {
		$cust = $customers[ $i % count( $customers ) ];

		$item_count = 1 + ( $i % 4 );
		$items      = array();
		$total      = 0.0;
		for ( $j = 0; $j < $item_count; $j++ ) {
			$sku   = $skus[ ( $i + $j ) % count( $skus ) ];
			$qty   = 1 + mt_rand( 0, 4 );
			$price = $sku[2];
			$total += $qty * $price;

			$mov_count = 1 + mt_rand( 0, 2 );
			$movements = array();
			for ( $k = 0; $k < $mov_count; $k++ ) {
				$movements[] = array(
					'id'       => sprintf( 'MOV-%d-%d-%d', $i, $j, $k ),
					'type'     => $movement_kn[ $k % 2 ],
					'qty'      => 1 + mt_rand( 0, $qty ),
					'location' => $locations[ ( $i + $j + $k ) % count( $locations ) ],
					'at'       => sprintf(
						'2026-04-%02dT%02d:%02d:00Z',
						1 + ( ( $i + $j + $k ) % 26 ),
						8 + ( ( $i + $k ) % 10 ),
						( $j * 13 + $k * 7 ) % 60
					),
				);
			}

			$items[] = array(
				'sku'       => $sku[0],
				'name'      => $sku[1],
				'qty'       => $qty,
				'price'     => $price,
				'movements' => $movements,
			);
		}

		$history = array();
		for ( $h = 0; $h < 8; $h++ ) {
			$history[] = mt_rand( 1, 16 );
		}

		$orders[] = array(
			'id'       => sprintf( 'ORD-%04d', 1000 + $i ),
			'customer' => $cust[0],
			'email'    => $cust[1],
			'country'  => $cust[2],
			'status'   => $statuses[ ( $i + ( $i % 3 ) ) % count( $statuses ) ],
			'payment'  => $payments[ $i % count( $payments ) ],
			'total'    => round( $total, 2 ),
			'currency' => $currencies[ $i % count( $currencies ) ],
			'created'  => sprintf( '2026-%02d-%02d', 1 + ( $i % 4 ), 1 + ( $i % 27 ) ),
			'tracking' => sprintf( '1Z%010dEU', 100000 + $i ),
			'logins'   => 1 + ( $i % 23 ),
			'history'  => $history,
			'items'    => $items,
		);
	}

	mt_srand();

	$cache = $orders;
	return $cache;
}
