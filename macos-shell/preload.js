const { contextBridge, ipcRenderer } = require("electron");

const OVERLAY_ID = "repairsync-native-loading-overlay";

function ensureLoadingOverlay(mode = "loading", detail = "") {
  if (typeof document === "undefined") return;
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", mode === "error" ? "alert" : "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <style>
        #${OVERLAY_ID} {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          place-items: center;
          background: #ffffff;
          color: #111827;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${OVERLAY_ID} .card {
          width: min(480px, calc(100vw - 48px));
          padding: 34px;
          text-align: center;
        }
        #${OVERLAY_ID} img { width: 72px; height: 72px; object-fit: contain; border-radius: 16px; }
        #${OVERLAY_ID} h1 { margin: 18px 0 10px; font-size: 27px; line-height: 1.15; letter-spacing: 0; }
        #${OVERLAY_ID} p { margin: 0 auto; max-width: 380px; color: #4b5563; font-size: 14px; line-height: 1.5; font-weight: 600; }
        #${OVERLAY_ID} .detail { margin-top: 12px; color: #6b7280; font-size: 12px; overflow-wrap: anywhere; }
        #${OVERLAY_ID} .spinner {
          width: 32px;
          height: 32px;
          margin: 22px auto 0;
          border: 4px solid #e5e7eb;
          border-top-color: #2563eb;
          border-radius: 999px;
          animation: spin 0.85s linear infinite;
        }
        #${OVERLAY_ID} .actions {
          display: none;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
          margin-top: 24px;
        }
        #${OVERLAY_ID}[data-mode="error"] .spinner { display: none; }
        #${OVERLAY_ID}[data-mode="error"] .actions { display: flex; }
        #${OVERLAY_ID} button {
          appearance: none;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #ffffff;
          color: #111827;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          padding: 11px 15px;
          cursor: pointer;
        }
        #${OVERLAY_ID} button.primary { border-color: #2563eb; background: #2563eb; color: white; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <main class="card">
        <img src="https://repairsync.qld.one/RepairSync_logo.png" alt="">
        <h1></h1>
        <p class="message"></p>
        <p class="detail"></p>
        <div class="spinner" aria-label="Loading"></div>
        <div class="actions">
          <button class="primary" type="button" data-action="reload">Try Again</button>
          <button type="button" data-action="browser">Open in Browser</button>
        </div>
      </main>
    `;
    document.documentElement.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      const button = event.target && event.target.closest ? event.target.closest("button[data-action]") : null;
      if (!button) return;
      if (button.dataset.action === "reload") ipcRenderer.send("app:reload");
      if (button.dataset.action === "browser") ipcRenderer.send("app:open-browser");
    });
  }

  overlay.dataset.mode = mode;
  overlay.querySelector("h1").textContent = mode === "error" ? "RepairSync could not finish loading" : "Opening RepairSync";
  overlay.querySelector(".message").textContent =
    mode === "error"
      ? "The app window is working, but RepairSync did not render correctly. Check your connection, then try again."
      : "Loading your RepairSync workspace.";
  overlay.querySelector(".detail").textContent = detail || "";
}

function hideLoadingOverlay() {
  const overlay = typeof document === "undefined" ? null : document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();
}

function installMacBridge() {
  if (typeof window === "undefined") return;
  document.documentElement.classList.add("repairsync-macos-wrapper");

  window.RepairSyncNativeOpenExternalUrl = function openExternalUrl(url) {
    if (!url) return false;
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  };

  window.RepairSyncMac = {
    isDesktopShell: true,
    platform: "macos",
    reloadApp() {
      ipcRenderer.send("app:reload");
    },
    openAppInBrowser() {
      ipcRenderer.send("app:open-browser");
    },
    async showNotification(payload) {
      return ipcRenderer.invoke("notification:show", payload || {});
    },
    async notificationsSupported() {
      return ipcRenderer.invoke("notification:is-supported");
    }
  };

  window.dispatchEvent(new CustomEvent("RepairSyncNativeWrapperReady", {
    detail: { platform: "macos", supportsNotifications: true, supportsAppleIAP: false }
  }));
}

function initialize() {
  ensureLoadingOverlay("loading");
  installMacBridge();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}

ipcRenderer.on("repairsync-loading:hide", () => hideLoadingOverlay());
ipcRenderer.on("repairsync-loading:error", (_event, detail) => ensureLoadingOverlay("error", detail || ""));
ipcRenderer.on("repairsync:deep-link", (_event, url) => {
  window.dispatchEvent(new CustomEvent("RepairSyncDeepLink", { detail: { url } }));
});
ipcRenderer.on("iap:completed", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("RepairSyncIAPPurchaseCompleted", { detail }));
});
ipcRenderer.on("iap:failed", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("RepairSyncIAPPurchaseFailed", { detail }));
});

contextBridge.exposeInMainWorld("RepairSyncDesktop", {
  platform: "macos",
  reloadApp() {
    ipcRenderer.send("app:reload");
  },
  openAppInBrowser() {
    ipcRenderer.send("app:open-browser");
  },
  showNotification(payload) {
    return ipcRenderer.invoke("notification:show", payload || {});
  },
  notificationsSupported() {
    return ipcRenderer.invoke("notification:is-supported");
  }
});

contextBridge.exposeInMainWorld("RepairSyncIAP", {
  isAvailable: ipcRenderer.sendSync("iap:is-available-sync"),
  purchase(productId) {
    if (!productId) return false;
    ipcRenderer.send("iap:purchase", productId);
    return true;
  },
  restore() {
    ipcRenderer.send("iap:restore");
    return true;
  }
});
