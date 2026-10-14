import { describe, expect, it } from "vitest";
import { UserFacingError } from "./dataStore";
import {
  fillRest,
  leftToSplit,
  linesFromAllocations,
  MAX_SPLIT_LINES,
  splitAllocations,
  type SplitLine,
} from "./splits";

const line = (envelopeId: string, amount: string): SplitLine => ({ envelopeId, amount });

describe("leftToSplit", () => {
  it("is what the lines do not cover yet, negative when they are over", () => {
    expect(leftToSplit(5_000, [line("a", "20"), line("b", "")])).toBe(3_000);
    expect(leftToSplit(5_000, [line("a", "20"), line("b", "30")])).toBe(0);
    expect(leftToSplit(5_000, [line("a", "20"), line("b", "40.01")])).toBe(-1_001);
  });

  it("counts a line that is not a number yet as nothing", () => {
    expect(leftToSplit(5_000, [line("a", "abc"), line("b", "-5")])).toBe(5_000);
  });
});

describe("splitAllocations", () => {
  it("gives every line the transaction's sign", () => {
    expect(splitAllocations(-5_000, [line("a", "20"), line("b", "30")])).toEqual([
      { envelopeId: "a", amount: -2_000 },
      { envelopeId: "b", amount: -3_000 },
    ]);
    expect(splitAllocations(5_000, [line("a", "20"), line("b", "30")])).toEqual([
      { envelopeId: "a", amount: 2_000 },
      { envelopeId: "b", amount: 3_000 },
    ]);
  });

  it("explains what is wrong with the lines", () => {
    const fails = (amount: number, lines: SplitLine[], message: RegExp) => {
      expect(() => splitAllocations(amount, lines)).toThrow(UserFacingError);
      expect(() => splitAllocations(amount, lines)).toThrow(message);
    };
    fails(-5_000, [line("", "50")], /Choose an envelope/);
    fails(-5_000, [line("a", "20"), line("a", "30")], /only once/);
    fails(-5_000, [line("a", "2x")], /like 12\.34/);
    fails(-5_000, [line("a", "0"), line("b", "50")], /above zero/);
    fails(-5_000, [line("a", ""), line("b", "50")], /above zero/);
    fails(-5_000, [line("a", "50"), line("b", "")], /above zero/);
    fails(-5_000, [line("a", "-10"), line("b", "60")], /above zero/);
    fails(-5_000, [line("a", "20"), line("b", "")], /\$30\.00 is not in an envelope/);
    fails(-5_000, [line("a", "20"), line("b", "20")], /\$10\.00 is not in an envelope/);
    fails(-5_000, [line("a", "20"), line("b", "40")], /\$10\.00 more than the amount/);
    const many = Array.from({ length: MAX_SPLIT_LINES + 1 }, (_, i) => line(`e${i}`, "1"));
    fails(-100 * many.length, many, /at most 50/);
  });
});

describe("fillRest", () => {
  it("adds what is left to one line", () => {
    expect(fillRest(5_000, [line("a", "20"), line("b", "")], 1)).toEqual([
      line("a", "20"),
      line("b", "30.00"),
    ]);
    expect(fillRest(5_000, [line("a", "20"), line("b", "10")], 1)[1]).toEqual(line("b", "30.00"));
  });

  it("changes nothing when nothing is left", () => {
    const lines = [line("a", "20"), line("b", "40")];
    expect(fillRest(5_000, lines, 1)).toEqual(lines);
  });
});

describe("linesFromAllocations", () => {
  it("shows each allocation as a positive amount", () => {
    expect(
      linesFromAllocations([
        { envelopeId: "a", amount: -1_250 },
        { envelopeId: "b", amount: -3_750 },
      ]),
    ).toEqual([line("a", "12.50"), line("b", "37.50")]);
  });
});
