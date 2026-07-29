ALTER TABLE `alert_rules` ADD `target_price_millis` integer;--> statement-breakpoint
ALTER TABLE `analysis_reports` ADD `price_millis` integer;--> statement-breakpoint
ALTER TABLE `trade_records` ADD `price_millis` integer;