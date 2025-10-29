import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../db/connection.js";

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { makeAdmin: false, list: false, create: false };
  for (const a of args) {
    if (a === "--make-admin") out.makeAdmin = true;
    else if (a === "--list") out.list = true;
    else if (a === "--create") out.create = true;
    else if (a.startsWith("--email=")) out.email = a.split("=").slice(1).join("=");
    else if (a.startsWith("--password=")) out.password = a.split("=").slice(1).join("=");
    else if (a.startsWith("--name=")) out.name = a.split("=").slice(1).join("=");
  }
  return out;
}

async function main() {
  const { email, password, makeAdmin, list, create, name } = parseArgs();

  if (list) {
    const admins = await pool.query(
      `SELECT id, name, email, role, created_at FROM users WHERE role='admin' ORDER BY id ASC`
    );
    if (!admins.rowCount) {
      console.log("No admin users found.");
    } else {
      console.log("Admins:");
      for (const r of admins.rows) console.log(`- ${r.email} (id ${r.id})`);
    }
    await pool.end();
    return;
  }

  if (!email && !list) {
    console.error("Usage: npm run reset-admin -- --email=user@example.com [--password=New#Pass123] [--make-admin] [--create] [--name=Full%20Name] | --list");
    process.exitCode = 1;
    await pool.end();
    return;
  }

  try {
    const existing = await pool.query(`SELECT id, role FROM users WHERE email=$1`, [email?.toLowerCase()]);

    if (!existing.rowCount) {
      if (!create) {
        console.error(`User not found for email ${email}. Add --create to create it.`);
        process.exitCode = 2;
        return;
      }
      const temp = password || "Temp#1234";
      const hashedNew = await bcrypt.hash(temp, 10);
      const fullName = name || email.split("@")[0];
      const ins = await pool.query(
        `INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,'admin') RETURNING id` ,
        [fullName, email.toLowerCase(), hashedNew]
      );
      console.log(`✅ Admin user created: ${email}`);
      if (!password) console.log(`ℹ️ Temporary password set to: Temp#1234 (please reset via Forgot Password).`);
      return;
    }

    const id = existing.rows[0].id;
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      await pool.query(`UPDATE users SET password=$1 WHERE id=$2`, [hashed, id]);
      console.log(`✅ Password updated for ${email}.`);
    }
    if (makeAdmin && existing.rows[0].role !== 'admin') {
      await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [id]);
      console.log(`✅ Role set to admin for ${email}.`);
    }
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
