import type { ManagedUser } from '@/lib/api/types';

export interface UserFormValues {
  name: string;
  username: string;
  email: string;
  password: string;
  role: string;
}

export type UserFormErrors = Partial<Record<'name' | 'username' | 'email' | 'password' | 'role', string>>;

export function emptyUserForm(): UserFormValues {
  return { name: '', username: '', email: '', password: '', role: '' };
}

export function userFormFromUser(user: ManagedUser): UserFormValues {
  return {
    name: user.name,
    username: user.username,
    email: user.email ?? '',
    password: '',
    role: user.roles[0] ?? '',
  };
}

export function validateUserForm(values: UserFormValues, mode: 'create' | 'edit'): UserFormErrors {
  const errors: UserFormErrors = {};
  const name = values.name.trim();
  const username = values.username.trim();
  const email = values.email.trim();
  const password = values.password;

  if (!name) errors.name = 'Nama wajib diisi.';
  else if (name.length > 150) errors.name = 'Maksimal 150 karakter.';

  if (mode === 'create') {
    if (!username) errors.username = 'Username wajib diisi.';
    else if (username.length > 60 || !/^[A-Za-z0-9._-]+$/.test(username)) {
      errors.username = 'Gunakan huruf, angka, titik, garis bawah, atau strip (maks. 60 karakter).';
    }
    if (password.length < 8) errors.password = 'Sandi minimal 8 karakter.';
    else if (password.length > 255) errors.password = 'Sandi maksimal 255 karakter.';
  }

  if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.email = 'Alamat email tidak valid (maks. 190 karakter).';
  }
  if (!values.role) errors.role = 'Pilih role pengguna.';
  return errors;
}

export function buildCreateUser(values: UserFormValues) {
  return {
    name: values.name.trim(),
    username: values.username.trim(),
    ...(values.email.trim() ? { email: values.email.trim() } : {}),
    password: values.password,
    role: values.role,
  };
}

export function buildUpdateUser(values: UserFormValues, original: ManagedUser) {
  const update: { name?: string; email?: string | null; role?: string } = {};
  const name = values.name.trim();
  const email = values.email.trim() || null;
  if (name !== original.name) update.name = name;
  if (email !== original.email) update.email = email;
  if (values.role !== (original.roles[0] ?? '')) update.role = values.role;
  return update;
}

export function validatePasswordChange(currentPassword: string, password: string, confirmation: string): string | null {
  if (!currentPassword) return 'Masukkan sandi saat ini.';
  if (password.length < 8 || password.length > 255) return 'Sandi baru harus 8–255 karakter.';
  if (password === currentPassword) return 'Sandi baru harus berbeda dari sandi saat ini.';
  if (password !== confirmation) return 'Konfirmasi sandi baru tidak cocok.';
  return null;
}
