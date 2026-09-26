-- P2-fb: queue_state — behavioural mirror for snooze + weekend feedback actions.
-- DO NOT APPLY without operator sign-off.
-- Pairs with lib/db/schema.ts queueState + app/api/queue/feedback/route.ts.

CREATE TABLE IF NOT EXISTS nexalog.queue_state (
  workspace_id  text         NOT NULL,
  capture_id    uuid         NOT NULL,
  source        text         NOT NULL,  -- 'snooze' | 'weekend'
  due_at        timestamptz  NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, capture_id, source)
);

CREATE INDEX IF NOT EXISTS queue_state_due_idx
  ON nexalog.queue_state (workspace_id, due_at);
