// 🧩 Middleware للتحقق من صلاحيات المستخدم حسب الدور
export const roleMiddleware = (allowedRoles = []) => {
  return (req, res, next) => {
    // ✅ لو مفيش مستخدم أصلاً (يعني مفيش توكن)
    if (!req.user) {
      return res.status(403).json({ message: "Access denied: no user context" });
    }

    const { role } = req.user;

    // ✅ لو الدور غير موجود أو غير مسموح به
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ message: "Access denied: insufficient role" });
    }

    // ✅ مسموح له بالمتابعة
    next();
  };
};
