DO $$
DECLARE
  function_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.reserve_edition_inventory(uuid)'::regprocedure
  )
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'Inventory reservation function not found';
  END IF;

  IF function_definition NOT LIKE '%15 minutes%' THEN
    RAISE EXCEPTION
      'Expected 15-minute reservation duration not found; review required';
  END IF;

  updated_definition := replace(
    function_definition,
    'interval ''15 minutes''',
    'public.status_inventory_hold_duration()'
  );

  IF updated_definition = function_definition THEN
    RAISE EXCEPTION
      'Reservation duration replacement failed';
  END IF;

  EXECUTE updated_definition;
END;
$$;
