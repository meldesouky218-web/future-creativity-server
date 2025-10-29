import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { authMiddleware } from "./middleware/auth.js";
import { roleMiddleware } from "./middleware/roleMiddleware.js";
import { migrate } from "./db/migrate.js";
import path from "path";
import fs from "fs";

import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import staffRouter from "./routes/staff.js";
import clientsRouter from "./routes/clients.js";
import projectsRouter from "./routes/projects.js";
import attendanceRouter from "./routes/attendance.js";
import payrollRouter from "./routes/payroll.js";
import contractsRouter from "./routes/contracts.js";
import dashboardRouter from "./routes/dashboard.js";
import logsRouter from "./routes/logs.js";
import pushRouter from "./routes/push.js";

dotenv.config();

/* ===========================================================
   🧩 ترحيل قاعدة البيانات قبل تشغيل السيرفر
=========================================================== */
try {
  await migrate();
  console.log("✅ Database migration completed successfully");
} catch (error) {
  console.error("❌ Database migration failed. Exiting...", error);
  process.exit(1);
}

/* ===========================================================
   ⚙️ تهيئة التطبيق Express
=========================================================== */
const app = express();

// إعداد CORS
app.use(
  cors({
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// قراءة JSON
app.use(express.json());

// تقديم الملفات المرفوعة
(() => {
  const uploadsDir = path.resolve("uploads");
  if (!fs.existsSync(uploadsDir)) {
    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
  }
  const projectsDir = path.join(uploadsDir, "projects");
  if (!fs.existsSync(projectsDir)) {
    try { fs.mkdirSync(projectsDir, { recursive: true }); } catch {}
  }
  const contractsDir = path.join(uploadsDir, "contracts");
  if (!fs.existsSync(contractsDir)) {
    try { fs.mkdirSync(contractsDir, { recursive: true }); } catch {}
  }
  const usersDir = path.join(uploadsDir, "users");
  if (!fs.existsSync(usersDir)) {
    try { fs.mkdirSync(usersDir, { recursive: true }); } catch {}
  }
  app.use("/uploads", express.static(uploadsDir));
})();

// تسجيل الطلبات أثناء التطوير
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

/* ===========================================================
   🚀 تعريف المسارات (من الأوسع إلى الأضيق)
=========================================================== */

// 1️⃣ مسارات عامة (بدون توكن)
app.use("/api/auth", authRouter);

// 2️⃣ مسارات محمية تحتاج تسجيل دخول
app.use("/api/projects", authMiddleware, projectsRouter);
app.use("/api/staff", authMiddleware, roleMiddleware(["admin", "manager"]), staffRouter);

// 3️⃣ باقي المسارات الإدارية
app.use("/api/users", usersRouter);
app.use("/api/clients", authMiddleware, roleMiddleware(["admin", "manager"]), clientsRouter);
app.use("/api/attendance", authMiddleware, attendanceRouter);
app.use("/api/payroll", authMiddleware, roleMiddleware(["admin", "manager"]), payrollRouter);
app.use("/api/contracts", authMiddleware, roleMiddleware(["admin", "manager"]), contractsRouter);
app.use("/api/dashboard", authMiddleware, dashboardRouter);
app.use("/api/logs", authMiddleware, roleMiddleware(["admin"]), logsRouter);
app.use("/api/push", pushRouter);

// مسار الفحص الأساسي
app.get("/", (req, res) => res.send("✅ Future Creativity API running"));

/* ===========================================================
   🚀 التشغيل المحلي فقط (عند التطوير)
=========================================================== */
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`🚀 Server running locally on port ${PORT}`));
}

/* ===========================================================
   📤 التصدير لـ Vercel
=========================================================== */
export default app;
