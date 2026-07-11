export function buildHandler(userCode: string) {
  return new Function(userCode);
}
