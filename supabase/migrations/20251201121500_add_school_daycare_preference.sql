/*
  # Normalize service preference values for school/daycare settings

  1. Changes
    - Replace legacy entries ('In school', 'Daycare/After School') with unified
      'School / Daycare / Preschool' in clients.service_preference.
    - Ensure clients flagged with in_school or daycare_after_school include the
      new label in their preference array.
    - Keep in_school/daycare_after_school booleans true whenever the unified
      label is present.

  2. Security
    - Data-only migration; relies on existing RLS policies.
*/

DO $$
DECLARE
  v_new_label constant text := 'School / Daycare / Preschool';
BEGIN
  WITH normalized AS (
    SELECT
      id,
      CASE
        WHEN needs_label THEN array(
          SELECT DISTINCT pref
          FROM unnest(
            array_append(
              array_remove(array_remove(current_prefs, 'In school'), 'Daycare/After School'),
              v_new_label
            )
          ) AS pref
        )
        ELSE array_remove(array_remove(current_prefs, 'In school'), 'Daycare/After School')
      END AS new_prefs
    FROM (
      SELECT
        id,
        COALESCE(service_preference, ARRAY[]::text[]) AS current_prefs,
        (
          COALESCE(service_preference, ARRAY[]::text[]) && ARRAY['In school', 'Daycare/After School']
          OR COALESCE(in_school, false)
          OR COALESCE(daycare_after_school, false)
        ) AS needs_label
      FROM clients
    ) data
  )
  UPDATE clients c
  SET service_preference = normalized.new_prefs
  FROM normalized
  WHERE c.id = normalized.id
    AND c.service_preference IS DISTINCT FROM normalized.new_prefs;

  UPDATE clients
  SET
    in_school = COALESCE(in_school, false) OR service_preference @> ARRAY[v_new_label],
    daycare_after_school = COALESCE(daycare_after_school, false) OR service_preference @> ARRAY[v_new_label]
  WHERE service_preference @> ARRAY[v_new_label];
END $$;

