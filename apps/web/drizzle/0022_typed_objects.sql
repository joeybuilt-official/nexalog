-- P9: typed objects — user-defined kinds (Book, Person, Meeting, …).
-- DO NOT APPLY without operator sign-off.
-- Pairs with lib/db/schema.ts typedObjectKinds + typedObjects.

CREATE TABLE nexalog.typed_object_kinds (
  workspace_id  text        NOT NULL,
  kind          text        NOT NULL,
  schema_json   jsonb       NOT NULL DEFAULT '{}',
  icon          text,
  PRIMARY KEY (workspace_id, kind)
);

CREATE TABLE nexalog.typed_objects (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  text        NOT NULL,
  kind          text        NOT NULL,
  data          jsonb       NOT NULL DEFAULT '{}',
  fts           tsvector    GENERATED ALWAYS AS
                              (to_tsvector('english', coalesce(data->>'title', ''))) STORED,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  FOREIGN KEY (workspace_id, kind)
    REFERENCES nexalog.typed_object_kinds(workspace_id, kind)
    ON DELETE CASCADE
);

CREATE INDEX typed_objects_workspace_kind_idx
  ON nexalog.typed_objects(workspace_id, kind);

CREATE INDEX typed_objects_fts_idx
  ON nexalog.typed_objects USING gin(fts);
