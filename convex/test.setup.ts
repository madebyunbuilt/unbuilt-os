/// <reference types="vite/client" />

// Every Convex module, for convexTest(schema, modules). Convex skips files with more than one dot when deploying.
export const modules = import.meta.glob(['./**/*.*s', '!./betterAuth/**']);
export const authModules = import.meta.glob('./betterAuth/**/*.*s');
