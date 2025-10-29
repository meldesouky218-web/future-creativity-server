import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";
import { logActivity } from "../utils/logger.js";

const router = express.Router();

// Helper
const safe = (s) => (s ?? "").toString().trim();

/* =========================
   GET: List staff
========================= */
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.created_at,
             sp.job_title, sp.status, sp.phone, sp.avatar_url
      FROM users u
      LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      ORDER BY u.id ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Failed to fetch staff list:", error.message);
    res.status(500).json({ message: "Failed to fetch staff list" });
  }
});

/* =========================
   GET: Single staff with summary
========================= */
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  try {
    const userQ = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              sp.job_title, sp.status, sp.phone, sp.national_id, sp.avatar_url
       FROM users u
       LEFT JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1`,
      [id]
    );
    if (!userQ.rowCount) return res.status(404).json({ message: "User not found" });

    const assignsQ = await pool.query(
      `SELECT pa.id, pa.project_id, p.name AS project_name, pa.role_in_project,
              pa.start_date, pa.end_date, pa.notes, pa.created_at
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE pa.user_id = $1
       ORDER BY pa.created_at DESC
       LIMIT 10`,
      [id]
    );

    const attendanceQ = await pool.query(
      `SELECT id, project_id, status, check_type,
              COALESCE(lat, latitude) AS lat,
              COALESCE(lng, longitude) AS lng,
              COALESCE(photo_url, image_url) AS photo_url,
              COALESCE(timestamp, NOW()) AS created_at,
              radius_m
       FROM attendance
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json({
      user: userQ.rows[0],
      recentAssignments: assignsQ.rows,
      recentAttendance: attendanceQ.rows,
    });
  } catch (error) {
    console.error("❌ Failed to fetch staff member:", error.message);
    res.status(500).json({ message: "Failed to fetch staff member" });
  }
});

/* =========================
   POST: Create user + profile
========================= */
router.post("/", async (req, res) => {
  const { name, email, role = "staff", phone, job_title, status = "active" } = req.body || {};
  if (!email || !name) return res.status(400).json({ message: "Name and email are required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const defaultPassHash = "$2a$10$5bFj3b8j2uE0f4t3p2v9Ye.3rFzF2Qh0l8R0jH47a8k5nVd1a6mJ2"; // "Temp#1234"
    const newUserQ = await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role, created_at`,
      [safe(name), safe(email.toLowerCase()), defaultPassHash, safe(role)]
    );
    const user = newUserQ.rows[0];

    await client.query(
      `INSERT INTO staff_profiles (user_id, phone, job_title, status)
       VALUES ($1,$2,$3,$4)`,
      [user.id, safe(phone), safe(job_title), safe(status)]
    );

    await logActivity({
      userId: req.user?.id || null,
      action: "STAFF_CREATED",
      entityType: "user",
      entityId: user.id,
      details: `Created staff ${user.email} (${role})`,
    });

    await client.query("COMMIT");
    res.status(201).json(user);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email already exists" });
    }
    console.error("❌ Failed to create staff:", error.message);
    res.status(500).json({ message: "Failed to create staff user" });
  } finally {
    client.release();
  }
});

/* =========================
   PUT: Update role/profile
========================= */
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, phone, job_title, status, avatar_url } = req.body || {};
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (name || role) {
      await client.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           role = COALESCE($2, role)
         WHERE id = $3`,
        [name ? safe(name) : null, role ? safe(role) : null, id]
      );
    }

    await client.query(
      `INSERT INTO staff_profiles (user_id, phone, job_title, status, avatar_url)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         phone = COALESCE(EXCLUDED.phone, staff_profiles.phone),
         job_title = COALESCE(EXCLUDED.job_title, staff_profiles.job_title),
         status = COALESCE(EXCLUDED.status, staff_profiles.status),
         avatar_url = COALESCE(EXCLUDED.avatar_url, staff_profiles.avatar_url),
         updated_at = NOW()`,
      [id, safe(phone), safe(job_title), safe(status), safe(avatar_url)]
    );

    await logActivity({
      userId: req.user?.id || null,
      action: "STAFF_UPDATED",
      entityType: "user",
      entityId: id,
      details: `Updated staff #${id}`,
    });

    await client.query("COMMIT");
    res.json({ message: "Staff updated successfully." });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("❌ Failed to update staff:", error.message);
    res.status(500).json({ message: "Failed to update staff" });
  } finally {
    client.release();
  }
});

/* =========================
   POST: Assign to project
========================= */
router.post("/:id/assign", async (req, res) => {
  const id = Number(req.params.id);
  const { project_id, role_in_project, start_date, end_date, notes } = req.body || {};
  if (!id || !project_id) return res.status(400).json({ message: "user id and project_id are required" });

  try {
    await pool.query(
      `INSERT INTO project_assignments (project_id, user_id, role_in_project, start_date, end_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, user_id) DO UPDATE SET
         role_in_project = EXCLUDED.role_in_project,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         notes = EXCLUDED.notes`,
      [project_id, id, safe(role_in_project), start_date || null, end_date || null, safe(notes)]
    );

    await logActivity({
      userId: req.user?.id || null,
      action: "STAFF_ASSIGNED_TO_PROJECT",
      entityType: "project_assignment",
      entityId: null,
      details: `User #${id} => project #${project_id} (${role_in_project || "member"})`,
    });

    res.json({ message: "Assigned successfully." });
  } catch (error) {
    console.error("❌ Failed to assign staff to project:", error.message);
    res.status(500).json({ message: "Failed to assign staff to project" });
  }
});

/* =========================
   Collections by user
========================= */
router.get("/:id/attendance", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  try {
    const { rows } = await pool.query(
      `SELECT id, project_id, status, check_type,
              COALESCE(lat, latitude) AS lat,
              COALESCE(lng, longitude) AS lng,
              COALESCE(photo_url, image_url) AS photo_url,
              COALESCE(timestamp, NOW()) AS created_at,
              radius_m
       FROM attendance WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ Failed to fetch attendance:", error.message);
    res.status(500).json({ message: "Failed to fetch attendance" });
  }
});

router.get("/:id/contracts", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  try {
    const { rows } = await pool.query(
      `SELECT id, project_id, user_id, file_url, created_at
       FROM contracts WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ Failed to fetch contracts:", error.message);
    res.status(500).json({ message: "Failed to fetch contracts" });
  }
});

router.get("/:id/payroll", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, project_id, total_days, total_amount, approved, created_at
       FROM payroll WHERE user_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ Failed to fetch payroll:", error.message);
    res.status(500).json({ message: "Failed to fetch payroll" });
  }
});

/* =========================
   Keep existing admin-reset for compatibility
========================= */
router.post("/admin-reset", async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ message: "Email and new password are required." });
  }
  try {
    const userCheck = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (!userCheck.rowCount) return res.status(404).json({ message: "User not found" });
    const user = userCheck.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password=$1 WHERE id=$2", [hashedPassword, user.id]);
    await logActivity({
      userId: req.user?.id || null,
      action: "ADMIN_PASSWORD_RESET",
      entityType: "user",
      entityId: user.id,
      details: `Admin reset password for ${email}`,
    });
    res.json({ message: "Password updated successfully (by admin)." });
  } catch (error) {
    console.error("❌ Failed to reset password:", error.message);
    res.status(500).json({ message: "Failed to update password." });
  }
});

export default router;
