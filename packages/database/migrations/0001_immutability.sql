-- Strategy versions are immutable: only lifecycle columns may change, and frozen_at may only be set once.
CREATE OR REPLACE FUNCTION ct_strategy_version_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.strategy_id IS DISTINCT FROM OLD.strategy_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.template IS DISTINCT FROM OLD.template
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.timeframe IS DISTINCT FROM OLD.timeframe
     OR NEW.hypothesis IS DISTINCT FROM OLD.hypothesis
     OR NEW.rationale IS DISTINCT FROM OLD.rationale
     OR NEW.invalidation IS DISTINCT FROM OLD.invalidation
     OR NEW.parameters IS DISTINCT FROM OLD.parameters
     OR NEW.risk IS DISTINCT FROM OLD.risk
     OR NEW.genome_parent IS DISTINCT FROM OLD.genome_parent
     OR NEW.mutations IS DISTINCT FROM OLD.mutations
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'strategy_versions definition columns are immutable (version %)', OLD.id;
  END IF;
  IF OLD.frozen_at IS NOT NULL AND NEW.frozen_at IS DISTINCT FROM OLD.frozen_at THEN
    RAISE EXCEPTION 'strategy version % is already frozen', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER strategy_versions_immutable BEFORE UPDATE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION ct_strategy_version_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ct_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER strategy_versions_no_delete BEFORE DELETE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION ct_append_only();
--> statement-breakpoint
CREATE TRIGGER claude_decisions_append_only BEFORE UPDATE OR DELETE ON claude_decisions
  FOR EACH ROW EXECUTE FUNCTION ct_append_only();
--> statement-breakpoint
CREATE TRIGGER backtest_runs_append_only BEFORE UPDATE OR DELETE ON backtest_runs
  FOR EACH ROW EXECUTE FUNCTION ct_append_only();
--> statement-breakpoint
CREATE TRIGGER risk_events_append_only BEFORE UPDATE OR DELETE ON risk_events
  FOR EACH ROW EXECUTE FUNCTION ct_append_only();
--> statement-breakpoint
CREATE TRIGGER validation_runs_append_only BEFORE UPDATE OR DELETE ON validation_runs
  FOR EACH ROW EXECUTE FUNCTION ct_append_only();
