import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";
import { verifyOtp } from "../utils/otp.js";
import { logActivity } from "../utils/logger.js";
import { authMiddleware } from "../middleware/auth.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();
const uploadsRoot = path.resolve("uploads");
const uploadsUsers = path.join(uploadsRoot, "users");
if (!fs.existsSync(uploadsUsers)) {
  try { fs.mkdirSync(uploadsUsers, { recursive: true }); } catch {}
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsUsers),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "file", ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${base}${ext}`);
  },
});
const upload = multer({ storage });

/* ===================================================
   👤 GET ALL USERS (Admin only)
=================================================== */
router.get("/", authMiddleware, roleMiddleware(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Failed to fetch users:", error.message);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

/* ===================================================
   🧩 RESET PASSWORD (via OTP)
   - يُستخدم من صفحة Forgot Password (خارج النظام)
=================================================== */
router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  // ✅ تحقق من إدخال جميع البيانات المطلوبة
  if (!email || !otp || !newPassword) {
    return res.status(400).json({
      message: "Missing required fields (email, otp, newPassword).",
    });
  }

  try {
    // ✅ تحقق من وجود المستخدم في قاعدة البيانات
    const userResult = await pool.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (!userResult.rowCount) {
      return res.status(404).json({ message: "No user found with this email." });
    }

    const user = userResult.rows[0];

    // ✅ تحقق من صحة الـ OTP
    const verification = await verifyOtp(email, "reset_password", otp);
    if (!verification.valid) {
      return res.status(400).json({
        message: verification.reason || "Invalid or expired OTP.",
      });
    }

    // ✅ تحديث كلمة المرور بعد التحقق
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password=$1 WHERE id=$2", [
      hashed,
      user.id,
    ]);

    // 🧾 تسجيل العملية في سجل النشاطات
    await logActivity({
      userId: user.id,
      action: "PASSWORD_RESET",
      entityType: "user",
      entityId: user.id,
      details: `Password reset via OTP for ${email.toLowerCase()}`,
    });

    // ✅ الرد النهائي
    res.json({ message: "Password has been updated successfully." });
  } catch (error) {
    console.error("❌ Failed to reset password:", error);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

/* ===================================================
   🔑 ADMIN RESET PASSWORD (No OTP)
   - يُستخدم من داخل لوحة Staff Management
=================================================== */
router.post("/admin-reset", authMiddleware, roleMiddleware(["admin"]), async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ message: "Email and new password are required." });
  }

  try {
    // ✅ تحقق من وجود المستخدم
    const result = await pool.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);

    if (!result.rowCount) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = result.rows[0];
    const hashed = await bcrypt.hash(newPassword, 10);

    // ✅ تحديث كلمة المرور مباشرة بدون OTP
    await pool.query("UPDATE users SET password=$1 WHERE id=$2", [
      hashed,
      user.id,
    ]);

    // 🧾 تسجيل العملية في logs
    await logActivity({
      userId: req.user?.id || null,
      action: "ADMIN_PASSWORD_RESET",
      entityType: "user",
      entityId: user.id,
      details: `Admin reset password for ${email}`,
    });

    res.json({ message: "Password updated successfully (by admin)." });
  } catch (error) {
    console.error("❌ Failed to reset password by admin:", error.message);
    res.status(500).json({ message: "Failed to update password." });
  }
});

export default router;
 
/* ==============================
   User personal documents
============================== */
// List current user's documents
router.get("/me/documents", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, file_url, file_name, status, notes, created_at, reviewed_by, reviewed_at
       FROM user_documents WHERE user_id=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// Upload new document for current user
router.post("/me/documents", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Missing file" });
    const type = (req.body?.type || "other").toString();
    const fileUrl = `/uploads/users/${req.file.filename}`;
    const fileName = req.body?.file_name || req.file.originalname || req.file.filename;
    const result = await pool.query(
      `INSERT INTO user_documents (user_id, type, file_url, file_name)
       VALUES ($1,$2,$3,$4) RETURNING id, type, file_url, file_name, status, created_at`,
      [req.user.id, type, fileUrl, fileName]
    );
    await logActivity({
      userId: req.user.id,
      action: "USER_DOC_UPLOADED",
      entityType: "user_document",
      entityId: result.rows[0].id,
      details: `${type} uploaded`,
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to upload document" });
  }
});

// Delete current user's document (or admin)
router.delete("/documents/:id", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const found = await pool.query(`SELECT user_id, file_url FROM user_documents WHERE id=$1`, [id]);
    if (!found.rowCount) return res.status(404).json({ message: "Document not found" });
    const row = found.rows[0];
    if (row.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Not allowed" });
    }
    if (row.file_url?.startsWith('/uploads/')) {
      const abs = path.join(uploadsRoot, row.file_url.replace('/uploads/', ''));
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
    }
    await pool.query(`DELETE FROM user_documents WHERE id=$1`, [id]);
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete document" });
  }
});

// Admin: list pending docs
router.get("/documents/pending", authMiddleware, roleMiddleware(["admin", "manager"]), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.user_id, u.name, u.email, d.type, d.file_name, d.file_url, d.status, d.created_at
       FROM user_documents d
       JOIN users u ON u.id = d.user_id
       WHERE d.status = 'pending'
       ORDER BY d.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch pending documents" });
  }
});

// Admin: update document status
router.put("/documents/:id/status", authMiddleware, roleMiddleware(["admin", "manager"]), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = (req.body?.status || '').toLowerCase();
  const notes = req.body?.notes || null;
  if (!['approved','rejected','pending'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      `UPDATE user_documents SET status=$1, notes=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4 RETURNING *`,
      [status, notes, req.user.id, id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Document not found' });
    res.json({ message: 'Updated', document: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update status' });
  }
});
