export function countUsers() {
  return db.query("SELECT 1");
}

export function findUser(id: string) {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}
