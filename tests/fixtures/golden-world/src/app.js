import { add, double } from './math.js';

export function boot() {
  return double(add(1, 2));
}

boot();
