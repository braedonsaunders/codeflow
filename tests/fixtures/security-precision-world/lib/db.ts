export function findUser(id: string) {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}
