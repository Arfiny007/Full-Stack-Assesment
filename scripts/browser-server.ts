// Reuse the same dedicated-database guard as the PostgreSQL integration suite.
import "../tests/setup.js";
process.env.PORT = "3101";
const { migrate } = await import("../backend/shared/db/migrate.js");
await migrate();
await import("../backend/server.js");
