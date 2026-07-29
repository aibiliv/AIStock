CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target_price_cents` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`acknowledged_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`buy_reason` text NOT NULL,
	`sell_reason` text NOT NULL,
	`followed_plan` integer NOT NULL,
	`lesson` text NOT NULL,
	`result_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`price_cents` integer NOT NULL,
	`quantity` integer NOT NULL,
	`trade_date` text NOT NULL,
	`reason` text NOT NULL,
	`max_loss_cents` integer,
	`fee_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_items_symbol_unique` ON `watch_items` (`symbol`);