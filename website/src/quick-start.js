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
      const tokenResponse = await fetch('https://www.wixapis.com/oauth2/token', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({clientId:'a5fc33eb-4eb3-4562-9e5d-6c1a61623499',grantType:'anonymous'})
      });
      if (!tokenResponse.ok) throw new Error('Unable to start submission');
      const token = (await tokenResponse.json()).access_token;
      if (!token) throw new Error('Unable to start submission');
      const submissions = Object.fromEntries(fields.filter(key => !form.elements[key].disabled).map(key => [key, form.elements[key].value.trim()]).filter(([,value])=>value));
      const wantsCall = submissions.contact_preference === 'phone';
      submissions.anything_else = [
        wantsCall ? 'Setup contact preference: PHONE — customer requested a setup call.' : 'Setup contact preference: EMAIL ONLY — do not make setup or sales calls. The escalation number is for caller transfers only.',
        submissions.anything_else
      ].filter(Boolean).join('\n');
      const response = await fetch('https://www.wixapis.com/form-submission-service/v4/submissions', {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:token},
        body:JSON.stringify({submission:{formId:'1738b140-49de-4cde-b966-3dcd5f676cfc',submissions}})
      });
      if (!response.ok) throw new Error('Submission not confirmed');
      const data = await response.json();
      if (!data.submission?.id || data.submission.status !== 'CONFIRMED') throw new Error('Submission not confirmed');
      status.textContent = 'Thank you. Your answers were received. Setup reference: '+data.submission.id;
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
})();
