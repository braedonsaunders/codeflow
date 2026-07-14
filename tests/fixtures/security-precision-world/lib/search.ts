export function find(items: string[], re: RegExp) {
  return items.filter((i) => re.exec(i));
}
