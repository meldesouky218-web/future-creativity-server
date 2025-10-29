# Future Creativity API (Express + PostgreSQL)

Production-ready API for the Future Creativity Platform: authentication + staff management + projects + attendance + payroll + documents + logs.

## Requirements

- Node.js 18+ (or 20+ recommended)
- PostgreSQL 13+

## Quick start

```
cd future-creativity-server
npm ci
cp .env.example .env   # Fill values
npm run dev            # Starts server with auto-migrate
```

Server listens on `PORT` (default 5000). A health check is available at `/`.

## Environment variables (.env)

See `.env.example` for a complete list. Key ones:

- `PORT=5000`
- `DATABASE_URL=postgresql://USER:PASS@HOST:5432/futurecreativity`
- `JWT_SECRET=change-me`
- SMTP configuration for OTP emails: `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE`

## Scripts

- `npm run dev` – start with nodemon (auto-migrate on boot)
- `npm start` – start in production mode
- `npm run seed` – seed demo data (users/projects/assignments/attendance/payroll/logs/documents/expenses)

## File uploads

- Local uploads are served at `/uploads/*` (directories created on boot).
- For production, consider S3 + presigned URLs in a future iteration.

## CORS

By default, CORS allows `http://localhost:3000`. Adjust `src/app.js` for your deployed frontend origins (e.g., `https://app.example.com`).

## Structure (high-level)

- `src/app.js` – server bootstrap, routes mounting, CORS, static uploads
- `src/routes/*` – feature routes (auth, users, staff, projects, attendance, payroll, dashboard, logs, push)
- `src/db/` – PostgreSQL connection + auto-migration
- `src/utils/` – helpers (logger, email, otp, seeding)

## Notes

- Migrations are idempotent and run on every start via `migrate()`.
- Upload directories: `uploads/projects`, `uploads/contracts`, `uploads/users`.

