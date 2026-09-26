-- SPDX-License-Identifier: MIT
-- Backing unique index for note_links .onConflictDoNothing() in
-- app/api/capture/route.ts and app/api/notes/[id]/links/route.ts.
-- Without this index the ON CONFLICT clause has no constraint to target,
-- so duplicate (source, target) pairs could accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS note_links_source_target_uniq ON nexalog.note_links (source_note_id, target_note_id);
