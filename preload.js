const { ipcRenderer } = require("electron");

// Expose API to close current tab from page scripts
window.electronAPI = {
  closeCurrentTab: () => {
    ipcRenderer.send("tab:close-current");
  }
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

const showAccountPicker = async () => {
  let settings;
  try {
    settings = await ipcRenderer.invoke("settings:get");
  } catch (_err) {
    settings = null;
  }
  if (!settings || !settings.saveLogin) return;

  const origin = location.origin;
  if (!origin || origin === "null") return;

  const accounts = await ipcRenderer.invoke("credentials:list", origin);
  if (!accounts || !accounts.length) return;

  const overlay = document.createElement("div");
  overlay.id = "account-picker-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "9999",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#1a1f2e",
    border: "1px solid #2a3342",
    borderRadius: "12px",
    padding: "24px",
    width: "340px",
    maxHeight: "420px",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    fontFamily: '"Inter", sans-serif',
    color: "#f0f4f8",
  });

  const title = document.createElement("h3");
  title.textContent = "Select Account";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "16px",
    fontWeight: "600",
  });

  const list = document.createElement("div");
  Object.assign(list.style, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    overflowY: "auto",
    maxHeight: "280px",
  });

  accounts.forEach((account) => {
    const btn = document.createElement("button");
    btn.textContent = account.username;
    Object.assign(btn.style, {
      padding: "12px 16px",
      background: "#252d3d",
      border: "1px solid #2a3342",
      borderRadius: "8px",
      color: "#f0f4f8",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: "500",
      textAlign: "left",
      transition: "all 0.2s ease",
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#2a3342";
      btn.style.borderColor = "#00d4ff";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#252d3d";
      btn.style.borderColor = "#2a3342";
    });

    btn.addEventListener("click", () => {
      applyCredentials(account.username, account.password);
      overlay.remove();
    });

    list.appendChild(btn);
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Cancel";
  Object.assign(closeBtn.style, {
    padding: "10px 16px",
    background: "#1a1f2e",
    border: "1px solid #2a3342",
    borderRadius: "8px",
    color: "#a0a9b8",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "500",
    transition: "all 0.2s ease",
  });

  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.borderColor = "#00d4ff";
    closeBtn.style.color = "#00d4ff";
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.borderColor = "#2a3342";
    closeBtn.style.color = "#a0a9b8";
  });

  closeBtn.addEventListener("click", () => {
    overlay.remove();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  modal.appendChild(title);
  modal.appendChild(list);
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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
  // showAccountPicker(); // Removed - only show from tab bar button
  document.addEventListener("submit", captureLoginOnSubmit, true);
});

// IPC listener for showing credentials manager modal
ipcRenderer.on("show:credentials-modal", async (event, accounts) => {
  let credentialsModalOverlay = document.getElementById("page-credentials-modal-overlay");
  if (credentialsModalOverlay) {
    credentialsModalOverlay.remove();
  }

  const origin = location.origin;
  let editingAccount = null;

  const overlay = document.createElement("div");
  overlay.id = "page-credentials-modal-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "2147483647",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    background: "#1a1f2e",
    border: "1px solid #2a3342",
    borderRadius: "12px",
    padding: "24px",
    width: "500px",
    maxHeight: "420px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
    fontFamily: '"Inter", sans-serif',
    color: "#f0f4f8",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  });

  const title = document.createElement("h3");
  title.textContent = "Saved Accounts";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "16px",
    fontWeight: "600",
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  Object.assign(closeBtn.style, {
    background: "none",
    border: "none",
    color: "#a0a9b8",
    cursor: "pointer",
    fontSize: "20px",
    padding: "0",
    width: "28px",
    height: "28px",
  });

  closeBtn.addEventListener("click", () => {
    overlay.remove();
  });

  header.appendChild(title);
  header.appendChild(closeBtn);

  // List view container
  const listView = document.createElement("div");
  listView.id = "list-view";
  Object.assign(listView.style, {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  });

  // Edit form container
  const editForm = document.createElement("div");
  editForm.id = "edit-form";
  Object.assign(editForm.style, {
    display: "none",
    flexDirection: "column",
    gap: "12px",
  });

  const usernameInput = document.createElement("input");
  usernameInput.type = "text";
  usernameInput.placeholder = "Username";
  Object.assign(usernameInput.style, {
    padding: "8px 12px",
    background: "#252d3d",
    border: "1px solid #2a3342",
    borderRadius: "6px",
    color: "#f0f4f8",
    fontSize: "13px",
  });

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.placeholder = "Password";
  Object.assign(passwordInput.style, {
    padding: "8px 12px",
    background: "#252d3d",
    border: "1px solid #2a3342",
    borderRadius: "6px",
    color: "#f0f4f8",
    fontSize: "13px",
  });

  const formActions = document.createElement("div");
  Object.assign(formActions.style, {
    display: "flex",
    gap: "8px",
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  Object.assign(cancelBtn.style, {
    flex: "1",
    padding: "8px 12px",
    border: "1px solid #2a3342",
    borderRadius: "6px",
    background: "#252d3d",
    color: "#f0f4f8",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "500",
  });

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  Object.assign(saveBtn.style, {
    flex: "1",
    padding: "8px 12px",
    border: "1px solid #00d4ff",
    borderRadius: "6px",
    background: "#00d4ff",
    color: "#0a101c",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: "600",
  });

  cancelBtn.addEventListener("click", () => {
    editForm.style.display = "none";
    listView.style.display = "flex";
    editingAccount = null;
    usernameInput.value = "";
    passwordInput.value = "";
  });

  saveBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!username || !password) {
      alert("Username and password are required");
      return;
    }

    // Delete old if editing
    if (editingAccount) {
      await ipcRenderer.invoke("credentials:delete", origin, editingAccount);
    }

    // Save new
    await ipcRenderer.invoke("credentials:save", origin, { username, password });
    
    // Refresh modal
    const newAccounts = await ipcRenderer.invoke("credentials:list", origin);
    overlay.remove();
    ipcRenderer.emit("show:credentials-modal", null, newAccounts);
  });

  formActions.appendChild(cancelBtn);
  formActions.appendChild(saveBtn);
  editForm.appendChild(usernameInput);
  editForm.appendChild(passwordInput);
  editForm.appendChild(formActions);

  // Render accounts list
  const renderList = () => {
    listView.innerHTML = "";

    if (!accounts || !accounts.length) {
      const empty = document.createElement("div");
      empty.textContent = "No saved accounts.";
      Object.assign(empty.style, {
        textAlign: "center",
        color: "#a0a9b8",
        padding: "24px 0",
        fontSize: "13px",
      });
      listView.appendChild(empty);
    } else {
      const list = document.createElement("div");
      Object.assign(list.style, {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxHeight: "200px",
        overflowY: "auto",
      });

      accounts.forEach((account) => {
        const item = document.createElement("div");
        Object.assign(item.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px",
          background: "#252d3d",
          border: "1px solid #2a3342",
          borderRadius: "8px",
        });

        const username = document.createElement("div");
        username.textContent = account.username;
        Object.assign(username.style, {
          fontWeight: "600",
          fontSize: "13px",
          color: "#f0f4f8",
        });

        const actions = document.createElement("div");
        Object.assign(actions.style, {
          display: "flex",
          gap: "6px",
        });

        const useBtn = document.createElement("button");
        useBtn.textContent = "Use";
        Object.assign(useBtn.style, {
          padding: "4px 10px",
          border: "1px solid #00d4ff",
          background: "transparent",
          color: "#00d4ff",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: "500",
        });

        useBtn.addEventListener("click", () => {
          applyCredentials(account.username, account.password);
          overlay.remove();
        });

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        Object.assign(editBtn.style, {
          padding: "4px 10px",
          border: "1px solid #2a3342",
          background: "transparent",
          color: "#f0f4f8",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: "500",
        });

        editBtn.addEventListener("click", () => {
          editingAccount = account.username;
          usernameInput.value = account.username;
          passwordInput.value = account.password;
          listView.style.display = "none";
          editForm.style.display = "flex";
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        Object.assign(deleteBtn.style, {
          padding: "4px 10px",
          border: "1px solid #ff4757",
          background: "transparent",
          color: "#ff4757",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: "500",
        });

        deleteBtn.addEventListener("click", async () => {
          if (confirm(`Delete account "${account.username}"?`)) {
            await ipcRenderer.invoke("credentials:delete", origin, account.username);
            const newAccounts = await ipcRenderer.invoke("credentials:list", origin);
            overlay.remove();
            ipcRenderer.emit("show:credentials-modal", null, newAccounts);
          }
        });

        actions.appendChild(useBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(username);
        item.appendChild(actions);
        list.appendChild(item);
      });

      listView.appendChild(list);
    }

    // Add New Account button
    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add New Account";
    Object.assign(addBtn.style, {
      padding: "10px 16px",
      border: "1px solid #00d4ff",
      borderRadius: "8px",
      background: "transparent",
      color: "#00d4ff",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: "600",
      marginTop: "8px",
    });

    addBtn.addEventListener("click", () => {
      editingAccount = null;
      usernameInput.value = "";
      passwordInput.value = "";
      listView.style.display = "none";
      editForm.style.display = "flex";
    });

    listView.appendChild(addBtn);
  };

  renderList();

  modal.appendChild(header);
  modal.appendChild(listView);
  modal.appendChild(editForm);

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
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