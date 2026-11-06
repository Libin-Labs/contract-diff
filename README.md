# @lp-labs/contract-diff

Directional compatibility analysis for a deliberately explicit subset of JSON Schema. Includes structured change reports and a CI command. Zero runtime or peer dependencies.

**Not a full JSON Schema/OpenAPI implementation.** Unsupported keywords throw instead of being ignored. A compatible result proves containment under the documented supported model; a potentially-breaking result means compatibility was not established, not that every consumer will break.

## Install

```sh
npm install @lp-labs/contract-diff
```

Node 18+ for the CLI. The main library is browser-compatible ES2022 and does not import Node modules. ESM/CommonJS and declarations are included.

## Quick start

```js
import { compareContracts, formatReport } from '@lp-labs/contract-diff';

const before = {
  type: 'object',
  properties: { name: { type: 'string' } },
  additionalProperties: false,
};
const after = {
  ...before,
  required: ['name'],
};
const report = compareContracts(before, after, { direction: 'request' });
console.log(report.compatible); // false: old callers could omit name
console.log(formatReport(report));
```

CommonJS: `const { compareContracts } = require('@lp-labs/contract-diff');`.

## Request versus response compatibility

- **Request** (default): every old permitted request must remain accepted by the new schema. The analysis tests `before` contained in `after`.
- **Response**: every response permitted by the new schema must remain accepted by old consumers. The analysis tests `after` contained in `before`.

```js
const oldSchema = { type: 'integer', minimum: 1, maximum: 10 };
const newSchema = { type: 'number', minimum: 0, maximum: 20 };
compareContracts(oldSchema, newSchema, { direction: 'request' }).compatible; // true
compareContracts(oldSchema, newSchema, { direction: 'response' }).compatible; // false
```

The same structural change can be safe in one direction and unsafe in the other. Compare request and response schemas separately when checking an endpoint.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
