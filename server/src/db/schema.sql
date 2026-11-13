CREATE TABLE IF NOT EXISTS kv (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          serial PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  duration_s  double precision NOT NULL,
  samples     jsonb NOT NULL,
  audio_path  text,
  waveform    jsonb
);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_path text;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS waveform jsonb;
