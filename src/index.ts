export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type Primitive = string | number | boolean | null;
export interface Schema {
  type: SchemaType;
  properties?: Readonly<Record<string, Schema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: readonly Primitive[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  title?: string;
  description?: string;
}
export interface CompareOptions {
  direction?: 'request' | 'response';
  maxDepth?: number;
  maxNodes?: number;
}
export interface Finding {
  path: string;
  code: 'TYPE' | 'ENUM' | 'RANGE' | 'REQUIRED' | 'ADDITIONAL' | 'UNCONSTRAINED';
  message: string;
}
export interface Change {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}
export interface Report {
  direction: 'request' | 'response';
  compatible: boolean;
  status: 'compatible' | 'potentially-breaking';
  findings: Finding[];
  changes: Change[];
}
export class SchemaError extends TypeError {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path || '/'}: ${message}`);
    this.name = 'SchemaError';
  }
}
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const pointer = (base: string, key: string): string =>
  `${base}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function limits(options: CompareOptions): { maxDepth: number; maxNodes: number } {
  const maxDepth = options.maxDepth ?? 64,
    maxNodes = options.maxNodes ?? 10000;
  if (
    !Number.isInteger(maxDepth) ||
    maxDepth < 1 ||
    maxDepth > 128 ||
    !Number.isInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > 100000
  )
    throw new RangeError('maxDepth must be 1..128 and maxNodes 1..100000.');
  return { maxDepth, maxNodes };
}
function scalarMatches(value: Primitive, schema: Schema): boolean {
  const type = value === null ? 'null' : typeof value;
  if (
    schema.type === 'integer'
      ? typeof value !== 'number' || !Number.isInteger(value)
      : schema.type !== type
  )
    return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (
    typeof value === 'number' &&
    (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))
  )
    return false;
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false;
  }
  return true;
}
export function validateSchema(
  value: unknown,
  options: CompareOptions = {},
): asserts value is Schema {
  const { maxDepth, maxNodes } = limits(options);
  let count = 0;
  const visiting = new Set<object>();
  const walk = (node: unknown, path: string, depth: number): void => {
    if (++count > maxNodes || depth > maxDepth)
      throw new SchemaError(path, 'Schema resource limit exceeded.');
    if (!record(node)) throw new SchemaError(path, 'Expected a plain schema object.');
    if (visiting.has(node)) throw new SchemaError(path, 'Cyclic schemas are not supported.');
    if (typeof node['type'] !== 'string' || !types.has(node['type']))
      throw new SchemaError(path, 'A supported single type is required.');
    visiting.add(node);
    const allowed = new Set(['type', 'title', 'description']);
    const type = node['type'];
    const numeric = type === 'number' || type === 'integer';
    const keys =
      type === 'object'
        ? ['properties', 'required', 'additionalProperties']
        : type === 'array'
          ? ['items', 'minItems', 'maxItems']
          : type === 'string'
            ? ['enum', 'minLength', 'maxLength']
            : numeric
              ? ['enum', 'minimum', 'maximum']
              : ['enum'];
    for (const key of keys) allowed.add(key);
    for (const key of Object.keys(node))
      if (!allowed.has(key))
        throw new SchemaError(pointer(path, key), 'Unsupported keyword for this schema type.');
    for (const key of ['title', 'description'])
      if (Object.hasOwn(node, key) && typeof node[key] !== 'string')
        throw new SchemaError(pointer(path, key), 'Expected a string.');
    if (type === 'object') {
      const properties = Object.hasOwn(node, 'properties') ? node['properties'] : {};
      if (!record(properties))
        throw new SchemaError(pointer(path, 'properties'), 'Expected a plain property map.');
      if (
        Object.hasOwn(node, 'additionalProperties') &&
        typeof node['additionalProperties'] !== 'boolean'
      )
        throw new SchemaError(path, 'additionalProperties must be boolean.');
      const required = Object.hasOwn(node, 'required') ? node['required'] : [];
      if (
        !Array.isArray(required) ||
        required.some((name) => typeof name !== 'string' || !Object.hasOwn(properties, name)) ||
        new Set(required).size !== required.length
      )
        throw new SchemaError(path, 'required must contain unique declared property names.');
      for (const [name, child] of Object.entries(properties))
        walk(child, pointer(pointer(path, 'properties'), name), depth + 1);
    } else if (type === 'array') {
      walk(node['items'], pointer(path, 'items'), depth + 1);
    }
    for (const [low, high] of numeric
      ? [['minimum', 'maximum']]
      : type === 'string'
        ? [['minLength', 'maxLength']]
        : type === 'array'
          ? [['minItems', 'maxItems']]
          : []) {
      for (const key of [low!, high!]) {
        if (
          Object.hasOwn(node, key) &&
          (typeof node[key] !== 'number' ||
            !Number.isFinite(node[key]) ||
            (!numeric && (!Number.isSafeInteger(node[key]) || node[key] < 0)))
        )
          throw new SchemaError(pointer(path, key), 'Invalid numeric bound.');
      }
      const lower = node[low!],
        upper = node[high!];
      if (typeof lower === 'number' && typeof upper === 'number' && lower > upper)
        throw new SchemaError(path, 'Minimum exceeds maximum.');
    }
    if (
      type === 'integer' &&
      Math.ceil((node['minimum'] as number | undefined) ?? -Infinity) >
        Math.floor((node['maximum'] as number | undefined) ?? Infinity)
    )
      throw new SchemaError(path, 'Integer interval is empty.');
    if (Object.hasOwn(node, 'enum')) {
      const values = node['enum'];
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.some(
          (entry) =>
            entry !== null &&
            typeof entry !== 'string' &&
            typeof entry !== 'boolean' &&
            (typeof entry !== 'number' || !Number.isFinite(entry)),
        ) ||
        new Set(values).size !== values.length
      )
        throw new SchemaError(
          pointer(path, 'enum'),
          'enum requires unique finite primitive values.',
        );
      const schema: Schema = { type: type as SchemaType };
      if (typeof node['minimum'] === 'number') schema.minimum = node['minimum'];
      if (typeof node['maximum'] === 'number') schema.maximum = node['maximum'];
      if (typeof node['minLength'] === 'number') schema.minLength = node['minLength'];
      if (typeof node['maxLength'] === 'number') schema.maxLength = node['maxLength'];
      if (values.some((entry: Primitive) => !scalarMatches(entry, schema)))
        throw new SchemaError(path, 'enum values must satisfy their schema type and bounds.');
    }
    visiting.delete(node);
  };
  walk(value, '', 0);
}
function containment(source: Schema, target: Schema, path: string, findings: Finding[]): void {
  const add = (code: Finding['code'], message: string, at = path): void => {
    findings.push({ path: at, code, message });
  };
  const finite =
    source.enum ??
    (source.type === 'boolean' ? [false, true] : source.type === 'null' ? [null] : undefined);
  if (finite) {
    if (finite.some((value) => !scalarMatches(value, target)))
      add('ENUM', 'At least one permitted source value is not accepted by the target.');
    return;
  }
  if (source.type !== target.type && !(source.type === 'integer' && target.type === 'number')) {
    add('TYPE', `Source type ${source.type} is not contained in target type ${target.type}.`);
    return;
  }
  if (target.enum) add('ENUM', 'The target enum is not proven to contain all source values.');
  if (source.type === 'object') {
    const s = source.properties ?? {},
      t = target.properties ?? {};
    for (const name of target.required ?? []) {
      if (!source.required?.includes(name))
        add(
          'REQUIRED',
          `Target requires property ${JSON.stringify(name)} that the source does not require.`,
          pointer(path, name),
        );
    }
    if (target.additionalProperties === false && source.additionalProperties !== false)
      add('ADDITIONAL', 'Source permits undeclared properties but target forbids them.');
    for (const name of Object.keys(s)) {
      if (!Object.hasOwn(t, name) && target.additionalProperties === false)
        add(
          'ADDITIONAL',
          `Source permits property ${JSON.stringify(name)} that target forbids.`,
          pointer(path, name),
        );
    }
    for (const [name, targetChild] of Object.entries(t)) {
      if (Object.hasOwn(s, name)) containment(s[name]!, targetChild, pointer(path, name), findings);
      else if (source.additionalProperties !== false)
        add(
          'UNCONSTRAINED',
          `Source permits unconstrained values for ${JSON.stringify(name)}.`,
          pointer(path, name),
        );
    }
  } else if (source.type === 'array') {
    range(
      source.minItems ?? 0,
      source.maxItems ?? Infinity,
      target.minItems ?? 0,
      target.maxItems ?? Infinity,
      add,
    );
    if (source.maxItems !== 0)
      containment(source.items!, target.items!, pointer(path, '*'), findings);
  } else if (source.type === 'string') {
    range(
      source.minLength ?? 0,
      source.maxLength ?? Infinity,
      target.minLength ?? 0,
      target.maxLength ?? Infinity,
      add,
    );
  } else if (source.type === 'integer' || source.type === 'number') {
    const lower = (node: Schema) =>
      node.type === 'integer' ? Math.ceil(node.minimum ?? -Infinity) : (node.minimum ?? -Infinity);
    const upper = (node: Schema) =>
      node.type === 'integer' ? Math.floor(node.maximum ?? Infinity) : (node.maximum ?? Infinity);
    range(lower(source), upper(source), lower(target), upper(target), add);
  }
}
function range(
  sMin: number,
  sMax: number,
  tMin: number,
  tMax: number,
  add: (code: Finding['code'], message: string) => void,
): void {
  if (sMin < tMin || sMax > tMax)
    add('RANGE', 'The permitted source range is not contained in the target range.');
}
function changes(before: unknown, after: unknown, path: string, output: Change[]): void {
  if (Object.is(before, after)) return;
  if (record(before) && record(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const at = pointer(path, key);
      if (!Object.hasOwn(before, key)) output.push({ path: at, kind: 'added', after: after[key] });
      else if (!Object.hasOwn(after, key))
        output.push({ path: at, kind: 'removed', before: before[key] });
      else changes(before[key], after[key], at, output);
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after))
    output.push({ path, kind: 'changed', before, after });
}
export function compareContracts(
  before: unknown,
  after: unknown,
  options: CompareOptions = {},
): Report {
  const direction = options.direction ?? 'request';
  if (direction !== 'request' && direction !== 'response')
    throw new TypeError('direction must be request or response.');
  validateSchema(before, options);
  validateSchema(after, options);
  const findings: Finding[] = [],
    differences: Change[] = [];
  containment(
    direction === 'request' ? before : after,
    direction === 'request' ? after : before,
    '',
    findings,
  );
  changes(before, after, '', differences);
  return {
    direction,
    compatible: findings.length === 0,
    status: findings.length ? 'potentially-breaking' : 'compatible',
    findings,
    changes: differences,
  };
}
export function formatReport(report: Report): string {
  return [
    `${report.status.toUpperCase()} (${report.direction})`,
    `${report.changes.length} schema change(s); ${report.findings.length} compatibility finding(s).`,
    ...report.findings.map(
      (finding) => `${finding.path || '/'} [${finding.code}] ${finding.message}`,
    ),
  ].join('\n');
}
