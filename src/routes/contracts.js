import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

// كل العقود
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name as user_name, p.name as project_name
       FROM contracts c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN projects p ON c.project_id = p.id
       ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch contracts" });
  }
});

// إضافة عقد
router.post("/", async (req, res) => {
  const { user_id, project_id, file_url, uploaded_by } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO contracts (user_id, project_id, file_url, uploaded_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [user_id, project_id, file_url, uploaded_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create contract" });
  }
});

export default router;

