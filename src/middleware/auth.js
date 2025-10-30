import jwt from "jsonwebtoken";

/**
 * ✅ Middleware للتحقق من JWT سواء من الكوكي أو الهيدر
 */
export const authMiddleware = (req, res, next) => {
  try {
    // ✅ المسارات المفتوحة (بدون توكن)
    const openRoutes = [
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/logout",
      "/api/auth/otp/request",
      "/api/users/reset-password",
      "/api/health",
    ];

    // ✅ استثناء المسارات المفتوحة أو health check
    if (openRoutes.some((route) => req.originalUrl.startsWith(route))) {
      return next();
    }

    // 🔍 نحاول قراءة التوكن من الكوكي أو الهيدر
    const token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : null);

    if (!token) {
      return res.status(401).json({ message: "Unauthorized - No token provided" });
    }

    // 🔑 التحقق من صحة التوكن
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("❌ Invalid token:", err.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    req.user = decoded; // ✅ تخزين بيانات المستخدم
    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error.message);
    res.status(500).json({ message: "Internal server error in authentication" });
  }
};
