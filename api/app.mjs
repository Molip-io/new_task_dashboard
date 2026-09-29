// Vercel looks for functions under api/. The handler itself lives with the rest of the
// dashboard code; this shim goes away together with the Vercel deployment.
export { default } from '../dashboard/api/app.mjs';
export * from '../dashboard/api/app.mjs';
