import { compareContracts, formatReport } from '@lp-labs/contract-diff';
import type { Report } from '@lp-labs/contract-diff';
const report: Report = compareContracts({ type: 'string' }, { type: 'string' });
const text: string = formatReport(report);
void text;
// @ts-expect-error direction is constrained
compareContracts({}, {}, { direction: 'both' });
