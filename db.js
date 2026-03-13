// ============================================================
//  Taskr — In-Memory Database
//  Simulates a real DB with seed data, CRUD helpers, and stats
// ============================================================

let todos = [
  { id: 1, text: "Design system architecture", priority: "high",   done: false, createdAt: Date.now() - 86400000 },
  { id: 2, text: "Write API documentation",   priority: "medium", done: false, createdAt: Date.now() - 72000000 },
  { id: 3, text: "Set up CI/CD pipeline",     priority: "high",   done: true,  createdAt: Date.now() - 50000000 },
  { id: 4, text: "Code review for PR #42",    priority: "medium", done: false, createdAt: Date.now() - 36000000 },
  { id: 5, text: "Update dependencies",       priority: "low",    done: true,  createdAt: Date.now() - 10000000 },
];

let nextId = 6;

// ── Read ────────────────────────────────────────────────────
const getAll = () => [...todos].sort((a, b) => b.createdAt - a.createdAt);

const getById = (id) => todos.find((t) => t.id === id) || null;

// ── Create ──────────────────────────────────────────────────
const create = ({ text, priority = "medium" }) => {
  const VALID = ["high", "medium", "low"];
  if (!text || typeof text !== "string" || !text.trim())
    throw new Error("Task text is required.");
  if (!VALID.includes(priority))
    throw new Error(`Priority must be one of: ${VALID.join(", ")}.`);

  const todo = {
    id:        nextId++,
    text:      text.trim(),
    priority,
    done:      false,
    createdAt: Date.now(),
  };
  todos.push(todo);
  return todo;
};

// ── Update ──────────────────────────────────────────────────
const update = (id, patches) => {
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const ALLOWED = ["text", "priority", "done"];
  const clean   = {};
  for (const key of ALLOWED) {
    if (key in patches) clean[key] = patches[key];
  }
  todos[idx] = { ...todos[idx], ...clean };
  return todos[idx];
};

// ── Delete ──────────────────────────────────────────────────
const remove = (id) => {
  const idx = todos.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  todos.splice(idx, 1);
  return true;
};

// ── Stats ───────────────────────────────────────────────────
const stats = () => ({
  total:    todos.length,
  active:   todos.filter((t) => !t.done).length,
  done:     todos.filter((t) =>  t.done).length,
  high:     todos.filter((t) => t.priority === "high"   && !t.done).length,
  medium:   todos.filter((t) => t.priority === "medium" && !t.done).length,
  low:      todos.filter((t) => t.priority === "low"    && !t.done).length,
});

module.exports = { getAll, getById, create, update, remove, stats };
