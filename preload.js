const { ipcRenderer } = require("electron");

// ---- Start Flash with the fastest settings ----
// Flash only renders through the graphics card (Stage3D, fast blitting) when
// the page embeds it with a hardware wmode. Pages that ship "opaque",
// "transparent" or nothing at all silently drop the game to CPU rendering.
// We correct the embed the moment the page inserts it, before Flash starts.
// The optional quality override works the same way.
(() => {
  let pageSettings = null;
  try {
    pageSettings = ipcRenderer.sendSync("settings:get-sync");
  } catch (_err) {}
  if (!pageSettings) return;

  const forced = {};
  if (pageSettings.performanceMode !== false) {
    forced.wmode = "direct";
  }
  if (["low", "medium", "high"].includes(pageSettings.flashQuality)) {
    forced.quality = pageSettings.flashQuality;
  }
  const names = Object.keys(forced);

  if (!names.length) return;

  const looksLikeFlash = (el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type.includes("shockwave-flash")) return true;
    const src = (el.getAttribute("src") || el.getAttribute("data") || "").toLowerCase();
    if (src.split("?")[0].endsWith(".swf")) return true;
    if (el.tagName === "OBJECT") {
      const movie = el.querySelector('param[name="movie" i]');
      return !!movie && (movie.getAttribute("value") || "").toLowerCase().includes(".swf");
    }
    return false;
  };

  const fixElement = (el) => {
    if (!el || (el.tagName !== "EMBED" && el.tagName !== "OBJECT") || !looksLikeFlash(el)) return;
    names.forEach((name) => {
      const value = forced[name];
      const param = el.tagName === "OBJECT" ? el.querySelector('param[name="' + name + '" i]') : null;
      const current = (
        (el.tagName === "EMBED" ? el.getAttribute(name) : param && param.getAttribute("value")) || ""
      ).toLowerCase();
      if (current === value) return;
      // "gpu" is the page author's own choice of a hardware mode; keep it.
      if (name === "wmode" && current === "gpu") return;
      if (el.tagName === "EMBED") {
        el.setAttribute(name, value);
      } else if (param) {
        param.setAttribute("value", value);
      } else {
        const added = document.createElement("param");
        added.setAttribute("name", name);
        added.setAttribute("value", value);
        el.appendChild(added);
      }
    });
  };

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === "PARAM") return fixElement(node.parentElement);
    fixElement(node);
    if (node.querySelectorAll) node.querySelectorAll("embed, object").forEach(fixElement);
  };

  new MutationObserver((mutations) => {
    mutations.forEach((m) => m.addedNodes.forEach(scan));
  }).observe(document, { childList: true, subtree: true });
})();

// Tell the client when this page starts showing Flash. Each tab's session has its
// own Flash process, and this is how the client knows which process is this tab's.
(() => {
  const isFlash = (el) => {
    if (!el || (el.tagName !== "EMBED" && el.tagName !== "OBJECT")) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const src = (el.getAttribute("src") || el.getAttribute("data") || "").toLowerCase();
    return type.includes("shockwave-flash") || src.split("?")[0].endsWith(".swf");
  };
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isFlash(node) || (node.querySelector && [...node.querySelectorAll("embed, object")].some(isFlash))) {
          observer.disconnect();
          ipcRenderer.send("flash:present");
          return;
        }
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });
})();

// A page calling window.close() (the game does on logout) closes its own tab,
// never the whole client.
window.close = () => {
  ipcRenderer.send("tab:close-current");
};

const getKey = (input) =>
  input.getAttribute("name") ||
  input.getAttribute("id") ||
  input.getAttribute("placeholder") ||
  "input";

const allowedTypes = ["text", "email", "search", "tel", "url"];
const credentialFieldTypes = ["text", "email", "search", "tel", "url", "password"];

// Dropdown of values typed into this field before. It is fixed to the viewport, follows
// the field, filters as you type, and closes whenever the field loses focus.
let suggestionBox = null;
let activeInput = null;
let activeOrigin = null;
let activeKey = null;
let allValues = [];
let shownValues = [];
let highlighted = -1;
let focusToken = 0;

const SUGGEST_CSS = `
#ua-autofill-box {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  display: none;
  box-sizing: border-box;
  max-height: 232px;
  overflow-y: auto;
  padding: 4px;
  background: #121821;
  border: 1px solid #263042;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  font: 13px "Segoe UI", system-ui, sans-serif;
  color: #e6ebf5;
  text-align: left;
}
#ua-autofill-box::-webkit-scrollbar { width: 8px; }
#ua-autofill-box::-webkit-scrollbar-thumb { background: #2a3446; border: 2px solid #121821; border-radius: 4px; }
#ua-autofill-box .ua-head {
  padding: 6px 10px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #6f7b91;
}
#ua-autofill-box .ua-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 4px 0 10px;
  border-radius: 7px;
  cursor: pointer;
}
#ua-autofill-box .ua-row.on { background: rgba(77, 184, 255, 0.14); }
#ua-autofill-box .ua-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#ua-autofill-box .ua-del {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6f7b91;
  font-size: 16px;
  line-height: 1;
  visibility: hidden;
}
#ua-autofill-box .ua-row.on .ua-del { visibility: visible; }
#ua-autofill-box .ua-del:hover { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
`;

const ensureSuggestionBox = () => {
  if (suggestionBox && suggestionBox.isConnected) return suggestionBox;
  const root = document.body || document.documentElement;
  if (!document.getElementById("ua-autofill-style")) {
    const style = document.createElement("style");
    style.id = "ua-autofill-style";
    style.textContent = SUGGEST_CSS;
    (document.head || root).appendChild(style);
  }
  suggestionBox = document.createElement("div");
  suggestionBox.id = "ua-autofill-box";
  // Keep focus in the field while clicking inside the list.
  suggestionBox.addEventListener("mousedown", (event) => event.preventDefault());
  root.appendChild(suggestionBox);
  return suggestionBox;
};

const hideSuggestions = () => {
  if (suggestionBox) {
    suggestionBox.style.display = "none";
    suggestionBox.textContent = "";
  }
  activeInput = null;
  shownValues = [];
  highlighted = -1;
};

const positionSuggestions = () => {
  if (!activeInput || !suggestionBox || suggestionBox.style.display === "none") return;
  const rect = activeInput.getBoundingClientRect();
  // Field scrolled out of view or hidden: close instead of floating in the open.
  if (!activeInput.isConnected || rect.width === 0 || rect.bottom < 0 || rect.top > innerHeight) {
    hideSuggestions();
    return;
  }
  const box = suggestionBox;
  box.style.width = `${Math.max(rect.width, 180)}px`;
  const height = box.offsetHeight;
  const below = innerHeight - rect.bottom;
  const top = below < height + 6 && rect.top > below ? rect.top - height - 4 : rect.bottom + 4;
  const left = Math.min(Math.max(4, rect.left), Math.max(4, innerWidth - box.offsetWidth - 4));
  box.style.top = `${Math.round(top)}px`;
  box.style.left = `${Math.round(left)}px`;
};

const pickSuggestion = (value) => {
  const input = activeInput;
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  hideSuggestions();
};

const highlight = (index) => {
  highlighted = index;
  suggestionBox.querySelectorAll(".ua-row").forEach((row, i) => row.classList.toggle("on", i === index));
  const row = suggestionBox.querySelectorAll(".ua-row")[index];
  if (row) row.scrollIntoView({ block: "nearest" });
};

const renderSuggestions = () => {
  if (!activeInput) return;
  const typed = (activeInput.value || "").trim().toLowerCase();
  shownValues = allValues.filter((val) => {
    const lower = String(val).toLowerCase();
    return !typed || (lower.includes(typed) && lower !== typed);
  });
  const box = ensureSuggestionBox();
  box.textContent = "";
  highlighted = -1;
  if (!shownValues.length) {
    box.style.display = "none";
    return;
  }
  const head = document.createElement("div");
  head.className = "ua-head";
  head.textContent = "Previously entered";
  box.appendChild(head);
  shownValues.forEach((val, index) => {
    const row = document.createElement("div");
    row.className = "ua-row";
    row.addEventListener("mouseenter", () => highlight(index));
    row.addEventListener("click", () => pickSuggestion(val));

    const text = document.createElement("span");
    text.className = "ua-text";
    text.textContent = val;

    const remove = document.createElement("span");
    remove.className = "ua-del";
    remove.textContent = "×";
    remove.title = "Remove from this list";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      const input = activeInput;
      const next = await ipcRenderer.invoke("autofill:delete", activeOrigin, activeKey, val);
      if (activeInput !== input) return;
      allValues = Array.isArray(next) ? next : [];
      renderSuggestions();
    });

    row.append(text, remove);
    box.appendChild(row);
  });
  box.style.display = "block";
  positionSuggestions();
};

const isAutofillField = (el) =>
  el instanceof HTMLInputElement &&
  allowedTypes.includes((el.getAttribute("type") || "text").toLowerCase()) &&
  !el.disabled &&
  !el.readOnly;

const openSuggestions = async (input) => {
  const token = ++focusToken;
  const origin = location.origin;
  const key = getKey(input);
  const values = await ipcRenderer.invoke("autofill:get", origin, key);
  // The field may have lost focus while we waited; never show a list for it then.
  if (token !== focusToken || document.activeElement !== input) return;
  activeInput = input;
  activeOrigin = origin;
  activeKey = key;
  allValues = Array.isArray(values) ? values : [];
  renderSuggestions();
};

const attachAutofill = () => {
  // Delegated, so fields added later (login pop-ups) work too.
  document.addEventListener("focusin", (event) => {
    if (isAutofillField(event.target)) openSuggestions(event.target);
    else hideSuggestions();
  }, true);
  document.addEventListener("focusout", (event) => {
    if (event.target === activeInput || !activeInput) {
      focusToken++;
      hideSuggestions();
    }
  }, true);
  document.addEventListener("input", (event) => {
    if (event.target === activeInput) renderSuggestions();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.target !== activeInput || !shownValues.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      highlight((highlighted + dir + shownValues.length) % shownValues.length);
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      pickSuggestion(shownValues[highlighted]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      hideSuggestions();
    }
  }, true);
  document.addEventListener("mousedown", (event) => {
    if (!activeInput || !suggestionBox) return;
    if (suggestionBox.contains(event.target) || event.target === activeInput) return;
    hideSuggestions();
  }, true);
  window.addEventListener("scroll", positionSuggestions, true);
  window.addEventListener("resize", positionSuggestions);
  window.addEventListener("blur", hideSuggestions);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hideSuggestions();
  });

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      const inputsInForm = Array.from(form.querySelectorAll("input"));
      const entries = inputsInForm
        .filter((el) => {
          const type = (el.getAttribute("type") || "text").toLowerCase();
          return allowedTypes.includes(type);
        })
        .map((el) => ({
          origin,
          key: getKey(el),
          path: location.pathname,
          url: location.href,
          value: (el.value || "").trim(),
        }))
        .filter((e) => e.value);
      if (entries.length) {
        ipcRenderer.invoke("autofill:queue", entries);
      }
    },
    true
  );
};

const pickUsernameField = (inputs) => {
  const lowered = (text) => (text || "").toLowerCase();
  const preferred = inputs.filter((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (!allowedTypes.includes(type)) return false;
    const name = lowered(el.getAttribute("name"));
    const id = lowered(el.getAttribute("id"));
    const placeholder = lowered(el.getAttribute("placeholder"));
    return (
      name.includes("user") ||
      name.includes("login") ||
      name.includes("email") ||
      id.includes("user") ||
      id.includes("login") ||
      id.includes("email") ||
      placeholder.includes("user") ||
      placeholder.includes("login") ||
      placeholder.includes("email")
    );
  });
  if (preferred.length) return preferred[0];
  return inputs.find((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return allowedTypes.includes(type);
  });
};

const applyCredentials = (username, password) => {
  const passwordInput = document.querySelector("input[type='password']");
  if (!passwordInput) return false;

  const form = passwordInput.closest("form") || document;
  const inputs = Array.from(form.querySelectorAll("input")).filter((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return credentialFieldTypes.includes(type);
  });

  const usernameInput = pickUsernameField(inputs);
  if (usernameInput) {
    usernameInput.value = username;
    usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
    usernameInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  passwordInput.value = password;
  passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
  passwordInput.dispatchEvent(new Event("change", { bubbles: true }));

  if (form && !form.__autoLoginSubmitted) {
    form.__autoLoginSubmitted = true;
    setTimeout(() => {
      try {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else if (typeof form.submit === "function") {
          form.submit();
        }
      } catch (_err) {}
    }, 400);
  }
  return true;
};

const captureLoginOnSubmit = async (event) => {
  let settings;
  try {
    settings = await ipcRenderer.invoke("settings:get");
  } catch (_err) {
    settings = null;
  }
  if (!settings || !settings.saveLogin) return;

  const form = event.target;
  if (!form || !form.querySelector) return;
  const passwordInput = form.querySelector("input[type='password']");
  if (!passwordInput) return;

  const inputs = Array.from(form.querySelectorAll("input"));
  const usernameInput = pickUsernameField(inputs);
  const username = usernameInput ? (usernameInput.value || "").trim() : "";
  const password = (passwordInput.value || "").trim();
  if (!username || !password) return;

  const origin = location.origin;
  if (!origin || origin === "null") return;
  await ipcRenderer.invoke("credentials:save", origin, { username, password });
};

window.addEventListener("DOMContentLoaded", () => {
  attachAutofill();
  document.addEventListener("submit", captureLoginOnSubmit, true);
});

// Accounts panel in the client chrome asks us to log in with a saved account
ipcRenderer.on("credentials:apply", (_event, account) => {
  if (!account) return;
  applyCredentials(account.username, account.password);
});

window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    ipcRenderer.invoke("zoom:adjust", event.deltaY);
  },
  { passive: false }
);

window.addEventListener(
  "mousewheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    ipcRenderer.invoke("zoom:adjust", event.wheelDelta || event.deltaY);
  },
  { passive: false }
);

window.addEventListener(
  "keydown",
  (event) => {
    if (!event.ctrlKey) return;
    const key = event.key;
    if (key === "+" || key === "=") {
      ipcRenderer.invoke("zoom:adjust", -120);
      event.preventDefault();
    } else if (key === "-" || key === "_") {
      ipcRenderer.invoke("zoom:adjust", 120);
      event.preventDefault();
    } else if (key === "0") {
      ipcRenderer.invoke("zoom:reset");
      event.preventDefault();
    }
  },
  true
);
