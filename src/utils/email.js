import nodemailer from "nodemailer";

let transporter;

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  SMTP_FROM,
} = process.env;

function ensureTransporter() {
  if (transporter) return transporter;

  if (!SMTP_HOST) {
    throw new Error("SMTP config missing: SMTP_HOST/PORT/USER/PASS required");
  }

  const port = Number(SMTP_PORT) || 587;
  const secure =
    String(SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth:
      SMTP_USER && SMTP_PASS
        ? {
            user: SMTP_USER,
            pass: SMTP_PASS,
          }
        : undefined,
  });

  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const tx = ensureTransporter();
  const fromAddress = SMTP_FROM || SMTP_USER;
  if (!fromAddress) {
    throw new Error("SMTP_FROM or SMTP_USER must be provided");
  }

  await tx.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
  });
}

export async function sendOtpEmail({ to, code, purpose, expiresIn }) {
  const readablePurpose =
    purpose === "reset_password" ? "Password Reset" : "Account Verification";

  const subject = `Your Future Creativity ${readablePurpose} Code`;

  const html = `
  <div style="font-family:Arial, sans-serif; background:#0B101C; padding:28px; color:#EDEDED;">
    <div style="max-width:520px; margin:0 auto; background:#101624; border:1px solid #1F2837; border-radius:12px; padding:24px;">
      <h2 style="color:#C2A14A; margin:0 0 8px;">Future Creativity</h2>
      <p style="margin:0 0 14px;">Use the following code to complete your <strong>${readablePurpose}</strong> request.</p>
      <div style="text-align:center; font-size:32px; letter-spacing:4px; font-weight:bold; background:#0D745D; color:#fff; padding:12px 0; border-radius:10px; margin:20px 0;">
        ${code}
      </div>
      <p style="margin:0 0 16px; color:#BDBDBD;">This code expires in <strong>${expiresIn}</strong> minutes.</p>
      <p style="margin:0; color:#8C8C8C; font-size:12px;">If you didn’t request it, you can ignore this email.</p>
    </div>
  </div>`;

  const text = `Your OTP is ${code}. It expires in ${expiresIn} minutes.`;

  await sendEmail({ to, subject, text, html });
}