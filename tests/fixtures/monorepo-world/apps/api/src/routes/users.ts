import { listUsers } from '../services/userService';

export function registerUserRoutes() {
  return listUsers();
}
