import { pool } from "./db/connection.js";

async function testDB() {
  try {
    const dbName = await pool.query("SELECT current_database() as db");
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    
    console.log("✅ Connected to database:", dbName.rows[0].db);
    console.log("📋 Tables found:");
    console.table(tables.rows);
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Database connection error:", err.message);
    process.exit(1);
  }
}

testDB();