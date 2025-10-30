import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";

dotenv.config();

const demoUsers = [
  { name: "Amal Admin", email: "amal@future.creativity", password: "admin123", role: "admin", jobTitle: "Administrator" },
  { name: "Omar Manager", email: "omar@future.creativity", password: "manager123", role: "manager", jobTitle: "Manager" },
  { name: "Memo Supervisor", email: "memo@future.com", password: "supervisor123", role: "supervisor", jobTitle: "Supervisor" },
  { name: "Ali Staff", email: "ali@future.com", password: "staff123", role: "staff", jobTitle: "Staff" },
  { name: "Nora Staff", email: "nora@future.com", password: "staff123", role: "staff", jobTitle: "Staff" },
  { name: "Lina Viewer", email: "lina@future.creativity", password: "viewer123", role: "viewer", jobTitle: "Viewer" }
];

async function seedDemoUsers() {
  console.log("🔄 Seeding demo users...");
  for (const user of demoUsers) {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [user.email]
    );

    if (existing.rowCount) {
      console.log(`ℹ️  User already exists: ${user.email}`);
      continue;
    }

    const hashedPassword = await bcrypt.hash(user.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)`,
      [user.name, user.email, hashedPassword, user.role]
    );

    // Create staff profile if table exists (ignore errors gracefully)
    try {
      const userIdQ = await pool.query("SELECT id FROM users WHERE email=$1", [user.email]);
      const userId = userIdQ.rows[0]?.id;
      if (userId) {
        await pool.query(
          `INSERT INTO staff_profiles (user_id, phone, job_title, status)
           VALUES ($1,$2,$3,'active')
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, "0550000000", user.jobTitle || null]
        );
      }
    } catch (e) {
      console.warn("⚠️ Skipped staff_profiles insert:", e.message);
    }

    console.log(`✅ Created demo user: ${user.email} (${user.role})`);
  }
}

seedDemoUsers()
  .then(() => {
    console.log("🎉 Demo users seeding complete.");
  })
  .catch((err) => {
    console.error("❌ Failed to seed demo users:", err.message);
  })
  .finally(() => {
    pool.end();
  });
