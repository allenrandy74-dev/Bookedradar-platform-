import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// A small isolated DOM harness: tests interaction/state, not browser rendering or AT.
function page(script, response = async () => Response.json({ ok: true, reply: "Synthetic reply", sessionId: "synthetic" })) {
  let active;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.value = ""; this.textContent = ""; this.className = ""; }
    get childNodes() { return this.children; }
    setAttribute(key, value) { this.attrs[key] = String(value); if (key === "class") this.className = value; }
    getAttribute(key) { return this.attrs[key]; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(key, listener) { this.listeners[key] = listener; }
    focus() { active = this; }
    get classList() {
      const el = this;
      return {
        contains(name) { return el.className.split(/\s+/).includes(name); },
        remove(name) { el.className = el.className.split(/\s+/).filter(n => n !== name).join(" "); },
        toggle(name) { if (this.contains(name)) { this.remove(name); return false; } el.className += ` ${name}`; return true; },
      };
    }
    querySelector(selector) {
      const matches = el => selector.startsWith(".") ? el.classList.contains(selector.slice(1)) : el.tag === selector;
      for (const child of this.children) { if (matches(child)) return child; const found = child.querySelector(selector); if (found) return found; }
      return null;
    }
    set innerHTML(html) {
      this.markup = html;
      const stack = [this];
      for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)([^>]*)>/gi)) {
        if (match[0].startsWith("</")) { stack.pop(); continue; }
        const el = new Element(match[1]);
        for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]);
        stack.at(-1).appendChild(el);
        if (!["input", "br"].includes(el.tag)) stack.push(el);
      }
    }
    attachShadow() { this.shadow = new Element("shadow"); return this.shadow; }
  }
  const document = { body: new Element("body"), currentScript: { dataset: { tenant: "synthetic", api: "https://synthetic.invalid" } }, createElement: tag => new Element(tag) };
  const requests = [];
  const stored = new Map();
  vm.runInNewContext(script, { document, sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) }, fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response(); } });
  const root = document.body.children[0].shadow;
  const launch = root.querySelector(".br-launch");
  const panel = root.querySelector(".br-panel");
  const input = root.querySelector(".br-input");
  const send = root.querySelector(".br-send");
  const log = root.querySelector(".br-log");
  return { root, launch, panel, input, send, log, requests, stored, get active() { return active; }, focusOutside() { new Element("outside").focus(); }, toggle() { launch.listeners.click(); }, close() { root.querySelector(".br-close").listeners.click(); }, submit() { return root.querySelector(".br-form").listeners.submit({ preventDefault() {} }); } };
}

for (const file of ["public/bookedradar-chat.js", "website/src/demo-chat.js"]) {
  const script = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
  test(`${file}: named dialog, input and polite conversation log`, () => {
    const p = page(script);
    assert.equal(p.input.getAttribute("aria-label"), "Message");
    assert.equal(p.panel.getAttribute("role"), "dialog");
    assert.equal(p.panel.getAttribute("aria-labelledby"), "br-chat-title");
    assert.match(p.panel.markup, /id="br-chat-title">[^<]+<\/span>/);
    assert.equal(p.panel.getAttribute("aria-modal"), undefined); // Page remains usable.
    assert.equal(p.log.getAttribute("role"), "log");
    assert.equal(p.log.getAttribute("aria-live"), "polite");
    assert.equal(p.log.getAttribute("aria-relevant"), "additions");
    assert.equal(p.log.getAttribute("tabindex"), "0");
    assert.equal(p.launch.getAttribute("aria-controls"), p.panel.id);
    assert.equal(p.launch.getAttribute("aria-expanded"), "false");
  });
  test(`${file}: launch, close and Escape restore focus and retain draft/history`, () => {
    const p = page(script);
    const label = p.launch.textContent;
    p.toggle();
    assert.equal(p.active, p.input);
    assert.equal(p.launch.getAttribute("aria-expanded"), "true");
    assert.equal(p.launch.textContent, "Close chat");
    p.input.value = "Unsent synthetic draft";
    p.close();
    assert.equal(p.active, p.launch);
    assert.equal(p.panel.classList.contains("open"), false);
    assert.equal(p.launch.textContent, label);
    p.toggle();
    assert.equal(p.log.children.length, 1);
    assert.equal(p.input.value, "Unsent synthetic draft");
    let prevented = 0;
    p.root.listeners.keydown({ key: "Escape", preventDefault() { prevented++; }, stopPropagation() {} });
    assert.equal(prevented, 1);
    assert.equal(p.active, p.launch);
    assert.equal(p.launch.getAttribute("aria-expanded"), "false");
    p.root.listeners.keydown({ key: "Escape", preventDefault() { prevented++; }, stopPropagation() {} });
    assert.equal(prevented, 1);
    p.toggle(); p.toggle();
    assert.equal(p.active, p.launch);
    assert.equal(p.launch.getAttribute("aria-expanded"), "false");
  });
  test(`${file}: one request while pending; late reply does not reopen or steal focus`, async () => {
    let finish;
    const p = page(script, () => new Promise(resolve => { finish = resolve; }));
    p.toggle(); p.input.value = "Synthetic test";
    const pending = p.submit();
    p.input.value = "Draft while waiting";
    await p.submit();
    assert.equal(p.requests.length, 1);
    assert.equal(p.log.children[1].textContent, "You: Synthetic test");
    assert.equal(p.send.disabled, true);
    p.close();
    finish(Response.json({ ok: true, reply: "<img onerror=alert(1)>", sessionId: "synthetic" }));
    await pending;
    assert.equal(p.panel.classList.contains("open"), false);
    assert.equal(p.active, p.launch);
    assert.equal(p.send.disabled, false);
    assert.equal(p.log.children.at(-1).textContent, "Assistant: <img onerror=alert(1)>");
    assert.equal(p.log.children.at(-1).children.length, 0);
    assert.equal(p.stored.get("bookedradar_chat_synthetic"), "synthetic");
    p.toggle();
    assert.equal(p.input.value, "Draft while waiting");
    assert.equal(p.log.children.length, 3);
  });
  for (const outcome of ["success", "failure"]) {
    test(`${file}: late ${outcome} preserves focus after leaving or closing`, async () => {
      let finish;
      let fail;
      const p = page(script, () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
      p.toggle(); p.input.value = "Synthetic test";
      const pending = p.submit();
      if (outcome === "failure") p.close();
      p.focusOutside();
      const outside = p.active;
      if (outcome === "failure") fail(new TypeError("offline"));
      else finish(Response.json({ ok: true, reply: "Synthetic reply" }));
      await pending;
      assert.equal(p.active, outside);
      assert.equal(p.panel.classList.contains("open"), outcome === "success");
      assert.equal(p.send.disabled, false);
      assert.match(p.log.children.at(-1).textContent, /^Assistant: /);
      if (outcome === "failure") assert.match(p.log.children.at(-1).textContent, /temporarily unavailable/);
      assert.equal(p.requests.length, 1);
    });
  }
  test(`${file}: failure is added to announced log without automatic retry`, async () => {
    const p = page(script, async () => { throw new TypeError("offline"); });
    p.toggle(); p.input.value = "Synthetic test";
    await p.submit();
    assert.equal(p.requests.length, 1);
    assert.match(p.log.children.at(-1).textContent, /temporarily unavailable/);
    assert.equal(p.send.disabled, false);
  });
}
