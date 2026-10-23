import { describe, expect, it } from "vitest";
import { editEntry, fillCents, startEntry, type AmountEntry } from "./amountEntry";

/** Types each key at the end of the field, as a person would. */
const type = (entry: AmountEntry, keys: string) =>
  [...keys].reduce((state, key) => editEntry(state, state.text + key, key), entry);
const backspace = (entry: AmountEntry) => editEntry(entry, entry.text.slice(0, -1), null);

describe("fillCents", () => {
  it("fills digits in from the right", () => {
    expect(fillCents("1")).toBe("0.01");
    expect(fillCents("12")).toBe("0.12");
    expect(fillCents("123")).toBe("1.23");
    expect(fillCents("123456")).toBe("1234.56");
  });

  it("ignores anything but digits, and leading zeros", () => {
    expect(fillCents("$1,2.3")).toBe("1.23");
    expect(fillCents("0005")).toBe("0.05");
    expect(fillCents("0")).toBe("0.00");
    expect(fillCents("0.0", true)).toBe("");
    expect(fillCents("0.00 + 0.0", true)).toBe("0.00 + ");
  });

  it("keeps signs and fills each amount on its own", () => {
    expect(fillCents("-123")).toBe("-1.23");
    expect(fillCents("120.00 + 5")).toBe("120.00 + 0.05");
    expect(fillCents("+50")).toBe("+0.50");
    expect(fillCents("1 − ")).toBe("0.01 − ");
    expect(fillCents("0.00 + 5")).toBe("0.00 + 0.05");
  });
});

describe("editEntry", () => {
  it("fills in cents first as digits are typed", () => {
    const entry = startEntry("");
    expect(type(entry, "1").text).toBe("0.01");
    expect(type(entry, "12").text).toBe("0.12");
    expect(type(entry, "123").text).toBe("1.23");
    expect(type(entry, "4520").text).toBe("45.20");
  });

  it("a typed 0 shows as 0.00, and the next digit fills in after it", () => {
    expect(type(startEntry(""), "0").text).toBe("0.00");
    expect(type(startEntry(""), "05").text).toBe("0.05");
  });

  it("keeps a leading minus sign", () => {
    expect(type(startEntry(""), "-4520").text).toBe("-45.20");
  });

  it("shifts digits back out on backspace and empties at zero", () => {
    let entry = type(startEntry(""), "123");
    entry = backspace(entry);
    expect(entry.text).toBe("0.12");
    entry = backspace(backspace(entry));
    expect(entry).toEqual({ text: "", centsFirst: true });
  });

  it("carries on from an amount the field opened with", () => {
    expect(type(startEntry("120.00"), "5").text).toBe("1200.05");
    expect(backspace(startEntry("120.00")).text).toBe("12.00");
  });

  it("a typed period turns the digits so far into dollars and keeps text as typed", () => {
    const entry = type(startEntry(""), "12.5");
    expect(entry).toEqual({ text: "12.5", centsFirst: false });
    expect(type(startEntry(""), ".5").text).toBe("0.5");
    expect(type(startEntry("120.00 + "), "5.").text).toBe("120.00 + 5.");
  });

  it("a period typed anywhere else is kept as it is", () => {
    expect(editEntry(startEntry("1.23"), "1.2.3", ".")).toEqual({
      text: "1.2.3",
      centsFirst: false,
    });
  });

  it("takes a pasted amount as it is", () => {
    expect(editEntry(startEntry(""), "$1,234.56", "$1,234.56")).toEqual({
      text: "$1,234.56",
      centsFirst: false,
    });
    expect(editEntry(startEntry(""), "45", "45").text).toBe("45");
  });

  it("goes back to cents first once the field is emptied", () => {
    let entry = type(startEntry(""), "1.");
    entry = backspace(backspace(entry));
    expect(entry).toEqual({ text: "", centsFirst: true });
    expect(type(entry, "99").text).toBe("0.99");
  });
});
