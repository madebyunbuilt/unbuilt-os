import { getAuthTables } from 'better-auth/db';
import { describe, expect, it } from 'vitest';
import { createAuthOptions } from '../auth';
import { tables } from './schema';

describe('Better Auth component schema', () => {
  it('matches the tables and fields Better Auth needs; run `pnpm auth:schema` if this fails', () => {
    const expected = Object.fromEntries(
      Object.values(getAuthTables(createAuthOptions({} as never))).map((table) => [
        table.modelName,
        Object.entries(table.fields)
          .filter(([name]) => name !== 'id')
          .map(([name, attr]) => attr.fieldName ?? name)
          .sort(),
      ]),
    );
    const actual = Object.fromEntries(
      Object.entries(tables).map(([name, table]) => [name, Object.keys(table.validator.fields).sort()]),
    );
    expect(actual).toEqual(expected);
  });
});
