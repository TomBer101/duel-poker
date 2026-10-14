import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "./cleanup.js";

describe("cleanup auth", () => {
  afterEach(() => vi.unstubAllEnvs());

  test.each<[string, string | undefined, string | null]>([
    ["no CRON_SECRET configured", undefined, "Bearer undefined"],
    ["no Authorization header", "s3cret", null],
    ["wrong secret", "s3cret", "Bearer nope"],
  ])("rejects: %s", async (_name, secret, header) => {
    vi.stubEnv("CRON_SECRET", secret ?? "");
    const headers = header ? { authorization: header } : undefined;
    const res = await GET(new Request("http://localhost/api/cleanup", { headers }));
    expect(res.status).toBe(401);
  });
});
