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

let suggestionBox;
let activeInput = null;

const ensureSuggestionBox = () => {
  if (suggestionBox) return suggestionBox;
  suggestionBox = document.createElement("div");
  suggestionBox.id = "ua-autofill-box";
  Object.assign(suggestionBox.style, {
    position: "absolute",
    zIndex: "2147483647",
    background: "rgba(10,16,28,0.95)",
    border: "1px solid rgba(105,224,255,0.3)",
    borderRadius: "8px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    padding: "4px 0",
    minWidth: "120px",
    maxWidth: "280px",
    display: "none",
    color: "#eaf0ff",
    fontFamily: "Segoe UI, sans-serif",
    fontSize: "12px",
  });
  document.body.appendChild(suggestionBox);
  return suggestionBox;
};

const hideSuggestions = () => {
  if (suggestionBox) {
    suggestionBox.style.display = "none";
    suggestionBox.innerHTML = "";
  }
  activeInput = null;
};

const showSuggestions = (input, origin, key, values) => {
  const box = ensureSuggestionBox();
  if (!values || !values.length) {
    hideSuggestions();
    return;
  }
  activeInput = input;
  const rect = input.getBoundingClientRect();
  box.innerHTML = "";
  values.forEach((val) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "6px",
      padding: "6px 10px",
      cursor: "pointer",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    });
    row.addEventListener("mouseenter", () => (row.style.background = "rgba(105,224,255,0.08)"));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));

    const text = document.createElement("span");
    text.textContent = val;
    text.style.flex = "1";
    text.style.overflow = "hidden";
    text.style.textOverflow = "ellipsis";
    text.style.whiteSpace = "nowrap";

    const btn = document.createElement("button");
    btn.textContent = "x";
    Object.assign(btn.style, {
      border: "1px solid rgba(105,224,255,0.25)",
      background: "rgba(255,255,255,0.05)",
      color: "#eaf0ff",
      borderRadius: "6px",
      width: "22px",
      height: "22px",
      cursor: "pointer",
    });
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const next = await ipcRenderer.invoke("autofill:delete", origin, key, val);
      if (Array.isArray(next) && next.length) {
        showSuggestions(input, origin, key, next);
      } else {
        hideSuggestions();
      }
    });

    row.addEventListener("click", () => {
      input.value = val;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      hideSuggestions();
    });

    row.appendChild(text);
    row.appendChild(btn);
    box.appendChild(row);
  });

  box.style.left = `${rect.left + window.scrollX}px`;
  box.style.top = `${rect.bottom + window.scrollY + 2}px`;
  box.style.minWidth = `${rect.width}px`;
  box.style.display = "block";
};

const attachAutofill = () => {
  const origin = location.origin;
  const inputs = Array.from(document.querySelectorAll("input"));

  inputs
    .filter((el) => {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return allowedTypes.includes(type);
    })
    .forEach((input) => {
      const key = getKey(input);

      input.addEventListener("focus", async () => {
        const values = await ipcRenderer.invoke("autofill:get", origin, key);
        showSuggestions(input, origin, key, values);
      });
    });

  document.addEventListener(
    "click",
    (event) => {
      if (!suggestionBox) return;
      if (suggestionBox.contains(event.target)) return;
      if (activeInput && activeInput.contains(event.target)) return;
      hideSuggestions();
    },
    true
  );

  window.addEventListener("scroll", hideSuggestions, true);
  window.addEventListener("resize", hideSuggestions);

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

// Sayfa içinde sağ tık context menu
const isFlashElement = (el) => {
  if (!el || typeof el.getAttribute !== "function") return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag !== "embed" && tag !== "object") return false;
  const type = (el.getAttribute("type") || "").toLowerCase();
  const data = (el.getAttribute("data") || "").toLowerCase();
  const src = (el.getAttribute("src") || "").toLowerCase();
  if (type.includes("shockwave") || type.includes("flash")) return true;
  if (data.includes(".swf") || src.includes(".swf")) return true;
  if (tag === "object") {
    const movieParam = el.querySelector('param[name="movie"]');
    const value = movieParam ? (movieParam.getAttribute("value") || "").toLowerCase() : "";
    if (value.includes(".swf")) return true;
  }
  return false;
};

const isFlashTarget = (event) => {
  if (!event) return false;
  if (typeof event.composedPath === "function") {
    const path = event.composedPath();
    for (const node of path) {
      if (node && node.tagName && isFlashElement(node)) return true;
    }
  }
  const target = event.target;
  if (target && typeof target.closest === "function") {
    const el = target.closest("embed, object");
    if (el && isFlashElement(el)) return true;
  }
  return false;
};

document.addEventListener("contextmenu", (event) => {
  if (isFlashTarget(event)) {
    // Allow Flash/Pepper to show its own context menu (quality/settings).
    return;
  }
  event.preventDefault();
  
  const selection = window.getSelection().toString();
  const target = event.target;
  
  let isLink = false;
  let linkUrl = null;
  let isImage = false;
  let imageUrl = null;
  
  // Link detection
  const linkElement = target.closest("a");
  if (linkElement && linkElement.href) {
    isLink = true;
    linkUrl = linkElement.href;
  }
  
  // Image detection
  if (target.tagName === "IMG") {
    isImage = true;
    imageUrl = target.src;
  }
  
  ipcRenderer.send("page:context-menu", {
    x: event.clientX,
    y: event.clientY,
    selection,
    isLink,
    linkUrl,
    isImage,
    imageUrl,
    canGoBack: window.history.length > 1
  });
});

