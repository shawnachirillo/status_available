ALTER TABLE public.websites
ADD COLUMN version bigint NOT NULL DEFAULT 0;

ALTER TABLE public.websites
ADD CONSTRAINT websites_version_nonnegative
CHECK (version >= 0);
