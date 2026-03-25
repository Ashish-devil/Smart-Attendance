const CACHE_NAME = 'attendance-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js',

  // Pre-cache model files so they're loaded quickly and available offline
  './models/ssd_mobilenetv1_model-weights_manifest.json',
  './models/ssd_mobilenetv1_model-shard1',
  './models/ssd_mobilenetv1_model-shard2',
  './models/face_landmark_68_model-weights_manifest.json',
  './models/face_landmark_68_model-shard1',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model-shard1',
  './models/face_recognition_model-shard2'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
