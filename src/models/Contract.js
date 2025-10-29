export const ContractModel = `
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  project_id INT REFERENCES projects(id),
  file_url TEXT,
  uploaded_by INT,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

