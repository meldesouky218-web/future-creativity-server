import "dotenv/config";
import { sendOtpEmail } from "./email.js";

async function main() {
  try {
    const to = process.env.SMTP_USER; // ابعت لنفس الإيميل للتجربة
    await sendOtpEmail({
      to,
      code: "123456",
      purpose: "reset_password",
      expiresIn: 10,
    });
    console.log("✅ Test email dispatched to:", to);
  } catch (error) {
    console.error("❌ Failed to send test email");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
  }
}

main();