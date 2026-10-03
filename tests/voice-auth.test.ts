import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ claims: vi.fn(), user: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: mock.claims, getUser: mock.user },
  }),
}));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: () => {
    throw new Error("Unexpected database read");
  },
}));
import { voiceActor } from "../src/lib/product/auth";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
});
afterEach(() => vi.unstubAllEnvs());
describe("verified voice upload identity", () => {
  it("uses verified Supabase claims without a merchant database read", async () => {
    mock.claims.mockResolvedValue({
      data: { claims: { sub: "verified-user" } },
      error: null,
    });
    expect(await voiceActor()).toBe("verified-user");
    expect(mock.claims).toHaveBeenCalledWith();
    expect(mock.user).not.toHaveBeenCalled();
  });
  it("refuses invalid signatures, expired sessions and missing subjects", async () => {
    mock.claims
      .mockResolvedValueOnce({
        data: null,
        error: { message: "invalid signature" },
      })
      .mockResolvedValueOnce({ data: null, error: { message: "expired" } })
      .mockResolvedValueOnce({ data: { claims: {} }, error: null });
    for (let i = 0; i < 3; i++)
      await expect(voiceActor()).rejects.toThrow("UNAUTHENTICATED");
  });
});
