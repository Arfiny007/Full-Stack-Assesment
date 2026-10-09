import "dotenv/config";
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error("TEST_DATABASE_URL is required; copy .env.example to .env");
const parsed = new URL(testUrl);
if (!parsed.pathname.endsWith("_test") || testUrl === process.env.DATABASE_URL)
  throw new Error("Tests require a separate database with a name ending _test");
process.env.DATABASE_URL = testUrl;
process.env.CANDIDATE_ID = "";
