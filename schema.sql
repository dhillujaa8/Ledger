-- ================================================================
--  Ledger — PostgreSQL Schema & Reference Queries
--  Run this file once to initialise the database:
--    psql -U postgres -d ledger_db -f schema.sql
-- ================================================================


-- ── 0. Database Setup ────────────────────────────────────────
-- Run these two lines manually in psql as a superuser first:
--   CREATE DATABASE ledger_db;
--   \c ledger_db


-- ── 1. Extensions ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()


-- ── 2. ENUM Types ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tx_type AS ENUM ('income', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. Categories Table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50)  NOT NULL UNIQUE,
  type       tx_type      NOT NULL,
  icon       VARCHAR(4)   NOT NULL DEFAULT '💰',
  color      VARCHAR(7)   NOT NULL DEFAULT '#C9A84C',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed categories
INSERT INTO categories (name, type, icon, color) VALUES
  ('Salary',        'income',  '💼', '#4CAF9A'),
  ('Freelance',     'income',  '🎨', '#6EC6A0'),
  ('Investments',   'income',  '📈', '#89D4AE'),
  ('Other Income',  'income',  '💰', '#A8DFC0'),
  ('Housing',       'expense', '🏠', '#C9A84C'),
  ('Food',          'expense', '🍽', '#D4B86A'),
  ('Transport',     'expense', '🚗', '#DCC88A'),
  ('Healthcare',    'expense', '⚕️', '#E3D4A0'),
  ('Shopping',      'expense', '🛍', '#C9A84C'),
  ('Entertainment', 'expense', '🎭', '#BF9B3A'),
  ('Utilities',     'expense', '⚡', '#B58E2A'),
  ('Education',     'expense', '📚', '#AA821A')
ON CONFLICT (name) DO NOTHING;


-- ── 4. Transactions Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          SERIAL        PRIMARY KEY,
  type        tx_type       NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description VARCHAR(255)  NOT NULL,
  category_id INTEGER       NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  tx_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for date-range queries and summaries
CREATE INDEX IF NOT EXISTS idx_tx_date       ON transactions(tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_type       ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_category   ON transactions(category_id);


-- ── 5. Seed Transactions (last 6 months) ────────────────────
INSERT INTO transactions (type, amount, description, category_id, tx_date) VALUES
  -- Month 0 (current)
  ('income',  5200.00, 'Monthly salary',           1, CURRENT_DATE - 2),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 3),
  ('expense',  240.50, 'Grocery run',               6, CURRENT_DATE - 4),
  ('expense',   89.00, 'Netflix & streaming',       10, CURRENT_DATE - 5),
  ('income',   650.00, 'UI design project',         2, CURRENT_DATE - 6),
  ('expense',  134.00, 'Electric & water bill',     11, CURRENT_DATE - 7),
  ('expense',   55.00, 'Bus pass',                  7, CURRENT_DATE - 8),

  -- Month -1
  ('income',  5200.00, 'Monthly salary',            1, CURRENT_DATE - 35),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 36),
  ('income',   420.00, 'Stock dividend',            3, CURRENT_DATE - 38),
  ('expense',  310.00, 'Doctor visit',              8, CURRENT_DATE - 40),
  ('expense',  195.00, 'Online shopping',           9, CURRENT_DATE - 42),
  ('expense',   72.00, 'Dinner out',                6, CURRENT_DATE - 45),

  -- Month -2
  ('income',  5200.00, 'Monthly salary',            1, CURRENT_DATE - 65),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 66),
  ('income',   800.00, 'Freelance logo design',     2, CURRENT_DATE - 68),
  ('expense',  450.00, 'New shoes & clothes',       9, CURRENT_DATE - 70),
  ('expense',  120.00, 'Gym membership',            10, CURRENT_DATE - 72),
  ('expense',  280.00, 'Car insurance',             7, CURRENT_DATE - 74),

  -- Month -3
  ('income',  5200.00, 'Monthly salary',            1, CURRENT_DATE - 95),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 96),
  ('income',   950.00, 'Consulting work',           2, CURRENT_DATE - 98),
  ('expense',  600.00, 'Online course bundle',      12, CURRENT_DATE - 100),
  ('expense',  210.00, 'Groceries & snacks',        6, CURRENT_DATE - 102),

  -- Month -4
  ('income',  5200.00, 'Monthly salary',            1, CURRENT_DATE - 125),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 126),
  ('expense',  750.00, 'Car repair',                7, CURRENT_DATE - 128),
  ('income',   300.00, 'Sold old laptop',           4, CURRENT_DATE - 130),
  ('expense',  145.00, 'Pharmacy',                  8, CURRENT_DATE - 132),

  -- Month -5
  ('income',  5200.00, 'Monthly salary',            1, CURRENT_DATE - 155),
  ('expense',  980.00, 'Rent payment',              5, CURRENT_DATE - 156),
  ('income',   500.00, 'Side project payment',      2, CURRENT_DATE - 158),
  ('expense',  320.00, 'Concert tickets',           10, CURRENT_DATE - 160),
  ('expense',  175.00, 'Groceries',                 6, CURRENT_DATE - 162)
ON CONFLICT DO NOTHING;


-- ================================================================
--  REFERENCE QUERIES  (used by server.js via pg pool)
-- ================================================================

-- ── A. GET all transactions (paginated, newest first) ─────────
/*
SELECT
  t.id, t.type, t.amount, t.description, t.tx_date, t.note,
  c.name  AS category,
  c.icon  AS category_icon,
  c.color AS category_color
FROM transactions t
JOIN categories c ON c.id = t.category_id
ORDER BY t.tx_date DESC, t.created_at DESC
LIMIT $1 OFFSET $2;
*/

-- ── B. GET single transaction ─────────────────────────────────
/*
SELECT t.*, c.name AS category, c.icon, c.color
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.id = $1;
*/

-- ── C. CREATE transaction ─────────────────────────────────────
/*
INSERT INTO transactions (type, amount, description, category_id, tx_date, note)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
*/

-- ── D. UPDATE transaction ─────────────────────────────────────
/*
UPDATE transactions
SET type=$1, amount=$2, description=$3, category_id=$4, tx_date=$5, note=$6
WHERE id=$7
RETURNING *;
*/

-- ── E. DELETE transaction ─────────────────────────────────────
/*
DELETE FROM transactions WHERE id=$1 RETURNING id;
*/

-- ── F. SUMMARY — balances + category breakdown + monthly chart ─
/*
WITH totals AS (
  SELECT
    SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS total_income,
    SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS total_expense
  FROM transactions
),
by_category AS (
  SELECT
    c.name, c.icon, c.color, t.type,
    SUM(t.amount) AS total
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  GROUP BY c.name, c.icon, c.color, t.type
  ORDER BY total DESC
),
monthly AS (
  SELECT
    TO_CHAR(DATE_TRUNC('month', tx_date), 'Mon YYYY') AS month,
    DATE_TRUNC('month', tx_date)                       AS month_start,
    SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS income,
    SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
  FROM transactions
  WHERE tx_date >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
  GROUP BY month, month_start
  ORDER BY month_start
)
SELECT
  (SELECT row_to_json(totals) FROM totals)        AS balances,
  (SELECT json_agg(by_category) FROM by_category) AS categories,
  (SELECT json_agg(monthly)     FROM monthly)      AS monthly;
*/

-- ── G. GET all categories ─────────────────────────────────────
/*
SELECT id, name, type, icon, color FROM categories ORDER BY type, name;
*/
