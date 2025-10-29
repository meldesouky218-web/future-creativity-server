import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";
import fs from "fs";
import path from "path";

dotenv.config();

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🔄 Seeding demo data...");
    await client.query("BEGIN");

    // 1) Users
    const demoUsers = [
      { name: "Amal Admin", email: "amal@future.creativity", role: "admin", password: "admin123" },
      { name: "Omar Manager", email: "omar@future.creativity", role: "manager", password: "manager123" },
      { name: "Lina Viewer", email: "lina@future.creativity", role: "viewer", password: "viewer123" },
      { name: "Sara HR", email: "sara@future.com", role: "manager", password: "sara12345" },
      { name: "Memo Supervisor", email: "memo@future.com", role: "supervisor", password: "memo12345" },
      { name: "Ali Staff", email: "ali@future.com", role: "staff", password: "staff123" },
      { name: "Nora Staff", email: "nora@future.com", role: "staff", password: "staff123" },
      { name: "Sam Staff", email: "sam@future.com", role: "staff", password: "staff123" },
    ];
    const userIds = [];
    for (const u of demoUsers) {
      const existing = await client.query("SELECT id FROM users WHERE email=$1", [u.email]);
      if (existing.rowCount) {
        userIds.push(existing.rows[0].id);
        continue;
      }
      const hashed = await bcrypt.hash(u.password, 10);
      const result = await client.query(
        `INSERT INTO users (name, email, password, role)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [u.name, u.email.toLowerCase(), hashed, u.role]
      );
      userIds.push(result.rows[0].id);
    }

    // Ensure profiles
    for (const id of userIds) {
      await client.query(
        `INSERT INTO staff_profiles (user_id, phone, job_title, status)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO NOTHING`,
        [id, `05${rand(10000000, 99999999)}`, "Staff", "active"]
      );
    }

    // 2) Projects
    const projectsData = [
      { name: "Mall Operations", description: "Daily operations and housekeeping", radius: 250, pay_type: "daily", pay_rate: 80 },
      { name: "Expo Event", description: "Event staffing and access control", radius: 200, pay_type: "daily", pay_rate: 100 },
      { name: "HQ Office", description: "Reception and facility support", radius: 150, pay_type: "monthly", pay_rate: 3500 },
    ];
    const projectIds = [];
    for (const p of projectsData) {
      const existing = await client.query("SELECT id FROM projects WHERE name=$1", [p.name]);
      if (existing.rowCount) {
        projectIds.push(existing.rows[0].id);
        continue;
      }
      const result = await client.query(
        `INSERT INTO projects (name, description, radius, pay_type, pay_rate, status)
         VALUES ($1,$2,$3,$4,$5,'Active') RETURNING id`,
        [p.name, p.description, p.radius, p.pay_type, p.pay_rate]
      );
      projectIds.push(result.rows[0].id);
    }

    // 3) Assignments (attach first 5 users randomly)
    for (const pid of projectIds) {
      for (const uid of userIds.slice(0, 5)) {
        await client.query(
          `INSERT INTO project_assignments (project_id, user_id, role_in_project, start_date)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (project_id, user_id) DO NOTHING`,
          [pid, uid, ["Supervisor","Hostess","Cleaner"][rand(0,2)], new Date()]
        );
      }
    }

    // 4) Attendance (last 7 days checkin/checkout)
    const now = new Date();
    for (const uid of userIds.slice(0, 6)) {
      for (let d = 0; d < 7; d++) {
        const dt = new Date(now);
        dt.setDate(now.getDate() - d);
        const pid = projectIds[rand(0, projectIds.length - 1)];
        // checkin
        await client.query(
          `INSERT INTO attendance (user_id, project_id, check_type, latitude, longitude, status, timestamp)
           VALUES ($1,$2,'checkin', $3, $4, 'approved', $5)`,
          [uid, pid, 24 + Math.random(), 46 + Math.random(), new Date(dt.setHours(8, rand(0,30))) ]
        );
        // checkout
        await client.query(
          `INSERT INTO attendance (user_id, project_id, check_type, latitude, longitude, status, timestamp)
           VALUES ($1,$2,'checkout', $3, $4, 'approved', $5)`,
          [uid, pid, 24 + Math.random(), 46 + Math.random(), new Date(dt.setHours(17, rand(0,30))) ]
        );
      }
    }

    // 5) Payroll (this month)
    for (const uid of userIds.slice(0, 6)) {
      const pid = projectIds[rand(0, projectIds.length - 1)];
      const days = rand(10, 22);
      const amount = days * rand(75, 120);
      await client.query(
        `INSERT INTO payroll (project_id, user_id, total_days, total_amount, approved)
         VALUES ($1,$2,$3,$4,$5)`,
        [pid, uid, days, amount, Math.random() > 0.4]
      );
    }

    // 6) Project logs
    for (const pid of projectIds) {
      await client.query(
        `INSERT INTO project_logs (project_id, user_id, content)
         VALUES ($1, NULL, $2)`,
        [pid, `Project ${pid} initialized and site inspected.`]
      );
    }

    // 7) Project documents (create demo files locally)
    const uploadsRoot = path.resolve("uploads");
    const projDir = path.join(uploadsRoot, "projects");
    const contractsDir = path.join(uploadsRoot, "contracts");
    try { if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true }); } catch {}
    try { if (!fs.existsSync(contractsDir)) fs.mkdirSync(contractsDir, { recursive: true }); } catch {}
    for (const pid of projectIds) {
      const file1 = `demo_${pid}_permit.txt`;
      const file2 = `demo_${pid}_layout.pdf`; // placeholder text as pdf name
      try {
        fs.writeFileSync(path.join(projDir, file1), `Permit for project ${pid} (demo)`);
        fs.writeFileSync(path.join(projDir, file2), `PDF placeholder for project ${pid}`);
      } catch {}
      await client.query(
        `INSERT INTO project_documents (project_id, file_url, file_name, uploaded_by)
         VALUES ($1,$2,$3,$4),($1,$5,$6,$4)`,
        [
          pid,
          `/uploads/projects/${file1}`,
          `Permit ${pid}.txt`,
          userIds[0] || null,
          `/uploads/projects/${file2}`,
          `Layout ${pid}.pdf`,
        ]
      );
    }

    // 8) Contracts linked to users/projects with local demo files
    for (const uid of userIds.slice(0, 5)) {
      const pid = projectIds[rand(0, projectIds.length - 1)];
      const fname = `contract_${uid}_${pid}.txt`;
      try { fs.writeFileSync(path.join(contractsDir, fname), `Contract for user ${uid} on project ${pid}`); } catch {}
      await client.query(
        `INSERT INTO contracts (project_id, user_id, file_url)
         VALUES ($1,$2,$3)`,
        [pid, uid, `/uploads/contracts/${fname}`]
      );
    }

    // 9) Project expenses demo
    for (const pid of projectIds) {
      for (let i = 0; i < 3; i++) {
        const categories = ["Transport", "Equipment", "Food", "Permit", "Misc"];
        const cat = categories[rand(0, categories.length - 1)];
        const amount = rand(50, 400);
        await client.query(
          `INSERT INTO project_expenses (project_id, category, amount, notes, created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [pid, cat, amount, `Demo expense ${i+1}`, userIds[0] || null]
        );
      }
    }

    await client.query("COMMIT");
    console.log("🎉 Demo data seeding complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to seed demo data:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    pool.end();
  }
}

seed();
