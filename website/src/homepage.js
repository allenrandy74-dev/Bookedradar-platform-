(() => {
  const params = new URLSearchParams(location.search);
  const clean = (value, max) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, max);
  const source = clean(params.get('source') || params.get('utm_source'), 80) || 'native_homepage';
  document.querySelectorAll('a[href*="/dashboard/try.html"]').forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set('source', source);
    url.searchParams.set('variant', 'native_homepage');
    link.href = url.href;
  });
})();
