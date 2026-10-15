import { describe, expect, it } from "vitest";
import { assertTestTarget, isTestTarget } from "./testTarget";

describe("isTestTarget", () => {
  it("allows the test project and a local Supabase", () => {
    expect(isTestTarget("https://kiqbgjgvptgknmboazaq.supabase.co")).toBe(true);
    expect(isTestTarget("http://127.0.0.1:54321")).toBe(true);
    expect(isTestTarget("http://localhost:54321")).toBe(true);
  });

  it("refuses production, look-alikes and missing URLs", () => {
    expect(isTestTarget("https://lkaurrcarzzkbqdwqfge.supabase.co")).toBe(false);
    expect(isTestTarget("https://kiqbgjgvptgknmboazaq.supabase.co.evil.example")).toBe(false);
    expect(isTestTarget("https://evil.example/kiqbgjgvptgknmboazaq")).toBe(false);
    expect(isTestTarget("not a url")).toBe(false);
    expect(isTestTarget(undefined)).toBe(false);
    expect(() => assertTestTarget("https://lkaurrcarzzkbqdwqfge.supabase.co")).toThrow(/Refusing/);
  });
});
