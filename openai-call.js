const API_BASE = "https://api.openai.com/v1";

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function checkedFetch(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `OpenAI call-control request failed (${response.status}): ${text || response.statusText}`
    );
  }

  return text ? JSON.parse(text) : null;
}

export async function acceptRealtimeCall({
  apiKey,
  callId,
  model,
  instructions,
  voice,
  tools,
}) {
  const body = {
    type: "realtime",
    model,
    instructions,
    audio: {
      output: {
        voice,
      },
    },
    tools,
    tool_choice: "auto",
  };

  return checkedFetch(
    `${API_BASE}/realtime/calls/${encodeURIComponent(callId)}/accept`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    }
  );
}

export async function referRealtimeCall({ apiKey, callId, targetUri }) {
  return checkedFetch(
    `${API_BASE}/realtime/calls/${encodeURIComponent(callId)}/refer`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ target_uri: targetUri }),
    }
  );
}

export async function hangupRealtimeCall({ apiKey, callId }) {
  return checkedFetch(
    `${API_BASE}/realtime/calls/${encodeURIComponent(callId)}/hangup`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );
}


export async function rejectRealtimeCall({
  apiKey,
  callId,
  statusCode = 404,
}) {
  return checkedFetch(
    `${API_BASE}/realtime/calls/${encodeURIComponent(callId)}/reject`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ status_code: statusCode }),
    }
  );
}
