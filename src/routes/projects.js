import express from "express";
import { pool } from "../db/connection.js";
import { logActivity } from "../utils/logger.js";

const router = express.Router();

/* =========================================================
   📊 Summary for Dashboard & Active Projects
========================================================= */

// 🟢 1. Active Projects Summary
router.get("/active/summary", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status ILIKE 'active' OR status ILIKE 'running') AS active_count,
        COUNT(*) FILTER (WHERE status ILIKE 'upcoming') AS upcoming_count,
        COUNT(*) FILTER (WHERE status ILIKE 'completed') AS completed_count,
        COUNT(*) AS total_projects
      FROM projects
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error fetching active projects summary:", error.message);
    res.status(500).json({ message: "Failed to load project summary" });
  }
});

// 📈 2. Full Dashboard Summary (projects + staff + attendance + payroll)
router.get("/dashboard/summary", async (_req, res) => {
  try {
    const [projects, staff, attendance, payroll] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status ILIKE 'active' OR status ILIKE 'running') AS active_projects,
          COUNT(*) FILTER (WHERE status ILIKE 'upcoming') AS upcoming_projects,
          COUNT(*) FILTER (WHERE status ILIKE 'completed') AS completed_projects
        FROM projects
      `),
      pool.query(`SELECT COUNT(*)::int AS total_staff FROM staff`),
      pool.query(`SELECT COUNT(*)::int AS attendance_7d 
                  FROM attendance 
                  WHERE timestamp >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COALESCE(SUM(total_amount),0)::numeric AS payroll_this_month 
                  FROM payroll 
                  WHERE created_at >= date_trunc('month', NOW()) 
                  AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'`),
    ]);

    res.json({
      active_projects: Number(projects.rows[0]?.active_projects || 0),
      upcoming_projects: Number(projects.rows[0]?.upcoming_projects || 0),
      completed_projects: Number(projects.rows[0]?.completed_projects || 0),
      total_staff: staff.rows[0]?.total_staff || 0,
      attendance_7d: attendance.rows[0]?.attendance_7d || 0,
      payroll_this_month: Number(payroll.rows[0]?.payroll_this_month || 0),
    });
  } catch (error) {
    console.error("❌ Error loading dashboard summary:", error.message);
    res.status(500).json({ message: "Failed to load dashboard summary" });
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
    const result = await pool.query("SELECT * FROM projects WHERE id=$1", [
      req.params.id,
    ]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch project" });
  }
});

// إنشاء مشروع (يدعم camelCase أو snake_case)
router.post("/", async (req, res) => {
  const body = req.body;

  const name = body.name;
  const description = body.description;
  const location_lat = body.location_lat ?? body.locationLat ?? null;
  const location_lng = body.location_lng ?? body.locationLng ?? null;
  const radius = body.radius ?? 200;
  const start_date = body.start_date ?? body.startDate ?? null;
  const end_date = body.end_date ?? body.endDate ?? null;
  const pay_type = body.pay_type ?? body.payType ?? null;
  const pay_rate = body.pay_rate ?? body.payRate ?? 0;
  const allowances = body.allowances ?? 0;
  const supervisor_id = body.supervisor_id ?? body.supervisorId ?? null;

  try {
    const result = await pool.query(
      `INSERT INTO projects (
        name, description, location_lat, location_lng, radius,
        start_date, end_date, pay_type, pay_rate, allowances, supervisor_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
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
    console.error("❌ Failed to create project:", error.message);
    res.status(500).json({ message: "Failed to create project" });
  }
});

/* =========================================================
   📊 Single Project Summary
========================================================= */
router.get("/:id/summary", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id))
    return res.status(400).json({ message: "Invalid id" });

  try {
    const [team, att, pay, docs] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT user_id)::int AS c 
         FROM project_assignments 
         WHERE project_id=$1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c 
         FROM attendance 
         WHERE project_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'`,
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
        `SELECT COUNT(*)::int AS c 
         FROM contracts 
         WHERE project_id=$1`,
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

export default router;
