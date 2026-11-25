import { expect, test } from "bun:test";
import { extractJson, parseAnswer, systemPrompt } from "./assistant";

test("extractJson handles whitespace, fences, prose and braces inside strings", () => {
  expect(extractJson('\n\n  {"a":1}')).toEqual({ a: 1 });
  expect(extractJson('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } });
  expect(extractJson('Sure! Here it is: {"s":"x { y } \\" z"} hope that helps {"later":true}')).toEqual({ s: 'x { y } " z' });
  expect(extractJson('{broken {"ok":2}')).toEqual({ ok: 2 });
  expect(extractJson("no json here")).toBeNull();
  expect(extractJson('{"truncated": [1, 2')).toBeNull();
});

test("parseAnswer normalises the envelope and the bare-playbook case", () => {
  expect(parseAnswer('{"reply":"hi","draft":null}')).toEqual({ reply: "hi", draft: null, questions: [] });
  expect(parseAnswer('{"reply":"ok","draft":{"id":"x"},"questions":["q",3]}')).toEqual({ reply: "ok", draft: { id: "x" }, questions: ["q"] });
  expect(parseAnswer('{"id":"bare","owner":"t"}')?.draft).toEqual({ id: "bare", owner: "t" });
  expect(parseAnswer('{"draft":[1]}')).toBeNull();
  expect(parseAnswer("nope")).toBeNull();
});

test("systemPrompt carries live names and the current draft", () => {
  const p = systemPrompt({ playbooks: [{ id: "ex" }], flags: ["flag_a"], eventFields: ["field_b"], unavailable: ["Prometheus"] }, { id: "d" });
  for (const s of ["flag_a", "field_b", '"id":"ex"', '{"id":"d"}', "Could not load: Prometheus", "min_samples >= 10"]) expect(p).toContain(s);
});
