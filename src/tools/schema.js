// A deliberately small JSON-Schema subset validator (~60 lines) so every rule the
// backend enforces can be read and explained. Supported keywords:
// type (object|string|integer|number|boolean|array), properties, required,
// additionalProperties:false, minLength, maxLength, pattern, enum,
// minimum, maximum, items, minItems, maxItems, uniqueItems.

function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/**
 * Validate `value` against `schema`.
 * @returns {string[]} human-readable errors; empty array means valid.
 */
export function validate(schema, value, path = '$') {
  const errors = [];
  const actual = typeOf(value);
  const expected = schema.type;
  const typeOk = !expected || actual === expected || (expected === 'number' && actual === 'integer');
  if (!typeOk) return [`${path}: expected ${expected}, got ${actual}`];

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  }
  if (actual === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (actual === 'integer' || actual === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${path}: items must be unique`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (actual === 'object') {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, v] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) errors.push(...validate(props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: is not an allowed field`);
    }
  }
  return errors;
}
