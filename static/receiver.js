// receiver.js — DropIt receiver logic

const socket = io({
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    path: "/socket.io"
});

// Session ID is injected by the Flask template; fall back to URL parsing
let sid      = (typeof window.__SESSION_ID__ !== "undefined" && window.__SESSION_ID__)
               ? window.__SESSION_ID__
               : window.location.pathname.split("/").pop();
let p2p      = null;
let metadata = null;
let received = 0;
let startTime = 0;

// StreamSaver writer (used when SW is supported, i.e. non-iOS)
let streamWriter = null;
// In-memory fallback chunks (iOS / unsupported browsers)
let memChunks = [];
let useStreamSaver = false;

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

socket.on("connect", () => {
    socket.emit("join_session", sid);
    setStatus("🔒 Secure handshake in progress…");
});

socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") {
        setStatus("⚠️ Connection lost — reconnecting…", "warn");
    }
});

socket.on("signal", async (signal) => {

    // ── 1. Metadata arrives first ──────────────────────────────────────────
    if (signal.metadata) {
        metadata = signal.metadata;
        received  = 0;
        memChunks = [];
        startTime = Date.now();

        document.getElementById("fileName").innerText = metadata.name;
        document.getElementById("fileSize").innerText = formatSize(metadata.size);
        document.getElementById("transferInfo").style.display = "block";

        useStreamSaver = streamSaverSupported();

        if (useStreamSaver) {
            // StreamSaver: streams directly to disk — no RAM buffering
            try {
                const fileStream = streamSaver.createWriteStream(metadata.name, {
                    size: metadata.size
                });
                streamWriter = fileStream.getWriter();
            } catch (e) {
                console.warn("[StreamSaver] failed to init, falling back to blob:", e);
                useStreamSaver = false;
            }
        }

        if (!useStreamSaver) {
            // Show iOS/unsupported-browser notice for large files
            if (metadata.size > 200 * 1024 * 1024) {
                showWarning(
                    "⚠️ Large file on this browser — the file will buffer in memory before downloading. " +
                    "Make sure you have enough free RAM, or use a desktop browser for files over 200 MB."
                );
            }
        }

        setStatus("🔐 Link secured — waiting for P2P connection…", "info");
        return;
    }

    // ── 2. WebRTC signalling ───────────────────────────────────────────────
    if (!p2p) {
        p2p = new PeerConnection(
            sid,
            (s) => socket.emit("signal", { sid, signal: s }),
            handleP2PError
        );
    }

    if (signal.offer) {
        const answer = await p2p.handleOffer(signal.offer);
        socket.emit("signal", { sid, signal: { answer } });

        p2p.pc.ondatachannel = (e) => {
            p2p.dc            = e.channel;
            p2p.dc.binaryType = "arraybuffer";

            p2p.dc.onopen  = () => setStatus("📥 Receiving file…", "active");
            p2p.dc.onerror = (ev) => handleP2PError("dc_error", ev);

            p2p.dc.onmessage = async (msg) => {
                // ── String control messages ──
                if (typeof msg.data === "string") {
                    try {
                        const payload = JSON.parse(msg.data);
                        if (payload.type === "DONE") {
                            await finishDownload();
                        }
                    } catch (_) {}
                    return;
                }

                // ── Binary chunk ──
                const chunk = new Uint8Array(msg.data);

                if (useStreamSaver && streamWriter) {
                    await streamWriter.write(chunk);
                } else {
                    memChunks.push(chunk);
                }

                received += chunk.byteLength;
                updateUI();
            };
        };
    }

    if (signal.candidate) await p2p.addIce(signal.candidate);
    if (signal.answer)    await p2p.handleAnswer(signal.answer);
});

// ---------------------------------------------------------------------------
// Download finalisation
// ---------------------------------------------------------------------------

async function finishDownload() {
    if (useStreamSaver && streamWriter) {
        await streamWriter.close();
    } else {
        // Build Blob and trigger <a download> — works on iOS Safari
        const blob = new Blob(memChunks, { type: metadata.type || "application/octet-stream" });
        memChunks  = []; // free memory ASAP

        const url = URL.createObjectURL(blob);
        const a   = document.createElement("a");
        a.href     = url;
        a.download = metadata.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Give the browser a moment to start the download before revoking
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    setStatus("✅ Download complete!", "success");
    document.getElementById("progressBar").style.width   = "100%";
    document.getElementById("progressPercent").innerText = "100%";
    document.getElementById("etaText").innerText         = "Done";
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateUI() {
    if (!metadata) return;
    const progress = Math.min((received / metadata.size) * 100, 100);
    document.getElementById("progressBar").style.width   = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;

    const elapsed   = (Date.now() - startTime) / 1000;
    const speed     = elapsed > 0 ? received / elapsed : 0;
    const remaining = speed > 0 ? (metadata.size - received) / speed : Infinity;

    const speedEl = document.getElementById("speedText");
    const etaEl   = document.getElementById("etaText");
    if (speedEl) speedEl.innerText = formatSpeed(speed);
    if (etaEl)   etaEl.innerText   = formatETA(remaining);
}

function setStatus(msg, type = "normal") {
    const el = document.getElementById("statusText");
    if (!el) return;
    const pulse = type === "active"  ? '<span class="pulse"></span>'
                : type === "success" ? '<span class="pulse pulse--success"></span>'
                : type === "warn"    ? '<span class="pulse pulse--warn"></span>'
                : type === "info"    ? '<span class="pulse pulse--info"></span>'
                : '';
    el.innerHTML = pulse + msg;
}

function showWarning(msg) {
    const w = document.getElementById("warningCard");
    if (!w) return;
    w.querySelector(".warning-msg").innerText = msg;
    w.style.display = "block";
}

function handleP2PError(reason) {
    console.error("[P2P error]", reason);
    const messages = {
        ice_failed:      "❌ P2P connection failed. Both peers may be behind strict firewalls.",
        ice_disconnected:"⚠️ Sender disconnected mid-transfer.",
        dc_error:        "❌ Data channel error. Transfer may be incomplete.",
    };
    const msg = messages[reason] || "❌ An unknown P2P error occurred.";
    const errCard = document.getElementById("errorCard");
    if (errCard) {
        errCard.querySelector(".error-msg").innerText = msg;
        errCard.style.display = "block";
    }
    setStatus(msg);
}