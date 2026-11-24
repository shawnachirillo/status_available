BEGIN;

CREATE TABLE public.website_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  website_id uuid NOT NULL
    REFERENCES public.websites(id) ON DELETE CASCADE,

  publication_version bigint NOT NULL
    CHECK (publication_version > 0),

  source_draft_version bigint NOT NULL
    CHECK (source_draft_version >= 0),

  edition_id text NOT NULL,

  content jsonb NOT NULL
    CHECK (jsonb_typeof(content) = 'object'),

  renderer_version integer NOT NULL DEFAULT 1
    CHECK (renderer_version > 0),

  published_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT publication_version_unique
    UNIQUE (website_id, publication_version),

  CONSTRAINT publication_website_identity_unique
    UNIQUE (website_id, id),

  CONSTRAINT publication_edition_matches_content
    CHECK (
      content ? 'edition'
      AND content->>'edition' IS NOT NULL
      AND content->>'edition' = edition_id
    )
);

ALTER TABLE public.websites
  ADD COLUMN public_slug text,
  ADD COLUMN current_publication_id uuid;

ALTER TABLE public.websites
  ADD CONSTRAINT website_public_slug_unique
    UNIQUE (public_slug),

  ADD CONSTRAINT website_public_slug_format
    CHECK (
      public_slug IS NULL OR (
        char_length(public_slug) BETWEEN 3 AND 63
        AND public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND public_slug NOT IN (
          'www', 'app', 'studio', 'api',
          'admin', 'auth', 'mail', 'status',
          'support', 'help', 'assets', 'cdn',
          'preview', 'billing', 'checkout',
          'dashboard', 'account', 'static'
        )
      )
    ),

  ADD CONSTRAINT website_current_publication_fk
    FOREIGN KEY (id, current_publication_id)
    REFERENCES public.website_publications
      (website_id, id),

  ADD CONSTRAINT website_published_snapshot_required
    CHECK (
      publication_status <> 'published'
      OR (
        public_slug IS NOT NULL
        AND current_publication_id IS NOT NULL
      )
    );

ALTER TABLE public.website_publications
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.website_publications
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION
  public.prevent_publication_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Published snapshots cannot be modified';
END;
$$;

CREATE TRIGGER publication_snapshots_immutable
BEFORE UPDATE ON public.website_publications
FOR EACH ROW
EXECUTE FUNCTION
  public.prevent_publication_snapshot_update();

COMMIT;
