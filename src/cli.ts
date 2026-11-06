#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { compareContracts, formatReport } from './index.js';

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(
      'Usage: contract-diff before.json after.json [--direction request|response] [--json]\nExit codes: 0 compatible, 1 potentially breaking, 2 invalid input.',
    );
    return 0;
  }
  const files: string[] = [];
  let direction: 'request' | 'response' = 'request',
    json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--json') json = true;
    else if (arg === '--direction') {
      const value = args[++index];
      if (value !== 'request' && value !== 'response')
        throw new TypeError('--direction requires request or response.');
      direction = value;
    } else if (arg.startsWith('-')) throw new TypeError(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (files.length !== 2)
    throw new TypeError('Expected before.json and after.json; use --help for usage.');
  const contents = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, 'utf8');
      if (text.length > 5000000)
        throw new RangeError(`${file}: schema file exceeds 5,000,000 characters.`);
      return JSON.parse(text) as unknown;
    }),
  );
  const report = compareContracts(contents[0], contents[1], { direction });
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.compatible ? 0 : 1;
}
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
