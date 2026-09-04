// sender.js — DropIt sender logic

const socket = io({
    transports: ["polling", "websocket"],   // polling first (Render.com proxy friendly)
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    path: "/socket.io"
});

let sid       = null;
let file      = null;
let p2p       = null;
let startTime = 0;

// ── Receive-from-mobile mode ──────────────────────────────────────────────────
let isReceiveMode = false;
let mobileSid     = null;
let rcvMetadata   = null;
let rcvReceived   = 0;
let rcvWriter     = null;    // StreamSaver writer (or null → blob fallback)
let rcvChunks     = [];

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

socket.on("connect", () => {
    console.log("[Socket] connected:", socket.id);
    clearError();
});

socket.on("disconnect", (reason) => {
    console.warn("[Socket] disconnected:", reason);
    if (reason !== "io client disconnect") setStatus("⚠️ Connection lost — reconnecting…", "warn");
});

socket.on("connect_error", (err) => {
    console.error("[Socket] connect_error:", err.message);
    setStatus("⚠️ Server unreachable — retrying…", "warn");
});

// ---------------------------------------------------------------------------
// ── SEND MODE (PC → Mobile) ──────────────────────────────────────────────────
// ---------------------------------------------------------------------------

socket.on("session_created", (newSid) => {
    sid = newSid;
    document.getElementById("shareLink").innerText =
        `${window.location.origin}/receive/${sid}`;
    showPanel("sessionInfo");
    hidePanel("dropZone");
    hidePanel("receiveBtn");
    setStatus("⏳ Waiting for receiver to open the link…");
});

socket.on("receiver_joined", async () => {
    setStatus("🔗 Receiver connected — establishing P2P…", "info");

    socket.emit("signal", {
        sid,
        signal: { metadata: { name: file.name, size: file.size, type: file.type } }
    });

    p2p = new PeerConnection(sid,
        (signal) => socket.emit("signal", { sid, signal }),
        handleP2PError
    );

    const offer = await p2p.createOffer();
    socket.emit("signal", { sid, signal: { offer } });

    p2p.dc.onopen  = onDataChannelOpen;
    p2p.dc.onerror = (e) => handleP2PError("dc_error", e);
});

socket.on("signal", async (s) => {
    if (isReceiveMode) {
        await handleReceiveModeSignal(s);
    } else {
        if (!p2p) return;
        if (s.answer)    await p2p.handleAnswer(s.answer);
        if (s.candidate) await p2p.addIce(s.candidate);
    }
});

// ---------------------------------------------------------------------------
// ── RECEIVE MODE (Mobile → PC) ───────────────────────────────────────────────
// ---------------------------------------------------------------------------

function startReceiveFromPhone() {
    isReceiveMode = true;
    hidePanel("dropZone");
    hidePanel("receiveBtn");
    socket.emit("create_receive_session");
}

socket.on("receive_session_created", (desktopSid) => {
    sid = desktopSid;
    const link = `${window.location.origin}/send/${desktopSid}`;
    document.getElementById("shareLink").innerText = link;

    showPanel("sessionInfo");
    // Auto-show QR in receive mode so mobile can scan right away
    buildQR(link);
    document.getElementById("qrContainer").style.display = "block";
    document.getElementById("qrToggleBtn").innerText = "Hide QR";
    qrVisible = true;

    setStatus("📱 Scan the QR with your phone to send a file here…");
});

socket.on("sender_joined", () => {
    setStatus("📲 Phone connected — waiting for file selection…", "info");
});

async function handleReceiveModeSignal(s) {
    if (s.metadata) {
        rcvMetadata = s.metadata;
        rcvReceived = 0;
        rcvChunks   = [];
        startTime   = Date.now();

        document.getElementById("fileSizeText").innerText = formatSize(rcvMetadata.size);
        document.getElementById("rcvFileName").innerText  = rcvMetadata.name;
        showPanel("transferInfo");

        if (streamSaverSupported()) {
            try {
                const stream = streamSaver.createWriteStream(rcvMetadata.name, { size: rcvMetadata.size });
                rcvWriter = stream.getWriter();
            } catch (e) {
                console.warn("[StreamSaver] fallback:", e);
                rcvWriter = null;
            }
        }
        if (!rcvWriter && rcvMetadata.size > 200 * 1024 * 1024) {
            showWarning("⚠️ Large file — buffering in RAM before saving.");
        }
        return;
    }

    if (!p2p) {
        p2p = new PeerConnection(
            mobileSid,
            (sig) => socket.emit("signal", { sid: mobileSid, signal: sig }),
            handleP2PError
        );
    }

    if (s.offer) {
        const answer = await p2p.handleOffer(s.offer);
        socket.emit("signal", { sid: mobileSid, signal: { answer } });

        p2p.pc.ondatachannel = (e) => {
            p2p.dc            = e.channel;
            p2p.dc.binaryType = "arraybuffer";
            p2p.dc.onopen     = () => setStatus("📥 Receiving from phone…", "active");
            p2p.dc.onerror    = (ev) => handleP2PError("dc_error", ev);
            p2p.dc.onmessage  = async (msg) => {
                if (typeof msg.data === "string") {
                    try { if (JSON.parse(msg.data).type === "DONE") await finishReceive(); } catch (_) {}
                    return;
                }
                const chunk = new Uint8Array(msg.data);
                rcvWriter ? await rcvWriter.write(chunk) : rcvChunks.push(chunk);
                rcvReceived += chunk.byteLength;
                updateReceiveUI();
            };
        };
    }

    if (s.candidate) await p2p.addIce(s.candidate);
    if (s.answer)    await p2p.handleAnswer(s.answer);
}

async function finishReceive() {
    if (rcvWriter) {
        await rcvWriter.close();
    } else {
        const blob = new Blob(rcvChunks, { type: rcvMetadata.type || "application/octet-stream" });
        rcvChunks  = [];
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: rcvMetadata.name });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    setStatus("✅ File received and saved!", "success");
    document.getElementById("progressBar").style.width   = "100%";
    document.getElementById("progressPercent").innerText = "100%";
    document.getElementById("etaText").innerText         = "Done";
}

function updateReceiveUI() {
    if (!rcvMetadata) return;
    const pct     = Math.min((rcvReceived / rcvMetadata.size) * 100, 100);
    const elapsed = Math.max((Date.now() - startTime) / 1000, 0.001);
    const speed   = rcvReceived / elapsed;
    const remain  = speed > 0 ? (rcvMetadata.size - rcvReceived) / speed : Infinity;

    document.getElementById("progressBar").style.width   = `${pct}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(pct)}%`;
    const speedEl = document.getElementById("speedText");
    const etaEl   = document.getElementById("etaText");
    if (speedEl) speedEl.innerText = formatSpeed(speed);
    if (etaEl)   etaEl.innerText   = formatETA(remain);
}

// ---------------------------------------------------------------------------
// ── SEND MODE helpers ────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

function handleFile(files) {
    if (!files || files.length === 0) return;
    file = files[0];
    document.getElementById("dropText").innerText = `📄 ${file.name}  (${formatSize(file.size)})`;
    socket.emit("create_session");
}

function onDataChannelOpen() {
    showPanel("transferInfo");
    setStatus("🚀 Transferring…", "active");
    startTime = Date.now();
    startWorkerTransfer();
}

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
            p2p.dc.onbufferedamountlow = () => { p2p.dc.onbufferedamountlow = null; isWaiting = false; processQueue(); };
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
        setStatus("✅ Transfer complete!", "success");
        document.getElementById("progressBar").style.width   = "100%";
        document.getElementById("progressPercent").innerText = "100%";
    }
}

function updateUI(sent) {
    const progress = Math.min((sent / file.size) * 100, 100);
    document.getElementById("progressBar").style.width   = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;

    const elapsed   = (Date.now() - startTime) / 1000;
    const speed     = elapsed > 0 ? sent / elapsed : 0;
    const remaining = speed > 0 ? (file.size - sent) / speed : Infinity;

    const etaEl   = document.getElementById("etaText");
    const speedEl = document.getElementById("speedText");
    if (etaEl)   etaEl.innerText   = formatETA(remaining);
    if (speedEl) speedEl.innerText = formatSpeed(speed);
}

// ---------------------------------------------------------------------------
// ── UI helpers ───────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

let qrVisible = false;
let qrBuilt   = false;

function buildQR(link) {
    if (qrBuilt) return;
    new QRCode(document.getElementById("qrcode"), {
        text: link, width: 172, height: 172,
        colorDark: "#000000", colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
    qrBuilt = true;
}

function toggleQR() {
    const link = document.getElementById("shareLink").innerText;
    if (!qrBuilt) buildQR(link);
    qrVisible = !qrVisible;
    document.getElementById("qrContainer").style.display = qrVisible ? "block" : "none";
    document.getElementById("qrToggleBtn").innerText     = qrVisible ? "Hide QR" : "QR";
}

function copyToClipboard() {
    const link = document.getElementById("shareLink").innerText;
    navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById("copyBtn");
        btn.innerText = "Copied!";
        btn.style.background = "var(--success)";
        setTimeout(() => { btn.innerText = "Copy"; btn.style.background = ""; }, 2000);
    });
}

function showPanel(id) { const el = document.getElementById(id); if (el) el.style.display = ""; }
function hidePanel(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

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

function clearError() {
    const err = document.getElementById("errorCard");
    if (err) err.style.display = "none";
}

function handleP2PError(reason) {
    console.error("[P2P error]", reason);
    const messages = {
        ice_failed:       "❌ P2P connection failed. Both devices may be behind strict firewalls.",
        ice_disconnected: "⚠️ Peer disconnected mid-transfer.",
        dc_error:         "❌ Data channel error. Transfer may be incomplete.",
        worker_error:     "❌ Failed to read the file.",
        worker_crash:     "❌ File reader crashed.",
    };
    const msg = messages[reason] || "❌ An unknown error occurred.";
    const errCard = document.getElementById("errorCard");
    if (errCard) { errCard.querySelector(".error-msg").innerText = msg; errCard.style.display = "block"; }
    setStatus(msg);
}