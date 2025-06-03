/*
  # Add Stripe Customers Table

  1. New Tables
    - `stripe_customers` - Links clients to Stripe customer IDs
      - `id` (uuid, primary key)
      - `client_id` (uuid, foreign key to clients)
      - `customer_id` (text, unique)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `stripe_customers` table
    - Add policy for admin users to view stripe customers
    - Add policy for admin users to manage stripe customers
  
  3. Triggers
    - Add trigger to update updated_at column
*/

-- Create stripe_customers table
CREATE TABLE IF NOT EXISTS stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id),
  UNIQUE(customer_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stripe_customers_client_id ON stripe_customers(client_id);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_customer_id ON stripe_customers(customer_id);

-- Enable Row Level Security
ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Stripe customers are viewable by admin"
  ON stripe_customers
  FOR SELECT
  TO authenticated
  USING (auth.user_has_role('admin'));

CREATE POLICY "Stripe customers can be managed by admin"
  ON stripe_customers
  FOR ALL
  TO authenticated
  USING (auth.user_has_role('admin'))
  WITH CHECK (auth.user_has_role('admin'));

-- Create trigger for updating updated_at column
CREATE TRIGGER update_stripe_customers_updated_at
  BEFORE UPDATE ON stripe_customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();