import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

/* =========================================================
   1️⃣ /dashboard/stats — إحصائيات عامة
========================================================= */
router.get("/stats", async (_req, res) => {
  try {
    const [projects, users, attendance] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM projects`),
      pool.query(`SELECT COUNT(*)::int AS c FROM users`),
      pool.query(`SELECT COUNT(*)::int AS c FROM attendance WHERE timestamp >= NOW() - INTERVAL '7 days'`),
    ]);

    res.json({
      projects: projects.rows[0].c,
      users: users.rows[0].c,
      attendance: attendance.rows[0].c,
    });
  } catch (error) {
    console.error("❌ Failed to load dashboard stats:", error.message);
    res.status(500).json({ message: "Failed to load dashboard stats" });
  }
});

/* =========================================================
   2️⃣ /dashboard/hr/monthly — ملخص الرواتب الشهرية
========================================================= */
router.get("/hr/monthly", async (req, res) => {
  const { month, project_id } = req.query;
  const monthStr = /^\d{4}-\d{2}$/.test(month)
    ? month
    : new Date().toISOString().slice(0, 7);

  const start = `${monthStr}-01`;
  const end = `${monthStr}-31`;

  try {
    // الإجمالي الشهري
    const totals = await pool.query(
      `
      SELECT 
        COALESCE(SUM(total_amount),0)::numeric AS total,
        COALESCE(SUM(CASE WHEN status='approved' THEN total_amount ELSE 0 END),0)::numeric AS approved_total,
        COALESCE(SUM(CASE WHEN status='pending' THEN total_amount ELSE 0 END),0)::numeric AS pending_total
      FROM payroll
      WHERE created_at BETWEEN $1 AND $2
      ${project_id ? "AND project_id = $3" : ""}
    `,
      project_id ? [start, end, project_id] : [start, end]
    );

    // التوزيع اليومي
    const daily = await pool.query(
      `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(total_amount),0)::numeric AS total
      FROM payroll
      WHERE created_at BETWEEN $1 AND $2
      ${project_id ? "AND project_id = $3" : ""}
      GROUP BY 1 ORDER BY 1
    `,
      project_id ? [start, end, project_id] : [start, end]
    );

    // حسب المشروع
    const byProject = await pool.query(
      `
      SELECT 
        p.name, 
        COALESCE(SUM(pay.total_amount),0)::numeric AS total
      FROM payroll pay
      JOIN projects p ON p.id = pay.project_id
      WHERE pay.created_at BETWEEN $1 AND $2
      GROUP BY p.id, p.name
      ORDER BY total DESC
      LIMIT 10
    `,
      [start, end]
    );

    res.json({
      totals: totals.rows[0],
      daily: daily.rows,
      byProject: byProject.rows,
    });
  } catch (error) {
    console.error("❌ Failed to load HR monthly:", error.message);
    res.status(500).json({ message: "Failed to load HR summary" });
  }
});

/* =========================================================
   3️⃣ /dashboard/users/roles — توزيع الموظفين حسب الدور
========================================================= */
router.get("/users/roles", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT role, COUNT(*)::int AS count
      FROM users
      GROUP BY role
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Failed to load user roles:", error.message);
    res.status(500).json({ message: "Failed to load user roles" });
  }
});

export default router;
