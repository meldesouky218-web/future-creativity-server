import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

// عدادات عامة للوحة التحكم
router.get("/stats", async (_req, res) => {
  try {
    const users = await pool.query("SELECT COUNT(*)::int AS c FROM users");
    const projects = await pool.query("SELECT COUNT(*)::int AS c FROM projects");
    const attendance = await pool.query(
      "SELECT COUNT(*)::int AS c FROM attendance"
    );
    res.json({
      users: users.rows[0].c,
      projects: projects.rows[0].c,
      attendance: attendance.rows[0].c,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// نفقات الموارد البشرية للشهر المختار (اعتمادًا على جدول payroll)
router.get("/hr/monthly", async (req, res) => {
  try {
    // month بالشكل YYYY-MM
    const month = (req.query.month || "").toString();
    const now = new Date();
    const [y, m] = month.match(/^\d{4}-\d{2}$/)
      ? month.split("-").map((v) => parseInt(v, 10))
      : [now.getFullYear(), now.getMonth() + 1];

    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const totalsQuery = `
      SELECT
        COALESCE(SUM(total_amount),0)::numeric AS total,
        COALESCE(SUM(CASE WHEN approved THEN total_amount ELSE 0 END),0)::numeric AS approved_total,
        COALESCE(SUM(CASE WHEN NOT approved THEN total_amount ELSE 0 END),0)::numeric AS pending_total
      FROM payroll
      WHERE created_at >= $1 AND created_at < $2%s;
    `;

    const dailyQuery = `
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(total_amount),0)::numeric AS total
      FROM payroll
      WHERE created_at >= $1 AND created_at < $2%s
      GROUP BY day
      ORDER BY day;
    `;

    const byProjectQuery = `
      SELECT COALESCE(p.name, 'Unassigned') AS name,
             COALESCE(SUM(pay.total_amount),0)::numeric AS total
      FROM payroll pay
      LEFT JOIN projects p ON p.id = pay.project_id
      WHERE pay.created_at >= $1 AND pay.created_at < $2%s
      GROUP BY name
      ORDER BY total DESC
      LIMIT 8;
    `;
    const projectId = parseInt(req.query.project_id, 10);
    const cond = Number.isFinite(projectId) ? " AND project_id = $3" : "";
    const values = [start, end];
    if (cond) values.push(projectId);

    const [totalsRes, dailyRes, projectRes] = await Promise.all([
      pool.query(totalsQuery.replace("%s", cond), values),
      pool.query(dailyQuery.replace("%s", cond), values),
      pool.query(byProjectQuery.replace("%s", cond), values),
    ]);

    const totalsRow = totalsRes.rows[0] || {
      total: 0,
      approved_total: 0,
      pending_total: 0,
    };

    const toNumber = (v) => Number(v ?? 0);

    const payload = {
      month: `${y}-${String(m).padStart(2, "0")}`,
      totals: {
        total: toNumber(totalsRow.total),
        approved_total: toNumber(totalsRow.approved_total),
        pending_total: toNumber(totalsRow.pending_total),
      },
      daily: dailyRes.rows.map((r) => ({
        day: r.day,
        total: toNumber(r.total),
      })),
      byProject: projectRes.rows.map((r) => ({
        name: r.name,
        total: toNumber(r.total),
      })),
    };

    res.json(payload);
  } catch (error) {
    console.error("/dashboard/hr/monthly error:", error.message);
    res.status(500).json({ message: "Failed to fetch monthly HR metrics" });
  }
});

// توزيع المستخدمين حسب الدور
router.get("/users/roles", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT role, COUNT(*)::int AS count
       FROM users
       GROUP BY role
       ORDER BY count DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch role distribution" });
  }
});

export default router;
