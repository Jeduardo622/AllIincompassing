/*
  # Add Scheduling Preferences

  1. Changes
    - Add scheduling preferences table
    - Add session constraints
    - Add travel preferences
    
  2. Security
    - Enable RLS
    - Add appropriate policies
*/

-- Create scheduling preferences table
CREATE TABLE IF NOT EXISTS scheduling_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  min_break_minutes integer DEFAULT 30,
  max_consecutive_sessions integer DEFAULT 4,
  preferred_break_minutes integer DEFAULT 45,
  max_daily_hours integer DEFAULT 8,
  start_location text,
  end_location text,
  avoid_highways boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE scheduling_preferences ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Users can view their own preferences"
  ON scheduling_preferences
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

CREATE POLICY "Users can update their own preferences"
  ON scheduling_preferences
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'admin'
    )
  );

-- Add trigger for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_scheduling_preferences_updated_at'
  ) THEN
    CREATE TRIGGER update_scheduling_preferences_updated_at
      BEFORE UPDATE ON scheduling_preferences
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Add comments
COMMENT ON TABLE scheduling_preferences IS 'User-specific scheduling preferences';
COMMENT ON COLUMN scheduling_preferences.min_break_minutes IS 'Minimum break time between sessions';
COMMENT ON COLUMN scheduling_preferences.max_consecutive_sessions IS 'Maximum number of consecutive sessions';
COMMENT ON COLUMN scheduling_preferences.preferred_break_minutes IS 'Preferred break time between sessions';
COMMENT ON COLUMN scheduling_preferences.max_daily_hours IS 'Maximum working hours per day';
COMMENT ON COLUMN scheduling_preferences.start_location IS 'Preferred starting location for the day';
COMMENT ON COLUMN scheduling_preferences.end_location IS 'Preferred ending location for the day';
COMMENT ON COLUMN scheduling_preferences.avoid_highways IS 'Preference to avoid highways for travel';