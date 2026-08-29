/**
 * Environment for the test run. Set before any module imports config/env.ts,
 * which validates configuration eagerly and exits the process when it is wrong.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://postgres@127.0.0.1:5432/talkwithme_test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
process.env.PASSWORD_PEPPER = 'test-password-pepper-value';
process.env.BCRYPT_COST = '10';
process.env.MAIL_DRIVER = 'console';
process.env.STORAGE_DRIVER = 'local';
process.env.LOG_LEVEL = 'error';
