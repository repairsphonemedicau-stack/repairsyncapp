const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, Notification, ipcMain, shell, session, inAppPurchase } = require("electron");

const APP_NAME = "RepairSync";
const APP_ORIGIN = "https://repairsync.qld.one";
const APP_URL = `${APP_ORIGIN}/?wrapper=macos`;
const CUSTOM_PROTOCOL = "repairsync";
const LOADING_PAGE = path.join(__dirname, "loading.html");
const ICON_PATH = path.join(__dirname, "build", "icon.png");
const LOAD_TIMEOUT_MS = 25000;
const BLANK_CHECK_DELAY_MS = 5000;
const RENDER_POLL_INTERVAL_MS = 500;
const APPLE_IAP_PRODUCT_IDS = new Set([
  "com.nemeanpartnersptyltd.repairsyncapp.starter.monthly.s",
  "com.nemeanpartnersptyltd.repairsyncapp.starter.yearly.s",
  "com.nemeanpartnersptyltd.repairsyncapp.pro.monthly",
  "com.nemeanpartnersptyltd.repairsyncapp.pro.yearly"
]);

let mainWindow = null;
let pendingDeepLink = null;
let loadToken = 0;
let isQuitting = false;
let pendingRestore = false;

app.commandLine.appendSwitch("disable-http-cache");
app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function isAllowedInAppUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "repairsync.qld.one" ||
      host === "www.repairsync.qld.one" ||
      host === "repairsync.ai.studio" ||
      host === "repairsync-distributed-app-854444042755.us-west1.run.app" ||
      host === "gen-lang-client-0477801246.firebaseapp.com" ||
      host.endsWith(".firebaseapp.com") ||
      host === "accounts.google.com" ||
      host.endsWith(".accounts.google.com") ||
      host === "appleid.apple.com"
    );
  } catch {
    return false;
  }
}

function appUrlWithRefresh() {
  const parsed = new URL(APP_URL);
  parsed.searchParams.set("macWrapperReload", String(Date.now()));
  return parsed.toString();
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about", label: `About ${APP_NAME}` },
        { type: "separator" },
        { label: `Show ${APP_NAME}`, accelerator: "CommandOrControl+0", click: focusMainWindow },
        { label: "Reload RepairSync", accelerator: "CommandOrControl+R", click: () => loadMainApp(true) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: `Quit ${APP_NAME}`, accelerator: "CommandOrControl+Q", click: () => {
          isQuitting = true;
          app.quit();
        } }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showLoading() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(LOADING_PAGE).catch(() => {});
}

function scheduleRenderCheck(token) {
  setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed() || token !== loadToken) return;
    try {
      const result = await mainWindow.webContents.executeJavaScript(`
        (function () {
          var text = (document.body && document.body.innerText || "").trim();
          var rootChildren = document.getElementById("root") ? document.getElementById("root").childElementCount : 0;
          var href = location.href;
          return { href: href, textLength: text.length, rootChildren: rootChildren, title: document.title };
        })();
      `);
      const stillBlank = !result || result.href === "about:blank" || (result.textLength < 8 && result.rootChildren === 0);
      if (stillBlank) {
        loadMainApp(true);
      }
    } catch {
      if (token === loadToken) loadMainApp(true);
    }
  }, BLANK_CHECK_DELAY_MS);
}

async function loadMainApp(forceRefresh = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const token = ++loadToken;
  await showLoading();
  const url = forceRefresh ? appUrlWithRefresh() : APP_URL;
  const minimumLoading = new Promise((resolve) => setTimeout(resolve, 700));
  try {
    await Promise.race([
      mainWindow.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RepairSync load timed out.")), LOAD_TIMEOUT_MS))
    ]);
    await minimumLoading;
    if (token === loadToken && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("repairsync-loading:hide");
      scheduleRenderCheck(token);
    }
  } catch (error) {
    if (token === loadToken && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("repairsync-loading:error", error.message || String(error));
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: APP_NAME,
    icon: ICON_PATH,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedInAppUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: mainWindow,
          modal: false,
          title: APP_NAME,
          webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedInAppUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return;
    if (!validatedURL || validatedURL === "about:blank") return;
    mainWindow?.webContents.send("repairsync-loading:error", errorDescription || "RepairSync failed to load.");
  });

  loadMainApp(false);
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    const allowed = isAllowedInAppUrl(url) && ["notifications", "clipboard-read", "media"].includes(permission);
    callback(Boolean(allowed));
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
      }
    });
  });
}

function canUseAppleIAP() {
  return process.mas === true && inAppPurchase.canMakePayments();
}

function getReceiptData() {
  const receiptUrl = inAppPurchase.getReceiptURL();
  if (!receiptUrl || !fs.existsSync(receiptUrl)) {
    return "";
  }
  return fs.readFileSync(receiptUrl).toString("base64");
}

function dispatchIAPSuccess(transaction, restored = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const productId = transaction.payment && transaction.payment.productIdentifier;
  const receiptData = getReceiptData();
  if (!receiptData) {
    dispatchIAPFailure(productId, "Apple receipt was not available.");
    return;
  }
  mainWindow.webContents.send("iap:completed", {
    productId,
    transactionId: transaction.transactionIdentifier || "",
    originalTransactionId: transaction.originalTransactionIdentifier || null,
    receiptData,
    restored
  });
}

function dispatchIAPFailure(productId, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("iap:failed", {
    productId: productId || null,
    message: message || "Apple purchase failed."
  });
}

function configureAppleIAP() {
  inAppPurchase.on("transactions-updated", (_event, transactions) => {
    for (const transaction of transactions) {
      const productId = transaction.payment && transaction.payment.productIdentifier;
      switch (transaction.transactionState) {
        case "purchased":
          dispatchIAPSuccess(transaction, false);
          inAppPurchase.finishTransactionByDate(transaction.transactionDate);
          break;
        case "restored":
          dispatchIAPSuccess(transaction, true);
          inAppPurchase.finishTransactionByDate(transaction.transactionDate);
          break;
        case "failed":
          dispatchIAPFailure(productId, transaction.errorMessage || "Apple purchase failed.");
          inAppPurchase.finishTransactionByDate(transaction.transactionDate);
          break;
        case "deferred":
          dispatchIAPFailure(productId, "Apple purchase is pending approval.");
          break;
        default:
          break;
      }
    }
    pendingRestore = false;
  });
}

function handleDeepLink(url) {
  pendingDeepLink = url;
  focusMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("repairsync:deep-link", url);
  }
}

ipcMain.on("app:reload", () => loadMainApp(true));
ipcMain.on("app:open-browser", () => shell.openExternal(APP_URL));
ipcMain.on("iap:is-available-sync", (event) => {
  event.returnValue = canUseAppleIAP();
});
ipcMain.on("iap:purchase", async (_event, productId) => {
  if (!canUseAppleIAP()) {
    dispatchIAPFailure(productId, "Apple in-app purchases are only available in the Mac App Store build.");
    return;
  }
  if (!APPLE_IAP_PRODUCT_IDS.has(productId)) {
    dispatchIAPFailure(productId, "Unknown Apple subscription product.");
    return;
  }
  try {
    const products = await inAppPurchase.getProducts([productId]);
    if (!products.some((product) => product.productIdentifier === productId)) {
      dispatchIAPFailure(productId, "Apple subscription product is not available yet.");
      return;
    }
    const started = await inAppPurchase.purchaseProduct(productId, { quantity: 1 });
    if (!started) {
      dispatchIAPFailure(productId, "Apple purchase could not be started.");
    }
  } catch (error) {
    dispatchIAPFailure(productId, error.message || String(error));
  }
});
ipcMain.on("iap:restore", () => {
  if (!canUseAppleIAP()) {
    dispatchIAPFailure(null, "Apple subscription restore is only available in the Mac App Store build.");
    return;
  }
  pendingRestore = true;
  inAppPurchase.restoreCompletedTransactions();
  setTimeout(() => {
    if (!pendingRestore) return;
    pendingRestore = false;
    dispatchIAPFailure(null, "No Apple purchases were available to restore.");
  }, 12000);
});
ipcMain.handle("notification:show", (_event, payload = {}) => {
  if (!Notification.isSupported()) return false;
  const title = String(payload.title || APP_NAME);
  const body = String(payload.body || "");
  new Notification({ title, body, icon: ICON_PATH }).show();
  return true;
});
ipcMain.handle("notification:is-supported", () => Notification.isSupported());

app.on("second-instance", (_event, argv) => {
  const urlArg = argv.find((arg) => arg.startsWith(`${CUSTOM_PROTOCOL}://`));
  if (urlArg) handleDeepLink(urlArg);
  focusMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.whenReady().then(() => {
  app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL);
  configurePermissions();
  configureAppleIAP();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    focusMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
