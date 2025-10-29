import express from "express";
import { pool } from "../db/connection.js";
import { logActivity } from "../utils/logger.js";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();
const uploadsRoot = path.resolve("uploads");
const uploadsProjects = path.join(uploadsRoot, "projects");
if (!fs.existsSync(uploadsProjects)) {
  try { fs.mkdirSync(uploadsProjects, { recursive: true }); } catch {}
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsProjects),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "file", ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// كل المشاريع
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM projects ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch projects" });
  }
});

// مشروع واحد
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM projects WHERE id=$1", [
      req.params.id,
    ]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch project" });
  }
});

// إنشاء مشروع
router.post("/", async (req, res) => {
  const {
    name,
    description,
    location_lat,
    location_lng,
    radius,
    start_date,
    end_date,
    pay_type,
    pay_rate,
    allowances,
    supervisor_id,
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO projects (name, description, location_lat, location_lng, radius, start_date, end_date, pay_type, pay_rate, allowances, supervisor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        name,
        description,
        location_lat,
        location_lng,
        radius,
        start_date,
        end_date,
        pay_type,
        pay_rate,
        allowances,
        supervisor_id,
      ]
    );
    const project = result.rows[0];
    res.status(201).json(project);
    await logActivity({
      userId: req.user?.id ?? null,
      action: "PROJECT_CREATED",
      entityType: "project",
      entityId: project?.id ?? null,
      details: project?.name ? `Created project ${project.name}` : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to create project" });
  }
});

export default router;
 
/* =========================================================
   Extra endpoints for Operations Layer (Phase 3)
========================================================= */
// Summary for a single project: team, attendance last 7 days, monthly payroll, docs
router.get("/:id/summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const [team, att, pay, docs] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT user_id)::int AS c FROM project_assignments WHERE project_id=$1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM attendance WHERE project_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'`,
        [id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_amount),0)::numeric AS total
         FROM payroll
         WHERE project_id=$1
           AND created_at >= date_trunc('month', NOW())
           AND created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM contracts WHERE project_id=$1`,
        [id]
      ),
    ]);

    res.json({
      team_count: team.rows[0]?.c ?? 0,
      attendance_last7: att.rows[0]?.c ?? 0,
      payroll_month_total: Number(pay.rows[0]?.total ?? 0),
      docs_count: docs.rows[0]?.c ?? 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to summarize project" });
  }
});

// Team assignments for a project
router.get("/:id/assignments", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const result = await pool.query(
      `SELECT pa.id, pa.user_id, u.name, u.email, pa.role_in_project, pa.start_date, pa.end_date
       FROM project_assignments pa
       JOIN users u ON u.id = pa.user_id
       WHERE pa.project_id = $1
       ORDER BY pa.start_date DESC NULLS LAST, pa.id DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});

// Logs endpoints
router.get("/:id/logs", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  const range = String(req.query.range || "").toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const interval = range === "today" || range === "24h" ? "1 day" : range === "7d" || range === "week" ? "7 days" : range === "30d" || range === "month" ? "30 days" : null;
  const whereInterval = interval ? ` AND created_at >= NOW() - INTERVAL '${interval}'` : "";
  try {
    const result = await pool.query(
      `SELECT id, user_id, content, photos, created_at
       FROM project_logs
       WHERE project_id=$1${whereInterval}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

router.post("/:id/logs", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  const { content, photos } = req.body || {};
  if (!content || !content.toString().trim()) {
    return res.status(400).json({ message: "Content is required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO project_logs (project_id, user_id, content, photos)
       VALUES ($1,$2,$3,$4)
       RETURNING id, user_id, content, photos, created_at`,
      [id, req.user?.id ?? null, content.toString().trim(), Array.isArray(photos) ? photos : null]
    );
    await logActivity({
      userId: req.user?.id || null,
      action: "PROJECT_LOG_CREATED",
      entityType: "project",
      entityId: id,
      details: `Log added to project #${id}`,
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create log" });
  }
});

// Active projects summary (for dashboard widget)
router.get("/active/summary", async (_req, res) => {
  try {
    const running = await pool.query(
      `SELECT COUNT(*)::int AS c FROM projects WHERE status ILIKE 'active' OR status ILIKE 'running'`
    );
    const assigned = await pool.query(
      `SELECT COUNT(DISTINCT pa.user_id)::int AS c
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE p.status ILIKE 'active' OR p.status ILIKE 'running'`
    );
    res.json({
      runningProjects: running.rows[0]?.c ?? 0,
      totalStaffAssigned: assigned.rows[0]?.c ?? 0,
      pendingTasks: 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch active projects summary" });
  }
});

/* =========================================================
   Documents endpoints (Docs tab)
========================================================= */
// List documents for project
router.get("/:id/docs", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const result = await pool.query(
      `SELECT pd.id, pd.project_id, pd.file_url, pd.file_name, pd.uploaded_by, pd.created_at,
              u.name AS uploader
       FROM project_documents pd
       LEFT JOIN users u ON u.id = pd.uploaded_by
       WHERE pd.project_id=$1
       ORDER BY pd.created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// Upload a new document
router.post("/:id/docs", upload.single("file"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    if (!req.file) return res.status(400).json({ message: "Missing file" });
    const fileUrl = `/uploads/projects/${req.file.filename}`;
    const fileName = req.body?.file_name || req.file.originalname || req.file.filename;
    const result = await pool.query(
      `INSERT INTO project_documents (project_id, file_url, file_name, uploaded_by)
       VALUES ($1,$2,$3,$4)
       RETURNING id, project_id, file_url, file_name, uploaded_by, created_at`,
      [id, fileUrl, fileName, req.user?.id ?? null]
    );
    await logActivity({
      userId: req.user?.id || null,
      action: "PROJECT_DOC_UPLOADED",
      entityType: "project",
      entityId: id,
      details: fileName,
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to upload document" });
  }
});

// Delete a document by id
router.delete("/docs/:docId", async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (!Number.isFinite(docId)) return res.status(400).json({ message: "Invalid id" });
  try {
    const found = await pool.query(
      `SELECT id, project_id, file_url, file_name FROM project_documents WHERE id=$1`,
      [docId]
    );
    if (!found.rowCount) return res.status(404).json({ message: "Document not found" });
    const doc = found.rows[0];
    // Try to unlink local file if inside uploads
    if (doc.file_url?.startsWith("/uploads/")) {
      const abs = path.join(uploadsRoot, doc.file_url.replace("/uploads/", ""));
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
    }
    await pool.query(`DELETE FROM project_documents WHERE id=$1`, [docId]);
    await logActivity({
      userId: req.user?.id || null,
      action: "PROJECT_DOC_DELETED",
      entityType: "project",
      entityId: doc.project_id,
      details: doc.file_name,
    });
    res.json({ message: "Document deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete document" });
  }
});

/* =========================================================
   Expenses endpoints (Finance tab)
========================================================= */
// List expenses for a project
router.get("/:id/expenses", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const result = await pool.query(
      `SELECT id, project_id, category, amount::numeric, notes, receipt_url, created_by, created_at
       FROM project_expenses
       WHERE project_id=$1
       ORDER BY created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
});

// Create expense (multipart optional: receipt)
router.post("/:id/expenses", upload.single("receipt"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  const { category, amount, notes } = req.body || {};
  if (!amount) return res.status(400).json({ message: "Amount is required" });
  try {
    const receiptUrl = req.file ? `/uploads/projects/${req.file.filename}` : null;
    const result = await pool.query(
      `INSERT INTO project_expenses (project_id, category, amount, notes, receipt_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, project_id, category, amount::numeric, notes, receipt_url, created_by, created_at`,
      [id, category || null, amount, notes || null, receiptUrl, req.user?.id ?? null]
    );
    await logActivity({
      userId: req.user?.id || null,
      action: "PROJECT_EXPENSE_CREATED",
      entityType: "project",
      entityId: id,
      details: `${category || 'expense'}: ${amount}`,
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create expense" });
  }
});

// Delete expense
router.delete("/expenses/:expenseId", async (req, res) => {
  const expenseId = parseInt(req.params.expenseId, 10);
  if (!Number.isFinite(expenseId)) return res.status(400).json({ message: "Invalid id" });
  try {
    const found = await pool.query(`SELECT receipt_url FROM project_expenses WHERE id=$1`, [expenseId]);
    if (!found.rowCount) return res.status(404).json({ message: "Expense not found" });
    const receipt = found.rows[0].receipt_url;
    if (receipt?.startsWith('/uploads/')) {
      const abs = path.join(uploadsRoot, receipt.replace('/uploads/', ''));
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
    }
    await pool.query(`DELETE FROM project_expenses WHERE id=$1`, [expenseId]);
    res.json({ message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete expense" });
  }
});

// Finance summary for project/month
router.get("/:id/finance/summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  const m = String(req.query.month || "");
  const ok = /^\d{4}-\d{2}$/.test(m);
  const now = new Date();
  const y = ok ? parseInt(m.slice(0,4)) : now.getFullYear();
  const mo = ok ? parseInt(m.slice(5,7)) : now.getMonth()+1;
  const start = new Date(y, mo-1, 1);
  const end = new Date(y, mo, 1);
  try {
    const exp = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM project_expenses WHERE project_id=$1 AND created_at >= $2 AND created_at < $3`,
      [id, start, end]
    );
    const pay = await pool.query(
      `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM payroll WHERE project_id=$1 AND created_at >= $2 AND created_at < $3`,
      [id, start, end]
    );
    res.json({
      month: `${y}-${String(mo).padStart(2,'0')}`,
      total_expenses: Number(exp.rows[0]?.total || 0),
      payroll_month_total: Number(pay.rows[0]?.total || 0),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to summarize finance' });
  }
});

/* =========================================================
   Logs upload photos (multipart)
========================================================= */
router.post("/:id/logs/upload", upload.array("photos", 8), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  const content = (req.body?.content || "").toString().trim();
  if (!content) return res.status(400).json({ message: "Content is required" });
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const urls = files.map((f) => `/uploads/projects/${f.filename}`);
    const result = await pool.query(
      `INSERT INTO project_logs (project_id, user_id, content, photos)
       VALUES ($1,$2,$3,$4)
       RETURNING id, user_id, content, photos, created_at`,
      [id, req.user?.id ?? null, content, urls]
    );
    await logActivity({
      userId: req.user?.id || null,
      action: "PROJECT_LOG_CREATED",
      entityType: "project",
      entityId: id,
      details: `Log with ${urls.length} photo(s)`,
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create log with photos" });
  }
});
