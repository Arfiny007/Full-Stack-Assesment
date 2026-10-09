import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  use: {
    baseURL: process.env.BROWSER_BASE_URL ?? "http://127.0.0.1:3101",
    headless: true,
    launchOptions: { channel: "chrome" },
  },
  webServer: process.env.BROWSER_BASE_URL
    ? undefined
    : {
        command: "node --import tsx scripts/browser-server.ts",
        url: "http://127.0.0.1:3101",
        reuseExistingServer: false,
        timeout: 30000,
      },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
