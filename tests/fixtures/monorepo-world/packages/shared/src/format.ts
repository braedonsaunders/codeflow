import { getUser } from '../../../apps/api/src/services/userService';

export function formatLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Intentional upward call: shared utils → app service. */
export function formatUser(id: number) {
  const user = getUser(id);
  return user ? formatLabel(user.name) : '';
}
