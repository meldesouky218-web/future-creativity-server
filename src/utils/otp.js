import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../db/connection.js";
import { sendOtpEmail } from "./email.js";

// أغراض الأكواد (تسجيل - استرجاع كلمة المرور)
export const OTP_PURPOSES = {
  REGISTER: "register",
  RESET_PASSWORD: "reset_password",
};

// مدة صلاحية الكود بالدقائق
const OTP_TTL_MINUTES = 10;

// توليد رقم مكون من 6 أرقام
const generateOtpCode = () =>
  (crypto.randomInt(0, 1_000_000) + 1_000_000).toString().slice(1);

// توليد وإرسال الكود
export async function issueOtp(email, purpose) {
  const cleanEmail = email.toLowerCase();
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // حفظ الكود في قاعدة البيانات
    await client.query(
      `INSERT INTO otps (email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [cleanEmail, purpose, codeHash, expiresAt]
    );

    // إرسال الكود على الإيميل
    await sendOtpEmail({
      to: cleanEmail,
      code,
      purpose,
      expiresIn: OTP_TTL_MINUTES,
    });

    await client.query("COMMIT");

    // يرجع الكود في وضع التطوير فقط
    return {
      success: true,
      expiresIn: OTP_TTL_MINUTES,
      ...(process.env.NODE_ENV !== "production" ? { code } : {}),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("❌ Error issuing OTP:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

// التحقق من الكود
export async function verifyOtp(email, purpose, submittedCode) {
  const cleanEmail = email.toLowerCase();

  // جلب أحدث كود بنفس الغرض
  const { rows } = await pool.query(
    `SELECT id, code_hash, expires_at FROM otps
     WHERE email = $1 AND purpose = $2 AND used = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [cleanEmail, purpose]
  );

  if (!rows.length) {
    return { valid: false, reason: "No OTP found for this email" };
  }

  const record = rows[0];

  // التحقق من انتهاء الصلاحية
  if (new Date(record.expires_at) < new Date()) {
    await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [record.id]);
    return { valid: false, reason: "OTP expired" };
  }

  // مطابقة الكود
  const matches = await bcrypt.compare(submittedCode, record.code_hash);
  if (!matches) {
    return { valid: false, reason: "Invalid OTP code" };
  }

  // تمييز الكود كمستخدم
  await pool.query(`UPDATE otps SET used = true WHERE id = $1`, [record.id]);

  return { valid: true };
}