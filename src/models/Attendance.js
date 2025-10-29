export const AttendanceModel = `
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  project_id INT REFERENCES projects(id),
  check_type VARCHAR(10),
  latitude DECIMAL,
  longitude DECIMAL,
  image_url TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending',
  approved_by INT,
  notes TEXT
);
`;

