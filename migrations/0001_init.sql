-- CiteReady v0.2/v0.3 schema. Times are unix milliseconds.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '',
  google_sub    TEXT UNIQUE,
  plan          TEXT NOT NULL DEFAULT 'free',      -- free | plus | pro
  plan_until    INTEGER,                           -- null = no expiry (free) or managed by subscription
  plan_source   TEXT NOT NULL DEFAULT '',          -- paypal_sub | razorpay | manual
  launch_price  INTEGER NOT NULL DEFAULT 0,        -- 1 = locked $19 launch price
  report_credits INTEGER NOT NULL DEFAULT 0,
  brand_name    TEXT NOT NULL DEFAULT '',
  brand_color   TEXT NOT NULL DEFAULT '#2563EB',
  brand_logo    TEXT NOT NULL DEFAULT '',
  brand_footer  TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,                    -- sha256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  next        TEXT NOT NULL DEFAULT '/app',
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sites (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  host           TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  competitors    TEXT NOT NULL DEFAULT '[]',       -- JSON array of names/domains
  weekly         INTEGER NOT NULL DEFAULT 1,
  last_score     INTEGER,
  last_audit_at  INTEGER,
  last_ai_score  REAL,
  created_at     INTEGER NOT NULL,
  UNIQUE (user_id, url)
);
CREATE INDEX sites_user ON sites(user_id);
CREATE INDEX sites_due ON sites(weekly, last_audit_at);

CREATE TABLE audits (
  id          TEXT PRIMARY KEY,
  site_id     TEXT REFERENCES sites(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  trigger     TEXT NOT NULL DEFAULT 'manual',      -- manual | weekly | add
  result_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX audits_site ON audits(site_id, created_at);

CREATE TABLE ai_prompts (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  prompt      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX ai_prompts_site ON ai_prompts(site_id);

CREATE TABLE ai_checks (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id      TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  runs          INTEGER NOT NULL,
  mentioned     INTEGER NOT NULL,                  -- runs that mention the brand
  avg_position  REAL,                              -- 1 = first brand named
  competitors   TEXT NOT NULL DEFAULT '[]',        -- [{name, count}]
  sources       TEXT NOT NULL DEFAULT '[]',        -- URLs/domains cited
  answers       TEXT NOT NULL DEFAULT '[]',        -- raw answers (trimmed)
  created_at    INTEGER NOT NULL
);
CREATE INDEX ai_checks_site ON ai_checks(site_id, created_at);
CREATE INDEX ai_checks_batch ON ai_checks(batch_id);

CREATE TABLE usage (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,                       -- YYYY-MM
  ai_prompts  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,                     -- paypal | razorpay
  provider_ref  TEXT NOT NULL UNIQUE,              -- order/subscription/payment id
  kind          TEXT NOT NULL,                     -- subscription | report | pack
  plan          TEXT NOT NULL DEFAULT '',
  amount        INTEGER NOT NULL DEFAULT 0,        -- minor units
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL,                     -- created | paid | active | cancelled | failed
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX payments_user ON payments(user_id);

CREATE TABLE alerts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id     TEXT REFERENCES sites(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                       -- score_drop | new_failure | recovered
  message     TEXT NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX alerts_user ON alerts(user_id, read, created_at);
