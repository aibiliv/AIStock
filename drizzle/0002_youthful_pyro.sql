CREATE TABLE `analysis_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`price_cents` integer NOT NULL,
	`market_time` text,
	`source` text NOT NULL,
	`mode` text NOT NULL,
	`summary` text NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `announcement_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`total_pages` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`mode` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_details` (
	`symbol` text PRIMARY KEY NOT NULL,
	`condition_text` text DEFAULT '等待自己的买入条件' NOT NULL,
	`status` text DEFAULT '研究中' NOT NULL,
	`last_reviewed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
