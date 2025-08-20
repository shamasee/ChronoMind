/**
 * ChronoMind AI Service Worker (sw.js)
 * Version: 8.1.2 (State Management & Bug Fix Release)
 * Description: Fully manages timer state including sessionStartTime to prevent data loss on page refresh.
 */

const CACHE_NAME = 'chronomind-v8.1.2'; // Updated cache name to force refresh
const APP_SHELL_URLS = [
    '/ChronoMind/',
    '/ChronoMind/index.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Teko:wght@300;400;600&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// --- INSTALL & CACHE ---
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            console.log('Service Worker: Caching App Shell');
            return cache.addAll(APP_SHELL_URLS);
        })
    );
});

// --- ACTIVATE & CLEAN UP OLD CACHES ---
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('Service Worker: Clearing old cache');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// --- FETCH (Offline First Strategy) ---
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
});


// --- BACKGROUND TIMER LOGIC ---

let timerInterval = null;
// --- BUG FIX: Add sessionStartTime to the authoritative state ---
let state = {
    isRunning: false,
    mode: 'stopwatch',
    startTime: 0,
    elapsedTime: 0,
    timerDuration: 0,
    displayTime: 0,
    sessionStartTime: null // <-- CRITICAL ADDITION
};

function formatTimeForNotification(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function showPersistentNotification() {
    if (!state.isRunning) {
        self.registration.getNotifications({ tag: 'chronomind-timer' }).then(notifications => {
            notifications.forEach(notification => notification.close());
        });
        return;
    }

    const title = state.mode === 'stopwatch' ? 'Stopwatch Running' : 'Timer Running';
    const body = `Current Time: ${formatTimeForNotification(state.displayTime)}`;

    self.registration.showNotification(title, {
        body: body,
        tag: 'chronomind-timer',
        icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Icon-Stopwatch.svg/192px-Icon-Stopwatch.svg.png',
        silent: true,
        renotify: false,
        actions: [
            { action: 'stop', title: 'Stop' }
        ]
    });
}

function tick() {
    state.elapsedTime = performance.now() - state.startTime;
    state.displayTime = state.mode === 'stopwatch' ? state.elapsedTime : state.timerDuration - state.elapsedTime;
    
    if (state.displayTime < 0) state.displayTime = 0;

    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'tick', state });
        });
    });

    showPersistentNotification();

    if (state.mode === 'timer' && state.displayTime <= 0) {
        stopTimer(true);
    }
}

function startTimer(initialState) {
    if (state.isRunning) return;
    // --- BUG FIX: The entire initial state, including sessionStartTime, is now managed here ---
    state = { ...state, ...initialState, isRunning: true };
    state.startTime = performance.now() - state.elapsedTime;
    timerInterval = setInterval(tick, 1000);
    console.log('Service Worker: Timer started with state:', state);
}

function stopTimer(isFinished = false) {
    if (!state.isRunning) return;
    state.isRunning = false;
    if (state.startTime > 0) {
        state.elapsedTime = performance.now() - state.startTime;
    }
    clearInterval(timerInterval);
    timerInterval = null;
    
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'stopped', state, isFinished });
        });
    });

    if (isFinished) {
        self.registration.showNotification('Timer Finished!', {
            body: 'Your timer has completed.',
            tag: 'chronomind-timer-finished',
            icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Icon-Stopwatch.svg/192px-Icon-Stopwatch.svg.png',
        });
    }
    
    showPersistentNotification();
    console.log('Service Worker: Timer stopped with final state:', state);
}

function resetTimer() {
    stopTimer();
    // --- BUG FIX: Reset sessionStartTime as well ---
    state = {
        isRunning: false,
        mode: 'stopwatch',
        startTime: 0,
        elapsedTime: 0,
        timerDuration: 0,
        displayTime: 0,
        sessionStartTime: null // <-- CRITICAL RESET
    };
     self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type: 'reset', state });
        });
    });
    console.log('Service Worker: Timer reset.');
}

// --- MESSAGE & NOTIFICATION EVENT LISTENERS ---

self.addEventListener('message', event => {
    const { command, data } = event.data;
    switch (command) {
        case 'start':
            startTimer(data);
            break;
        case 'stop':
            stopTimer();
            break;
        case 'reset':
            resetTimer();
            break;
        case 'getState':
             if (event.source) {
                event.source.postMessage({ type: 'state', state });
             }
            break;
    }
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'stop') {
        stopTimer(event.notification.tag === 'chronomind-timer' && state.mode === 'timer' && state.displayTime <= 0);
    }

    const appUrl = '/ChronoMind/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            for (const client of clients) {
                if (client.url.endsWith(appUrl) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(appUrl);
            }
        })
    );
});
