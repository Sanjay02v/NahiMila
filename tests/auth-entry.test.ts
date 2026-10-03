import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { seedJudgeDemo } from "../src/lib/product/demo";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  cookies: vi.fn(),
}));
let network = seedJudgeDemo();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookies }),
}));
vi.mock("../src/lib/product/auth", () => ({
  actor: mocks.actor,
  login: mocks.login,
  logout: mocks.logout,
  register: mocks.register,
}));
vi.mock("../src/lib/product/repository", () => ({
  remote: null,
  withNetwork: async (fn: (n: typeof network) => unknown) => fn(network),
}));
import { POST } from "../src/app/api/auth/route";
const post = (b: unknown) =>
  POST(
    new Request("http://localhost/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": crypto.randomUUID(),
      },
      body: JSON.stringify(b),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  network = seedJudgeDemo();
  mocks.actor.mockResolvedValue(network.shops[0].user_id);
});
afterEach(() => vi.unstubAllEnvs());
describe("judge entry and signup", () => {
  it("opens only the fixed fictional shop with server-side credentials", async () => {
    vi.stubEnv("NML_DEMO_PASSWORD", "private-server-test-password");
    const response = await post({ action: "demo" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ onboarded: true, locale: "en" });
    expect(mocks.login).toHaveBeenCalledWith(
      "sharma@demo.nahimila.local",
      "private-server-test-password",
    );
  });
  it("refuses user-selected credentials or a mismatched demo user", async () => {
    expect(
      (await post({ action: "demo", email: "real@example.invalid" })).status,
    ).toBe(400);
    expect(mocks.login).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue("other-user");
    expect((await post({ action: "demo" })).status).toBe(403);
    expect(mocks.logout).toHaveBeenCalled();
  });
  it("handles required email confirmation as a successful pending signup", async () => {
    mocks.register.mockResolvedValue({ confirmationRequired: true });
    const response = await post({
      action: "register",
      email: "new@example.invalid",
      password: "long-test-password",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      check_email: true,
      onboarded: false,
    });
    expect(mocks.actor).not.toHaveBeenCalled();
  });
  it("sends a verified newly registered user to empty onboarding", async () => {
    mocks.register.mockResolvedValue({ confirmationRequired: false });
    mocks.actor.mockResolvedValue(crypto.randomUUID());
    const response = await post({
      action: "register",
      email: "new@example.invalid",
      password: "long-test-password",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ onboarded: false });
  });
  it("cannot create a signup without valid credentials", async () => {
    expect(
      (await post({ action: "register", email: "bad", password: "short" }))
        .status,
    ).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
