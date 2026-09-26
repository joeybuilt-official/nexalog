import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["nexalog"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
