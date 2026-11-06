import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compareContracts, validateSchema, formatReport, SchemaError } from '../dist/esm/index.js';
const request = (a, b) => compareContracts(a, b);
const response = (a, b) => compareContracts(a, b, { direction: 'response' });
const object = (properties = {}, required = [], additionalProperties = false) => ({
  type: 'object',
  properties,
  required,
  additionalProperties,
});

test('identical contracts have no findings or changes', () => {
  const schema = object({ id: { type: 'integer' } }, ['id']);
  const report = request(schema, structuredClone(schema));
  assert.equal(report.status, 'compatible');
  assert.deepEqual(report.changes, []);
  assert.deepEqual(report.findings, []);
});
test('request widening is compatible while response widening is potentially breaking', () => {
  const a = { type: 'integer', minimum: 1, maximum: 10 };
  const b = { type: 'number', minimum: 0, maximum: 20 };
  assert.equal(request(a, b).compatible, true);
  assert.equal(response(a, b).compatible, false);
  assert.equal(request(b, a).compatible, false);
  assert.equal(response(b, a).compatible, true);
});
test('new required request fields break old callers; required response fields protect old consumers', () => {
  const optional = object({ name: { type: 'string' } });
  const required = object({ name: { type: 'string' } }, ['name']);
  assert.equal(request(optional, required).findings[0].code, 'REQUIRED');
  assert.equal(request(required, optional).compatible, true);
  assert.equal(response(required, optional).compatible, false);
  assert.equal(response(optional, required).compatible, true);
});
test('closed-object property addition/removal considers direction and requiredness', () => {
  const old = object({ id: { type: 'integer' } }, ['id']);
  const next = object({ id: { type: 'integer' }, label: { type: 'string' } }, ['id']);
  assert.equal(request(old, next).compatible, true);
  assert.equal(response(old, next).compatible, false);
  assert.equal(request(next, old).compatible, false);
  assert.equal(response(next, old).compatible, true);
});
test('open-object newly constrained fields can break requests', () => {
  assert.equal(
    request(object({}, [], true), object({ x: { type: 'string' } }, [], true)).findings[0].code,
    'UNCONSTRAINED',
  );
  assert.equal(request(object({}, [], true), object()).compatible, false);
  assert.equal(request(object(), object({}, [], true)).compatible, true);
});
test('enum containment, booleans and null are handled as finite value sets', () => {
  assert.equal(
    request({ type: 'string', enum: ['a'] }, { type: 'string', enum: ['a', 'b'] }).compatible,
    true,
  );
  assert.equal(
    response({ type: 'string', enum: ['a'] }, { type: 'string', enum: ['a', 'b'] }).compatible,
    false,
  );
  assert.equal(
    request({ type: 'boolean' }, { type: 'boolean', enum: [true, false] }).compatible,
    true,
  );
  assert.equal(request({ type: 'null' }, { type: 'null', enum: [null] }).compatible, true);
  assert.equal(
    request({ type: 'integer', enum: [1, 2] }, { type: 'number', minimum: 1, maximum: 2 })
      .compatible,
    true,
  );
});
test('nested arrays and string bounds generate readable data paths', () => {
  const before = object({
    'a/b~': { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 5 },
  });
  const after = object({
    'a/b~': { type: 'array', items: { type: 'string', minLength: 2 }, maxItems: 4 },
  });
  const report = request(before, after);
  assert.deepEqual(
    report.findings.map((f) => f.path),
    ['/a~1b~0', '/a~1b~0/*'],
  );
  assert.ok(formatReport(report).includes('[RANGE]'));
  assert.ok(report.changes.some((change) => change.path === '/properties/a~1b~0/items/minLength'));
});
test('integer bounds normalize to effective whole-number endpoints', () => {
  assert.equal(
    request(
      { type: 'integer', minimum: 0.1, maximum: 1.9 },
      { type: 'integer', minimum: 1, maximum: 1 },
    ).compatible,
    true,
  );
  assert.throws(() => validateSchema({ type: 'integer', minimum: 0.1, maximum: 0.9 }), /empty/);
});
test('zero-length arrays do not constrain unreachable items', () => {
  assert.equal(
    request(
      { type: 'array', items: { type: 'string' }, maxItems: 0 },
      { type: 'array', items: { type: 'number' } },
    ).compatible,
    true,
  );
});
test('unsupported schema features and malformed schemas fail explicitly', () => {
  for (const schema of [
    true,
    null,
    {},
    { type: ['string', 'null'] },
    { type: 'string', pattern: 'a' },
    { type: 'string', $ref: '#/x' },
    { type: 'string', minLength: -1 },
    { type: 'string', minLength: 2, maxLength: 1 },
    { type: 'array' },
    { type: 'object', required: ['missing'] },
    { type: 'object', additionalProperties: {} },
    { type: 'string', enum: [] },
    { type: 'number', enum: [NaN] },
    { type: 'string', enum: ['a', 'a'] },
    { type: 'string', enum: [1] },
    { type: 'number', minimum: Infinity },
    { type: 'boolean', minimum: 1 },
  ])
    assert.throws(() => validateSchema(schema), SchemaError);
});
test('cycles, depth and node limits stop pathological schema processing', () => {
  const cyclic = { type: 'array' };
  cyclic.items = cyclic;
  assert.throws(() => validateSchema(cyclic), /Cyclic/);
  const nested = { type: 'array', items: { type: 'array', items: { type: 'string' } } };
  assert.throws(() => validateSchema(nested, { maxDepth: 1 }), /limit/);
  assert.throws(() => validateSchema(nested, { maxNodes: 1 }), /limit/);
  assert.throws(() => validateSchema(nested, { maxDepth: 1000 }), RangeError);
});
test('special property names remain own fields without prototype interpretation', () => {
  const schema = JSON.parse(
    '{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"additionalProperties":false}',
  );
  assert.equal(request(schema, structuredClone(schema)).compatible, true);
});
test('metadata changes are reported without changing compatibility', () => {
  const report = request({ type: 'string', title: 'Old' }, { type: 'string', title: 'New' });
  assert.equal(report.compatible, true);
  assert.deepEqual(report.changes, [
    { path: '/title', kind: 'changed', before: 'Old', after: 'New' },
  ]);
  assert.throws(() => compareContracts({}, {}, { direction: 'invalid' }), /direction/);
});
test('null object keywords are rejected instead of treated as absent', () => {
  for (const schema of [
    { type: 'object', properties: null },
    { type: 'object', required: null },
  ])
    assert.throws(() => validateSchema(schema), SchemaError);
});
test('compatible reports preserve acceptance over a generated representative value set', () => {
  function accepts(schema, value) {
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
      if ((schema.required ?? []).some((name) => !Object.hasOwn(value, name))) return false;
      return Object.keys(value).every((key) =>
        Object.hasOwn(schema.properties ?? {}, key)
          ? accepts(schema.properties[key], value[key])
          : schema.additionalProperties !== false,
      );
    }
    if (schema.type === 'array')
      return (
        Array.isArray(value) &&
        value.length >= (schema.minItems ?? 0) &&
        value.length <= (schema.maxItems ?? Infinity) &&
        value.every((item) => accepts(schema.items, item))
      );
    if (
      schema.type === 'null'
        ? value !== null
        : schema.type === 'integer'
          ? !Number.isInteger(value)
          : typeof value !== schema.type
    )
      return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (typeof value === 'string')
      return (
        [...value].length >= (schema.minLength ?? 0) &&
        [...value].length <= (schema.maxLength ?? Infinity)
      );
    return (
      typeof value !== 'number' ||
      (value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity))
    );
  }
  const scalars = [
    { type: 'string' },
    { type: 'string', minLength: 1 },
    { type: 'string', enum: ['a'] },
    { type: 'integer' },
    { type: 'number' },
    { type: 'integer', minimum: 0, maximum: 2 },
    { type: 'number', enum: [0, 1] },
    { type: 'boolean' },
    { type: 'boolean', enum: [true] },
    { type: 'null' },
  ];
  const schemas = [...scalars];
  for (const scalar of scalars) {
    schemas.push(
      { type: 'array', items: scalar },
      object({ x: scalar }),
      object({ x: scalar }, ['x']),
      object({ x: scalar }, [], true),
    );
  }
  const values = [null, true, false, -1, 0, 0.5, 1, 2, 3, '', 'a', 'ab', '😀'];
  const samples = [
    ...values,
    {},
    { extra: 'x' },
    [],
    ...values.flatMap((value) => [[value], { x: value }, { x: value, extra: 1 }]),
  ];
  for (const source of schemas)
    for (const target of schemas) {
      if (!request(source, target).compatible) continue;
      for (const value of samples)
        if (accepts(source, value)) {
          assert.equal(accepts(target, value), true, JSON.stringify({ source, target, value }));
        }
    }
});
test('CommonJS exposes the same report API without importing Node CLI modules', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.equal(cjs.compareContracts({ type: 'string' }, { type: 'number' }).compatible, false);
});
test('CI CLI exits 0 for compatible, 1 for findings, 2 for invalid input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contract-cli-'));
  const cli = new URL('../dist/esm/cli.js', import.meta.url);
  try {
    const a = join(directory, 'a.json'),
      b = join(directory, 'b.json');
    await writeFile(a, '{"type":"string"}');
    await writeFile(b, '{"type":"string","minLength":1}');
    const run = (...args) =>
      spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: 'utf8' });
    const breaking = run(a, b, '--json');
    assert.equal(breaking.status, 1);
    assert.equal(JSON.parse(breaking.stdout).status, 'potentially-breaking');
    assert.equal(run(a, b, '--direction', 'response').status, 0);
    const invalid = run(a, b, '--bad');
    assert.equal(invalid.status, 2);
    assert.ok(invalid.stderr.includes('Unknown option'));
    await writeFile(b, '{"type":"string","pattern":"x"}');
    assert.equal(run(a, b).status, 2);
    await writeFile(b, '{bad');
    assert.equal(run(a, b).status, 2);
    assert.equal(run('--help').status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
