export const UserModel = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  age INT,
  nationality VARCHAR(50),
  phone VARCHAR(20),
  email VARCHAR(100) UNIQUE,
  password VARCHAR(255),
  role VARCHAR(50) DEFAULT 'staff',
  job_title VARCHAR(100),
  experience TEXT,
  notes TEXT,
  profile_image TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

