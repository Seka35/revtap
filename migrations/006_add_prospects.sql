CREATE TABLE IF NOT EXISTS prospects (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'to_visit',
  next_action_date DATE,
  notes TEXT,
  assigned_card_code TEXT REFERENCES tags(code) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
