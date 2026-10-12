import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits rows and cells, with line numbers", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["1", "2", "3"] },
    ]);
  });

  it("handles Windows line endings, a trailing newline, and blank lines", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 3, cells: ["1", "2"] },
    ]);
  });

  it("reads quoted cells containing commas, quotes and line breaks", () => {
    expect(parseCsv('"Food, dining","Say ""hi""","two\nlines"\nnext,row,x')).toEqual([
      { line: 1, cells: ["Food, dining", 'Say "hi"', "two\nlines"] },
      { line: 3, cells: ["next", "row", "x"] },
    ]);
  });

  it("drops a byte-order mark and keeps empty cells", () => {
    expect(parseCsv("﻿a,,c")).toEqual([{ line: 1, cells: ["a", "", "c"] }]);
  });

  it("rejects a quote that is never closed", () => {
    expect(() => parseCsv('a,"open\nb')).toThrow(CsvError);
  });
});
