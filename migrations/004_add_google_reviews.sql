ALTER TABLE tags ADD COLUMN IF NOT EXISTS google_place_id TEXT;

CREATE TABLE IF NOT EXISTS google_reviews_history (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES tags(code) ON DELETE CASCADE,
  rating NUMERIC(3,2),
  user_ratings_total INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_latest_reviews (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES tags(code) ON DELETE CASCADE,
  author_name TEXT,
  profile_photo_url TEXT,
  rating INTEGER,
  text TEXT,
  time INTEGER
);

CREATE INDEX IF NOT EXISTS idx_grh_code ON google_reviews_history(code);
CREATE INDEX IF NOT EXISTS idx_glr_code ON google_latest_reviews(code);
