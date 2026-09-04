// mobile_sender.js — runs on the phone at /send/<session_id>
// Mobile is the SENDER; desktop (which generated the QR) is the RECEIVER.

const socket = io({
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    path: "/socket.io"
});

// Desktop's socket ID comes from the URL, injected by Flask
const desktopSid = window.__SESSION_ID__;

let file      = null;
let p2p       = null;
let startTime = 0;

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

socket.on("connect", () => {
    console.log("[Mobile] connected:", socket.id);
    // Join the desktop's receive room
    socket.emit("join_send_session", desktopSid);
    setStatus("🔗 Connected — choose a file to send", "info");
});

socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") setStatus("⚠️ Connection lost — reconnecting…", "warn");
});

socket.on("connect_error", (err) => {
    console.error("[Socket] error:", err.message);
    setStatus("⚠️ Server unreachable — retrying…", "warn");
});

// Desktop may send ICE candidates / answer back via the signal event
socket.on("signal", async (s) => {
    if (!p2p) return;
    if (s.answer)    await p2p.handleAnswer(s.answer);
    if (s.candidate) await p2p.addIce(s.candidate);
});

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

function handleFile(files) {
    if (!files || files.length === 0) return;
    file = files[0];

    document.getElementById("pickText").innerText    = `📄 ${file.name}`;
    document.getElementById("fileSizeText").innerText = formatSize(file.size);
    document.getElementById("sendFileName").innerText = file.name;

    // Hide pick zone, show progress area
    document.getElementById("pickZone").style.display = "none";
    document.getElementById("transferInfo").style.display = "";

    setStatus("🔒 Establishing secure P2P connection…", "info");
    startSend();
}

// ---------------------------------------------------------------------------
// Initiating the transfer
// ---------------------------------------------------------------------------

async function startSend() {
    // 1. Send metadata so desktop can prepare its write stream
    socket.emit("signal", {
        sid: desktopSid,
        signal: { metadata: { name: file.name, size: file.size, type: file.type } }
    });

    // 2. Create WebRTC peer — mobile is the offerer
    p2p = new PeerConnection(
        desktopSid,
        (sig) => socket.emit("signal", { sid: desktopSid, signal: sig }),
        handleP2PError
    );

    const offer = await p2p.createOffer();
    socket.emit("signal", { sid: desktopSid, signal: { offer } });

    // 3. Once DataChannel opens, start streaming
    p2p.dc.onopen  = onDataChannelOpen;
    p2p.dc.onerror = (e) => handleP2PError("dc_error");
}

function onDataChannelOpen() {
    setStatus("🚀 Sending…", "active");
    startTime = Date.now();
    startWorkerTransfer();
}

// ---------------------------------------------------------------------------
// Chunked transfer (same proven logic as desktop sender)
// ---------------------------------------------------------------------------

function startWorkerTransfer() {
    const worker      = new Worker("/static/worker.js");
    const CHUNK_SIZE  = 64 * 1024;
    const BUFFER_HIGH = 4 * 1024 * 1024;

    worker.postMessage({ file, chunkSize: CHUNK_SIZE });

    let isWaiting = false;
    const queue   = [];

    worker.onmessage = (e) => {
        if (e.data.done)  { drainThenFinish(); return; }
        if (e.data.error) { handleP2PError("worker_error"); return; }
        queue.push(e.data);
        if (!isWaiting) processQueue();
    };
    worker.onerror = () => handleP2PError("worker_crash");

    function processQueue() {
        if (queue.length === 0) { isWaiting = false; return; }

        if (p2p.dc.bufferedAmount > BUFFER_HIGH) {
            isWaiting = true;
            p2p.dc.onbufferedamountlow = () => {
                p2p.dc.onbufferedamountlow = null;
                isWaiting = false;
                processQueue();
            };
            return;
        }

        const data = queue.shift();
        p2p.dc.send(data.buffer);
        updateUI(data.offset + data.buffer.byteLength);

        if (queue.length % 10 === 0) setTimeout(processQueue, 0);
        else processQueue();
    }

    function drainThenFinish() {
        if (p2p.dc.bufferedAmount > 0) { setTimeout(drainThenFinish, 50); return; }
        p2p.dc.send(JSON.stringify({ type: "DONE" }));
        setStatus("✅ Sent! File is downloading on the desktop.", "success");
        document.getElementById("progressBar").style.width   = "100%";
        document.getElementById("progressPercent").innerText = "100%";
        document.getElementById("etaText").innerText         = "Done";
    }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateUI(sent) {
    const pct     = Math.min((sent / file.size) * 100, 100);
    const elapsed = Math.max((Date.now() - startTime) / 1000, 0.001);
    const speed   = sent / elapsed;
    const remain  = speed > 0 ? (file.size - sent) / speed : Infinity;

    document.getElementById("progressBar").style.width   = `${pct}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(pct)}%`;
    const speedEl = document.getElementById("speedText");
    const etaEl   = document.getElementById("etaText");
    if (speedEl) speedEl.innerText = formatSpeed(speed);
    if (etaEl)   etaEl.innerText   = formatETA(remain);
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

function handleP2PError(reason) {
    console.error("[P2P error]", reason);
    const messages = {
        ice_failed:       "❌ P2P connection failed. Try moving closer to your router.",
        ice_disconnected: "⚠️ Desktop disconnected.",
        dc_error:         "❌ Data channel error.",
        worker_error:     "❌ Could not read the file.",
        worker_crash:     "❌ File reader crashed.",
    };
    const msg = messages[reason] || "❌ Unknown error.";
    const errCard = document.getElementById("errorCard");
    if (errCard) { errCard.querySelector(".error-msg").innerText = msg; errCard.style.display = "block"; }
    setStatus(msg);
}
