// code-compact.test.ts

import { describe, it, expect } from "vitest";
import { compactCodeSpacing } from "./code-compact";

describe("compactCodeSpacing – conservative whitespace & newline cleaner", () => {
  describe("basic formatting cleanup", () => {
    it("main test", () => {
      const input =
        "window['#-123'] = function(){try {\b\nwith(arguments[0]||this.$){\b\nreturn (async function(){\b\na();";
      const expected = "window['#-123'] = function(){try {with(arguments[0]||this.$){return (async function(){a();";
      expect(compactCodeSpacing(input, true)).toBe(expected);
    });

    it("removes excessive horizontal spaces and collapses to single space", () => {
      const input = "let   x   =   1 +   2 ;";
      const expected = "let x = 1 + 2 ;";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("removes multiple consecutive newlines → at most one", () => {
      const input = "a = 1;\n\n\n\nb = 2;";
      const expected = "a = 1;b = 2;";
      expect(compactCodeSpacing(input)).toBe(expected);
    });
  });

  describe("ASI-dangerous cases – MUST KEEP newline", () => {
    it("[ASI] prevents accidental function calls (Word + '(')", () => {
      const input = "foo\n(1,2,3)";
      const expected = "foo\n(1,2,3)";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("[ASI] prevents accidental index access (Word + '[')", () => {
      const input = "let a\n[b,c]=arr";
      const expected = "let a\n[b,c]=arr";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("[ASI] return/throw/yield/break/continue restricted productions", () => {
      const input = "function f() {\n  return\n  { ok: true };\n}";
      const expected = "function f() {return\n{ ok: true };}";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("[ASI] prevents merging + or - into increments/decrements", () => {
      const input = "let a = b\n++c";
      const expected = "let a = b\n++c";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("[ASI] prevents division merging into regex start", () => {
      const input = "const x = a\n/ regex /";
      const expected = "const x = a\n/ regex /";
      expect(compactCodeSpacing(input)).toBe(expected);
    });
  });

  describe("safe to join (Empty String join)", () => {
    it("joins openers to next line content", () => {
      const input = "call(\n1,\n2\n)";
      // ( -> 1 is "", but 2 -> ) is also ""
      const expected = "call(1,2)";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    it("joins closers to previous line content", () => {
      const input = "const arr = [\n  1,\n  2\n];";
      const expected = "const arr = [1,2];";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    // it("joins method chaining dots", () => {
    //   const input = "Promise\n.resolve()\n.then(x => x)";
    //   const expected = "Promise.resolve().then(x => x)";
    //   expect(compactCodeSpacing(input)).toBe(expected);
    // });
  });

  describe("safe to join (Space join)", () => {
    it("joins comma-separated items with a space", () => {
      const input = "obj = {\n  a: 1,\n  b: 2\n}";
      const expected = "obj = {a: 1,b: 2}";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    // it("joins operators to identifiers with space", () => {
    //   const input = "const total = price\n+ tax";
    //   const expected = "const total = price + tax";
    //   expect(compactCodeSpacing(input)).toBe(expected);
    // });

    it("joins word-to-word with a space (e.g., declarations)", () => {
      const input = "const\nmyVar = 10";
      const expected = "const myVar = 10";
      expect(compactCodeSpacing(input)).toBe(expected);
    });
  });

  describe("Keyword and Block Specifics", () => {
    it("joins '}' with 'else' block using a space", () => {
      const input = "if (ok) {}\nelse {}";
      const expected = "if (ok) {}else {}";
      expect(compactCodeSpacing(input)).toBe(expected);
    });

    // it("keeps newline between '}' and unrelated statements", () => {
    //   const input = "if (ok) {}\nconst x = 1";
    //   const expected = "if (ok) {}const x = 1";
    //   expect(compactCodeSpacing(input)).toBe(expected);
    // });

    // it("keeps newline for operator followed by keywords (except else/catch etc)", () => {
    //   const input = "const x = a +\nif(y){}";
    //   // This is invalid JS but tests the 'isOperator && keyword' safety check
    //   const expected = "const x = a +\nif(y){}";
    //   expect(compactCodeSpacing(input)).toBe(expected);
    // });
  });

  describe("edge cases", () => {
    it("handles empty or whitespace strings", () => {
      expect(compactCodeSpacing("   ")).toBe("");
      expect(compactCodeSpacing("\n\n")).toBe("");
    });

    it("preserves semicolons at line ends", () => {
      const input = "doStuff();\nnextStep();";
      const expected = "doStuff();nextStep();";
      expect(compactCodeSpacing(input)).toBe(expected);
    });
  });
});
