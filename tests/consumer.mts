import {
  compareContracts,
  validateSchema,
  formatReport,
  SchemaError,
} from '@lp-labs/contract-diff';
import type { Schema, Report, Finding, CompareOptions } from '@lp-labs/contract-diff';
const schema: Schema = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 0 } },
  required: ['id'],
};
const options: CompareOptions = { direction: 'response', maxDepth: 64 };
const report: Report = compareContracts(schema, schema, options);
const finding: Finding | undefined = report.findings[0];
void finding;
formatReport(report);
const error: SchemaError = new SchemaError('/', 'invalid');
void error;
let unknownSchema: unknown = { type: 'string' };
validateSchema(unknownSchema);
const type: string = unknownSchema.type;
void type;
// @ts-expect-error union schemas are outside this subset
const invalid: Schema = { type: ['string', 'null'] };
void invalid;
