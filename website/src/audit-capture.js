(() => {
  const mount = document.querySelector('.sticky');
  if (!mount || document.getElementById('brAuditLead')) return;
  const oldNotice = mount.querySelector('.notice');
  if (oldNotice) oldNotice.hidden = true;
  const card = document.createElement('div');
  card.id = 'brAuditLead';
  card.innerHTML = `<h3>Want a human review of your score?</h3>
    <p class="brSub">Send us your results and we’ll look for recovery gaps in your current process. Email-only follow-up is available.</p>
    <form id="brAuditLeadForm" hidden><div class="brGrid">
      <label>First name<input name="first" autocomplete="given-name" maxlength="60" required></label>
      <label>Last name (optional)<input name="last" autocomplete="family-name" maxlength="59"></label>
      <label class="brFull">Business email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label class="brFull">Business name<input name="company" autocomplete="organization" maxlength="160" required></label>
      <label class="brFull">How should we follow up?<select name="contactPreference" id="audit-contact-preference"><option value="email">Email only — no sales call</option><option value="phone">I’d prefer a phone call</option></select></label>
      <label class="brFull" id="audit-phone-field" hidden>Phone number<input name="phone" type="tel" autocomplete="tel" maxlength="40" disabled></label>
      <label class="brFull">Primary trade (optional)<select name="trade"><option value="">Choose later</option><option>HVAC</option><option>Plumbing</option><option>Electrical</option><option>Roofing</option><option>Other</option></select></label>
      <label class="brFull">Where do you think opportunities are slipping away? (optional)<textarea name="note" maxlength="1200" placeholder="Missed calls, slow response, old estimates, cancellations..."></textarea></label>
      <label class="brTrap" aria-hidden="true">Leave empty<input name="company_url" tabindex="-1" autocomplete="off"></label>
    </div><p class="brConsent">By requesting a review, you ask BookedRadar to follow up using your chosen contact method. This is not marketing text consent or service activation. Please do not include passwords, payment details or customer information. <a href="privacy.html">Privacy</a></p>
    <button type="submit">Request My Review</button><div class="brStatus" id="brAuditStatus" role="status" aria-live="polite"></div></form>
    <p class="brSub">Prefer email? Write to <a href="mailto:randy@bookedradar.com?subject=BookedRadar%20audit%20review">randy@bookedradar.com</a> with your business name and score.</p>`;
  mount.appendChild(card);
  const form = document.getElementById('brAuditLeadForm');
  const status = document.getElementById('brAuditStatus');
  const button = form.querySelector('button');
  const field = name => form.elements.namedItem(name);
  let sending = false;
  let recorded = false;
  function updateContactChoice() {
    const wantsCall = field('contactPreference').value === 'phone';
    document.getElementById('audit-phone-field').hidden = !wantsCall;
    field('phone').disabled = !wantsCall;
    field('phone').required = wantsCall;
  }
  field('contactPreference').addEventListener('change', updateContactChoice);
  updateContactChoice();

  function auditReport() {
    const answers = Array.from(document.querySelectorAll('#questions input[type=radio]:checked')).map(input => {
      const question = input.closest('.question');
      return `${question.querySelector('label').textContent.trim()} = ${input.closest('.option').textContent.trim()}`;
    });
    return [
      `Audit score: ${document.getElementById('score').textContent} / 100`,
      `Tier: ${document.getElementById('tier').textContent}`,
      `Illustrative monthly scenario: ${document.getElementById('money').textContent} (${document.getElementById('leads').value} leads/week, $${document.getElementById('job').value} average job, ${document.getElementById('rate').value}% recovery). Not a revenue guarantee.`,
      'Answers:', ...answers,
    ].join('\n');
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || recorded || !form.reportValidity() || field('company_url').value) return;
    if (document.querySelectorAll('#questions input[type=radio]:checked').length !== 7) {
      status.textContent = 'Answer all 7 audit questions before requesting a review.';
      return;
    }
    const body = {
      name: [field('first').value.trim(), field('last').value.trim()].filter(Boolean).join(' '),
      business: field('company').value.trim(), email: field('email').value.trim(),
      contactPreference: field('contactPreference').value,
      trade: field('trade').value,
      goal: field('note').value.trim(),
      company_url: field('company_url').value,
      inquiryType: 'audit', auditReport: auditReport(),
    };
    if (body.contactPreference === 'phone') body.phone = field('phone').value.trim();
    sending = true;
    button.disabled = true;
    status.textContent = 'Sending your audit…';
    try {
      const response = await fetch('https://bookedradar-platform.onrender.com/api/v1/public/proof-pilot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('capture_not_confirmed');
      recorded = true;
      status.textContent = result.duplicate
        ? 'An audit review request using these contact details is already recorded. Email randy@bookedradar.com to confirm its status or update your answers.'
        : body.contactPreference === 'phone'
        ? 'Received. Your audit answers are saved. You requested a phone call; we’ll follow up at the number provided.'
        : 'Received. Your audit answers are saved. We’ll review them and follow up by email, with no sales call.';
      button.textContent = result.duplicate ? 'Request already recorded' : 'Audit submitted';
      if (!result.duplicate) window.BookedRadarTelemetry?.track?.('audit_submit', '/audit.html');
    } catch {
      status.textContent = 'We couldn’t confirm your audit request. Your answers are still here. Please email randy@bookedradar.com for help; don’t submit repeatedly.';
    } finally {
      sending = false;
      button.disabled = recorded;
    }
  });
  // Attach the handler before showing personal fields, avoiding a default GET.
  form.hidden = false;
})();
