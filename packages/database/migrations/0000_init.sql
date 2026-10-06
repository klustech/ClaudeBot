CREATE TABLE "alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text,
	"strategy_version_id" text,
	"parameter_set_id" text,
	"template" text NOT NULL,
	"market" text NOT NULL,
	"timeframe" text NOT NULL,
	"partition" text NOT NULL,
	"run_hash" text NOT NULL,
	"dataset_version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"net_profit" numeric(30, 10) NOT NULL,
	"expectancy" numeric(30, 10) NOT NULL,
	"trade_count" integer NOT NULL,
	"profit_factor" real NOT NULL,
	"sharpe" real NOT NULL,
	"max_drawdown" real NOT NULL,
	"win_rate" real NOT NULL,
	"source" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"markets" jsonb NOT NULL,
	"timeframe" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "claude_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"strategy_id" text,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"input_metrics" jsonb NOT NULL,
	"output_decision" text NOT NULL,
	"model" text NOT NULL,
	"session_id" text NOT NULL,
	"actor" text DEFAULT 'claude' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"backtest_run_id" text,
	"session_id" text,
	"time" timestamp with time zone NOT NULL,
	"equity" numeric(30, 10) NOT NULL,
	"drawdown" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"number" bigserial NOT NULL,
	"campaign_id" text,
	"strategy_version_id" text,
	"template" text,
	"market" text,
	"timeframe" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"hypothesis" text,
	"configurations_tested" integer DEFAULT 0 NOT NULL,
	"dataset_version" text,
	"code_hash" text,
	"engine_version" text,
	"seed" integer,
	"date_from" timestamp with time zone,
	"date_to" timestamp with time zone,
	"params" jsonb,
	"fee_model" jsonb,
	"result_summary" jsonb,
	"verdict" text,
	"notes" text,
	"source" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"venue" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"capital_stage" integer DEFAULT 0 NOT NULL,
	"strategy_version_ids" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"session_id" text,
	"session_kind" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"venue" text NOT NULL,
	"venue_order_id" text,
	"market" text NOT NULL,
	"direction" text NOT NULL,
	"requested_stake" numeric(30, 10) NOT NULL,
	"filled_stake" numeric(30, 10),
	"fill_price" numeric(30, 10),
	"fees" numeric(30, 10),
	"state" text NOT NULL,
	"reason" text,
	"risk_decision" jsonb,
	"latency" jsonb,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"starting_balance" numeric(30, 10) NOT NULL,
	"currency" text NOT NULL,
	"strategy_version_ids" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parameter_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"session_kind" text NOT NULL,
	"order_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"market" text NOT NULL,
	"direction" text NOT NULL,
	"stake" numeric(30, 10) NOT NULL,
	"entry_price" numeric(30, 10) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_price" numeric(30, 10),
	"pnl" numeric(30, 10)
);
--> statement-breakpoint
CREATE TABLE "research_journal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" text,
	"experiment_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"strategy_version_id" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"timeframe" text NOT NULL,
	"family" text NOT NULL,
	"created_by" text NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"family" text NOT NULL,
	"market" text NOT NULL,
	"timeframe" text NOT NULL,
	"hypothesis" text NOT NULL,
	"rationale" text NOT NULL,
	"invalidation" text NOT NULL,
	"expected_regimes" jsonb NOT NULL,
	"parameters" jsonb NOT NULL,
	"risk" jsonb NOT NULL,
	"genome_parent" text,
	"mutations" jsonb NOT NULL,
	"generation" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	"stage" text DEFAULT 'IDEA' NOT NULL,
	"live_eligible" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real,
	"stage_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"level" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_kind" text NOT NULL,
	"backtest_run_id" text,
	"session_id" text,
	"order_id" text,
	"strategy_version_id" text,
	"market" text NOT NULL,
	"direction" text NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"exit_time" timestamp with time zone NOT NULL,
	"entry_price" numeric(30, 10) NOT NULL,
	"exit_price" numeric(30, 10) NOT NULL,
	"stake" numeric(30, 10) NOT NULL,
	"fees" numeric(30, 10) NOT NULL,
	"pnl" numeric(30, 10) NOT NULL,
	"return_on_stake" real NOT NULL,
	"exit_reason" text,
	"win" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text,
	"strategy_version_id" text NOT NULL,
	"kind" text DEFAULT 'validation' NOT NULL,
	"passed" boolean NOT NULL,
	"checks" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"score_card" jsonb,
	"confidence" real,
	"trials" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_runs_experiment_idx" ON "backtest_runs" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "backtest_runs_version_idx" ON "backtest_runs" USING btree ("strategy_version_id");--> statement-breakpoint
CREATE INDEX "equity_run_idx" ON "equity_points" USING btree ("backtest_run_id");--> statement-breakpoint
CREATE INDEX "equity_session_idx" ON "equity_points" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "experiments_campaign_idx" ON "experiments" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "experiments_version_idx" ON "experiments" USING btree ("strategy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_idx" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parameter_sets_hash_idx" ON "parameter_sets" USING btree ("template","params_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_version_idx" ON "strategy_versions" USING btree ("strategy_id","version");--> statement-breakpoint
CREATE INDEX "strategy_versions_stage_idx" ON "strategy_versions" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "trades_run_idx" ON "trades" USING btree ("backtest_run_id");--> statement-breakpoint
CREATE INDEX "trades_session_idx" ON "trades" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "trades_version_idx" ON "trades" USING btree ("strategy_version_id");