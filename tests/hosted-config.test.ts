import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
const check = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["scripts/check-hosted-env.mjs"], {
    encoding: "utf8",
      env: { ...env, NODE_ENV: "test" },
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it("refuses to start a hosted server without shared database/account settings", () => {
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL");
  expect(result.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
});
it("allows configured startup without exposing credential values", () => {
  const result = check({
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "fictional-secret",
  });
  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).not.toMatch(/fictional|test.supabase/);
});
it("rejects whitespace-only required settings", () => {
  expect(
    check({
      NEXT_PUBLIC_SUPABASE_URL: "  ",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "example",
      SUPABASE_SERVICE_ROLE_KEY: "example",
    }).status,
  ).toBe(1);
});
it("does not fall back to local merchant files on Render", async () => {
  vi.resetModules();
  vi.stubEnv("RENDER", "true");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const { withNetwork } = await import("../src/lib/product/repository");
  await expect(withNetwork(() => "not allowed")).rejects.toThrow(
    "DATABASE_REQUIRED",
  );
});
