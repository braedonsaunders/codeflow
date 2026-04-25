export function add(a, b) {
  return a + b;
}

export function double(value) {
  return add(value, value);
}

function unusedHelper() {
  return add(1, 1);
}
