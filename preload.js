const { ipcRenderer } = require("electron");

const getKey = (input) =>
  input.getAttribute("name") ||
  input.getAttribute("id") ||
  input.getAttribute("placeholder") ||
  "input";

const allowedTypes = ["text", "email", "search", "tel", "url"];

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

window.addEventListener("DOMContentLoaded", () => {
  attachAutofill();
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
document.addEventListener("contextmenu", (event) => {
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