import { describe, expect, it } from 'vitest';
import type { ManagedUser } from '@/lib/api/types';
import { buildCreateUser, buildUpdateUser, emptyUserForm, validatePasswordChange, validateUserForm, userFormFromUser } from './userForm';

const existing: ManagedUser = {
  id: 8,
  name: 'Siti Aminah',
  username: 'siti.aminah',
  email: null,
  is_active: true,
  roles: ['Kasir'],
  last_login_at: null,
};

describe('user management form', () => {
  it('validates required fields and username syntax on creation', () => {
    expect(validateUserForm(emptyUserForm(), 'create')).toMatchObject({
      name: expect.any(String),
      username: expect.any(String),
      password: expect.any(String),
      role: expect.any(String),
    });
    expect(validateUserForm({ ...emptyUserForm(), name: 'Admin', username: 'a b', password: 'password1', role: 'Admin' }, 'create').username).toBeDefined();
  });

  it('builds trimmed create and minimal update payloads', () => {
    expect(buildCreateUser({ name: ' Admin ', username: ' admin ', email: ' ', password: 'password1', role: 'Admin' })).toEqual({
      name: 'Admin', username: 'admin', password: 'password1', role: 'Admin',
    });
    const values = userFormFromUser(existing);
    expect(buildUpdateUser(values, existing)).toEqual({});
    expect(buildUpdateUser({ ...values, name: 'Siti A', email: 'siti@example.test', role: 'Finance' }, existing)).toEqual({
      name: 'Siti A', email: 'siti@example.test', role: 'Finance',
    });
  });

  it('checks personal password changes and confirmation', () => {
    expect(validatePasswordChange('', 'password2', 'password2')).not.toBeNull();
    expect(validatePasswordChange('password1', 'password1', 'password1')).not.toBeNull();
    expect(validatePasswordChange('password1', 'password2', 'different')).not.toBeNull();
    expect(validatePasswordChange('password1', 'password2', 'password2')).toBeNull();
  });
});
