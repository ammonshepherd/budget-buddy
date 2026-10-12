import { describe, expect, it } from "vitest";
import { parseRoute } from "./routes";

describe("parseRoute", () => {
  it("reads known routes regardless of case or a leading slash", () => {
    expect(parseRoute("#accounts")).toBe("accounts");
    expect(parseRoute("#/Settings")).toBe("settings");
  });

  it("falls back to Budget", () => {
    expect(parseRoute("")).toBe("budget");
    expect(parseRoute("#nope")).toBe("budget");
  });
});
