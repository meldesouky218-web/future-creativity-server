export const ProjectModel = `
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  description TEXT,
  location_lat DECIMAL,
  location_lng DECIMAL,
  radius INT DEFAULT 200,
  start_date DATE,
  end_date DATE,
  pay_type VARCHAR(20),
  pay_rate DECIMAL,
  allowances JSON,
  supervisor_id INT REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'Active'
);
`;

