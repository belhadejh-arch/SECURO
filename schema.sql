CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(160) NOT NULL,
  referral_code VARCHAR(12) NOT NULL UNIQUE,
  referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  user_vip JSONB,
  vip_expires_at TIMESTAMPTZ,
  completed_tasks_count INTEGER NOT NULL DEFAULT 0,
  task_last_reset_date DATE,
  last_claim_date DATE,
  current_trial_day INTEGER NOT NULL DEFAULT 1,
  trial_tasks_completed INTEGER NOT NULL DEFAULT 0,
  trial_active BOOLEAN NOT NULL DEFAULT FALSE,
  trial_used BOOLEAN NOT NULL DEFAULT FALSE,
  available_spins INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vip_expires_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS available_spins INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_tasks_completed INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_referred_by_not_self'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_referred_by_not_self
      CHECK (referred_by IS NULL OR referred_by <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users(referred_by);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 10),
  txid VARCHAR(255) NOT NULL UNIQUE,
  network VARCHAR(32) NOT NULL DEFAULT 'USDT TRC20',
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deposit_requests_status_idx
  ON deposit_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank VARCHAR(32) NOT NULL,
  account VARCHAR(255) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 10),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx
  ON withdrawal_requests(status, created_at DESC);

-- Backfill reservations for requests created before reserved_balance existed.
UPDATE users u
SET reserved_balance = pending.amount
FROM (
  SELECT user_id, COALESCE(SUM(amount), 0) AS amount
  FROM withdrawal_requests
  WHERE status = 'pending'
  GROUP BY user_id
) pending
WHERE u.id = pending.user_id;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('credit', 'debit')),
  description VARCHAR(255) NOT NULL,
  reference_type VARCHAR(32),
  reference_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_user_idx
  ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_not_self CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id BIGSERIAL PRIMARY KEY,
  beneficiary_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deposit_request_id BIGINT NOT NULL REFERENCES deposit_requests(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  rate NUMERIC(5, 4) NOT NULL CHECK (rate > 0 AND rate <= 1),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (beneficiary_id, deposit_request_id, level)
);

CREATE INDEX IF NOT EXISTS referral_commissions_beneficiary_idx
  ON referral_commissions(beneficiary_id, created_at DESC);

-- Server-owned task attempts prevent the browser from inventing completions,
-- changing the reward, or claiming the same task more than once per day.
CREATE TABLE IF NOT EXISTS task_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_day DATE NOT NULL,
  task_index INTEGER NOT NULL CHECK (task_index >= 0),
  comment TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, task_day, task_index)
);

ALTER TABLE task_attempts
  ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS task_attempts_user_day_idx
  ON task_attempts(user_id, task_day, task_index);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_task_attempt_unique
  ON transactions(user_id, reference_type, reference_id)
  WHERE reference_type = 'task_attempt' AND reference_id IS NOT NULL;