// ================================================================
//  Ledger — Express Server  (Node.js + Express + PostgreSQL)
//  Endpoints:
//    GET    /api/transactions          list (paginated)
//    POST   /api/transactions          create
//    PUT    /api/transactions/:id      update
//    DELETE /api/transactions/:id      delete
//    GET    /api/summary               balances + chart + categories
//    GET    /api/categories            list all categories
// ================================================================

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── PostgreSQL Connection Pool ───────────────────────────────
const pool = new Pool({
  host:     process.env.PG_HOST     || "localhost",
  port:     parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DATABASE || "ledger_db",
  user:     process.env.PG_USER     || "postgres",
  password: process.env.PG_PASSWORD || "",
  max:      10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

// Test connection on startup
pool.query("SELECT NOW()").then(() => {
  console.log("  ✓ PostgreSQL connected");
}).catch((e) => {
  console.warn("  ✗ PostgreSQL unavailable — check .env:", e.message);
});

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}]  ${req.method.padEnd(7)} ${req.path}`);
  next();
});

// ── Response Helpers ─────────────────────────────────────────
const ok   = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const fail = (res, msg,  status = 400) => res.status(status).json({ ok: false, error: msg });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ── Validation ───────────────────────────────────────────────
function validateTransaction(body) {
  const { type, amount, description, category_id, tx_date } = body;
  if (!["income", "expense"].includes(type))        return "type must be 'income' or 'expense'.";
  if (!amount || isNaN(amount) || Number(amount) <= 0) return "amount must be a positive number.";
  if (!description?.trim())                         return "description is required.";
  if (!category_id || isNaN(category_id))           return "category_id must be a valid integer.";
  if (!tx_date || isNaN(Date.parse(tx_date)))       return "tx_date must be a valid date (YYYY-MM-DD).";
  return null;
}

// ── Routes ───────────────────────────────────────────────────

// GET /api/categories
app.get("/api/categories", asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, type, icon, color FROM categories ORDER BY type, name"
  );
  ok(res, rows);
}));

// GET /api/summary
app.get("/api/summary", asyncHandler(async (_req, res) => {
  const sql = `
    WITH totals AS (
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expense
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
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions
      WHERE tx_date >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
      GROUP BY month, month_start
      ORDER BY month_start
    )
    SELECT
      (SELECT row_to_json(totals) FROM totals)        AS balances,
      (SELECT json_agg(by_category) FROM by_category) AS categories,
      (SELECT json_agg(monthly)     FROM monthly)      AS monthly
  `;
  const { rows } = await pool.query(sql);
  const r = rows[0];
  ok(res, {
    balances:   r.balances,
    categories: r.categories || [],
    monthly:    r.monthly    || [],
  });
}));

// GET /api/transactions?limit=50&offset=0
app.get("/api/transactions", asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "50", 10), 200);
  const offset = Math.max(parseInt(req.query.offset || "0",  10), 0);

  const { rows } = await pool.query(`
    SELECT
      t.id, t.type, t.amount::float AS amount,
      t.description, t.tx_date, t.note,
      c.name  AS category,
      c.icon  AS category_icon,
      c.color AS category_color,
      t.created_at
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    ORDER BY t.tx_date DESC, t.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*)::int AS count FROM transactions");
  ok(res, { items: rows, total: count, limit, offset });
}));

// GET /api/transactions/:id
app.get("/api/transactions/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(`
    SELECT t.*, t.amount::float AS amount,
           c.name AS category, c.icon, c.color
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.id = $1
  `, [id]);
  if (!rows.length) return fail(res, "Transaction not found.", 404);
  ok(res, rows[0]);
}));

// POST /api/transactions
app.post("/api/transactions", asyncHandler(async (req, res) => {
  const err = validateTransaction(req.body);
  if (err) return fail(res, err);

  const { type, amount, description, category_id, tx_date, note } = req.body;
  const { rows } = await pool.query(`
    INSERT INTO transactions (type, amount, description, category_id, tx_date, note)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *, amount::float AS amount
  `, [type, Number(amount), description.trim(), parseInt(category_id), tx_date, note || null]);

  ok(res, rows[0], 201);
}));

// PUT /api/transactions/:id
app.put("/api/transactions/:id", asyncHandler(async (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const err = validateTransaction(req.body);
  if (err) return fail(res, err);

  const { type, amount, description, category_id, tx_date, note } = req.body;
  const { rows } = await pool.query(`
    UPDATE transactions
    SET type=$1, amount=$2, description=$3, category_id=$4, tx_date=$5, note=$6
    WHERE id=$7
    RETURNING *, amount::float AS amount
  `, [type, Number(amount), description.trim(), parseInt(category_id), tx_date, note || null, id]);

  if (!rows.length) return fail(res, "Transaction not found.", 404);
  ok(res, rows[0]);
}));

// DELETE /api/transactions/:id
app.delete("/api/transactions/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    "DELETE FROM transactions WHERE id=$1 RETURNING id", [id]
  );
  if (!rows.length) return fail(res, "Transaction not found.", 404);
  ok(res, { id: rows[0].id });
}));

// ── Error Handler ────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  if (err.code === "23503") return fail(res, "Referenced category does not exist.", 400);
  if (err.code === "23514") return fail(res, "Amount must be greater than zero.",   400);
  fail(res, "Internal server error.", 500);
});

// ── Catch-all SPA ────────────────────────────────────────────
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════╗
  ║  LEDGER  running on :${PORT}          ║
  ║  http://localhost:${PORT}             ║
  ╚════════════════════════════════════╝
  `);
});

module.exports = app;
