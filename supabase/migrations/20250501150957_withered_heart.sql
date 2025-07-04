/*
  # Update Client Hours Categories

  1. Changes
    - Remove single authorized_hours column
    - Add three specific hour categories:
      - one_to_one_units
      - supervision_units
      - parent_consult_units
    
  2. Security
    - Maintain existing RLS policies
*/

-- Remove old authorized_hours column
ALTER TABLE clients 
DROP COLUMN IF EXISTS authorized_hours;

-- Add new unit categories
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS one_to_one_units integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS supervision_units integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS parent_consult_units integer DEFAULT 0;

-- Add comments
COMMENT ON COLUMN clients.one_to_one_units IS 'Authorized 1:1 service units';
COMMENT ON COLUMN clients.supervision_units IS 'Authorized supervision units';
COMMENT ON COLUMN clients.parent_consult_units IS 'Authorized parent consultation units';