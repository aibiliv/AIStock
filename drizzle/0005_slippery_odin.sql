CREATE TABLE `account_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`initial_capital_cents` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
