// sender.js — DropIt sender logic

const socket = io({
    transports: ["polling", "websocket"],   // polling first (Render.com proxy friendly)
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    path: "/socket.io"
});

let sid      = null;
let file     = null;
let p2p      = null;
let startTime = 0;

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

socket.on("connect", () => {
    console.log("[Socket] connected:", socket.id);
    clearError();
});

socket.on("disconnect", (reason) => {
    console.warn("[Socket] disconnected:", reason);
    if (reason !== "io client disconnect") {
        setStatus("⚠️ Connection lost — reconnecting…", "warn");
    }
});

socket.on("connect_error", (err) => {
    console.error("[Socket] connect_error:", err.message);
    setStatus("⚠️ Server unreachable — retrying…", "warn");
});

socket.on("session_created", (newSid) => {
    sid = newSid;
    document.getElementById("shareLink").innerText =
        `${window.location.origin}/receive/${sid}`;
    document.getElementById("sessionInfo").style.display  = "block";
    document.getElementById("dropZone").style.display     = "none";
    setStatus("⏳ Waiting for receiver to open the link…");
});

socket.on("receiver_joined", async () => {
    setStatus("🔗 Receiver connected — establishing P2P…", "info");

    // Send metadata before the WebRTC handshake so the receiver can
    // prepare its write stream immediately.
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

    // Show selected file info in drop zone
    document.getElementById("dropText").innerText = `📄 ${file.name}  (${formatSize(file.size)})`;

    socket.emit("create_session");
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

function onDataChannelOpen() {
    document.getElementById("transferInfo").style.display = "block";
    setStatus("🚀 Transferring…", "active");
    startTime = Date.now();
    startWorkerTransfer();
}

function startWorkerTransfer() {
    const worker     = new Worker("/static/worker.js");
    const CHUNK_SIZE  = 64 * 1024;         // 64 KB — ideal WebRTC MTU
    const BUFFER_HIGH = 4 * 1024 * 1024;   // 4 MB high-water mark

    worker.postMessage({ file, chunkSize: CHUNK_SIZE });

    let isWaiting = false;
    const queue   = [];

    worker.onmessage = (e) => {
        if (e.data.done) {
            // Drain remaining queue before sending DONE sentinel
            drainThenFinish();
            return;
        }
        if (e.data.error) {
            handleP2PError("worker_error");
            return;
        }
        queue.push(e.data);
        if (!isWaiting) processQueue();
    };

    worker.onerror = () => handleP2PError("worker_crash");

    function processQueue() {
        if (queue.length === 0) {
            isWaiting = false;
            return;
        }

        if (p2p.dc.bufferedAmount > BUFFER_HIGH) {
            isWaiting = true;
            // Back-pressure: wait for the low-water event (set to 512 KB in webrtc.js)
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

        // Yield to browser every 10 chunks to keep the page responsive
        if (queue.length % 10 === 0) {
            setTimeout(processQueue, 0);
        } else {
            processQueue();
        }
    }

    function drainThenFinish() {
        // Wait until the send buffer is fully flushed before sending DONE
        if (p2p.dc.bufferedAmount > 0) {
            setTimeout(drainThenFinish, 50);
            return;
        }
        p2p.dc.send(JSON.stringify({ type: "DONE" }));
        setStatus("✅ Transfer complete!", "success");
        document.getElementById("progressBar").style.width = "100%";
        document.getElementById("progressPercent").innerText = "100%";
    }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateUI(sent) {
    const progress = Math.min((sent / file.size) * 100, 100);
    document.getElementById("progressBar").style.width     = `${progress}%`;
    document.getElementById("progressPercent").innerText   = `${Math.round(progress)}%`;

    const elapsed   = (Date.now() - startTime) / 1000;
    const speed     = elapsed > 0 ? sent / elapsed : 0;
    const remaining = speed > 0 ? (file.size - sent) / speed : Infinity;

    const etaEl   = document.getElementById("etaText");
    const speedEl = document.getElementById("speedText");
    if (etaEl)   etaEl.innerText   = formatETA(remaining);
    if (speedEl) speedEl.innerText = formatSpeed(speed);
}

function setStatus(msg, type = "normal") {
    const el = document.getElementById("statusText");
    if (!el) return;
    const pulse = type === "active"  ? '<span class="pulse"></span>'
                : type === "success" ? '<span class="pulse pulse--success"></span>'
                : type === "warn"    ? '<span class="pulse pulse--warn"></span>'
                : '';
    el.innerHTML = pulse + msg;
}

function clearError() {
    const err = document.getElementById("errorCard");
    if (err) err.style.display = "none";
}

function handleP2PError(reason) {
    console.error("[P2P error]", reason);
    const messages = {
        ice_failed:      "❌ P2P connection failed. Both peers may be behind strict firewalls. Try again.",
        ice_disconnected:"⚠️ Peer disconnected mid-transfer.",
        dc_error:        "❌ Data channel error. Transfer may be incomplete.",
        worker_error:    "❌ Failed to read the file.",
        worker_crash:    "❌ File reader crashed.",
    };
    const msg = messages[reason] || "❌ An unknown error occurred.";
    const errCard = document.getElementById("errorCard");
    if (errCard) {
        errCard.querySelector(".error-msg").innerText = msg;
        errCard.style.display = "block";
    }
    setStatus(msg);
}