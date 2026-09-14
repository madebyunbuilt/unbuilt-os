import { createApi } from '@convex-dev/better-auth';
import { createAuthOptions } from '../auth';
import schema from './schema';

// The database adapter functions Better Auth calls, running inside the component.
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } = createApi(
  schema,
  createAuthOptions,
);
