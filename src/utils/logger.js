import { pool } from "../db/connection.js";

/**
 * يسجّل الأحداث المهمة في جدول logs
 * @param {Object} options
 * @param {number|null} options.userId - رقم المستخدم (اختياري)
 * @param {string} options.action - نوع النشاط
 * @param {string} options.entityType - نوع الكيان (project, user, otp, ...)
 * @param {number|null} options.entityId - رقم الكيان (اختياري)
 * @param {string} options.details - تفاصيل إضافية
 */
export async function logActivity({
  userId = null,
  action,
  entityType,
  entityId = null,
  details = "",
}) {
  try {
    await pool.query(
      `INSERT INTO logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, entityType, entityId, details]
    );

    // طباعة النشاط في السيرفر للمراجعة
    console.log(
      `🧾 Log recorded → action: ${action}, entity: ${entityType}, userId: ${userId}`
    );
  } catch (error) {
    // عدم تعطيل السيرفر في حال فشل التسجيل
    console.error("⚠️ Failed to log activity:", error.message);
  }
}