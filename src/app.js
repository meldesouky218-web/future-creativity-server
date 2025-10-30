/* ===========================================================
   🚀 Future Creativity Server — Main App Entry
=========================================================== */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";

import { migrate } from "./db/migrate.js";
import { authMiddleware } from "./middleware/auth.js";
import { roleMiddleware } from "./middleware/roleMiddleware.js";

/* ===========================================================
   📦 Routes Imports
=========================================================== */
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

/* ===========================================================
   🌍 إعداد dotenv (محلي فقط)
=========================================================== */
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

/* ===========================================================
   🧩 ترحيل قاعدة البيانات (مع التعامل الآمن على Vercel)
=========================================================== */
try {
  await migrate();
  console.log("✅ Database migration completed successfully");
} catch (error) {
  console.error("⚠️ Database migration failed (but continuing):", error.message);
}

/* ===========================================================
   ⚙️ تهيئة تطبيق Express
=========================================================== */
const app = express();

/* ===========================================================
   🌐 إعداد CORS لدعم لوحة التحكم على Vercel والدومين الرسمي
=========================================================== */
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://dashboard.future-creativity.com", // الدومين الرسمي
      "https://future-creativity-dashboard.vercel.app", // نسخة Vercel
      /\.vercel\.app$/, // أي فروع Preview
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // ضروري لنقل الكوكيز بين النطاقات
  })
);

/* ===========================================================
   🧾 قراءة JSON + Cookies
=========================================================== */
app.use(express.json());
app.use(cookieParser()); // لازم قبل أي Route يقرأ الكوكيز

/* ===========================================================
   📂 إنشاء مجلدات الرفع تلقائيًا (uploads)
=========================================================== */
(() => {
  const uploadsDir = path.resolve("uploads");
  const folders = ["projects", "contracts", "users"];

  for (const folder of folders) {
    const dir = path.join(uploadsDir, folder);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn(`⚠️ Failed to create ${dir}:`, err.message);
      }
    }
  }

  app.use("/uploads", express.static(uploadsDir));
})();

/* ===========================================================
   🧾 تسجيل الطلبات أثناء التطوير
=========================================================== */
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  next();
});

/* ===========================================================
   🚀 تعريف المسارات (Routes)
=========================================================== */
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/projects", authMiddleware, projectsRouter);
app.use("/api/staff", authMiddleware, roleMiddleware(["admin", "manager"]), staffRouter);
app.use("/api/clients", authMiddleware, roleMiddleware(["admin", "manager"]), clientsRouter);
app.use("/api/attendance", authMiddleware, attendanceRouter);
app.use("/api/payroll", authMiddleware, roleMiddleware(["admin", "manager"]), payrollRouter);
app.use("/api/contracts", authMiddleware, roleMiddleware(["admin", "manager"]), contractsRouter);
app.use("/api/dashboard", authMiddleware, dashboardRouter);
app.use("/api/logs", authMiddleware, roleMiddleware(["admin"]), logsRouter);
app.use("/api/push", pushRouter);

/* ===========================================================
   🩺 Health Check (تشخيص سريع)
=========================================================== */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    message: "✅ Future Creativity API is alive",
  });
});

app.get("/", (req, res) =>
  res.send("✅ Future Creativity API running successfully on Vercel")
);

/* ===========================================================
   🧠 التعامل مع الأخطاء العامة (Fallback)
=========================================================== */
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});

/* ===========================================================
   🚀 تشغيل السيرفر محليًا فقط
=========================================================== */
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`🚀 Server running locally on port ${PORT}`));
}

/* ===========================================================
   📤 تصدير التطبيق لـ Vercel
=========================================================== */
export default app;
