// Zero-dependency validator for a small JSON Schema 2020-12 subset.
//
// Supported keywords: type, properties, required, additionalProperties
// (false or a schema), items (one schema), enum, const, pattern, minimum,
// maximum, minItems, uniqueItems, default, description, title, $schema, $id,
// $defs, and local $ref ("#/$defs/name"). Any other keyword makes the schema
// invalid. A rule can therefore never be skipped in silence (fail closed).

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export interface ValidationError {
  /** JSON pointer (RFC 6901) to the offending value in the data. */
  readonly pointer: string;
  readonly message: string;
}

export class SchemaError extends Error {
  override readonly name = "SchemaError";
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "uniqueItems",
  "default",
  "description",
  "title",
  "$schema",
  "$id",
  "$defs",
  "$ref",
]);

const TYPES: ReadonlySet<string> = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function childPointer(pointer: string, segment: string | number): string {
  return `${pointer}/${escapePointer(String(segment))}`;
}

// ---------- Schema check (fail closed) ----------

/** Throw SchemaError when the schema uses a keyword or shape this validator does not implement. */
export function assertSupportedSchema(schema: JsonValue): void {
  checkSchemaNode(schema, schema, "#");
}

function checkSchemaNode(node: JsonValue, root: JsonValue, where: string): void {
  if (!isJsonObject(node)) {
    throw new SchemaError(`${where}: a schema must be an object`);
  }
  for (const key of Object.keys(node)) {
    if (!KEYWORDS.has(key)) {
      throw new SchemaError(`${where}: unsupported schema keyword "${key}"`);
    }
  }
  const type = node["type"];
  if (type !== undefined) {
    const list = isJsonArray(type) ? type : [type];
    for (const entry of list) {
      if (typeof entry !== "string" || !TYPES.has(entry)) {
        throw new SchemaError(`${where}/type: unsupported type ${JSON.stringify(entry)}`);
      }
    }
  }
  const properties = node["properties"];
  if (properties !== undefined) {
    if (!isJsonObject(properties)) {
      throw new SchemaError(`${where}/properties: must be an object`);
    }
    for (const [name, child] of Object.entries(properties)) {
      checkSchemaNode(child, root, `${where}/properties/${name}`);
    }
  }
  const defs = node["$defs"];
  if (defs !== undefined) {
    if (!isJsonObject(defs)) {
      throw new SchemaError(`${where}/$defs: must be an object`);
    }
    for (const [name, child] of Object.entries(defs)) {
      checkSchemaNode(child, root, `${where}/$defs/${name}`);
    }
  }
  const required = node["required"];
  if (required !== undefined && (!isJsonArray(required) || required.some((r) => typeof r !== "string"))) {
    throw new SchemaError(`${where}/required: must be an array of strings`);
  }
  const additional = node["additionalProperties"];
  if (additional !== undefined && additional !== false) {
    checkSchemaNode(additional, root, `${where}/additionalProperties`);
  }
  const items = node["items"];
  if (items !== undefined) {
    checkSchemaNode(items, root, `${where}/items`);
  }
  const enumeration = node["enum"];
  if (enumeration !== undefined && (!isJsonArray(enumeration) || enumeration.length === 0)) {
    throw new SchemaError(`${where}/enum: must be a non-empty array`);
  }
  const pattern = node["pattern"];
  if (pattern !== undefined) {
    if (typeof pattern !== "string") {
      throw new SchemaError(`${where}/pattern: must be a string`);
    }
    try {
      new RegExp(pattern, "u");
    } catch {
      throw new SchemaError(`${where}/pattern: not a valid regular expression`);
    }
  }
  for (const key of ["minimum", "maximum", "minItems"] as const) {
    const bound = node[key];
    if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) {
      throw new SchemaError(`${where}/${key}: must be a number`);
    }
  }
  const unique = node["uniqueItems"];
  if (unique !== undefined && typeof unique !== "boolean") {
    throw new SchemaError(`${where}/uniqueItems: must be a boolean`);
  }
  const ref = node["$ref"];
  if (ref !== undefined) {
    if (typeof ref !== "string") {
      throw new SchemaError(`${where}/$ref: must be a string`);
    }
    resolveRef(ref, root, where);
  }
}

function resolveRef(ref: string, root: JsonValue, where: string): JsonValue {
  const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
  if (match === null || !isJsonObject(root)) {
    throw new SchemaError(`${where}/$ref: only local "#/$defs/<name>" references are supported`);
  }
  const defs = root["$defs"];
  const target = isJsonObject(defs) ? defs[match[1] ?? ""] : undefined;
  if (target === undefined) {
    throw new SchemaError(`${where}/$ref: "${ref}" does not exist`);
  }
  return target;
}

// ---------- Validation ----------

function typeMatches(type: string, value: JsonValue): boolean {
  switch (type) {
    case "object":
      return isJsonObject(value);
    case "array":
      return isJsonArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) {
    return true;
  }
  if (isJsonArray(a) && isJsonArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index] ?? null));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => {
        const other = b[key];
        return other !== undefined && jsonEqual(a[key] ?? null, other);
      })
    );
  }
  return false;
}

function describe(value: JsonValue): string {
  return JSON.stringify(value) ?? "undefined";
}

/** Validate data against a schema. Throws SchemaError when the schema is unsupported. */
export function validate(schema: JsonValue, data: JsonValue): readonly ValidationError[] {
  assertSupportedSchema(schema);
  const errors: ValidationError[] = [];
  validateNode(schema, schema, data, "", errors);
  return errors;
}

function validateNode(
  node: JsonValue,
  root: JsonValue,
  data: JsonValue,
  pointer: string,
  errors: ValidationError[],
): void {
  if (!isJsonObject(node)) {
    return;
  }
  const ref = node["$ref"];
  if (typeof ref === "string") {
    validateNode(resolveRef(ref, root, pointer), root, data, pointer, errors);
  }
  const type = node["type"];
  if (type !== undefined) {
    const list = isJsonArray(type) ? type : [type];
    const names = list.filter((entry): entry is string => typeof entry === "string");
    if (!names.some((name) => typeMatches(name, data))) {
      errors.push({ pointer, message: `must be of type ${names.join(" or ")}` });
      return;
    }
  }
  const enumeration = node["enum"];
  if (isJsonArray(enumeration) && !enumeration.some((option) => jsonEqual(option, data))) {
    errors.push({ pointer, message: `must be one of ${enumeration.map(describe).join(", ")}` });
  }
  const constant = node["const"];
  if (constant !== undefined && !jsonEqual(constant, data)) {
    errors.push({ pointer, message: `must equal ${describe(constant)}` });
  }
  if (typeof data === "string") {
    const pattern = node["pattern"];
    if (typeof pattern === "string" && !new RegExp(pattern, "u").test(data)) {
      errors.push({ pointer, message: `must match pattern ${pattern}` });
    }
  }
  if (typeof data === "number") {
    const minimum = node["minimum"];
    if (typeof minimum === "number" && data < minimum) {
      errors.push({ pointer, message: `must be at least ${minimum}` });
    }
    const maximum = node["maximum"];
    if (typeof maximum === "number" && data > maximum) {
      errors.push({ pointer, message: `must be at most ${maximum}` });
    }
  }
  if (isJsonArray(data)) {
    validateArray(node, root, data, pointer, errors);
  }
  if (isJsonObject(data)) {
    validateObject(node, root, data, pointer, errors);
  }
}

function validateArray(
  node: JsonObject,
  root: JsonValue,
  data: readonly JsonValue[],
  pointer: string,
  errors: ValidationError[],
): void {
  const minItems = node["minItems"];
  if (typeof minItems === "number" && data.length < minItems) {
    errors.push({ pointer, message: `must have at least ${minItems} item${minItems === 1 ? "" : "s"}` });
  }
  if (node["uniqueItems"] === true) {
    data.forEach((item, index) => {
      if (data.slice(0, index).some((earlier) => jsonEqual(earlier, item))) {
        errors.push({ pointer: childPointer(pointer, index), message: "must not repeat an earlier item" });
      }
    });
  }
  const items = node["items"];
  if (items !== undefined) {
    data.forEach((item, index) => validateNode(items, root, item, childPointer(pointer, index), errors));
  }
}

function validateObject(
  node: JsonObject,
  root: JsonValue,
  data: JsonObject,
  pointer: string,
  errors: ValidationError[],
): void {
  const required = node["required"];
  if (isJsonArray(required)) {
    for (const name of required) {
      if (typeof name === "string" && data[name] === undefined) {
        errors.push({ pointer: childPointer(pointer, name), message: "is required" });
      }
    }
  }
  const properties = node["properties"];
  const known = isJsonObject(properties) ? properties : {};
  const additional = node["additionalProperties"];
  for (const [name, value] of Object.entries(data)) {
    const child = known[name];
    if (child !== undefined) {
      validateNode(child, root, value, childPointer(pointer, name), errors);
    } else if (additional === false) {
      errors.push({ pointer: childPointer(pointer, name), message: "is not a known key" });
    } else if (additional !== undefined) {
      validateNode(additional, root, value, childPointer(pointer, name), errors);
    }
  }
}

// ---------- Defaults ----------

function resolveNode(node: JsonValue, root: JsonValue): JsonObject | null {
  if (!isJsonObject(node)) {
    return null;
  }
  const ref = node["$ref"];
  if (typeof ref !== "string") {
    return node;
  }
  const target = resolveRef(ref, root, "#");
  return isJsonObject(target) ? { ...target, ...node } : null;
}

function schemaType(node: JsonObject): string | null {
  const type = node["type"];
  return typeof type === "string" ? type : null;
}

/**
 * Return a copy of the data with every schema `default` filled in. An absent
 * object section is created when its schema has properties, so that nested
 * defaults appear. Run it only on data that already passed `validate`.
 */
export function applyDefaults(schema: JsonValue, data: JsonValue): JsonValue {
  assertSupportedSchema(schema);
  return fill(schema, schema, data);
}

function fill(node: JsonValue, root: JsonValue, data: JsonValue): JsonValue {
  const resolved = resolveNode(node, root);
  if (resolved === null) {
    return data;
  }
  if (isJsonObject(data)) {
    const properties = resolved["properties"];
    if (!isJsonObject(properties)) {
      return data;
    }
    const result: { [key: string]: JsonValue } = { ...data };
    for (const [name, child] of Object.entries(properties)) {
      const present = data[name];
      if (present !== undefined) {
        result[name] = fill(child, root, present);
        continue;
      }
      const childResolved = resolveNode(child, root);
      if (childResolved === null) {
        continue;
      }
      const fallback = childResolved["default"];
      if (fallback !== undefined) {
        result[name] = fill(child, root, fallback);
      } else if (schemaType(childResolved) === "object" && isJsonObject(childResolved["properties"])) {
        result[name] = fill(child, root, {});
      }
    }
    return result;
  }
  if (isJsonArray(data)) {
    const items = resolved["items"];
    return items === undefined ? data : data.map((item) => fill(items, root, item));
  }
  return data;
}
