import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";

dotenv.config();

const demoUsers = [
  {
    name: "Amal Admin",
    email: "amal@future.creativity",
    password: "admin123",
    role: "admin",
  },
  {
    name: "Omar Manager",
    email: "omar@future.creativity",
    password: "manager123",
    role: "manager",
  },
  {
    name: "Lina Viewer",
    email: "lina@future.creativity",
    password: "viewer123",
    role: "viewer",
  },
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

