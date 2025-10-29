import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/connection.js";
import { authMiddleware } from "../middleware/auth.js";
import { issueOtp, OTP_PURPOSES } from "../utils/otp.js";
import { logActivity } from "../utils/logger.js";

const router = express.Router();
const TOKEN_EXPIRES_IN = "12h";

// 🔹 إنشاء JWT Token
const createToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });

/* ===================================================
   🔹 1) طلب OTP سواء للتسجيل أو لاسترجاع كلمة المرور
=================================================== */
router.post("/otp/request", async (req, res) => {
  const { email, purpose } = req.body;
  if (!email || !purpose)
    return res
      .status(400)
      .json({ message: "Email and purpose are required" });

  const normalizedPurpose = purpose.toLowerCase();

  if (!Object.values(OTP_PURPOSES).includes(normalizedPurpose))
    return res.status(400).json({ message: "Unsupported OTP purpose" });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);

    // ❌ لو المستخدم بيحاول يسجل وإيميله موجود
    if (normalizedPurpose === OTP_PURPOSES.REGISTER && existing.rowCount) {
      return res
        .status(409)
        .json({ message: "An account with this email already exists" });
    }

    // ❌ لو المستخدم بيحاول يسترجع باسورد وهو مش موجود
    if (
      normalizedPurpose === OTP_PURPOSES.RESET_PASSWORD &&
      !existing.rowCount
    ) {
      return res
        .status(404)
        .json({ message: "No user found with this email address" });
    }

    // ✅ توليد الكود وإرساله بالإيميل
    const otpResult = await issueOtp(email, normalizedPurpose);

    // 🧾 تسجيل العملية
    await logActivity({
      userId:
        normalizedPurpose === OTP_PURPOSES.RESET_PASSWORD &&
        existing.rowCount
          ? existing.rows[0].id
          : null,
      action: `OTP_${normalizedPurpose.toUpperCase()}`,
      entityType: "otp",
      entityId:
        normalizedPurpose === OTP_PURPOSES.RESET_PASSWORD &&
        existing.rowCount
          ? existing.rows[0].id
          : null,
      details: `OTP ${normalizedPurpose} issued to ${email.toLowerCase()}`,
    });

    // ✅ الرد النهائي
    res.json({
      message: "OTP issued successfully.",
      expiresInMinutes: otpResult.expiresIn,
      ...(otpResult.code ? { demoCode: otpResult.code } : {}),
    });
  } catch (error) {
    console.error("❌ Failed to issue OTP:", error.message);
    res
      .status(500)
      .json({ message: "Failed to issue OTP. Please try again later." });
  }
});

/* ===================================================
   🔹 2) تسجيل مستخدم جديد
=================================================== */
router.post("/register", async (req, res) => {
  const { name, email, password, role = "staff" } = req.body;
  if (!email || !password)
    return res
      .status(400)
      .json({ message: "Email and password are required" });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (existing.rowCount)
      return res.status(409).json({ message: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email, hashedPassword, role]
    );
    const user = result.rows[0];
    const token = createToken({ id: user.id, role: user.role });

    await logActivity({
      userId: user.id,
      action: "USER_REGISTERED",
      entityType: "user",
      entityId: user.id,
      details: `Registered ${email.toLowerCase()} as ${role}`,
    });

    res.status(201).json({ user, token });
  } catch (error) {
    console.error("❌ Failed to register user:", error.message);
    res.status(500).json({ message: "Failed to register user" });
  }
});

/* ===================================================
   🔹 3) تسجيل الدخول (Login)
=================================================== */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res
      .status(400)
      .json({ message: "Email and password are required" });

  try {
    const result = await pool.query(
      "SELECT id, name, email, role, password FROM users WHERE email=$1",
      [email]
    );
    if (!result.rowCount)
      return res.status(401).json({ message: "Invalid credentials" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const token = createToken({ id: user.id, role: user.role });
    delete user.password;

    await logActivity({
      userId: user.id,
      action: "USER_LOGIN",
      entityType: "user",
      entityId: user.id,
      details: `${email.toLowerCase()} logged in`,
    });

    res.json({ user, token });
  } catch (error) {
    console.error("❌ Failed to login:", error.message);
    res.status(500).json({ message: "Failed to login" });
  }
});

/* ===================================================
   🔹 4) استرجاع بيانات المستخدم (Profile)
=================================================== */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role FROM users WHERE id=$1",
      [req.user?.id]
    );
    if (!result.rowCount)
      return res.status(404).json({ message: "User not found" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Failed to fetch profile:", error.message);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

/* ===================================================
   ✅ 5) تصدير الراوتر
=================================================== */
export default router;