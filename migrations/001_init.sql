CREATE TABLE IF NOT EXISTS tags (
  code TEXT PRIMARY KEY,
  business_name TEXT,
  review_url TEXT,
  notes TEXT,
  price_paid INTEGER,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES tags(code) ON DELETE CASCADE,
  source TEXT, -- 'nfc' or 'qr' or null if unknown
  user_agent TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scans_code ON scans(code);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at);
