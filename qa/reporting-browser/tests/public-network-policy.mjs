export const signupPath = '/api/v1/public/proof-pilot';
export const chatPath = '/api/v1/public/chat?tenant=qa-browser';
export const assetPaths = new Set([
  '/dashboard/signup.html', '/dashboard/pilot-signup.js',
  '/qa/chat.html', '/qa/demo.html', '/public/bookedradar-chat.js',
  '/website/src/demo-chat.js', '/favicon.ico'
]);
export function allowedRequest(rawURL, method, origin) {
  const url = new URL(rawURL);
  if (url.origin !== origin) return false;
  const target = url.pathname + url.search;
  return method === 'GET' ? assetPaths.has(target)
    : method === 'POST' && (target === signupPath || target === chatPath);
}
export function syntheticBody(target, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (target === chatPath) return Object.keys(body).sort().join(',') === 'message,sessionId'
    && ['', 'qa-session'].includes(body.sessionId)
    && typeof body.message === 'string' && /^SYNTHETIC QA [a-z ]{1,100}$/.test(body.message);
  if (target !== signupPath) return false;
  const fields = new Set(['name', 'business', 'email', 'contactPreference', 'phone', 'trade', 'serviceArea', 'businessHours', 'services', 'currentWorkflow', 'website', 'goal', 'company_url']);
  return Object.keys(body).every(key => fields.has(key))
    && body.name === 'Synthetic Visitor' && body.business === 'Synthetic QA'
    && ['visitor@example.invalid', 'changed@example.invalid'].includes(body.email)
    && ['email', 'phone'].includes(body.contactPreference)
    && (body.phone === undefined || body.phone === '+12025550100')
    && [...fields].filter(key => !['name', 'business', 'email', 'contactPreference', 'phone'].includes(key))
      .every(key => body[key] === undefined || body[key] === '');
}
