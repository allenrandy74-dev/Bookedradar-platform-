(() => {
  const script = document.currentScript;
  if (!script) return;
  const tenant = String(script.dataset.tenant || "").trim();
  const api = String(script.dataset.api || "https://bookedradar-platform.onrender.com").replace(/\/$/, "");
  if (!tenant) return;

  const host = document.createElement("div");
  host.setAttribute("data-bookedradar-chat", tenant);
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    button{font:inherit}.br-launch{position:fixed;right:20px;bottom:20px;border:0;border-radius:999px;padding:13px 17px;background:#111;color:#fff;font-weight:700;box-shadow:0 10px 35px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000}
    .br-panel{position:fixed;right:20px;bottom:76px;width:min(360px,calc(100vw - 28px));height:min(520px,calc(100vh - 110px));background:#fff;color:#111;border:1px solid #ddd;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000}
    .br-panel.open{display:flex}.br-head{padding:14px 16px;background:#111;color:#fff;font-weight:800}.br-sub{font-size:12px;font-weight:500;opacity:.75;margin-top:3px}
    .br-log{flex:1;overflow:auto;padding:14px;background:#f7f7f7}.br-msg{max-width:86%;padding:10px 12px;border-radius:14px;margin:8px 0;white-space:pre-wrap;line-height:1.35;font-size:14px}.assistant{background:#fff;border:1px solid #e4e4e4}.visitor{background:#111;color:#fff;margin-left:auto}
    .br-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e4e4e4}.br-input{flex:1;border:1px solid #ccc;border-radius:12px;padding:10px;font:inherit;min-width:0}.br-send{border:0;border-radius:12px;background:#111;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}
    .br-note{font-size:10px;color:#777;padding:0 12px 9px;background:#fff}
  `;
  root.appendChild(style);

  const launch = document.createElement("button");
  launch.className = "br-launch";
  launch.type = "button";
  launch.textContent = "Chat with us";
  root.appendChild(launch);

  const panel = document.createElement("div");
  panel.className = "br-panel";
  panel.innerHTML = '<div class="br-head">How can we help?<div class="br-sub">Powered by BookedRadar</div></div><div class="br-log"></div><form class="br-form"><input class="br-input" autocomplete="off" maxlength="1600" placeholder="Type a message…"><button class="br-send" type="submit">Send</button></form><div class="br-note">Do not send passwords, Social Security numbers, or full payment-card numbers.</div>';
  root.appendChild(panel);

  const log = panel.querySelector(".br-log");
  const form = panel.querySelector(".br-form");
  const input = panel.querySelector(".br-input");
  const send = panel.querySelector(".br-send");
  const sessionKey = `bookedradar_chat_${tenant}`;
  let sessionId = sessionStorage.getItem(sessionKey) || "";

  function add(role, text) {
    const div = document.createElement("div");
    div.className = `br-msg ${role}`;
    div.textContent = String(text || "");
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  launch.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      if (!log.childNodes.length) add("assistant", "Hi! Tell me what you need help with.");
      input.focus();
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || send.disabled) return;
    add("visitor", message);
    input.value = "";
    send.disabled = true;
    try {
      const response = await fetch(`${api}/api/v1/public/chat?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("chat unavailable");
      sessionId = data.sessionId || sessionId;
      if (sessionId) sessionStorage.setItem(sessionKey, sessionId);
      add("assistant", data.reply || "Thanks. We received your message.");
    } catch {
      add("assistant", "I’m sorry, chat is temporarily unavailable. Please call the business directly.");
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();