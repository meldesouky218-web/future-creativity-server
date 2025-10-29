export const PayrollModel = `
CREATE TABLE IF NOT EXISTS payroll (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id),
  user_id INT REFERENCES users(id),
  total_days INT,
  total_amount DECIMAL,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

