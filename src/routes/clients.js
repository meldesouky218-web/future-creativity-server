import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";

const router = express.Router();

// كل العملاء
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, role FROM users WHERE role='client' ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// إنشاء عميل
router.post("/", async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password are required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password, role)
       VALUES ($1,$2,$3,$4,'client') RETURNING id, name, email, phone, role`,
      [name, email, phone, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create client" });
  }
});

export default router;
