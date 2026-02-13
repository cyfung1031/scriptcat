/**
 * Conservative JavaScript whitespace minimizer / line-joiner
 * 
 * Purpose:
 *   Removes unnecessary whitespace (especially newlines) while trying very hard
 *   NOT to change the meaning of the code due to Automatic Semicolon Insertion (ASI),
 *   regex literals, ++ / -- confusion, ASI-restricted productions (return/throw/break/yield),
 *   or accidental method calls / template literal splitting.
 *
 * Philosophy:
 *   • When in doubt → KEEP the newline
 *   • Only remove newline (or replace with space) when we are very confident it is safe
 *   • Sacrifices maximum minification for maximum safety
 *   • Safer than most one-line minifiers / tersers when input is already pretty-printed
 *
 * Main safety-preserving rules:
 *
 *   KEEP newline when:
 *   • identifier → (  [                 → would become function call / array access
 *   • identifier → + - /                → would become ++ -- or regex start
 *   • line ends with return|throw|yield|break|continue (restricted productions)
 *   • operator → else|while|catch|finally
 *   • template literal is open (odd number of backticks so far)
 *
 *   SAFE to remove newline (→ join directly) when:
 *   • , : ; → anything
 *   • after opener ( ( [ {
 *   • before closer ) ] }
 *   • } → else / while / catch / finally    (traditional style)
 *   • identifier → .
 *   • . → identifier / number
 *
 *   SAFE to replace newline with space when:
 *   • identifier/number → identifier/number   (const x  →  const x)
 *   • identifier/number → operator
 *   • operator          → identifier/number
 *
 * Usage examples:
 *
 *   compactCodeSpacing(`
 *     const x = 3
 *     function hello() {
 *       return x + 1
 *     }
 *   `)
 *   // → "const x = 3 function hello() {return x + 1\n}"
 *
 *   compactCodeSpacing(`
 *     obj
 *       .method()
 *       .chain()
 *   `)
 *   // → "obj.method()\n.chain()"
 *
 * Flags:
 *   withEndingBackSpaceOnly = true
 *     → only removes newline when previous line ends with \b (backspace)
 *       (very conservative mode, mostly useful for generated code pipelines)
 *
 * @param code                     source code to compact
 * @param withEndingBackSpaceOnly  only join lines that end with \b (default: false)
 * @returns                        compacted code (still readable, not aggressively minified)
 */
export const compactCodeSpacing = (code: string, withEndingBackSpaceOnly: boolean = false) => {
  if (typeof code !== "string" || !code.trim()) return "";

  /*
    | prev (end of line) | next (start of line)    | Safe? | Typical reason / risk level            |
    |--------------------|-------------------------|-------|----------------------------------------|
    | word / digit       | ( [ + - /               | NO    | ASI risk: accidental call/regex/op     |
    | return/throw/etc   | anything                | NO    | Restricted production (ASI)            |
    | , : ;              | anything                | YES   | Standard delimiters                    |
    | operator           | else/while/catch/etc    | NO    | Potential syntax/logic ambiguity       |
    | }                  | else/while/catch/etc    | YES   | Traditional block continuation         |
    | ( [ { (Openers)    | anything                | YES   | Expression/Block start                 |
    | anything           | ) ] } (Closers)         | YES   | Expression/Block end                   |
    | .                  | word / digit            | YES   | Property access                        |
    | word / digit       | .                       | YES   | Method chaining                        |
    | operator           | word / digit            | YES   | Binary operator continuation           |
    | word / digit       | word / digit            | YES* | Joined with space (e.g., const x)      |
    | anything           | operator                | YES* | Joined with space (e.g., x + y)        |
  */

  const isLetterOrDigit = (x: string) => /[0-9a-zA-Z]/.test(x);
  const isOperator = (x: string) => /[*/%&|^!~=<>?:+-]/.test(x);
  const isVarName = (x: string) => /[\w$]/.test(x);
  const isOpener = (x: string) => /[({[]/.test(x);
  const isCloser = (x: string) => /[)}\]]/.test(x);
  // eslint-disable-next-line no-control-regex
  const trimLine = (x: string) => x.replace(/\s*\x08\s*$/, "").trim();

  // eslint-disable-next-line no-control-regex
  code = code.replace(/\s*\x08\s*$/, "").trim();
  code = code.replace(/\r\n?/g, "\n");

  code = code.replace(/\s+/g, (x) => {
    const s = [...x];
    let last = null;
    let r = "";
    for (const c of s) {
      if (c !== last) {
        last = c;
        r += c;
      }
    }
    return r;
  });
  const lines = code.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) return "";

  let prevLine = trimLine(lines[0]);
  const result = [prevLine];
  const countQ = (x: string) => {
    const p = x.split("`").length;
    return p > 1 ? p - x.split("\\`").length : 0;
  };
  let q = countQ(prevLine);

  for (let i = 1; i < lines.length; i++) {
    const q0 = q;
    const currentLine = trimLine(lines[i]);
    q += countQ(currentLine);
    const prevChar = prevLine[prevLine.length - 1];
    const nextChar = currentLine[0];
    let newlineChar = "\n";

    const doTrim = withEndingBackSpaceOnly ? lines[i - 1].indexOf("\b") === lines[i - 1].length - 1 : true;

    if (doTrim) {
      let skipByReturnThrow = false;
      if ((q0 & 1) === 0 && /\b(return|throw)\b/.test(prevLine)) {
        skipByReturnThrow = true;
        const a = prevLine.lastIndexOf("return");
        const b = prevLine.lastIndexOf("throw");
        const c = Math.max(a, b);
        const d = prevLine.substring(c);
        if ((d.split("(").length & 1) ^ (d.split(")").length & 1)) skipByReturnThrow = false;
        else if ((d.split("{").length & 1) ^ (d.split("}").length & 1)) skipByReturnThrow = false;
        else if ((d.split("[").length & 1) ^ (d.split("]").length & 1)) skipByReturnThrow = false;
        else if (prevLine.endsWith(";")) skipByReturnThrow = false;
      }
      if (skipByReturnThrow) {
        // ignore
      } else if ((q0 & 1) === 0) {
        // --- HIGH RISK / MUST KEEP NEWLINE ---
        if (isVarName(prevChar) && (nextChar === "(" || nextChar === "[")) {
          newlineChar = "\n"; // Prevent accidental function calls or index access
        } else if (isVarName(prevChar) && (nextChar === "+" || nextChar === "-" || nextChar === "/")) {
          newlineChar = "\n"; // Prevent a + \n +b becoming a++b or / becoming regex
        } else if (/\b(return|throw|break|continue|yield)$/.test(prevLine)) {
          newlineChar = "\n"; // ASI restricted productions
        } else if (isOperator(prevChar) && /^(else|while|catch|finally)\b/.test(currentLine)) {
          newlineChar = "\n"; // Logic separation
        }

        // --- SAFE TO REMOVE (REPLACE WITH EMPTY) ---
        else if (prevChar === "," || prevChar === ":" || prevChar === ";") {
          newlineChar = "";
        } else if (isOpener(prevChar)) {
          newlineChar = ""; // After ( [ {
        } else if (isCloser(nextChar)) {
          newlineChar = ""; // Before ) ] }
        } else if (isCloser(prevChar) && !/^(else|while|catch|finally)\b/.test(currentLine)) {
          // } followed by anything else: check nextChar
          if (isCloser(nextChar) || nextChar === ";" || nextChar === ",") newlineChar = "";
          else newlineChar = "\n";
        } else if (prevChar === "}" && /^(else|while|catch|finally)\b/.test(currentLine)) {
          newlineChar = "";
        } else if (prevChar === "." && isLetterOrDigit(nextChar)) {
          newlineChar = "";
        } else if (isVarName(prevChar) && nextChar === ".") {
          newlineChar = "";
        }

        // --- SAFE TO REMOVE (REPLACE WITH SPACE FOR TOKEN SEPARATION) ---
        else if (isOperator(prevChar) && isLetterOrDigit(nextChar)) {
          newlineChar = " ";
        } else if (isLetterOrDigit(prevChar) && isOperator(nextChar)) {
          newlineChar = " ";
        } else if (isLetterOrDigit(prevChar) && isLetterOrDigit(nextChar)) {
          newlineChar = " "; // e.g., "const x"
        }
      }
    }

    result.push(`${newlineChar}${currentLine}`);
    prevLine = currentLine;
  }

  return result.join("").trim();
};
