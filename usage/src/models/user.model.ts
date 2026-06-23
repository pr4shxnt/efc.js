import { defineModel } from 'express-file-cluster';

interface User {
  email: string;
  password: string;
}

export const User = defineModel<User>('User', {
  email: { type: 'string', required: true, unique: true },
  password: { type: 'string', required: true },
});
