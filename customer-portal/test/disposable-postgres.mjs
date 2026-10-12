/** Destructive test operations are restricted to explicitly acknowledged local test DBs. */
export function requireDisposablePostgres(env = process.env) {
  if (env.PORTAL_TEST_ACK !== 'disposable') throw new Error('Set PORTAL_TEST_ACK=disposable only for an isolated disposable test database.');
  let url;
  try { url = new URL(env.PORTAL_TEST_DATABASE_URL || ''); } catch { throw new Error('PORTAL_TEST_DATABASE_URL must identify an isolated disposable PostgreSQL database.'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^[a-z][a-z0-9_]{0,48}_portal_test$/.test(database)
    || /prod|production|live/.test(database)
    || url.search || url.hash || !url.username) {
    throw new Error('Refusing database: tests require loopback host, an explicit *_portal_test database, no production/live naming, and no URL overrides.');
  }
  return { connectionString: url.toString(), database };
}
