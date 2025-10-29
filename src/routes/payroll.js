import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

// كل الكشوف
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT pay.*, u.name as user_name, p.name as project_name
       FROM payroll pay
       LEFT JOIN users u ON pay.user_id = u.id
       LEFT JOIN projects p ON pay.project_id = p.id
       ORDER BY pay.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch payrolls" });
  }
});

// إنشاء كشف
router.post("/", async (req, res) => {
  const { project_id, user_id, total_days, total_amount, approved } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO payroll (project_id, user_id, total_days, total_amount, approved)
       VALUES ($1,$2,$3,$4,COALESCE($5,false)) RETURNING *`,
      [project_id, user_id, total_days, total_amount, approved]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create payroll" });
  }
});

export default router;

/* =========================================================
   Phase 4: Payroll Records (monthly) — compute/generate/list/approve
========================================================= */

// Helper to parse month
function parseMonth(monthStr) {
  const m = String(monthStr || "");
  const ok = /^\d{4}-\d{2}$/.test(m);
  const now = new Date();
  const y = ok ? parseInt(m.slice(0, 4)) : now.getFullYear();
  const mo = ok ? parseInt(m.slice(5, 7)) : now.getMonth() + 1;
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 1);
  return { start, end, key: `${y}-${String(mo).padStart(2, "0")}` };
}

// Compute preview from attendance
router.get("/compute", async (req, res) => {
  try {
    const { start, end, key } = parseMonth(req.query.month);
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;

    const query = `
      WITH days AS (
        SELECT user_id, project_id, date_trunc('day', timestamp) AS d
        FROM attendance
        WHERE timestamp >= $1 AND timestamp < $2 AND check_type='checkin'
        GROUP BY user_id, project_id, date_trunc('day', timestamp)
      )
      SELECT d.user_id, d.project_id, COUNT(*)::int AS days_present,
             u.name AS user_name, u.email,
             p.name AS project_name, p.pay_type, p.pay_rate, p.allowances
      FROM days d
      JOIN users u ON u.id = d.user_id
      JOIN projects p ON p.id = d.project_id
      WHERE ($3::int IS NULL OR p.id = $3)
      GROUP BY d.user_id, d.project_id, u.name, u.email, p.name, p.pay_type, p.pay_rate, p.allowances
      ORDER BY d.project_id, d.user_id;
    `;
    const values = [start, end, projectId];
    const result = await pool.query(query, values);

    const computed = result.rows.map((r) => {
      const payType = (r.pay_type || '').toLowerCase();
      const rate = Number(r.pay_rate || 0);
      // تقدير بسيط لمعدل اليوم
      const dailyRate = payType === 'daily' ? rate
        : payType === 'weekly' ? rate / 6
        : payType === 'monthly' ? rate / 22
        : payType === 'hourly' ? rate * 8
        : rate;
      let allowancesTotal = 0;
      try {
        if (r.allowances) {
          const obj = typeof r.allowances === 'string' ? JSON.parse(r.allowances) : r.allowances;
          for (const v of Object.values(obj || {})) allowancesTotal += Number(v || 0);
        }
      } catch {}
      const days = Number(r.days_present || 0);
      const total = dailyRate * days + allowancesTotal;
      return {
        month: key,
        user_id: r.user_id,
        user_name: r.user_name,
        email: r.email,
        project_id: r.project_id,
        project_name: r.project_name,
        days_present: days,
        base_rate: Number(dailyRate.toFixed(2)),
        allowances_total: Number(allowancesTotal.toFixed(2)),
        total_amount: Number(total.toFixed(2)),
      };
    });

    res.json({ month: key, records: computed });
  } catch (error) {
    console.error("/payroll/compute error:", error.message);
    res.status(500).json({ message: "Failed to compute payroll" });
  }
});

// Generate and upsert payroll_records for the month
router.post("/generate", async (req, res) => {
  try {
    const { start, end, key } = parseMonth(req.body?.month);
    const projectId = req.body?.project_id ? parseInt(req.body.project_id, 10) : null;

    // Reuse compute query
    const compRes = await pool.query(
      `WITH days AS (
         SELECT user_id, project_id, date_trunc('day', timestamp) AS d
         FROM attendance
         WHERE timestamp >= $1 AND timestamp < $2 AND check_type='checkin'
         GROUP BY user_id, project_id, date_trunc('day', timestamp)
       )
       SELECT d.user_id, d.project_id, COUNT(*)::int AS days_present,
              p.pay_type, p.pay_rate, p.allowances
       FROM days d
       JOIN projects p ON p.id = d.project_id
       WHERE ($3::int IS NULL OR p.id = $3)
       GROUP BY d.user_id, d.project_id, p.pay_type, p.pay_rate, p.allowances
       ORDER BY d.project_id, d.user_id`,
      [start, end, projectId]
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of compRes.rows) {
        const payType = (r.pay_type || '').toLowerCase();
        const rate = Number(r.pay_rate || 0);
        const dailyRate = payType === 'daily' ? rate : payType === 'weekly' ? rate/6 : payType==='monthly'? rate/22 : payType==='hourly'? rate*8 : rate;
        let allowances = null; let allowancesTotal = 0;
        try { allowances = typeof r.allowances === 'string' ? JSON.parse(r.allowances) : r.allowances; } catch {}
        if (allowances && typeof allowances === 'object') {
          for (const v of Object.values(allowances)) allowancesTotal += Number(v || 0);
        }
        const days = Number(r.days_present || 0);
        const total = dailyRate * days + allowancesTotal;
        await client.query(
          `INSERT INTO payroll_records (user_id, project_id, month, days_present, base_rate, allowances, deductions, total_amount, approved)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
           ON CONFLICT (user_id, project_id, month) DO UPDATE SET
             days_present = EXCLUDED.days_present,
             base_rate = EXCLUDED.base_rate,
             allowances = EXCLUDED.allowances,
             deductions = EXCLUDED.deductions,
             total_amount = EXCLUDED.total_amount,
             approved = payroll_records.approved`,
          [r.user_id, r.project_id, start, days, dailyRate, allowances, null, total]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ message: 'Payroll records generated', month: key });
  } catch (error) {
    console.error('/payroll/generate error:', error.message);
    res.status(500).json({ message: 'Failed to generate payroll records' });
  }
});

// List payroll_records
router.get("/records", async (req, res) => {
  try {
    const { start, end } = parseMonth(req.query.month);
    const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const approved = typeof req.query.approved === 'string' ? req.query.approved === 'true' : null;
    const where = ["month >= $1 AND month < $2"]; const vals = [start, end]; let i = 3;
    if (projectId) { where.push(`project_id = $${i}`); vals.push(projectId); i++; }
    if (approved !== null) { where.push(`approved = $${i}`); vals.push(approved); i++; }
    const query = `
      SELECT pr.*, u.name AS user_name, p.name AS project_name
      FROM payroll_records pr
      LEFT JOIN users u ON u.id = pr.user_id
      LEFT JOIN projects p ON p.id = pr.project_id
      WHERE ${where.join(' AND ')}
      ORDER BY pr.project_id, pr.user_id`;
    const result = await pool.query(query, vals);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payroll records' });
  }
});

// Approve a payroll record
router.put("/records/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    await pool.query(`UPDATE payroll_records SET approved=true WHERE id=$1`, [id]);
    res.json({ message: 'Record approved' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to approve record' });
  }
});

// Reject (set approved=false)
router.put("/records/:id/reject", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    await pool.query(`UPDATE payroll_records SET approved=false WHERE id=$1`, [id]);
    res.json({ message: 'Record rejected' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reject record' });
  }
});
