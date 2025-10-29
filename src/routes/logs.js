import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

/**
 * تحويل قيمة range إلى فترة زمنية SQL
 */
const getInterval = (range) => {
  switch ((range || "").toLowerCase()) {
    case "today":
    case "24h":
      return "1 day";
    case "7d":
    case "week":
      return "7 days";
    case "30d":
    case "month":
      return "30 days";
    default:
      return null;
  }
};

/**
 * 🟢 جلب السجلات (logs)
 * /api/logs?range=7d
 */
router.get("/", async (req, res) => {
  const interval = getInterval(req.query.range);
  const whereClause = interval
    ? `WHERE l.created_at >= NOW() - INTERVAL '${interval}'`
    : "";

  try {
    const query = `
      SELECT l.*, u.name AS user_name
      FROM logs l
      LEFT JOIN users u ON l.user_id = u.id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT 100;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Failed to fetch logs:", error);
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

/**
 * 🟡 ملخص السجلات (summary)
 * /api/logs/summary?range=7d
 */
router.get("/summary", async (req, res) => {
  const interval = getInterval(req.query.range);
  const whereClause = interval
    ? `WHERE created_at >= NOW() - INTERVAL '${interval}'`
    : "";

  try {
    const query = `
      SELECT
        CASE
          WHEN action ILIKE '%create%' THEN 'create'
          WHEN action ILIKE '%otp%' THEN 'otp'
          WHEN action ILIKE '%update%' OR action ILIKE '%reset%' THEN 'update'
          WHEN action ILIKE '%delete%' OR action ILIKE '%remove%' THEN 'delete'
          ELSE 'other'
        END AS type,
        COUNT(*)::int AS count
      FROM logs
      ${whereClause}
      GROUP BY type;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Failed to summarize logs:", error);
    res.status(500).json({ message: "Failed to summarize logs" });
  }
});

/**
 * 🔵 إضافة سجل يدوي (للاستخدام الداخلي)
 */
router.post("/", async (req, res) => {
  const { user_id, action, entity_type, entity_id, details } = req.body;
  try {
    const query = `
      INSERT INTO logs (user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [user_id, action, entity_type, entity_id, details];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Failed to create log entry:", error);
    res.status(500).json({ message: "Failed to create log entry" });
  }
});

export default router;