/**
 * fileHandler.js — shared utilities for DropIt
 * Loaded by both sender.html and receiver.html.
 */

/**
 * Format a byte count as a human-readable file size string.
 * @param {number} bytes
 * @returns {string}  e.g. "4.2 MB"
 */
function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const labels = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), labels.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + labels[i];
}

/**
 * Format a bytes-per-second speed value.
 * @param {number} bytesPerSecond
 * @returns {string}  e.g. "12.4 MB/s"
 */
function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s';
    const k = 1024;
    const labels = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(k)), labels.length - 1);
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + labels[i];
}

/**
 * Format a remaining-seconds value as a readable ETA string.
 * @param {number} seconds
 * @returns {string}  e.g. "2m 14s" or "45s"
 */
function formatETA(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
}

/**
 * Detect whether the current browser supports StreamSaver.js.
 * StreamSaver requires a Service Worker, which is blocked on iOS Safari.
 * @returns {boolean}
 */
function streamSaverSupported() {
    const ua = navigator.userAgent;
    // iOS Safari (and Chrome/Firefox on iOS which also use WebKit) does NOT support SW
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    if (isIOS) return false;
    // Service worker must be available
    if (!('serviceWorker' in navigator)) return false;
    return true;
}