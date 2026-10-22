import { describe, expect, it } from "vitest";
import { exactOption, matchOptions, type PickerOption } from "./envelopeSearch";

const options: PickerOption[] = [
  { value: "", label: "Uncategorized" },
  { value: "g", label: "Groceries", group: "Everyday", detail: "has $50.00" },
  { value: "c", label: "Car insurance", group: "Bills" },
  { value: "p", label: "Phone", group: "Bills" },
  { value: "i", label: "Income (to Available to Assign)", disabled: true },
];

const values = (typed: string) => matchOptions(options, typed).map((o) => o.value);

describe("matchOptions", () => {
  it("shows everything when nothing is typed", () => {
    expect(values("  ")).toEqual(["", "g", "c", "p", "i"]);
  });

  it("matches the start of any word, ignoring case", () => {
    expect(values("gro")).toEqual(["g"]);
    expect(values("INS")).toEqual(["c"]);
  });

  it("needs every word typed, in any order", () => {
    expect(values("car ins")).toEqual(["c"]);
    expect(values("ins car")).toEqual(["c"]);
    expect(values("car phone")).toEqual([]);
  });

  it("matches the group name too", () => {
    expect(values("bills")).toEqual(["c", "p"]);
  });

  it("ignores punctuation in what is typed", () => {
    expect(values("income (to")).toEqual(["i"]);
  });

  it("does not match the middle of a word", () => {
    expect(values("ocer")).toEqual([]);
  });
});

describe("exactOption", () => {
  it("finds the choice with exactly the typed name", () => {
    expect(exactOption(options, "  groceries ")?.value).toBe("g");
    expect(exactOption(options, "Gro")).toBeUndefined();
  });

  it("never returns a disabled choice", () => {
    expect(exactOption(options, "Income (to Available to Assign)")).toBeUndefined();
  });
});
