let sessionId = null;
let selectedFile = null;
let rtc = null;
let isTransferring = false;
let currentChunkIndex = 0;
let fileWorker = null;
const fileHandler = new FileHandler();

// Initialize Drag & Drop
const dropZone = document.getElementById("dropZone");
if (dropZone) {
    ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add("active"), false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove("active"), false);
    });

    dropZone.addEventListener("drop", e => {
        onFileSelected(e.dataTransfer.files[0]);
    }, false);
}

async function onFileSelected(file) {
    if (!file) return;
    selectedFile = file;
    console.log("File selected:", selectedFile.name);
    
    const fileInfo = document.getElementById("fileInfo");
    if (fileInfo) fileInfo.innerText = `Selected: ${selectedFile.name} (${formatSize(selectedFile.size)})`;
    if (dropZone) dropZone.style.display = "none";

    console.log("Emitting create_session...");
    socket.emit("create_session", {
        metadata: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
    });
}

// Global Handlers
socket.on("receiver_joined", async () => {
    console.log("Receiver joined room. Starting WebRTC sequence.");
    document.getElementById("statusText").innerText = "Receiver joined. Creating WebRTC connection...";
    document.getElementById("transferInfo").style.display = "block";

    rtc = new WebRTCManager(
        sessionId,
        (candidate) => sendSignal(sessionId, { candidate }),
        (dc) => {}, 
        (data) => handleControlMessage(data)
    );

    const dc = rtc.createDataChannel("fileTransfer");
    dc.onopen = () => {
        console.log("Data channel open");
        dc.send(JSON.stringify({
            type: "metadata",
            content: { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
        }));
        startTransfer();
    };

    const offer = await rtc.createOffer();
    sendSignal(sessionId, { offer });
});

socket.on("signal", async (data) => {
    if (data.answer) await rtc.setAnswer(data.answer);
    if (data.candidate) await rtc.addCandidate(data.candidate);
});

function initWorker() {
    fileWorker = new Worker("/static/fileWorker.js");
    fileWorker.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === "CHUNK_READY") handleWorkerChunk(data);
        else if (type === "COMPLETE") handleTransferComplete();
    };
}

function handleControlMessage(data) {
    if (typeof data === "string") {
        const msg = JSON.parse(data);
        if (msg.type === "resume") {
            currentChunkIndex = msg.content;
            startTransfer();
        }
    }
}

async function startTransfer() {
    if (isTransferring) return;
    isTransferring = true;
    updateStatus(sessionId, "transferring");
    fileHandler.startTimer();
    if (!fileWorker) initWorker();
    
    document.getElementById("statusText").innerText = "Transferring...";
    document.getElementById("totalSize").innerText = formatSize(selectedFile.size);

    fileWorker.postMessage({
        type: "START_TRANSFER",
        data: { file: selectedFile, resumeFrom: currentChunkIndex }
    });
}

function handleWorkerChunk(data) {
    if (!isTransferring) return;
    rtc.dc.send(data.chunk);
    currentChunkIndex = data.index;
    updateUI();

    if (rtc.dc.bufferedAmount > 8 * 1024 * 1024) {
        setTimeout(() => fileWorker.postMessage({ type: "RESUME" }), 50);
    } else {
        fileWorker.postMessage({ type: "RESUME" });
    }
}

function handleTransferComplete() {
    rtc.dc.send(JSON.stringify({ type: "done" }));
    isTransferring = false;
    updateStatus(sessionId, "completed");
    document.getElementById("statusText").innerText = "Transfer complete!";
}

function updateUI() {
    const sent = currentChunkIndex * 64 * 1024;
    const progress = Math.min((sent / selectedFile.size) * 100, 100);
    const stats = fileHandler.getStats(sent, selectedFile.size);
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;
    document.getElementById("speed").innerText = stats.speed;
    document.getElementById("sentSize").innerText = formatSize(sent);
    document.getElementById("timeLeft").innerText = stats.eta;
}

async function copyToClipboard() {
    const shareLink = document.getElementById("shareLink").innerText;
    await navigator.clipboard.writeText(shareLink);
    const btn = document.querySelector("button[onclick=\"copyToClipboard()\"]");
    const oldText = btn.innerText;
    btn.innerText = "Copied!";
    setTimeout(() => btn.innerText = oldText, 2000);
}

function toggleQR() {
    const qrContainer = document.getElementById("qrcode");
    const shareLink = document.getElementById("shareLink").innerText;
    qrContainer.classList.toggle("active");
    if (qrContainer.classList.contains("active")) {
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, { text: shareLink, width: 256, height: 256 });
    }
}