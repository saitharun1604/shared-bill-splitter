-- Migration: 0001_init.sql
-- Initial schema for Shared Bill Splitter

CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT chk_homes_name CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT uq_members_home_position UNIQUE (home_id, position),
  CONSTRAINT chk_members_name CHECK (length(trim(name)) > 0),
  CONSTRAINT chk_members_position CHECK (position >= 0)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT chk_bills_title CHECK (length(trim(title)) > 0),
  CONSTRAINT chk_bills_total_cents CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT uq_shares_bill_member UNIQUE (bill_id, member_id),
  CONSTRAINT chk_shares_amount_cents CHECK (amount_cents >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_payments_share FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
  CONSTRAINT uq_payments_share UNIQUE (share_id),
  CONSTRAINT chk_payments_key CHECK (length(trim(idempotency_key)) > 0)
);

-- Performance indexes for foreign keys and ordering
CREATE INDEX IF NOT EXISTS idx_members_home_position ON members (home_id, position);
CREATE INDEX IF NOT EXISTS idx_bills_home ON bills (home_id);
CREATE INDEX IF NOT EXISTS idx_shares_bill ON shares (bill_id);
CREATE INDEX IF NOT EXISTS idx_shares_member ON shares (member_id);
CREATE INDEX IF NOT EXISTS idx_payments_share ON payments (share_id);

