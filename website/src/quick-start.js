(() => {
  const form = document.getElementById('quickStart');
  const status = document.getElementById('setupStatus');
  const next = document.getElementById('nextSteps');
  const preference = form.elements.contact_preference;
  const phoneField = document.getElementById('setup-phone-field');
  const followup = document.getElementById('setup-followup');
  const fields = ['first_name','business_name','email','contact_preference','phone','business_type','service_area','business_hours','services','coverage','urgent_contact','urgent_definition','customer_tracking','booking','anything_else'];
  function updateContactPreference() {
    const wantsCall = preference.value === 'phone';
    phoneField.hidden = !wantsCall;
    form.elements.phone.required = wantsCall;
    form.elements.phone.disabled = !wantsCall;
  }
  preference.addEventListener('change', updateContactPreference);
  updateContactPreference();
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || form.elements.website_check.value || !form.reportValidity()) return;
    busy = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Saving your setup answers…';
    try {
      const submissions = Object.fromEntries(fields.filter(key => !form.elements[key].disabled).map(key => [key, form.elements[key].value.trim()]));
      const wantsCall = submissions.contact_preference === 'phone';
      const response = await fetch('https://bookedradar-platform.onrender.com/api/v1/public/proof-pilot', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ inquiryType: 'setup', setupAnswers: submissions, company_url: form.elements.website_check.value })
      });
      const data = await response.json();
      if (response.status === 400) {
        status.textContent = data.error === 'setup_transfer_number_required'
          ? 'Enter one direct US phone number for caller transfers, without an extension. This is separate from setup follow-up. Your answers are still here.'
          : 'Please check your required answers, email, phone numbers and selections. Your answers are still here; nothing has been confirmed yet.';
        button.disabled = false;
        busy = false;
        return;
      }
      if (!response.ok || !data.ok) throw new Error('Submission not confirmed');
      status.textContent = data.duplicate ? 'These setup answers are already recorded for review.' : 'Thank you. Your setup answers were received and saved for review.';
      followup.textContent = wantsCall ? 'You requested a setup call.' : 'We’ll follow up by email, with no setup or sales call.';
      form.reset();
      updateContactPreference();
      form.hidden = true;
      next.hidden = false;
    } catch {
      status.textContent = 'We could not confirm receipt. Your answers are still here. Please contact randy@bookedradar.com so we can check before you submit again.';
      button.disabled = false;
      busy = false;
    }
  });
  // Show the form only after attaching the handler, preventing a default GET.
  form.hidden = false;
})();
