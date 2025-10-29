import jwt from "jsonwebtoken";

// 🧠 Middleware للتحقق من التوكن (JWT)
export const authMiddleware = (req, res, next) => {
  try {
    // ✅ المسارات المفتوحة (بدون توكن)
    const openRoutes = [
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/otp/request",
      "/api/users/reset-password",
    ];

    // ✅ استثناء أي مسار يبدأ بمسار مفتوح
    if (openRoutes.some((route) => req.originalUrl.startsWith(route))) {
      return next();
    }

    // 🔹 استخراج التوكن من الهيدر
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    // 🔹 التحقق من التوكن
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error.message);
    res.status(500).json({ message: "Internal server error in authentication" });
  }
};
