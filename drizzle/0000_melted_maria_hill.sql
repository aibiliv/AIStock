CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`price` real NOT NULL,
	`quantity` integer NOT NULL,
	`reason` text NOT NULL,
	`plan` text NOT NULL,
	`traded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
