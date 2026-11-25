import { expect, test } from "bun:test";
import { chunk } from "./sarvam";

test("chunk keeps text, splits on sentences, never exceeds the limit", () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something about the outage.`).join(" ");
  const parts = chunk(text, 200);
  expect(parts.join("")).toBe(text);
  expect(parts.every((p) => p.length <= 200)).toBe(true);
  expect(parts.slice(0, -1).every((p) => /\.\s*$/.test(p))).toBe(true);
  const long = "word ".repeat(1000); // one "sentence" longer than the limit
  expect(chunk(long, 1800).every((p) => p.length <= 1800)).toBe(true);
  expect(chunk(long, 1800).join("")).toBe(long);
  expect(chunk("short")).toEqual(["short"]);
});
