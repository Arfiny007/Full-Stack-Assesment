import 'dotenv/config';
import { app } from './app.js';
import { pool } from './shared/db/index.js';
import { startMqtt } from './modules/mqtt/worker.js';
async function main() {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; copy .env.example to .env');
  await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
  const stopMqtt=startMqtt();
  const server=app.listen(Number(process.env.PORT??3000),()=>console.log(`HTTP listening on http://localhost:${process.env.PORT??3000}`));
  let closing=false;
  async function shutdown() {
    if(closing)return;closing=true;
    const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();
    server.close(async()=>{await stopMqtt();await pool.end();clearTimeout(timeout);});
  }
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
main().catch(error=>{console.error(error);process.exitCode=1;pool.end();});
