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

/* =========================================================
   ✅ Active projects summary (for dashboard widget)
   📍 لازم يكون قبل أي Route فيه :id
========================================================= */
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
    console.error("❌ Failed to fetch active projects summary:", error.message);
    res.status(500).json({ message: "Failed to fetch active projects summary" });
  }
});

/* =========================================================
   📋 Projects CRUD
========================================================= */

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
    const result = await pool.query("SELECT * FROM projects WHERE id=$1", [req.params.id]);
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

/* =========================================================
   Extra endpoints for Operations Layer (Phase 3)
========================================================= */

// Summary for a single project: team, attendance, payroll, docs
router.get("/:id/summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const [team, att, pay, docs] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT user_id)::int AS c FROM project_assignments WHERE project_id=$1`, [id]),
      pool.query(`SELECT COUNT(*)::int AS c FROM attendance WHERE project_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'`, [id]),
      pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM payroll WHERE project_id=$1 AND created_at >= date_trunc('month', NOW()) AND created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')`, [id]),
      pool.query(`SELECT COUNT(*)::int AS c FROM contracts WHERE project_id=$1`, [id]),
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

// باقي الأكواد كما هي (assignments, logs, docs, expenses ...)

export default router;
