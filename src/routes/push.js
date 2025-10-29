import express from "express";
import { pool } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Register or update device token
router.post("/register", authMiddleware, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ message: "Token is required" });
  try {
    await pool.query(
      `INSERT INTO device_tokens (token, user_id, platform)
       VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen = NOW(), enabled=true`,
      [token, req.user?.id || null, platform || null]
    );
    res.json({ message: "Registered" });
  } catch (error) {
    res.status(500).json({ message: "Failed to register device" });
  }
});

export default router;

