-- P7 spaced review — DO NOT APPLY AUTO (operator-gate; run manually after deploy)
CREATE TABLE IF NOT EXISTS nexalog.review_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  capture_id UUID NOT NULL,
  next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  interval_days REAL NOT NULL DEFAULT 1,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  review_count INTEGER NOT NULL DEFAULT 0,
  last_grade INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS review_schedule_workspace_due_idx ON nexalog.review_schedule (workspace_id, next_review_at);
CREATE UNIQUE INDEX IF NOT EXISTS review_schedule_capture_unique ON nexalog.review_schedule (workspace_id, capture_id);
