export function listUsers() {
  return [{ id: 1, name: 'Ada' }];
}

export function getUser(id: number) {
  return listUsers().find((user) => user.id === id) || null;
}
