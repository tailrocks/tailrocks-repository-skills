import { describe, expect, test } from "bun:test";
import {
  applyDefaults,
  assertSupportedSchema,
  type JsonValue,
  SchemaError,
  validate,
} from "../lib/policy/schema-validate.ts";

function messages(schema: JsonValue, data: JsonValue): readonly string[] {
  return validate(schema, data).map((e) => `${e.pointer}: ${e.message}`);
}

describe("validator keywords", () => {
  test("type", () => {
    expect(messages({ type: "string" }, "x")).toEqual([]);
    expect(messages({ type: "string" }, 1)).toEqual([": must be of type string"]);
    expect(messages({ type: "integer" }, 1.5)).toEqual([": must be of type integer"]);
    expect(messages({ type: ["string", "null"] }, null)).toEqual([]);
    expect(messages({ type: "boolean" }, "true")).toHaveLength(1);
    expect(messages({ type: "array" }, {})).toHaveLength(1);
  });

  test("properties, required, additionalProperties false", () => {
    const schema: JsonValue = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: { a: { type: "string" } },
    };
    expect(messages(schema, { a: "x" })).toEqual([]);
    expect(messages(schema, {})).toEqual(["/a: is required"]);
    expect(messages(schema, { a: "x", b: 1 })).toEqual(["/b: is not a known key"]);
    expect(messages(schema, { a: 1 })).toEqual(["/a: must be of type string"]);
  });

  test("additionalProperties as a schema", () => {
    const schema: JsonValue = { type: "object", additionalProperties: { type: "integer" } };
    expect(messages(schema, { x: 1, y: 2 })).toEqual([]);
    expect(messages(schema, { x: "no" })).toEqual(["/x: must be of type integer"]);
  });

  test("items, minItems, uniqueItems", () => {
    const schema: JsonValue = { type: "array", items: { type: "integer" }, minItems: 2, uniqueItems: true };
    expect(messages(schema, [1, 2])).toEqual([]);
    expect(messages(schema, [1])).toEqual([": must have at least 2 items"]);
    expect(messages(schema, [1, "a"])).toEqual(["/1: must be of type integer"]);
    expect(messages(schema, [1, 1])).toEqual(["/1: must not repeat an earlier item"]);
    expect(messages({ type: "array", uniqueItems: true }, [{ a: [1] }, { a: [1] }])).toHaveLength(1);
  });

  test("enum and const", () => {
    expect(messages({ enum: ["a", "b"] }, "a")).toEqual([]);
    expect(messages({ enum: ["a", "b"] }, "c")).toEqual([': must be one of "a", "b"']);
    expect(messages({ const: 1 }, 1)).toEqual([]);
    expect(messages({ const: 1 }, 2)).toEqual([": must equal 1"]);
  });

  test("pattern", () => {
    expect(messages({ type: "string", pattern: "^a+$" }, "aa")).toEqual([]);
    expect(messages({ type: "string", pattern: "^a+$" }, "b")).toEqual([": must match pattern ^a+$"]);
  });

  test("minimum and maximum", () => {
    const schema: JsonValue = { type: "integer", minimum: 1, maximum: 3 };
    expect(messages(schema, 2)).toEqual([]);
    expect(messages(schema, 0)).toEqual([": must be at least 1"]);
    expect(messages(schema, 4)).toEqual([": must be at most 3"]);
  });

  test("local $ref and $defs", () => {
    const schema: JsonValue = {
      $defs: { name: { type: "string", pattern: "^x" } },
      type: "object",
      properties: { a: { $ref: "#/$defs/name" } },
    };
    expect(messages(schema, { a: "xy" })).toEqual([]);
    expect(messages(schema, { a: "y" })).toEqual(["/a: must match pattern ^x"]);
  });

  test("annotation keywords are accepted", () => {
    const schema: JsonValue = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.invalid/s",
      title: "t",
      description: "d",
      type: "string",
      default: "x",
    };
    expect(messages(schema, "ok")).toEqual([]);
  });

  test("pointers escape ~ and /", () => {
    const schema: JsonValue = { type: "object", additionalProperties: false, properties: {} };
    expect(messages(schema, { "a/b~c": 1 })).toEqual(["/a~1b~0c: is not a known key"]);
  });
});

describe("validator fails closed on the schema", () => {
  test("rejects an unknown keyword", () => {
    expect(() => validate({ type: "string", minLength: 1 }, "x")).toThrow(SchemaError);
    expect(() => validate({ type: "string", minLength: 1 }, "x")).toThrow(/minLength/);
  });

  test("rejects an unknown keyword nested in properties, items, and $defs", () => {
    expect(() => assertSupportedSchema({ properties: { a: { format: "uri" } } })).toThrow(/format/);
    expect(() => assertSupportedSchema({ items: { oneOf: [] } })).toThrow(/oneOf/);
    expect(() => assertSupportedSchema({ $defs: { a: { allOf: [] } } })).toThrow(/allOf/);
    expect(() => assertSupportedSchema({ additionalProperties: { not: {} } })).toThrow(/not/);
  });

  test("rejects non-local and dangling references", () => {
    expect(() => assertSupportedSchema({ $ref: "https://example.invalid/x" })).toThrow(SchemaError);
    expect(() => assertSupportedSchema({ $ref: "#/$defs/missing" })).toThrow(/does not exist/);
  });

  test("rejects malformed keyword values", () => {
    expect(() => assertSupportedSchema({ type: "text" })).toThrow(SchemaError);
    expect(() => assertSupportedSchema({ required: "a" })).toThrow(SchemaError);
    expect(() => assertSupportedSchema({ pattern: "(" })).toThrow(SchemaError);
    expect(() => assertSupportedSchema({ additionalProperties: true })).toThrow(SchemaError);
    expect(() => assertSupportedSchema({ enum: [] })).toThrow(SchemaError);
    expect(() => assertSupportedSchema("string")).toThrow(SchemaError);
  });
});

describe("defaults", () => {
  const schema: JsonValue = {
    type: "object",
    properties: {
      a: { type: "string", default: "x" },
      section: { type: "object", properties: { n: { type: "integer", default: 3 } } },
      list: {
        type: "array",
        items: { type: "object", properties: { cwd: { type: "string", default: "." } } },
        default: [],
      },
    },
  };

  test("fills scalars, nested sections, and array items", () => {
    expect(applyDefaults(schema, {})).toEqual({ a: "x", section: { n: 3 }, list: [] });
    expect(applyDefaults(schema, { a: "y", list: [{}, { cwd: "sub" }] })).toEqual({
      a: "y",
      section: { n: 3 },
      list: [{ cwd: "." }, { cwd: "sub" }],
    });
  });

  test("does not change the input", () => {
    const input: JsonValue = { section: {} };
    applyDefaults(schema, input);
    expect(input).toEqual({ section: {} });
  });
});
