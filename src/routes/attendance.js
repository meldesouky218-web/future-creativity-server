import express from "express";
import { pool } from "../db/connection.js";

const router = express.Router();

const getInterval = (range) => {
  switch ((range || "").toLowerCase()) {
    case "today":
    case "24h":
      return "1 day";
    case "7d":
    case "week":
      return "7 days";
    case "30d":
    case "month":
      return "30 days";
    default:
      return null;
  }
};

// Haversine distance in meters
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// سجل الحضور بالكامل
router.get("/", async (req, res) => {
  try {
    const interval = getInterval(req.query?.range);
    const whereClause = interval
      ? `WHERE a.timestamp >= NOW() - INTERVAL '${interval}'`
      : "";
    const query = `
      SELECT a.*, u.name as user_name, p.name as project_name
      FROM attendance a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN projects p ON a.project_id = p.id
      ${whereClause}
      ORDER BY a.timestamp DESC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch attendance" });
  }
});

// إنشاء سجل حضور
router.post("/", async (req, res) => {
  const {
    user_id,
    project_id,
    check_type,
    latitude,
    longitude,
    image_url,
    status,
    notes,
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO attendance (user_id, project_id, check_type, latitude, longitude, image_url, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        user_id,
        project_id,
        check_type,
        latitude,
        longitude,
        image_url,
        status,
        notes,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create attendance record" });
  }
});

// Check-in route
router.post("/checkin", async (req, res) => {
  const { project_id, latitude, longitude, image_url } = req.body;
  try {
    // Geofence validation
    const p = await pool.query(`SELECT location_lat, location_lng, radius FROM projects WHERE id=$1`, [project_id]);
    if (!p.rowCount) return res.status(404).json({ message: 'Project not found' });
    const plat = Number(p.rows[0].location_lat);
    const plng = Number(p.rows[0].location_lng);
    const radius = Number(p.rows[0].radius || 200); // meters
    if (isFinite(plat) && isFinite(plng) && isFinite(radius) && isFinite(latitude) && isFinite(longitude)) {
      const d = haversineMeters(plat, plng, Number(latitude), Number(longitude));
      if (d > radius * 1.2) { // 20% tolerance
        return res.status(400).json({ message: `Outside geofence (${Math.round(d)}m > ${radius}m)` });
      }
    }

    await pool.query(
      `INSERT INTO attendance (user_id, project_id, check_type, latitude, longitude, image_url, status)
       VALUES ($1,$2,'checkin',$3,$4,$5,'approved')`,
      [req.user.id, project_id, latitude, longitude, image_url]
    );
    res.json({ message: "Checked in successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to check in" });
  }
});

export default router;
