import assert from 'node:assert/strict';
import { formatLabel } from '../packages/shared/src/format.ts';

assert.equal(formatLabel('ok'), 'Ok');
