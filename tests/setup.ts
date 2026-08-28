import path from "path";
import os from "os";

process.env.SPELOCK_DB_PATH = path.join(
  os.tmpdir(),
  `speclock-test-${process.pid}.db`
);
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_UNPOOLED;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;
process.env.ALLOW_MOCK_PAYMENTS = "true";
process.env.SPELOCK_INTERNAL_SECRET = "test-internal-secret";
process.env.X402_DEMO_AGENT_KEY = "test-demo-key";
process.env.MANDATE_SIGNING_SECRET = "test-only-mandate-signing-secret";
