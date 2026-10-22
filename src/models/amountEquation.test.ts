import { describe, expect, it } from "vitest";
import { evaluateAmount, padPress, padStart, type PadKey, type PadState } from "./amountEquation";

describe("evaluateAmount", () => {
  it("reads a plain amount as the new total", () => {
    expect(evaluateAmount("250", 12000)).toBe(25000);
    expect(evaluateAmount(" 12.5 ", 0)).toBe(1250);
  });

  it("adds and takes away, left to right", () => {
    expect(evaluateAmount("120.00 + 50", 0)).toBe(17000);
    expect(evaluateAmount("120 + 50 − 10.25", 0)).toBe(15975);
    expect(evaluateAmount("100-30+5", 0)).toBe(7500);
  });

  it("starts from the current amount when it begins with a sign", () => {
    expect(evaluateAmount("+50", 12000)).toBe(17000);
    expect(evaluateAmount("− 20", 12000)).toBe(10000);
    expect(evaluateAmount("-20", 12000)).toBe(10000);
  });

  it("rounds each term to the cent", () => {
    expect(evaluateAmount("1.005 + 1.005", 0)).toBe(202);
  });

  it("can come out negative (the caller decides whether that is allowed)", () => {
    expect(evaluateAmount("10 − 25", 0)).toBe(-1500);
  });

  it("rejects what is not an equation", () => {
    for (const text of ["", "  ", "abc", "50 +", "50 + + 5", "5 +- 2", "+", "12c"]) {
      expect(evaluateAmount(text, 100)).toBeNull();
    }
  });
});

const press = (state: PadState, keys: PadKey[]) => keys.reduce(padPress, state);

describe("padPress", () => {
  it("replaces the opening amount when a digit comes first", () => {
    expect(press(padStart("120.00"), ["5", "0"])).toEqual({ text: "50", fresh: false });
  });

  it("builds on the opening amount with + or −", () => {
    expect(press(padStart("120.00"), ["+", "5", "0"]).text).toBe("120.00 + 50");
    expect(press(padStart("120.00"), ["−", "2", "0"]).text).toBe("120.00 − 20");
  });

  it("swaps a sign pressed straight after another", () => {
    expect(press(padStart("120.00"), ["+", "−"]).text).toBe("120.00 − ");
  });

  it("chains several terms", () => {
    expect(press(padStart("10.00"), ["+", "5", "−", "2"]).text).toBe("10.00 + 5 − 2");
  });

  it("allows one decimal point and two decimals per term", () => {
    expect(press(padStart("0.00"), [".", "5", ".", "5", "5"]).text).toBe("0.55");
    expect(press(padStart("1.00"), ["+", "1", ".", "2", "5", "9"]).text).toBe("1.00 + 1.25");
  });

  it("drops leading zeros", () => {
    expect(press(padStart("0.00"), ["0", "0", "7"]).text).toBe("7");
  });

  it("backspace clears the opening amount, then removes one key at a time", () => {
    expect(press(padStart("120.00"), ["back"]).text).toBe("");
    expect(press(padStart("120.00"), ["+", "5", "back"]).text).toBe("120.00 + ");
    expect(press(padStart("120.00"), ["+", "back"]).text).toBe("120.00");
  });

  it("a sign on an empty pad starts from zero", () => {
    expect(press(padStart("120.00"), ["back", "+", "5"]).text).toBe("0.00 + 5");
  });

  it("works out what the pad shows", () => {
    const state = press(padStart("120.00"), ["+", "5", "0", "−", "1", "0"]);
    expect(evaluateAmount(state.text, 12000)).toBe(16000);
  });
});
