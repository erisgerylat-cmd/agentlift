import { readFile } from "node:fs/promises";

const expected = process.argv[2];
if (!expected) {
  process.stderr.write("Expected value is required\n");
  process.exitCode = 2;
} else {
  const actual = (await readFile("result.txt", "utf8")).trim();
  if (actual !== expected) {
    process.stderr.write(`Expected ${expected}, received ${actual}\n`);
    process.exitCode = 1;
  }
}
