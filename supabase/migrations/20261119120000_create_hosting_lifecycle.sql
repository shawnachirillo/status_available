BEGIN;

CREATE FUNCTION public.website_hosting_state(
  starts_at timestamptz,
  ends_at timestamptz,
  evaluated_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN starts_at IS NULL
      OR ends_at IS NULL
      OR evaluated_at IS NULL
      OR ends_at <= starts_at
      THEN 'unallocated'

    WHEN evaluated_at < starts_at
      THEN 'scheduled'

    WHEN evaluated_at < ends_at
      THEN 'active'

    WHEN evaluated_at <
      ends_at + interval '720 hours'
      THEN 'grace'

    WHEN evaluated_at <
      ends_at + interval '2880 hours'
      THEN 'suspended'

    ELSE 'retention_expired'
  END;
$$;

CREATE FUNCTION public.website_hosting_operational(
  starts_at timestamptz,
  ends_at timestamptz,
  evaluated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.website_hosting_state(
    starts_at,
    ends_at,
    evaluated_at
  ) IN ('active', 'grace');
$$;

REVOKE ALL ON FUNCTION public.website_hosting_state(
  timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.website_hosting_operational(
  timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;

DO $grant$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.website_hosting_state(
      timestamptz, timestamptz, timestamptz
    ) TO service_role;

    GRANT EXECUTE ON FUNCTION public.website_hosting_operational(
      timestamptz, timestamptz, timestamptz
    ) TO service_role;
  END IF;
END;
$grant$;

COMMENT ON FUNCTION public.website_hosting_state(
  timestamptz, timestamptz, timestamptz
) IS
  'Hosting time eligibility only. Does not establish ownership, payment or publication authorization.';

COMMIT;
