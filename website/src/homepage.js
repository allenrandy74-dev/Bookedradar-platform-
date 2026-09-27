(() => {
  const params = new URLSearchParams(location.search);
  const clean = (value, max) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, max);
  const source = clean(params.get('source') || params.get('utm_source'), 80) || 'native_homepage';
  const tradeByPhone = {
    'tel:+14092574186': 'hvac',
    'tel:+14095477916': 'plumbing',
    'tel:+14092139980': 'electrical',
    'tel:+14092321112': 'roofing',
    'tel:+14092304297': 'home_services',
  };
  const metric = (event, trade = 'unknown') => {
    try {
      const body = JSON.stringify({ event, trade, source, variant: 'native_homepage' });
      navigator.sendBeacon('https://bookedradar-platform.onrender.com/api/v1/public/growth-event', new Blob([body], { type: 'text/plain' }));
    } catch { /* Measurement never blocks navigation. */ }
  };
  metric('page_view');
  document.addEventListener('click', event => {
    const href = event.target.closest?.('a[href^="tel:"]')?.getAttribute('href');
    if (tradeByPhone[href]) metric('demo_call_click', tradeByPhone[href]);
  }, { passive: true });
  document.querySelectorAll('a[href*="/dashboard/try.html"]').forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set('source', source);
    url.searchParams.set('variant', 'native_homepage');
    link.href = url.href;
  });
})();
