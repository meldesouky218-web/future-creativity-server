import { pool } from "./connection.js";
import { UserModel } from "../models/User.js";
import { ProjectModel } from "../models/Project.js";
import { AttendanceModel } from "../models/Attendance.js";
import { PayrollModel } from "../models/Payroll.js";
import { ContractModel } from "../models/Contract.js";
import { LogModel } from "../models/Log.js";
import { OtpModel } from "../models/Otp.js";

const MODELS = [
  UserModel,
  ProjectModel,
  AttendanceModel,
  PayrollModel,
  ContractModel,
  LogModel,
  OtpModel,
];

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of MODELS) {
      await client.query(statement);
    }
    // Phase 2 additions: staff profiles, assignments, and table extensions
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone VARCHAR(50),
        national_id VARCHAR(50),
        job_title VARCHAR(120),
        status VARCHAR(30) DEFAULT 'active',
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_profiles_user ON staff_profiles(user_id);`
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_assignments (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_in_project VARCHAR(120),
        start_date DATE,
        end_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(project_id, user_id)
      );
    `);

    // Phase 3: project logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_logs (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        content TEXT,
        photos TEXT[],
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Phase 3: project documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_documents (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        file_name VARCHAR(255),
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Phase 4: payroll_records (monthly aggregation)
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        month DATE NOT NULL,
        days_present INT DEFAULT 0,
        base_rate NUMERIC,
        allowances JSON,
        deductions JSON,
        total_amount NUMERIC,
        approved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, project_id, month)
      );
    `);

    // Phase 4: project_expenses
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_expenses (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category VARCHAR(120),
        amount NUMERIC NOT NULL,
        notes TEXT,
        receipt_url TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Phase 4: user_documents for mobile onboarding
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50),
        file_url TEXT NOT NULL,
        file_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Phase 4: approvals (generic queue)
    await client.query(`
      CREATE TABLE IF NOT EXISTS approvals (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'pending',
        notes TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Phase 4: device_tokens for push notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        platform VARCHAR(20),
        last_seen TIMESTAMP DEFAULT NOW(),
        enabled BOOLEAN DEFAULT true,
        UNIQUE(token)
      );
    `);

    await client.query(`
      ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS photo_url TEXT,
      ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS radius_m INTEGER DEFAULT 200;
    `);

    await client.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);

    await client.query(`
      ALTER TABLE payroll
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);
    await client.query("ALTER TABLE logs ADD COLUMN IF NOT EXISTS details TEXT");
    await client.query("COMMIT");
    console.log(
      "✅ Tables verified:",
      [
        "users",
        "projects",
        "attendance",
        "payroll",
        "contracts",
        "logs",
        "otps",
        "staff_profiles",
        "project_assignments",
        "project_documents",
        "payroll_records",
        "project_expenses",
        "project_logs",
        "user_documents",
        "approvals",
        "device_tokens",
      ].join(", ")
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Database migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}
