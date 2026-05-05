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
      const ready = window.wp?.desktop?.ready;
      if (typeof ready === "function") {
        ready(() => cb(desktopReady()));
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
    const w2 = window;
    let slot = w2[SHARED_STORES_SLOT];
    if (!slot) {
      slot = /* @__PURE__ */ new Map();
      w2[SHARED_STORES_SLOT] = slot;
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
  function getStatus(userId) {
    return desktopMaybe()?.presence.getStatus(userId) ?? "offline";
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
  const renderKeyedList = (...args) => desktopReady().renderKeyedList(...args);
  const clearKeyedList = (host) => desktopReady().clearKeyedList(host);
  new Proxy(
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
  const store$1 = createSharedStore(
    "wpdm-messages/self-sent",
    () => ({ ids: /* @__PURE__ */ new Set() })
  );
  const TTL_MS = 6e4;
  function markMessageAsSelfSent(id) {
    store$1.state.ids.add(id);
    window.setTimeout(() => {
      store$1.state.ids.delete(id);
    }, TTL_MS);
  }
  const DEFAULT_SETTINGS = {
    nudgeSoundId: "",
    volume: 0.7,
    showToast: true,
    soundWhileFocused: false,
    inactiveAfterSeconds: 300,
    acceptFrom: "everyone"
  };
  const store = createSharedStore("wpdm-messages/state", () => ({
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
  const state = store.state;
  function notify() {
    store.notify();
  }
  subscribePresence(() => {
    store.notify();
  });
  function getState() {
    return store.getState();
  }
  function subscribe(cb) {
    return store.subscribe(cb);
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
  function setMessagesForConversation(conversationId, rows) {
    const existing = state.messagesByConversation.get(conversationId) ?? [];
    if (existing.length === 0) {
      state.messagesByConversation.set(conversationId, rows.slice());
      notify();
      return;
    }
    const byId = /* @__PURE__ */ new Map();
    for (const r of rows) {
      byId.set(r.id, r);
    }
    for (const r of existing) {
      if (!byId.has(r.id)) {
        byId.set(r.id, r);
      }
    }
    const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id);
    state.messagesByConversation.set(conversationId, merged);
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
  function clearUnreadForConversation(conversationId) {
    const current = state.unreadByConversation.get(conversationId) ?? 0;
    if (current === 0) {
      return;
    }
    state.unreadByConversation.set(conversationId, 0);
    state.totalUnread = Math.max(0, state.totalUnread - current);
    notify();
  }
  function setWindowMounted(mounted) {
    state.windowMounted = mounted;
    notify();
  }
  function setWindowFocused(focused) {
    state.windowFocused = focused;
    notify();
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
  async function listUsers(opts = {}) {
    const params = new URLSearchParams();
    if (opts.search) {
      params.set("search", opts.search);
    }
    if (opts.page) {
      params.set("page", String(opts.page));
    }
    if (opts.perPage) {
      params.set("per_page", String(opts.perPage));
    }
    const qs = params.toString() ? `?${params}` : "";
    return request(`/users${qs}`);
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
  async function postTyping(conversationId) {
    return request(`/conversations/${conversationId}/typing`, {
      method: "POST",
      body: "{}"
    });
  }
  async function postNudge(conversationId, soundId) {
    return request(`/conversations/${conversationId}/nudge`, {
      method: "POST",
      body: JSON.stringify({ soundId: "" })
    });
  }
  const TYPING_THROTTLE_MS = 1500;
  function mountComposer(props) {
    props.host.innerHTML = "";
    const textarea = document.createElement("wpd-textarea");
    textarea.setAttribute("placeholder", __("Type a message…"));
    textarea.setAttribute("rows", "1");
    textarea.setAttribute("maxlength", "4000");
    textarea.setAttribute("auto-grow", "");
    textarea.setAttribute("max-rows", "6");
    textarea.setAttribute("submit-on-enter", "");
    textarea.classList.add("wpdm-messages__composer-input");
    const actions = document.createElement("div");
    actions.className = "wpdm-messages__composer-actions";
    const nudgeBtn = document.createElement("wpd-button");
    nudgeBtn.setAttribute("variant", "secondary");
    nudgeBtn.setAttribute("title", __("Send a nudge"));
    nudgeBtn.setAttribute("aria-label", __("Send a nudge"));
    nudgeBtn.classList.add("wpdm-messages__composer-nudge");
    nudgeBtn.innerHTML = '<span class="wpdm-messages__composer-nudge-icon" aria-hidden="true">👋</span>';
    const sendBtn = document.createElement("wpd-button");
    sendBtn.setAttribute("variant", "primary");
    sendBtn.classList.add("wpdm-messages__composer-send");
    sendBtn.textContent = __("Send");
    actions.appendChild(nudgeBtn);
    actions.appendChild(sendBtn);
    props.host.appendChild(textarea);
    props.host.appendChild(actions);
    let lastTypingMs = 0;
    const submit = async () => {
      const conv = props.getConversation();
      if (!conv) {
        return;
      }
      const value = (textarea.value ?? "").trim();
      if (!value) {
        return;
      }
      textarea.clear?.();
      try {
        const out = await sendMessage(conv.id, value);
        if (out.message) {
          markMessageAsSelfSent(out.message.id);
          appendMessage(out.message);
        }
      } catch (_err) {
        textarea.value = value;
      }
    };
    textarea.addEventListener("wpd-submit", () => {
      void submit();
    });
    textarea.addEventListener("wpd-input-change", () => {
      const conv = props.getConversation();
      if (!conv) {
        return;
      }
      const now = Date.now();
      if (now - lastTypingMs < TYPING_THROTTLE_MS) {
        return;
      }
      lastTypingMs = now;
      void postTyping(conv.id).catch(() => void 0);
    });
    sendBtn.addEventListener("click", () => {
      void submit();
    });
    nudgeBtn.addEventListener("click", async () => {
      const conv = props.getConversation();
      if (!conv) {
        return;
      }
      try {
        const out = await postNudge(conv.id);
        if (out.message) {
          markMessageAsSelfSent(out.message.id);
          appendMessage(out.message);
        }
      } catch (_err) {
      }
    });
    return () => {
      props.host.innerHTML = "";
    };
  }
  function mountConversationList(props) {
    const repaint = () => render(props);
    const unsubscribe = subscribe(repaint);
    repaint();
    return () => {
      unsubscribe();
      clearKeyedList(props.host);
    };
  }
  function ensureListContainer(host, props) {
    let list = host.querySelector(".wpdm-messages__list-items");
    if (list) {
      return list;
    }
    host.innerHTML = "";
    list = document.createElement("ul");
    list.className = "wpdm-messages__list-items";
    list.setAttribute("role", "list");
    host.appendChild(list);
    list.addEventListener("click", (ev) => {
      const target = ev.target;
      const li = target?.closest(".wpdm-messages__list-item");
      if (!li) {
        return;
      }
      const id = Number(li.dataset.conversationId);
      if (!Number.isFinite(id) || id <= 0) {
        return;
      }
      const conv = getState().conversations.find((c) => c.id === id);
      if (!conv) {
        return;
      }
      setFocusedConversation(id);
      props.onSelect(conv);
    });
    return list;
  }
  function showEmptyState(props) {
    const host = props.host;
    clearKeyedList(host);
    host.innerHTML = "";
    const empty = document.createElement("wpd-empty-state");
    empty.setAttribute("icon", "dashicons-format-chat");
    empty.setAttribute("heading", __("No conversations yet"));
    empty.setAttribute(
      "description",
      __("Start a chat with another administrator or editor.")
    );
    const cta = document.createElement("wpd-button");
    cta.setAttribute("variant", "primary");
    cta.setAttribute("slot", "cta");
    cta.textContent = __("New chat");
    cta.addEventListener("click", () => props.onStartNew());
    empty.appendChild(cta);
    host.appendChild(empty);
  }
  function render(props) {
    const state2 = getState();
    if (state2.conversations.length === 0) {
      showEmptyState(props);
      return;
    }
    const list = ensureListContainer(props.host, props);
    renderKeyedList(list, state2.conversations, {
      keyOf: (c) => c.id,
      buildItem: (c) => buildRow$1(c, props),
      updateItem: (el, c) => updateRow(el, c)
    });
  }
  function updateRow(li, c) {
    const state2 = getState();
    li.classList.toggle(
      "wpdm-messages__list-item--active",
      state2.focusedConversationId === c.id
    );
    const avatar = li.querySelector("wpd-avatar");
    if (avatar) {
      avatar.setAttribute("name", c.otherUser?.displayName ?? "");
      if (c.otherUser?.avatarUrl) {
        avatar.setAttribute("src", c.otherUser.avatarUrl);
      } else {
        avatar.removeAttribute("src");
      }
      const presence = getStatus(c.otherUserId);
      const fallback = c.otherUser?.presence;
      const resolved = presence !== "offline" ? presence : fallback ?? presence;
      if (resolved) {
        avatar.setAttribute("presence", resolved);
      } else {
        avatar.removeAttribute("presence");
      }
    }
    const nameEl = li.querySelector(".wpdm-messages__list-item-name");
    if (nameEl) {
      const next = c.otherUser?.displayName ?? __("Unknown user");
      if (nameEl.textContent !== next) {
        nameEl.textContent = next;
      }
    }
    const previewEl = li.querySelector(".wpdm-messages__list-item-preview");
    if (previewEl) {
      const next = c.lastMessage.preview || __("No messages yet");
      if (previewEl.textContent !== next) {
        previewEl.textContent = next;
      }
    }
    const trailing = li.querySelector(".wpdm-messages__list-item-trailing");
    if (trailing) {
      trailing.innerHTML = "";
      if (c.lastMessage.createdAtMs > 0) {
        const time = document.createElement("wpd-relative-time");
        time.setAttribute(
          "datetime",
          new Date(c.lastMessage.createdAtMs).toISOString()
        );
        trailing.appendChild(time);
      }
      const unread = state2.unreadByConversation.get(c.id) ?? c.unreadCount;
      if (unread > 0) {
        const badge = document.createElement("wpd-badge");
        badge.setAttribute("tone", "danger");
        badge.setAttribute("no-dot", "");
        badge.textContent = unread > 99 ? "99+" : String(unread);
        trailing.appendChild(badge);
      }
    }
  }
  function buildRow$1(c, props) {
    const state2 = getState();
    const li = document.createElement("li");
    li.className = "wpdm-messages__list-item";
    li.dataset.conversationId = String(c.id);
    if (state2.focusedConversationId === c.id) {
      li.classList.add("wpdm-messages__list-item--active");
    }
    li.setAttribute("role", "listitem");
    const avatar = document.createElement("wpd-avatar");
    avatar.setAttribute("size", "40");
    avatar.setAttribute("name", c.otherUser?.displayName ?? "");
    if (c.otherUser?.avatarUrl) {
      avatar.setAttribute("src", c.otherUser.avatarUrl);
    }
    if (c.otherUserId) {
      avatar.setAttribute("user-id", String(c.otherUserId));
    }
    const presenceFromFwk = getStatus(c.otherUserId);
    const presence = presenceFromFwk !== "offline" ? presenceFromFwk : c.otherUser?.presence ?? presenceFromFwk;
    if (presence) {
      avatar.setAttribute("presence", presence);
    }
    const meta = document.createElement("div");
    meta.className = "wpdm-messages__list-item-meta";
    const name = document.createElement("div");
    name.className = "wpdm-messages__list-item-name";
    name.textContent = c.otherUser?.displayName ?? __("Unknown user");
    const preview = document.createElement("div");
    preview.className = "wpdm-messages__list-item-preview";
    preview.textContent = c.lastMessage.preview || __("No messages yet");
    meta.appendChild(name);
    meta.appendChild(preview);
    const trailing = document.createElement("div");
    trailing.className = "wpdm-messages__list-item-trailing";
    if (c.lastMessage.createdAtMs > 0) {
      const time = document.createElement("wpd-relative-time");
      time.setAttribute(
        "datetime",
        new Date(c.lastMessage.createdAtMs).toISOString()
      );
      trailing.appendChild(time);
    }
    const unread = state2.unreadByConversation.get(c.id) ?? c.unreadCount;
    if (unread > 0) {
      const badge = document.createElement("wpd-badge");
      badge.setAttribute("tone", "danger");
      badge.setAttribute("no-dot", "");
      badge.textContent = unread > 99 ? "99+" : String(unread);
      trailing.appendChild(badge);
    }
    li.appendChild(avatar);
    li.appendChild(meta);
    li.appendChild(trailing);
    li.addEventListener("click", () => {
      setFocusedConversation(c.id);
      props.onSelect(c);
    });
    return li;
  }
  function mountDirectory(props) {
    props.host.innerHTML = "";
    const sheet = document.createElement("div");
    sheet.className = "wpdm-messages__directory";
    const header = document.createElement("header");
    header.className = "wpdm-messages__directory-header";
    const title = document.createElement("h3");
    title.textContent = __("Start a chat");
    header.appendChild(title);
    const closeBtn = document.createElement("wpd-button");
    closeBtn.setAttribute("variant", "ghost");
    closeBtn.innerHTML = '<span class="dashicons dashicons-no-alt" aria-hidden="true"></span>';
    closeBtn.addEventListener("click", () => props.onClose());
    header.appendChild(closeBtn);
    const search = document.createElement("wpd-text-field");
    search.setAttribute("placeholder", __("Search by name…"));
    search.classList.add("wpdm-messages__directory-search");
    const list = document.createElement("ul");
    list.className = "wpdm-messages__directory-list";
    sheet.appendChild(header);
    sheet.appendChild(search);
    sheet.appendChild(list);
    props.host.appendChild(sheet);
    let lastSearch = "";
    let debounce = null;
    const load = async (q) => {
      try {
        list.innerHTML = "";
        const out = await listUsers({ search: q, perPage: 50 });
        if (out.users.length === 0) {
          const empty = document.createElement("li");
          empty.className = "wpdm-messages__directory-empty";
          empty.textContent = __("No matching users.");
          list.appendChild(empty);
          return;
        }
        for (const u of out.users) {
          list.appendChild(buildRow(u, props));
        }
      } catch (_err) {
        list.innerHTML = "";
        const errLi = document.createElement("li");
        errLi.className = "wpdm-messages__directory-empty";
        errLi.textContent = __("Could not load users.");
        list.appendChild(errLi);
      }
    };
    search.addEventListener("wpd-input-change", (ev) => {
      const detail = ev.detail;
      const next = (detail?.value ?? "").trim();
      if (next === lastSearch) {
        return;
      }
      lastSearch = next;
      if (debounce !== null) {
        window.clearTimeout(debounce);
      }
      debounce = window.setTimeout(() => {
        void load(next);
      }, 200);
    });
    void load("");
    return () => {
      if (debounce !== null) {
        window.clearTimeout(debounce);
      }
      props.host.innerHTML = "";
    };
  }
  function buildRow(user, props) {
    const li = document.createElement("li");
    li.className = "wpdm-messages__directory-row";
    const avatar = document.createElement("wpd-avatar");
    avatar.setAttribute("size", "32");
    avatar.setAttribute("name", user.displayName);
    avatar.setAttribute("user-id", String(user.id));
    if (user.avatarUrl) {
      avatar.setAttribute("src", user.avatarUrl);
    }
    if (user.presence) {
      avatar.setAttribute("presence", user.presence);
    }
    const text = document.createElement("div");
    text.className = "wpdm-messages__directory-row-text";
    const name = document.createElement("div");
    name.className = "wpdm-messages__directory-row-name";
    name.textContent = user.displayName;
    text.appendChild(name);
    const role = document.createElement("div");
    role.className = "wpdm-messages__directory-row-role";
    role.textContent = user.role;
    text.appendChild(role);
    li.appendChild(avatar);
    li.appendChild(text);
    li.addEventListener("click", async () => {
      try {
        const out = await startConversation(user.id);
        upsertConversation(out.conversation);
        setFocusedConversation(out.conversation.id);
        props.onClose();
      } catch (_err) {
      }
    });
    return li;
  }
  const SCROLL_BACKLOAD_THRESHOLD_PX = 80;
  function mountThread(props) {
    props.host.innerHTML = "";
    const scroller = document.createElement("div");
    scroller.className = "wpdm-messages__thread-scroller";
    const list = document.createElement("ol");
    list.className = "wpdm-messages__thread-list";
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    scroller.appendChild(list);
    props.host.appendChild(scroller);
    let loadingMore = false;
    let lastRenderedConversation = 0;
    let lastRowCount = 0;
    const lastMarkedIdByConv = /* @__PURE__ */ new Map();
    const scrollToBottom = () => {
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    };
    const repaint = () => {
      const convId = props.getConversationId();
      if (convId === null) {
        list.innerHTML = "";
        lastRowCount = 0;
        return;
      }
      const state2 = getState();
      const rows = state2.messagesByConversation.get(convId) ?? [];
      const conversationChanged = lastRenderedConversation !== convId;
      lastRenderedConversation = convId;
      const arrived = rows.length > lastRowCount;
      list.innerHTML = "";
      for (const row of rows) {
        list.appendChild(buildBubble(row, state2.settings.nudgeSoundId));
      }
      const typing = state2.typingByConversation.get(convId);
      if (typing && typing.length > 0) {
        list.appendChild(buildTypingDots(typing.length));
      }
      if (arrived || conversationChanged) {
        scrollToBottom();
      }
      lastRowCount = rows.length;
      const unread = state2.unreadByConversation.get(convId) ?? 0;
      if (unread > 0 && state2.windowFocused && rows.length > 0) {
        const lastId = rows[rows.length - 1].id;
        const acked = lastMarkedIdByConv.get(convId) ?? 0;
        if (lastId > 0 && lastId > acked) {
          lastMarkedIdByConv.set(convId, lastId);
          props.onMarkRead(lastId);
        }
      }
    };
    const onScroll = async () => {
      if (loadingMore) {
        return;
      }
      const convId = props.getConversationId();
      if (convId === null) {
        return;
      }
      if (scroller.scrollTop > SCROLL_BACKLOAD_THRESHOLD_PX) {
        return;
      }
      const state2 = getState();
      const rows = state2.messagesByConversation.get(convId) ?? [];
      if (rows.length === 0) {
        return;
      }
      loadingMore = true;
      try {
        const oldest = rows[0].id;
        const out = await fetchMessages(convId, { before: oldest, limit: 50 });
        if (out.messages.length > 0) {
          const merged = [...out.messages, ...rows];
          setMessagesForConversation(convId, merged);
          scroller.scrollTop = SCROLL_BACKLOAD_THRESHOLD_PX + 10;
        }
      } catch (_err) {
      } finally {
        loadingMore = false;
      }
    };
    scroller.addEventListener("scroll", () => {
      void onScroll();
    });
    const unsubscribe = subscribe(repaint);
    repaint();
    return unsubscribe;
  }
  function buildBubble(row, _soundId) {
    const li = document.createElement("li");
    li.className = "wpdm-messages__bubble";
    li.dataset.messageId = String(row.id);
    const cfg = window.wpDesktopMessagesConfig;
    const isMine = !!cfg && Number(cfg.currentUserId) === Number(row.authorId);
    li.classList.add(isMine ? "wpdm-messages__bubble--mine" : "wpdm-messages__bubble--theirs");
    if (row.kind === "nudge") {
      li.classList.add("wpdm-messages__bubble--nudge");
    }
    const body = document.createElement("div");
    body.className = "wpdm-messages__bubble-body";
    if (row.kind === "nudge") {
      body.innerHTML = "👋 " + __("sent a nudge");
    } else {
      body.innerHTML = row.content;
    }
    li.appendChild(body);
    const time = document.createElement("wpd-relative-time");
    time.className = "wpdm-messages__bubble-time";
    time.setAttribute("datetime", new Date(row.createdAtMs).toISOString());
    li.appendChild(time);
    return li;
  }
  function buildTypingDots(count) {
    const li = document.createElement("li");
    li.className = "wpdm-messages__typing";
    li.setAttribute(
      "aria-label",
      count === 1 ? __("Someone is typing") : __("Several people are typing")
    );
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "wpdm-messages__typing-dot";
      li.appendChild(dot);
    }
    return li;
  }
  const MESSAGES_WINDOW_ID = "wpdm-messages";
  const ROOT = "[data-wpdm-messages-root]";
  const SIDEBAR_LIST = "[data-wpdm-messages-list]";
  const MAIN = "[data-wpdm-messages-main]";
  const PLACEHOLDER = "[data-wpdm-messages-placeholder]";
  const THREAD = "[data-wpdm-messages-thread]";
  const COMPOSER = "[data-wpdm-messages-composer]";
  const renderCallback = (body) => {
    const root = body.querySelector(ROOT);
    if (!root) {
      return;
    }
    setWindowMounted(true);
    const setWindowTitle = (title) => {
      const win = body.closest(".wp-desktop-window");
      const titleEl = win?.querySelector(
        ".wp-desktop-window__title-text, .wp-desktop-window__title"
      );
      if (titleEl) {
        titleEl.textContent = title;
      }
    };
    let directoryTeardown = null;
    const teardowns = [];
    const sidebarList = body.querySelector(SIDEBAR_LIST);
    const main = body.querySelector(MAIN);
    const placeholder = body.querySelector(PLACEHOLDER);
    const thread = body.querySelector(THREAD);
    const composer = body.querySelector(COMPOSER);
    if (!sidebarList || !main || !placeholder || !thread || !composer) {
      console.warn("[wpdm-messages] Template missing data-wpdm-messages-* hooks");
      return;
    }
    const wireNewChatButtons = () => {
      body.querySelectorAll("[data-wpdm-messages-new]").forEach((btn) => {
        if (btn.dataset.wpdmNewWired === "1") {
          return;
        }
        btn.dataset.wpdmNewWired = "1";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openDirectory();
        });
      });
    };
    wireNewChatButtons();
    const onBodyClick = (ev) => {
      const path = ev.composedPath() || [];
      for (const node of path) {
        if (!(node instanceof Element)) {
          continue;
        }
        if (node.hasAttribute("data-wpdm-messages-new")) {
          ev.preventDefault();
          openDirectory();
          return;
        }
      }
    };
    body.addEventListener("click", onBodyClick);
    teardowns.push(() => body.removeEventListener("click", onBodyClick));
    const getCurrentConversation = () => {
      const id = getState().focusedConversationId;
      if (id === null) {
        return null;
      }
      return getState().conversations.find((c) => c.id === id) ?? null;
    };
    const showThread = () => {
      placeholder.style.display = "none";
      thread.style.display = "flex";
      composer.style.display = "flex";
      placeholder.hidden = true;
      thread.hidden = false;
      composer.hidden = false;
    };
    const showPlaceholder = () => {
      placeholder.style.display = "flex";
      thread.style.display = "none";
      composer.style.display = "none";
      placeholder.hidden = false;
      thread.hidden = true;
      composer.hidden = true;
    };
    const seededFocusedId = getState().focusedConversationId;
    let seededTitleApplied = false;
    if (seededFocusedId !== null) {
      showThread();
      void hydrateMessages(seededFocusedId);
      const seededConv = getCurrentConversation();
      if (seededConv) {
        setWindowTitle(
          seededConv.otherUser?.displayName ?? __("Messages")
        );
        seededTitleApplied = true;
      }
    } else {
      showPlaceholder();
    }
    teardowns.push(
      mountConversationList({
        host: sidebarList,
        onSelect: (c) => {
          setFocusedConversation(c.id);
          void hydrateMessages(c.id);
          showThread();
          setWindowTitle(c.otherUser?.displayName ?? __("Messages"));
        },
        onStartNew: () => openDirectory()
      })
    );
    const threadHostInner = document.createElement("div");
    threadHostInner.className = "wpdm-messages__thread-inner";
    thread.appendChild(threadHostInner);
    teardowns.push(
      mountThread({
        host: threadHostInner,
        getConversation: getCurrentConversation,
        getConversationId: () => getState().focusedConversationId,
        onMarkRead: (lastReadId) => {
          const id = getState().focusedConversationId;
          if (id === null) {
            return;
          }
          clearUnreadForConversation(id);
          void markRead(id, lastReadId).catch(() => void 0);
        }
      })
    );
    teardowns.push(
      mountComposer({
        host: composer,
        getConversation: getCurrentConversation
      })
    );
    function openDirectory() {
      if (directoryTeardown) {
        directoryTeardown();
      }
      const sheet = document.createElement("div");
      sheet.className = "wpdm-messages__directory-sheet";
      main.appendChild(sheet);
      directoryTeardown = mountDirectory({
        host: sheet,
        onClose: () => {
          if (directoryTeardown) {
            directoryTeardown();
            directoryTeardown = null;
          }
          sheet.remove();
          const c = getCurrentConversation();
          if (c) {
            showThread();
          } else {
            showPlaceholder();
          }
        }
      });
      placeholder.hidden = true;
      thread.hidden = true;
      composer.hidden = true;
    }
    const onWindowFocused = (ev) => {
      const detail = ev.detail;
      setWindowFocused(detail?.windowId === MESSAGES_WINDOW_ID);
    };
    const onWindowChanged = (ev) => {
      const detail = ev.detail;
      if (detail?.windowId !== MESSAGES_WINDOW_ID) {
        return;
      }
      setWindowMounted(detail.state !== "minimized");
    };
    const onWindowClosed = (ev) => {
      const detail = ev.detail;
      if (detail?.windowId !== MESSAGES_WINDOW_ID) {
        return;
      }
      setWindowMounted(false);
      setWindowFocused(false);
    };
    let lastFocusedId = seededTitleApplied ? seededFocusedId : null;
    const onWindowReopened = (ev) => {
      const detail = ev.detail;
      if (detail?.windowId !== MESSAGES_WINDOW_ID) {
        return;
      }
      if (directoryTeardown) {
        directoryTeardown();
        directoryTeardown = null;
        body.querySelectorAll(".wpdm-messages__directory-sheet").forEach((el) => el.remove());
      }
      lastFocusedId = null;
      const currentFocus = getState().focusedConversationId;
      if (currentFocus !== null) {
        showThread();
        void hydrateMessages(currentFocus);
        const conv = getCurrentConversation();
        if (conv) {
          setWindowTitle(
            conv.otherUser?.displayName ?? __("Messages")
          );
          lastFocusedId = currentFocus;
        }
      } else {
        showPlaceholder();
      }
    };
    document.addEventListener("wp-desktop-window-focused", onWindowFocused);
    document.addEventListener("wp-desktop-window-changed", onWindowChanged);
    document.addEventListener("wp-desktop-window-closed", onWindowClosed);
    document.addEventListener("wp-desktop-window-reopened", onWindowReopened);
    teardowns.push(() => {
      document.removeEventListener("wp-desktop-window-focused", onWindowFocused);
      document.removeEventListener("wp-desktop-window-changed", onWindowChanged);
      document.removeEventListener("wp-desktop-window-closed", onWindowClosed);
      document.removeEventListener("wp-desktop-window-reopened", onWindowReopened);
    });
    const wp = window.wp;
    const focused = wp?.desktop?.windowManager?.getFocused?.();
    if (focused?.id === MESSAGES_WINDOW_ID) {
      setWindowFocused(true);
    }
    void listConversations().then((out) => {
      for (const c of out.conversations) {
        upsertConversation(c);
      }
    }).catch(() => void 0);
    const focusUnsub = subscribe((state2) => {
      const id = state2.focusedConversationId;
      if (id === null) {
        showPlaceholder();
        lastFocusedId = null;
        return;
      }
      showThread();
      if (id !== lastFocusedId) {
        lastFocusedId = id;
        void hydrateMessages(id);
        const conv = getCurrentConversation();
        if (conv) {
          setWindowTitle(
            conv.otherUser?.displayName ?? __("Messages")
          );
        } else {
          lastFocusedId = null;
        }
      }
    });
    teardowns.push(focusUnsub);
    setWindowTitle(__("Messages"));
    return () => {
      setWindowMounted(false);
      setWindowFocused(false);
      if (directoryTeardown) {
        directoryTeardown();
      }
      for (const fn of teardowns) {
        try {
          fn();
        } catch (_err) {
        }
      }
    };
  };
  async function hydrateMessages(conversationId) {
    const state2 = getState();
    if (state2.messagesByConversation.has(conversationId)) {
      return;
    }
    try {
      const out = await fetchMessages(conversationId, { limit: 50 });
      setMessagesForConversation(conversationId, out.messages);
    } catch (_err) {
    }
  }
  const w = window;
  w.wpDesktopNativeWindows = w.wpDesktopNativeWindows ?? {};
  w.wpDesktopNativeWindows["wpdm-messages"] = renderCallback;
})();
