const { app, BrowserWindow, session } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    // ── Grant camera/media permissions permanently ──────────────────────────
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = [
            'media', 'videoCapture', 'audioCapture',
            'camera', 'microphone', 'notifications',
            'fullscreen', 'pointerLock'
        ];
        const grant = allowed.includes(permission);
        console.log(`[Permission] ${permission} -> ${grant ? 'GRANTED' : 'denied'}`);
        callback(grant);
    });

    // Synchronous permission check (pre-check before request fires)
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowed = [
            'media', 'videoCapture', 'audioCapture',
            'camera', 'microphone', 'fullscreen', 'pointerLock'
        ];
        return allowed.includes(permission);
    });

    // Override CSP headers to allow CDN scripts + fonts
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob: data: mediastream:; " +
                    "media-src 'self' blob: mediastream:; " +
                    "img-src 'self' data: blob:;"
                ]
            }
        });
    });

    // Spoof user-agent so CDNs work correctly
    session.defaultSession.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 650,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: false,              // required for getUserMedia / camera stream
            webSecurity: false,          // allow file:// to load local ./models folder
            allowRunningInsecureContent: true,
        },
        autoHideMenuBar: true,
        backgroundColor: '#0f172a',
        show: false,
    });

    // Show window only when content is ready (removes white flash)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Uncomment line below to open DevTools for debugging:
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
