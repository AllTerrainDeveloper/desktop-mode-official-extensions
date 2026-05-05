(function() {
  "use strict";
  function desktopMaybe() {
    return window.wp?.desktop;
  }
  function desktopReady() {
    const d = window.wp?.desktop;
    if (!d) {
      throw new Error(
        "[wpdm-messages] window.wp.desktop not available at runtime — is wp-desktop-mode active?"
      );
    }
    return d;
  }
  function whenDesktopReady(cb) {
    const d = desktopMaybe();
    if (d && typeof d.isReady === "function" && d.isReady()) {
      cb(d);
      return;
    }
    const tryReady = () => {
      const ready2 = window.wp?.desktop?.ready;
      if (typeof ready2 === "function") {
        ready2(() => cb(desktopReady()));
      } else if (document.readyState === "loading") {
        document.addEventListener(
          "DOMContentLoaded",
          () => queueMicrotask(tryReady),
          { once: true }
        );
      } else {
        window.setTimeout(tryReady, 50);
      }
    };
    tryReady();
  }
  function __(text, _domain) {
    return window.wp?.i18n?.__?.(text, "wp-desktop-messages") ?? text;
  }
  const SHARED_STORES_SLOT = "__wpDesktopSharedStores";
  function resolveSlot() {
    const w = window;
    let slot = w[SHARED_STORES_SLOT];
    if (!slot) {
      slot = /* @__PURE__ */ new Map();
      w[SHARED_STORES_SLOT] = slot;
    }
    return slot;
  }
  function createSharedStore(key, initialState) {
    const slot = resolveSlot();
    let record = slot.get(key);
    if (!record) {
      record = {
        state: initialState(),
        listeners: /* @__PURE__ */ new Set(),
        rebuild: initialState
      };
      slot.set(key, record);
    }
    const r = record;
    return {
      get state() {
        return r.state;
      },
      set state(next) {
        r.state = next;
      },
      getState() {
        return r.state;
      },
      notify() {
        for (const cb of r.listeners) {
          try {
            cb(r.state);
          } catch (err) {
            console.error("[wpdm-messages] shared-store subscriber threw", err);
          }
        }
      },
      subscribe(cb) {
        r.listeners.add(cb);
        return () => {
          r.listeners.delete(cb);
        };
      },
      reset() {
        r.state = r.rebuild();
        r.listeners.clear();
      }
    };
  }
  const HOOKS = Object.freeze({
    WINDOW_OPENED: "wp-desktop.window.opened",
    WINDOW_REOPENED: "wp-desktop.window.reopened",
    WINDOW_CLOSED: "wp-desktop.window.closed",
    WINDOW_FOCUSED: "wp-desktop.window.focused",
    WINDOW_BLURRED: "wp-desktop.window.blurred",
    WINDOW_MINIMIZED: "wp-desktop.window.minimized",
    WINDOW_RESTORED: "wp-desktop.window.restored"
  });
  function wpHooks() {
    return window.wp?.hooks;
  }
  function addAction(hookName, namespace, callback, priority) {
    const h = wpHooks();
    if (!h) {
      whenDesktopReady(() => addAction(hookName, namespace, callback, priority));
      return;
    }
    h.addAction(hookName, namespace, callback, priority);
  }
  function removeAction(hookName, namespace) {
    const h = wpHooks();
    return h ? h.removeAction(hookName, namespace) : 0;
  }
  const ACTIVITY_PREFIX = "wp-desktop.activity.";
  const activity = {
    publish(channel, payload) {
      const h = wpHooks();
      if (h) {
        h.applyFilters(ACTIVITY_PREFIX + channel, payload);
      }
    },
    subscribe(channel, cb) {
      const ns = `wpdm-messages/activity-sub/${Math.random().toString(36).slice(2)}`;
      addAction(ACTIVITY_PREFIX + channel, ns, (payload) => cb(payload));
      return () => {
        removeAction(ACTIVITY_PREFIX + channel, ns);
      };
    },
    filter(channel, value, ...args) {
      const h = wpHooks();
      if (!h) {
        return value;
      }
      return h.applyFilters(ACTIVITY_PREFIX + channel, value, ...args);
    }
  };
  function applyPresenceBatch(updates) {
    desktopMaybe()?.presence.applyBatch(updates);
  }
  function subscribePresence(cb) {
    let unsub = null;
    let cancelled = false;
    whenDesktopReady((d) => {
      if (cancelled) return;
      unsub = d.presence.subscribe(cb);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }
  function showToast(opts) {
    const d = desktopMaybe();
    if (!d) {
      console.warn("[wpdm-messages] showToast called before wp.desktop ready");
      return () => void 0;
    }
    return d.showToast(opts);
  }
  const heartbeat = new Proxy(
    {},
    {
      get(_t, prop, recv) {
        const live = desktopMaybe()?.heartbeat;
        if (!live) {
          if (prop === "contribute" || prop === "subscribe") {
            return () => () => void 0;
          }
          return void 0;
        }
        return Reflect.get(live, prop, recv);
      }
    }
  );
  const WINDOW_ID$1 = "wpdm-messages";
  function resolveDocks() {
    const wp = window.wp;
    const out = [];
    const dock = wp?.desktop?.dock;
    const taskbar = wp?.desktop?.taskbar;
    if (dock && typeof dock.setAttention === "function") {
      out.push(dock);
    }
    if (taskbar && typeof taskbar.setAttention === "function") {
      out.push(taskbar);
    }
    return out;
  }
  function resolveBadgeRails() {
    const wp = window.wp;
    const out = [];
    const dock = wp?.desktop?.dock;
    const taskbar = wp?.desktop?.taskbar;
    const icons = wp?.desktop?.icons;
    if (dock && typeof dock.setBadge === "function") {
      out.push(dock);
    }
    if (taskbar && typeof taskbar.setBadge === "function") {
      out.push(taskbar);
    }
    if (icons && typeof icons.setBadge === "function") {
      out.push(icons);
    }
    return out;
  }
  function requestMessagesAttention(mode = "pulse", durationMs = 4e3) {
    const wp = window.wp;
    const win = wp?.desktop?.windowManager?.getById?.(WINDOW_ID$1);
    if (win && typeof win.requestAttention === "function") {
      win.requestAttention(mode, { durationMs });
      return;
    }
    for (const d of resolveDocks()) {
      d.setAttention?.(WINDOW_ID$1, mode, { durationMs });
    }
  }
  function setMessagesBadge(count) {
    for (const d of resolveBadgeRails()) {
      d.setBadge?.(WINDOW_ID$1, count);
    }
  }
  function openAndShakeMessagesWindow() {
    const wp = window.wp;
    const desktop = wp?.desktop;
    desktop?.openWindow?.(WINDOW_ID$1);
    requestAnimationFrame(() => {
      const win = desktop?.windowManager?.getById?.(WINDOW_ID$1);
      if (!win) {
        return;
      }
      if (win.state === "minimized" && typeof win.restore === "function") {
        win.restore();
      }
      if (typeof win.shake === "function") {
        win.shake();
      }
    });
  }
  const DEFAULT_SETTINGS = {
    nudgeSoundId: "",
    volume: 0.7,
    showToast: true,
    soundWhileFocused: false,
    inactiveAfterSeconds: 300,
    acceptFrom: "everyone"
  };
  const store$1 = createSharedStore("wpdm-messages/state", () => ({
    conversations: [],
    focusedConversationId: null,
    messagesByConversation: /* @__PURE__ */ new Map(),
    typingByConversation: /* @__PURE__ */ new Map(),
    settings: { ...DEFAULT_SETTINGS },
    sounds: [],
    defaultSoundId: "",
    totalUnread: 0,
    unreadByConversation: /* @__PURE__ */ new Map(),
    windowMounted: false,
    windowFocused: false
  }));
  const state = store$1.state;
  function notify() {
    store$1.notify();
  }
  subscribePresence(() => {
    store$1.notify();
  });
  function getState() {
    return store$1.getState();
  }
  function subscribe(cb) {
    return store$1.subscribe(cb);
  }
  function upsertConversation(c) {
    const existing = state.conversations.findIndex((x) => x.id === c.id);
    if (existing >= 0) {
      state.conversations[existing] = c;
    } else {
      state.conversations.push(c);
    }
    state.conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    if (!state.unreadByConversation.has(c.id)) {
      state.unreadByConversation.set(c.id, c.unreadCount);
      state.totalUnread = state.totalUnread + c.unreadCount;
    }
    notify();
  }
  function setFocusedConversation(id) {
    state.focusedConversationId = id;
    notify();
  }
  function appendMessage(row) {
    const list = state.messagesByConversation.get(row.conversationId) ?? [];
    if (list.some((r) => r.id === row.id)) {
      return;
    }
    list.push(row);
    list.sort((a, b) => a.id - b.id);
    state.messagesByConversation.set(row.conversationId, list);
    const conv = state.conversations.find((c) => c.id === row.conversationId);
    if (conv) {
      conv.lastMessage = {
        preview: row.kind === "nudge" ? "👋 sent a nudge" : row.content,
        authorId: row.authorId,
        createdAtMs: row.createdAtMs
      };
      conv.updatedAtMs = row.createdAtMs;
      state.conversations.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    }
    notify();
  }
  function setTyping(conversationId, entries) {
    if (entries.length === 0) {
      state.typingByConversation.delete(conversationId);
    } else {
      state.typingByConversation.set(conversationId, entries.slice());
    }
    notify();
  }
  function setSettings(settings) {
    state.settings = { ...settings };
    notify();
  }
  function setSounds(list, defaultId) {
    state.sounds = list.slice();
    state.defaultSoundId = defaultId;
    notify();
  }
  function setUnread(total, byConversation) {
    state.totalUnread = total;
    state.unreadByConversation = /* @__PURE__ */ new Map();
    for (const [k, v] of Object.entries(byConversation)) {
      state.unreadByConversation.set(Number(k), v);
    }
    notify();
  }
  function bumpUnread(conversationId) {
    const current = state.unreadByConversation.get(conversationId) ?? 0;
    state.unreadByConversation.set(conversationId, current + 1);
    state.totalUnread = state.totalUnread + 1;
    notify();
  }
  const WINDOW_ID = "wpdm-messages";
  let installedLifecycleNamespace = null;
  const LIFECYCLE_HOOKS = [
    HOOKS.WINDOW_OPENED,
    HOOKS.WINDOW_FOCUSED,
    HOOKS.WINDOW_BLURRED,
    HOOKS.WINDOW_MINIMIZED,
    HOOKS.WINDOW_RESTORED,
    HOOKS.WINDOW_CLOSED,
    HOOKS.WINDOW_REOPENED
  ];
  function isMessagesWindowActive() {
    const wp = window.wp;
    return !!wp?.desktop?.windowManager?.isActive?.(WINDOW_ID);
  }
  function repaintBadge() {
    const totalUnread = getState().totalUnread;
    const active = isMessagesWindowActive();
    const raw = active ? 0 : totalUnread;
    const final = activity.filter("messages/badge-count", raw, {
      totalUnread,
      windowActive: active
    });
    setMessagesBadge(
      typeof final === "number" ? Math.max(0, Math.floor(final)) : raw
    );
  }
  function startMessagesBadgePolicy() {
    if (installedLifecycleNamespace) {
      return () => void 0;
    }
    installedLifecycleNamespace = `wp-desktop-mode/messages-badge-policy/${Date.now()}`;
    const ns = installedLifecycleNamespace;
    const stateUnsub = subscribe(() => repaintBadge());
    for (const hook of LIFECYCLE_HOOKS) {
      addAction(hook, ns, (payload) => {
        const detail = payload;
        if (detail?.windowId !== WINDOW_ID) {
          return;
        }
        repaintBadge();
      });
    }
    repaintBadge();
    return () => {
      stateUnsub();
      for (const hook of LIFECYCLE_HOOKS) {
        removeAction(hook, ns);
      }
      installedLifecycleNamespace = null;
    };
  }
  function config() {
    return window.wpDesktopMessagesConfig;
  }
  async function request(path, init = {}) {
    const cfg = config();
    if (!cfg) {
      throw new Error("[wpdm-messages] config missing");
    }
    const url = path.startsWith("http") ? path : cfg.restRoot.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-WP-Nonce": cfg.restNonce,
        ...init.headers || {}
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[wpdm-messages] ${path} → ${res.status}: ${body}`);
    }
    return await res.json();
  }
  async function listConversations() {
    return request("/conversations?per_page=100");
  }
  async function startConversation(recipientId) {
    return request("/conversations", {
      method: "POST",
      body: JSON.stringify({ recipientId })
    });
  }
  async function fetchMessages(conversationId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.before) {
      params.set("before", String(opts.before));
    }
    if (opts.limit) {
      params.set("limit", String(opts.limit));
    }
    const qs = params.toString() ? `?${params}` : "";
    return request(`/conversations/${conversationId}/messages${qs}`);
  }
  async function sendMessage(conversationId, content, opts = {}) {
    return request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        kind: opts.kind ?? "text",
        clientId: opts.clientId
      })
    });
  }
  async function markRead(conversationId, lastReadId) {
    return request(`/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ lastReadId })
    });
  }
  async function postNudge(conversationId, soundId) {
    return request(`/conversations/${conversationId}/nudge`, {
      method: "POST",
      body: JSON.stringify({ soundId: soundId ?? "" })
    });
  }
  async function fetchSince(lastEventId) {
    return request(`/since?lastEventId=${lastEventId}`);
  }
  async function fetchSounds() {
    return request("/sounds");
  }
  async function getSettings() {
    return request("/settings");
  }
  async function saveSettings(settings) {
    return request("/settings", {
      method: "POST",
      body: JSON.stringify({ settings })
    });
  }
  async function postPresence(inactive) {
    return request("/presence", {
      method: "POST",
      body: JSON.stringify({ inactive })
    });
  }
  function registerMessagesSettingsTab() {
    try {
      const wp = window.wp;
      const register = wp?.desktop?.registerSettingsTab;
      if (typeof register !== "function") {
        const ready2 = window.wp?.desktop?.ready;
        if (typeof ready2 === "function") {
          ready2(() => registerMessagesSettingsTab());
        } else {
          window.setTimeout(() => registerMessagesSettingsTab(), 100);
        }
        return;
      }
      register({
        id: "messages",
        label: __("Messages"),
        owner: "wp-desktop-messages-shell",
        order: 25,
        render(body) {
          void renderForm(body);
        }
      });
    } catch (err) {
      console.error("[wpdm-messages] settings-tab registration failed", err);
    }
  }
  async function renderForm(body) {
    body.innerHTML = "";
    const cfg = window.wpDesktopMessagesConfig;
    const sounds = cfg?.sounds ?? [];
    let current;
    try {
      current = await getSettings();
    } catch (_err) {
      current = cfg?.userSettings ?? {
        nudgeSoundId: "",
        volume: 0.7,
        showToast: true,
        soundWhileFocused: false,
        inactiveAfterSeconds: 300,
        acceptFrom: "everyone"
      };
    }
    const root = document.createElement("div");
    root.className = "wpdm-messages-settings";
    const stack = document.createElement("wpd-stack");
    stack.setAttribute("gap", "16");
    stack.appendChild(buildSoundField(sounds, current));
    stack.appendChild(buildVolumeField(current));
    stack.appendChild(buildShowToastField(current));
    stack.appendChild(buildSoundFocusedField(current));
    stack.appendChild(buildInactiveField(current));
    stack.appendChild(buildAcceptFromField(current));
    if (cfg?.siteSettings && cfg?.siteSettingsUrl) {
      stack.appendChild(
        buildSiteAdminBlock(cfg.siteSettings, cfg.siteSettingsUrl, cfg.restNonce)
      );
    }
    root.appendChild(stack);
    body.appendChild(root);
    root.addEventListener("wpdm-messages-settings-change", async (ev) => {
      const detail = ev.detail;
      const next = { ...current, ...detail };
      current = next;
      setSettings(next);
      try {
        const saved = await saveSettings(detail);
        current = saved;
        setSettings(saved);
      } catch (_err) {
      }
    });
  }
  function emitChange(host, detail) {
    host.dispatchEvent(
      new CustomEvent("wpdm-messages-settings-change", {
        detail,
        bubbles: true
      })
    );
  }
  function buildSoundField(sounds, current) {
    const select = document.createElement("wpd-select");
    select.setAttribute("label", __("Nudge sound"));
    select.setAttribute("value", current.nudgeSoundId || "");
    const optDefault = document.createElement("wpd-option");
    optDefault.setAttribute("value", "");
    optDefault.textContent = __("Default");
    select.appendChild(optDefault);
    for (const s of sounds) {
      const opt = document.createElement("wpd-option");
      opt.setAttribute("value", s.id);
      opt.textContent = s.label;
      select.appendChild(opt);
    }
    const optSilent = document.createElement("wpd-option");
    optSilent.setAttribute("value", "silent");
    optSilent.textContent = __("(silent)");
    select.appendChild(optSilent);
    select.addEventListener("wpd-pick", (ev) => {
      const value = ev.detail?.value ?? "";
      emitChange(select, { nudgeSoundId: value });
    });
    return select;
  }
  function buildVolumeField(current) {
    const range = document.createElement("wpd-range-field");
    range.setAttribute("label", __("Volume"));
    range.setAttribute("min", "0");
    range.setAttribute("max", "100");
    range.setAttribute("step", "5");
    range.setAttribute("value", String(Math.round(current.volume * 100)));
    range.setAttribute("suffix", "%");
    range.addEventListener("wpd-range-change", (ev) => {
      const v = ev.detail?.value ?? 0;
      emitChange(range, { volume: Math.max(0, Math.min(1, v / 100)) });
    });
    return range;
  }
  function buildShowToastField(current) {
    const cb = document.createElement("wpd-checkbox-label");
    cb.setAttribute("label", __("Show toast on incoming message"));
    if (current.showToast) {
      cb.setAttribute("checked", "");
    }
    cb.addEventListener("wpd-checkbox-change", (ev) => {
      const checked = !!ev.detail?.checked;
      emitChange(cb, { showToast: checked });
    });
    return cb;
  }
  function buildSoundFocusedField(current) {
    const cb = document.createElement("wpd-checkbox-label");
    cb.setAttribute("label", __("Play sound even when chat window is focused"));
    if (current.soundWhileFocused) {
      cb.setAttribute("checked", "");
    }
    cb.addEventListener("wpd-checkbox-change", (ev) => {
      const checked = !!ev.detail?.checked;
      emitChange(cb, { soundWhileFocused: checked });
    });
    return cb;
  }
  function buildInactiveField(current) {
    const wrap = document.createElement("div");
    const number = document.createElement("wpd-number-field");
    number.setAttribute("label", __("Mark me inactive after (minutes)"));
    number.setAttribute("min", "1");
    number.setAttribute("max", "60");
    number.setAttribute("step", "1");
    number.setAttribute("suffix", __("min"));
    number.setAttribute(
      "value",
      String(Math.round(current.inactiveAfterSeconds / 60))
    );
    number.addEventListener("wpd-input-commit", (ev) => {
      const v = ev.detail?.value ?? 5;
      emitChange(wrap, {
        inactiveAfterSeconds: Math.max(60, Math.min(3600, v * 60))
      });
    });
    wrap.appendChild(number);
    return wrap;
  }
  function buildSiteAdminBlock(initial, url, nonce) {
    const wrap = document.createElement("wpd-section");
    wrap.setAttribute(
      "heading",
      __("Site-level (administrators only)")
    );
    wrap.setAttribute(
      "description",
      __(
        "These toggles affect every user on the site. Only administrators can change them."
      )
    );
    let saving = false;
    let error = "";
    let state2 = { ...initial };
    const cb = document.createElement("wpd-checkbox-label");
    cb.setAttribute("label", __("Enable real-time chat updates (SSE)"));
    if (state2.realtime_sse_enabled) {
      cb.setAttribute("checked", "");
    }
    const hint = document.createElement("p");
    hint.className = "wp-desktop-ext__hint";
    hint.textContent = __(
      "Off by default. With this off, the Messages window polls the server every few seconds for new messages — the safe default that works on every host. Turn it on only on capable hosting: real-time delivery uses Server-Sent Events, which holds a long-lived PHP-FPM worker per logged-in admin tab and can exhaust workers on shared / cheap hosting."
    );
    const status = document.createElement("p");
    status.className = "wp-desktop-ext__saving";
    status.style.minHeight = "1em";
    const repaintStatus = () => {
      if (error) {
        status.className = "wp-desktop-ext__error";
        status.textContent = error;
      } else if (saving) {
        status.className = "wp-desktop-ext__saving";
        status.textContent = __("Saving…");
      } else {
        status.textContent = "";
      }
    };
    const save = async (next) => {
      saving = true;
      error = "";
      repaintStatus();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WP-Nonce": nonce
          },
          body: JSON.stringify({ options: next })
        });
        if (!res.ok) {
          const body2 = await res.json().catch(() => ({}));
          error = body2.message ?? `Error ${res.status}`;
        } else {
          const saved = await res.json().catch(() => null);
          if (saved && typeof saved === "object") {
            state2 = saved;
          }
        }
      } catch {
        error = __("Network error — check your connection.");
      } finally {
        saving = false;
        repaintStatus();
      }
    };
    cb.addEventListener("wpd-checkbox-change", (ev) => {
      const checked = !!ev.detail?.checked;
      state2 = { ...state2, realtime_sse_enabled: checked };
      void save(state2);
    });
    wrap.appendChild(cb);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    return wrap;
  }
  function buildAcceptFromField(current) {
    const wrap = document.createElement("div");
    wrap.className = "wpdm-messages-settings__accept-row";
    const label = document.createElement("label");
    label.className = "wpd-text-field__label";
    label.textContent = __("Accept messages from");
    const seg = document.createElement("wpd-segmented");
    seg.setAttribute("value", current.acceptFrom);
    const everyone = document.createElement("wpd-segment");
    everyone.setAttribute("value", "everyone");
    everyone.textContent = __("Everyone");
    const adminsOnly = document.createElement("wpd-segment");
    adminsOnly.setAttribute("value", "admins-only");
    adminsOnly.textContent = __("Admins only");
    seg.appendChild(everyone);
    seg.appendChild(adminsOnly);
    seg.addEventListener("wpd-pick", (ev) => {
      const value = ev.detail?.value ?? "everyone";
      emitChange(wrap, {
        acceptFrom: value === "admins-only" ? "admins-only" : "everyone"
      });
    });
    wrap.appendChild(label);
    wrap.appendChild(seg);
    return wrap;
  }
  class SoundRegistry {
    constructor() {
      this.cache = /* @__PURE__ */ new Map();
      this.muted = false;
      this.primed = false;
    }
    register(s) {
      if (this.cache.has(s.id)) {
        return;
      }
      try {
        const el = new Audio(s.url);
        el.preload = "auto";
        el.volume = clamp01(s.volume ?? 1);
        this.cache.set(s.id, el);
      } catch (_err) {
      }
    }
    registerAll(list) {
      for (const s of list) {
        this.register(s);
      }
    }
    play(id, volumeOverride) {
      if (!id || this.muted) {
        return;
      }
      const el = this.cache.get(id);
      if (!el) {
        return;
      }
      try {
        el.currentTime = 0;
        if (typeof volumeOverride === "number") {
          el.volume = clamp01(volumeOverride);
        }
        const result = el.play();
        if (result && typeof result.catch === "function") {
          result.catch(() => void 0);
        }
      } catch (_err) {
      }
    }
    setMuted(muted) {
      this.muted = muted;
    }
    primeOnce() {
      if (this.primed) {
        return;
      }
      this.primed = true;
      for (const el of this.cache.values()) {
        try {
          const result = el.play();
          if (result && typeof result.catch === "function") {
            result.catch(() => void 0);
          }
          el.pause();
          el.currentTime = 0;
        } catch (_err) {
        }
      }
    }
    /** Used in tests. */
    _size() {
      return this.cache.size;
    }
  }
  function clamp01(v) {
    if (!Number.isFinite(v)) {
      return 1;
    }
    return Math.max(0, Math.min(1, v));
  }
  const soundRegistry = new SoundRegistry();
  function installAutoplayPrimer() {
    const handler = () => {
      soundRegistry.primeOnce();
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("keydown", handler, true);
    };
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("keydown", handler, true);
  }
  const HEARTBEAT_FIELD_ACTIVE = "wpdm_messages_active";
  const HEARTBEAT_FIELD_USER_ACTIVE = "wpdm_messages_user_active";
  const HEARTBEAT_FIELD_SEEN_ID = "wpdm_messages_seen_id";
  function startHeartbeatProbe(handlers) {
    heartbeat.contribute(
      HEARTBEAT_FIELD_ACTIVE,
      () => handlers.getActiveFlag() ? true : void 0
    );
    heartbeat.contribute(
      HEARTBEAT_FIELD_USER_ACTIVE,
      () => handlers.getActiveFlag() ? handlers.getUserActiveFlag() : void 0
    );
    heartbeat.contribute(
      HEARTBEAT_FIELD_SEEN_ID,
      () => handlers.getActiveFlag() ? handlers.getLastSeenId() : void 0
    );
    heartbeat.subscribe("wpdm_messages", (block) => {
      if (!block) {
        return;
      }
      if (typeof block.totalUnread === "number" && block.unreadByConversation && typeof block.unreadByConversation === "object") {
        handlers.onUnread?.(
          block.totalUnread,
          block.unreadByConversation
        );
      }
      if (Array.isArray(block.newSinceLastSeen) && block.newSinceLastSeen.length > 0) {
        handlers.onMessages?.(block.newSinceLastSeen);
      }
      if (block.presence && typeof block.presence === "object") {
        const batch = [];
        for (const [k, v] of Object.entries(block.presence)) {
          if (v && typeof v === "object" && "status" in v) {
            batch.push({ userId: Number(k), status: v.status });
          }
        }
        handlers.onPresence?.(batch);
      }
    });
  }
  function computeUserActive(lastInputMs, settings) {
    const threshold = settings.inactiveAfterSeconds * 1e3;
    return Date.now() - lastInputMs < threshold;
  }
  const CHANNEL_NAME = "wpdm-messages-coord";
  const HEARTBEAT_MS = 1500;
  const ELECTION_TIMEOUT_MS = 800;
  const STALE_LEADER_MS = 3e3;
  class MessagesLeader {
    constructor(handlers = {}) {
      this.chan = null;
      this.epoch = 0;
      this.isLeader = false;
      this.currentLeaderId = null;
      this.currentLeaderLastSeen = 0;
      this.heartbeatTimer = null;
      this.staleCheckTimer = null;
      this.claimTimer = null;
      this.started = false;
      this.onBeforeUnload = () => {
        if (this.isLeader && this.chan) {
          this.broadcast("resign");
        }
      };
      this.onMessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.tabId === this.tabId) {
          return;
        }
        if (msg.type === "claim") {
          const challengerWins = msg.epoch > this.epoch || msg.epoch === this.epoch && msg.tabId > this.tabId;
          if (challengerWins && this.isLeader) {
            this.demote();
          }
          if (challengerWins) {
            this.currentLeaderId = msg.tabId;
            this.currentLeaderLastSeen = msg.timestamp;
            this.epoch = Math.max(this.epoch, msg.epoch);
            if (this.claimTimer !== null) {
              window.clearTimeout(this.claimTimer);
              this.claimTimer = null;
            }
          }
          return;
        }
        if (msg.type === "heartbeat") {
          this.currentLeaderId = msg.tabId;
          this.currentLeaderLastSeen = msg.timestamp;
          this.epoch = Math.max(this.epoch, msg.epoch);
          if (this.claimTimer !== null) {
            window.clearTimeout(this.claimTimer);
            this.claimTimer = null;
          }
          return;
        }
        if (msg.type === "event") {
          this.handlers.onEvent?.(msg.payload);
          return;
        }
        if (msg.type === "resign" && msg.tabId === this.currentLeaderId) {
          this.currentLeaderId = null;
          if (this.claimTimer !== null) {
            window.clearTimeout(this.claimTimer);
          }
          this.claimTimer = window.setTimeout(
            () => this.claim(),
            ELECTION_TIMEOUT_MS
          );
          return;
        }
        if (msg.type === "who-leader" && this.isLeader) {
          this.broadcast("heartbeat");
        }
      };
      this.handlers = handlers;
      this.tabId = generateTabId();
    }
    start() {
      if (this.started) {
        return;
      }
      this.started = true;
      try {
        this.chan = new BroadcastChannel(CHANNEL_NAME);
      } catch (_err) {
        this.becomeLeader();
        return;
      }
      this.chan.addEventListener("message", this.onMessage);
      this.broadcast("who-leader");
      this.claimTimer = window.setTimeout(() => this.claim(), ELECTION_TIMEOUT_MS);
      this.staleCheckTimer = window.setInterval(
        () => this.detectStaleLeader(),
        HEARTBEAT_MS
      );
      window.addEventListener("beforeunload", this.onBeforeUnload);
    }
    stop() {
      this.started = false;
      if (this.isLeader) {
        this.broadcast("resign");
        this.isLeader = false;
      }
      if (this.chan) {
        this.chan.removeEventListener("message", this.onMessage);
        this.chan.close();
        this.chan = null;
      }
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.staleCheckTimer !== null) {
        window.clearInterval(this.staleCheckTimer);
        this.staleCheckTimer = null;
      }
      if (this.claimTimer !== null) {
        window.clearTimeout(this.claimTimer);
        this.claimTimer = null;
      }
      window.removeEventListener("beforeunload", this.onBeforeUnload);
    }
    getLeaderState() {
      return { isLeader: this.isLeader, tabId: this.tabId };
    }
    /** Leader publishes an event to every other tab. No-op when not leader. */
    publishEvent(payload) {
      if (!this.isLeader) {
        return;
      }
      this.broadcast("event", payload);
    }
    claim() {
      const jitter = 10 + Math.random() * 140;
      this.claimTimer = window.setTimeout(() => {
        if (this.currentLeaderId && this.currentLeaderId !== this.tabId) {
          return;
        }
        this.epoch += 1;
        this.broadcast("claim");
        this.becomeLeader();
      }, jitter);
    }
    becomeLeader() {
      if (this.isLeader) {
        return;
      }
      this.isLeader = true;
      this.currentLeaderId = this.tabId;
      this.heartbeatTimer = window.setInterval(
        () => this.broadcast("heartbeat"),
        HEARTBEAT_MS
      );
      this.handlers.onBecameLeader?.();
    }
    demote() {
      if (!this.isLeader) {
        return;
      }
      this.isLeader = false;
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.handlers.onLostLeadership?.();
    }
    detectStaleLeader() {
      if (this.isLeader) {
        return;
      }
      if (!this.currentLeaderId) {
        return;
      }
      if (Date.now() - this.currentLeaderLastSeen > STALE_LEADER_MS) {
        this.currentLeaderId = null;
        this.claim();
      }
    }
    broadcast(type, payload) {
      if (!this.chan) {
        return;
      }
      const msg = {
        type,
        tabId: this.tabId,
        epoch: this.epoch,
        timestamp: Date.now(),
        payload
      };
      try {
        this.chan.postMessage(msg);
      } catch (_err) {
      }
    }
  }
  function generateTabId() {
    const cryptoApi = window.crypto;
    if (cryptoApi?.randomUUID) {
      return cryptoApi.randomUUID();
    }
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  class MessagesPoller {
    constructor(opts, handlers = {}) {
      this.timer = null;
      this.inFlight = false;
      this.stopped = true;
      this.currentDelay = 0;
      this.opts = opts;
      this.handlers = handlers;
    }
    start() {
      if (!this.stopped) {
        return;
      }
      this.stopped = false;
      this.scheduleNext(this.delayForState(this.opts.getState()));
    }
    stop() {
      this.stopped = true;
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
    }
    /**
     * Force an immediate poll (e.g., on visibility-change → visible
     * to refresh quickly without waiting for the next tick).
     */
    pokeNow() {
      if (this.stopped || this.inFlight) {
        return;
      }
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
      void this.tick();
    }
    /**
     * Cadence changed (state transition). Re-schedule the next tick.
     */
    rescheduleForState() {
      if (this.stopped) {
        return;
      }
      const next = this.delayForState(this.opts.getState());
      if (next !== this.currentDelay) {
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
          this.timer = null;
        }
        this.scheduleNext(next);
      }
    }
    delayForState(state2) {
      switch (state2) {
        case "active":
          return Math.max(1e3, this.opts.activeMs);
        case "idle":
          return Math.max(3e3, this.opts.idleMs);
        case "hidden":
          return Math.max(5e3, this.opts.hiddenMs);
      }
    }
    scheduleNext(delay) {
      this.currentDelay = delay;
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.tick();
      }, delay);
    }
    async tick() {
      if (this.stopped || this.inFlight) {
        return;
      }
      this.inFlight = true;
      try {
        const out = await fetchSince(this.opts.getCursor());
        let maxId = this.opts.getCursor();
        for (const row of out.messages) {
          if (row.id <= maxId) {
            continue;
          }
          maxId = row.id;
          if (row.kind === "nudge") {
            this.handlers.onNudge?.(row);
          } else {
            this.handlers.onMessage?.(row);
          }
        }
        if (out.cursor > maxId) {
          maxId = out.cursor;
        }
        if (maxId > this.opts.getCursor()) {
          this.opts.setCursor(maxId);
        }
      } catch (_err) {
      } finally {
        this.inFlight = false;
        if (!this.stopped) {
          this.scheduleNext(this.delayForState(this.opts.getState()));
        }
      }
    }
  }
  class MessagesSseClient {
    constructor(handlers = {}) {
      this.es = null;
      this.lastEventId = 0;
      this.reconnectMs = 1e3;
      this.url = "";
      this.nonce = "";
      this.reconnectTimer = null;
      this.stopped = true;
      this.handlers = handlers;
    }
    configure(opts) {
      this.url = opts.url;
      this.nonce = opts.nonce;
      this.reconnectMs = Math.max(250, opts.reconnectMs || 1e3);
    }
    start() {
      this.stopped = false;
      this.openConnection();
    }
    stop() {
      this.stopped = true;
      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.closeConnection();
    }
    openConnection() {
      if (!this.url || !this.nonce) {
        return;
      }
      const supplied = this.handlers.initialLastEventId?.();
      if (typeof supplied === "number" && supplied > this.lastEventId) {
        this.lastEventId = supplied;
      }
      this.handlers.onState?.("connecting");
      const url = new URL(this.url, window.location.origin);
      url.searchParams.set("nonce", this.nonce);
      if (this.lastEventId > 0) {
        url.searchParams.set("last_event_id", String(this.lastEventId));
      }
      try {
        this.es = new EventSource(url.toString());
      } catch (err) {
        this.handlers.onError?.(err);
        this.scheduleReconnect();
        return;
      }
      this.es.addEventListener("open", () => {
        this.handlers.onState?.("open");
      });
      this.es.addEventListener("message", (ev) => this.dispatch("message", ev));
      this.es.addEventListener("nudge", (ev) => this.dispatch("nudge", ev));
      this.es.addEventListener("typing", (ev) => this.dispatch("typing", ev));
      this.es.addEventListener("presence", (ev) => this.dispatch("presence", ev));
      this.es.addEventListener("open", () => this.dispatch("open", void 0));
      this.es.addEventListener("close", () => this.dispatch("close", void 0));
      this.es.addEventListener("error", (err) => {
        this.handlers.onError?.(err);
        this.handlers.onState?.("closed");
        this.closeConnection();
        void this.catchUp();
        this.scheduleReconnect();
      });
    }
    closeConnection() {
      if (this.es) {
        try {
          this.es.close();
        } catch (_err) {
        }
        this.es = null;
      }
    }
    scheduleReconnect() {
      if (this.stopped) {
        return;
      }
      if (this.reconnectTimer !== null) {
        return;
      }
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.stopped) {
          this.openConnection();
        }
      }, this.reconnectMs);
    }
    async catchUp() {
      try {
        const out = await fetchSince(this.lastEventId);
        for (const row of out.messages) {
          if (row.id <= this.lastEventId) {
            continue;
          }
          this.lastEventId = row.id;
          if (row.kind === "nudge") {
            this.handlers.onNudge?.(row);
          } else {
            this.handlers.onMessage?.(row);
          }
        }
        if (out.cursor > this.lastEventId) {
          this.lastEventId = out.cursor;
        }
      } catch (err) {
        this.handlers.onError?.(err);
      }
    }
    dispatch(kind, ev) {
      if (!ev) {
        return;
      }
      let data = null;
      try {
        data = ev.data ? JSON.parse(ev.data) : null;
      } catch (_err) {
        return;
      }
      if (ev.lastEventId) {
        const id = Number(ev.lastEventId);
        if (Number.isFinite(id) && id > this.lastEventId) {
          this.lastEventId = id;
        }
      }
      switch (kind) {
        case "message":
          this.handlers.onMessage?.(data);
          break;
        case "nudge":
          this.handlers.onNudge?.(data);
          break;
        case "typing":
          this.handlers.onTyping?.(data);
          break;
        case "presence":
          this.handlers.onPresence?.(data);
          break;
      }
    }
  }
  const store = createSharedStore(
    "wpdm-messages/self-sent",
    () => ({ ids: /* @__PURE__ */ new Set() })
  );
  const TTL_MS = 6e4;
  function markMessageAsSelfSent(id) {
    store.state.ids.add(id);
    window.setTimeout(() => {
      store.state.ids.delete(id);
    }, TTL_MS);
  }
  function isSelfSent(id) {
    return store.state.ids.has(id);
  }
  const CONFIG = () => window.wpDesktopMessagesConfig;
  let lastSeenId = 0;
  let lastUserInputMs = Date.now();
  function noteUserActivity() {
    lastUserInputMs = Date.now();
  }
  function isMessagesWindowVisible() {
    const wp = window.wp;
    const win = wp?.desktop?.windowManager?.getById?.("wpdm-messages");
    if (win) {
      return win.state !== "minimized";
    }
    return getState().windowMounted;
  }
  function bootShell() {
    if (window.__wpdmMessagesShellBooted) {
      return;
    }
    window.__wpdmMessagesShellBooted = true;
    const cfg = CONFIG();
    if (!cfg) {
      return;
    }
    try {
      bootShellInternal(cfg);
    } catch (err) {
      console.error("[wpdm-messages] shell boot failed:", err);
    }
  }
  function bootShellInternal(cfg) {
    soundRegistry.registerAll(cfg.sounds);
    setSounds(cfg.sounds, cfg.defaultSoundId);
    setSettings(cfg.userSettings);
    installAutoplayPrimer();
    document.addEventListener("pointerdown", noteUserActivity, { capture: true, passive: true });
    document.addEventListener("keydown", noteUserActivity, { capture: true, passive: true });
    const poller = new MessagesPoller(
      {
        activeMs: cfg.pollIntervalActiveMs,
        idleMs: cfg.pollIntervalIdleMs,
        hiddenMs: cfg.pollIntervalHiddenMs,
        getCursor: () => lastSeenId,
        setCursor: (id) => {
          if (id > lastSeenId) {
            lastSeenId = id;
          }
        },
        getState: () => computePollerState()
      },
      {
        onMessage: (row) => handleIncomingMessage(row),
        onNudge: (row) => handleIncomingNudge(row)
      }
    );
    const sse = new MessagesSseClient({
      onMessage: (row) => handleIncomingMessage(row),
      onNudge: (row) => handleIncomingNudge(row),
      onTyping: (payload) => handleTyping(payload),
      onPresence: (payload) => handlePresence(payload),
      onError: () => {
      },
      onState: (state2) => {
        document.dispatchEvent(
          new CustomEvent("wp-desktop-messages-sse-state", {
            detail: { state: state2, isLeader: leader.getLeaderState().isLeader }
          })
        );
      },
      // The SSE's per-instance lastEventId is initialised to 0; on
      // first connect it would otherwise ship `last_event_id=0` and
      // the server would replay every message in the user's inbox
      // (one toast per row). Read the SHELL's cursor lazily so the
      // connect URL reflects whatever bootstrap / poller / heartbeat
      // has already advanced.
      initialLastEventId: () => lastSeenId
    });
    sse.configure({
      url: cfg.streamUrl,
      nonce: cfg.restNonce,
      reconnectMs: cfg.sseReconnectMs
    });
    const leader = new MessagesLeader({
      onBecameLeader: () => {
        document.dispatchEvent(
          new CustomEvent("wp-desktop-messages-leader-changed", {
            detail: { tabId: leader.getLeaderState().tabId, isLeader: true }
          })
        );
        if (cfg.realtimeSseEnabled) {
          sse.start();
        }
      },
      onLostLeadership: () => {
        document.dispatchEvent(
          new CustomEvent("wp-desktop-messages-leader-changed", {
            detail: { tabId: leader.getLeaderState().tabId, isLeader: false }
          })
        );
        sse.stop();
      },
      onEvent: (payload) => {
        applyChannelEvent(payload);
      }
    });
    window.__wpdmMessagesPoller = poller;
    subscribe(() => {
      poller.rescheduleForState();
    });
    startHeartbeatProbe({
      getActiveFlag: () => true,
      getUserActiveFlag: () => computeUserActive(lastUserInputMs, getState().settings),
      getLastSeenId: () => lastSeenId,
      onMessages: () => {
      },
      onPresence: (batch) => applyPresenceBatch(
        batch.map((entry) => ({
          userId: entry.userId,
          status: entry.status
        }))
      ),
      onUnread: (total, byConv) => {
        setUnread(total, byConv);
      }
    });
    startMessagesBadgePolicy();
    function computePollerState() {
      if (document.hidden) {
        return "hidden";
      }
      const s = getState();
      if (s.windowMounted && s.windowFocused) {
        return "active";
      }
      return "idle";
    }
    registerMessagesSettingsTab();
    void bootstrapHistorySilently().catch(() => void 0).then(() => {
      poller.start();
      if (cfg.realtimeSseEnabled) {
        leader.start();
      }
    }).then(() => hydrateInitial());
    exposePublicApi();
    document.dispatchEvent(
      new CustomEvent("wp-desktop-messages-ready", {
        detail: { user: cfg.currentUserId, allowedRoles: cfg.allowedRoles }
      })
    );
  }
  async function hydrateInitial() {
    try {
      const out = await listConversations();
      for (const c of out.conversations) {
        upsertConversation(c);
      }
    } catch (_err) {
    }
    try {
      const sounds = await fetchSounds();
      soundRegistry.registerAll(sounds.sounds);
      setSounds(sounds.sounds, sounds.defaultSoundId);
    } catch (_err) {
    }
  }
  async function bootstrapHistorySilently() {
    try {
      const out = await fetchSince(0);
      for (const row of out.messages) {
        appendMessage(row);
        if (row.id > lastSeenId) {
          lastSeenId = row.id;
        }
      }
      if (typeof out.cursor === "number" && out.cursor > lastSeenId) {
        lastSeenId = out.cursor;
      }
    } catch (_err) {
    }
  }
  function handleIncomingMessage(row) {
    if (row.id <= lastSeenId) {
      return;
    }
    lastSeenId = Math.max(lastSeenId, row.id);
    appendMessage(row);
    if (!getState().conversations.some((c) => c.id === row.conversationId)) {
      void hydrateInitial();
    }
    const state2 = getState();
    const cfg = CONFIG();
    const isOwn = !!cfg && Number(row.authorId) === Number(cfg.currentUserId) || isSelfSent(row.id);
    document.dispatchEvent(
      new CustomEvent("wp-desktop-messages-message-incoming", {
        detail: {
          message: row,
          conversationId: row.conversationId,
          isWindowFocused: state2.windowFocused
        }
      })
    );
    if (isOwn) {
      document.dispatchEvent(
        new CustomEvent("wp-desktop-messages-message-sent", {
          detail: { message: row, conversationId: row.conversationId }
        })
      );
      return;
    }
    const focusedHere = state2.focusedConversationId === row.conversationId && state2.windowFocused;
    if (!focusedHere) {
      bumpUnread(row.conversationId);
    }
    if (focusedHere) {
      return;
    }
    const conv = state2.conversations.find((c) => c.id === row.conversationId);
    const senderName = conv?.otherUser?.displayName ?? __("New message");
    if (!isMessagesWindowVisible() && state2.settings.showToast) {
      toast(senderName, row);
    }
    const shouldPlay = state2.settings.soundWhileFocused || !state2.windowFocused;
    if (shouldPlay) {
      const id = state2.settings.nudgeSoundId || state2.defaultSoundId;
      soundRegistry.play(id, state2.settings.volume);
    }
    requestMessagesAttention("pulse", 4e3);
  }
  function handleIncomingNudge(row) {
    if (row.id <= lastSeenId) {
      return;
    }
    lastSeenId = Math.max(lastSeenId, row.id);
    appendMessage(row);
    if (!getState().conversations.some((c) => c.id === row.conversationId)) {
      void hydrateInitial();
    }
    const cfg = CONFIG();
    const isOwnByAuthor = !!cfg && Number(row.authorId) === Number(cfg.currentUserId);
    const isOwnBySent = isSelfSent(row.id);
    if (isOwnByAuthor || isOwnBySent) {
      return;
    }
    const state2 = getState();
    const focusedHereForNudge = state2.focusedConversationId === row.conversationId && state2.windowFocused;
    if (!focusedHereForNudge) {
      bumpUnread(row.conversationId);
    }
    const soundId = row.payload && typeof row.payload.soundId === "string" && row.payload.soundId || state2.settings.nudgeSoundId || state2.defaultSoundId;
    soundRegistry.play(soundId, state2.settings.volume);
    requestMessagesAttention("shake", 1500);
    setFocusedConversation(row.conversationId);
    openAndShakeMessagesWindow();
    document.dispatchEvent(
      new CustomEvent("wp-desktop-messages-nudge-received", {
        detail: {
          conversationId: row.conversationId,
          fromUserId: row.authorId,
          soundId
        }
      })
    );
  }
  function handleTyping(payload) {
    for (const [conversationId, entries] of Object.entries(payload)) {
      setTyping(Number(conversationId), entries);
    }
    window.setTimeout(() => {
      const state2 = getState();
      const now = Date.now();
      for (const [id, entries] of state2.typingByConversation) {
        const live = entries.filter((e) => e.untilMs > now);
        if (live.length !== entries.length) {
          setTyping(id, live);
        }
      }
    }, 4e3);
  }
  function handlePresence(payload) {
    const batch = [];
    for (const [k, v] of Object.entries(payload)) {
      batch.push({
        userId: Number(k),
        status: v.status,
        lastSeenMs: typeof v.lastSeenMs === "number" ? v.lastSeenMs : void 0
      });
    }
    applyPresenceBatch(batch);
  }
  function applyChannelEvent(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const ev = payload;
    switch (ev.kind) {
      case "message":
        if (ev.row) {
          handleIncomingMessage(ev.row);
        }
        break;
      case "nudge":
        if (ev.row) {
          handleIncomingNudge(ev.row);
        }
        break;
      case "typing":
        handleTyping(ev.data);
        break;
      case "presence":
        handlePresence(ev.data);
        break;
    }
  }
  const outstandingToasts = /* @__PURE__ */ new Set();
  function toast(title, row) {
    const cfg = CONFIG();
    const message = row.kind === "nudge" ? `${title} 👋` : `${title}: ${stripTags(row.content)}`;
    const wp = window.wp;
    const payload = {
      message,
      duration: 5e3,
      action: cfg ? {
        label: __("Open"),
        onClick: () => {
          api().openWindow({ conversationId: row.conversationId });
        }
      } : void 0
    };
    const dismiss = showToast(payload);
    outstandingToasts.add(dismiss);
    window.setTimeout(() => outstandingToasts.delete(dismiss), 6e3);
    wp?.hooks?.doAction?.("wp-desktop.messages.toast", payload);
  }
  function dismissOutstandingToasts() {
    for (const dismiss of outstandingToasts) {
      try {
        dismiss();
      } catch (_err) {
      }
    }
    outstandingToasts.clear();
  }
  function stripTags(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || div.innerText || "").slice(0, 140);
  }
  let cachedApi = null;
  function api() {
    if (cachedApi) {
      return cachedApi;
    }
    cachedApi = {
      openWindow: (opts) => {
        if (opts && typeof opts.conversationId === "number") {
          setFocusedConversation(opts.conversationId);
        }
        const wp = window.wp;
        wp?.desktop?.openWindow?.("wpdm-messages");
        document.dispatchEvent(
          new CustomEvent("wp-desktop-messages-window-opened", {
            detail: opts ?? {}
          })
        );
      },
      closeWindow: () => {
        const wp = window.wp;
        const w = wp?.desktop?.windowManager?.getById?.("wpdm-messages");
        w?.close?.();
      },
      startConversationWith: async (userId) => {
        const out = await startConversation(userId);
        upsertConversation(out.conversation);
        return out.conversation;
      },
      send: async (conversationId, content, opts) => {
        const out = await sendMessage(conversationId, content, opts);
        if (out.message) {
          markMessageAsSelfSent(out.message.id);
          appendMessage(out.message);
          return out.message;
        }
        throw new Error("[wpdm-messages] Send returned no message");
      },
      markRead: async (conversationId, lastReadId) => {
        const state2 = getState();
        const id = lastReadId ?? (state2.messagesByConversation.get(conversationId) ?? []).map((r) => r.id).reduce((a, b) => Math.max(a, b), 0);
        if (id > 0) {
          await markRead(conversationId, id);
        }
      },
      nudge: async (conversationId, soundId) => {
        const out = await postNudge(conversationId, soundId);
        if (out.message) {
          markMessageAsSelfSent(out.message.id);
          appendMessage(out.message);
        }
      },
      listConversations: async () => {
        const out = await listConversations();
        for (const c of out.conversations) {
          upsertConversation(c);
        }
        return out.conversations;
      },
      fetchMessages: async (conversationId, opts) => {
        const out = await fetchMessages(conversationId, opts);
        return out.messages;
      },
      getPresence: (userId) => {
        const fwk = window.wp?.desktop?.presence;
        return fwk ? fwk.getStatus(userId) : "offline";
      },
      getUnreadCount: (conversationId) => {
        const state2 = getState();
        if (typeof conversationId === "number") {
          return state2.unreadByConversation.get(conversationId) ?? 0;
        }
        return state2.totalUnread;
      },
      subscribe: (event, cb) => {
        const handler = (e) => {
          const detail = e.detail;
          cb(detail);
        };
        document.addEventListener(event, handler);
        return () => document.removeEventListener(event, handler);
      }
    };
    return cachedApi;
  }
  function exposePublicApi() {
    const wp = window.wp;
    if (!wp || !wp.desktop) {
      const readyFn = window.wp?.desktop?.ready;
      if (typeof readyFn === "function") {
        readyFn(() => exposePublicApi());
      } else {
        window.setTimeout(exposePublicApi, 50);
      }
      return;
    }
    if (typeof wp.desktop.registerNamespace === "function") {
      wp.desktop.registerNamespace("messages", api());
    } else {
      wp.desktop.messages = api();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void postPresence(true).catch(() => void 0);
    } else {
      noteUserActivity();
      void postPresence(false).catch(() => void 0);
      const w = window.__wpdmMessagesPoller;
      w?.rescheduleForState?.();
      w?.pokeNow?.();
    }
  });
  let lastWindowMounted = false;
  subscribe((state2) => {
    const ids = [];
    for (const rows of state2.messagesByConversation.values()) {
      for (const r of rows) {
        ids.push(r.id);
      }
    }
    const max = ids.reduce((a, b) => Math.max(a, b), 0);
    if (max > lastSeenId) {
      lastSeenId = max;
    }
    if (!lastWindowMounted && state2.windowMounted) {
      dismissOutstandingToasts();
    }
    lastWindowMounted = state2.windowMounted;
  });
  const tryBoot = () => {
    bootShell();
  };
  const ready = window.wp?.desktop?.ready;
  if (typeof ready === "function") {
    ready(tryBoot);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryBoot, { once: true });
  } else {
    queueMicrotask(tryBoot);
  }
})();
