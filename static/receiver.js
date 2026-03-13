let sessionId = null;
let rtc = null;
const fileHandler = new FileHandler();

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

socket.on("connect", () => {
    console.log("Receiver connected.");
    sessionId = window.location.pathname.split("/").pop();
    if (sessionId) {
        socket.emit("join_session", { sessionId });
    }
});

socket.on("session_info", (data) => {
    console.log("Session info received");
    const statusText = document.getElementById("statusText");
    const transferInfo = document.getElementById("transferInfo");
    const totalSize = document.getElementById("totalSize");

    if (statusText) statusText.innerText = "Connected to sender. Starting transfer...";
    if (transferInfo) transferInfo.style.display = "block";
    if (totalSize) totalSize.innerText = formatSize(data.metadata.size);
    
    rtc = new WebRTCManager(
        sessionId,
        (candidate) => sendSignal(sessionId, candidate),
        (dc) => handleDataChannel(dc)
    );
});

socket.on("signal", async (data) => {
    if (data.offer) {
        const answer = await rtc.createAnswer(data.offer);
        sendSignal(sessionId, answer);
    }
    if (data.candidate) await rtc.addCandidate(data.candidate);
});

function handleDataChannel(dc) {
    dc.onopen = () => console.log("Data channel open!");
    dc.onmessage = (e) => {
        if (typeof e.data === "string") {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === "metadata") {
                    fileHandler.init(msg.content.name, msg.content.size, msg.content.type);
                    fileHandler.startTimer();
                } else if (msg.type === "done") {
                    fileHandler.save();
                    document.getElementById("statusText").innerText = "Transfer complete!";
                }
            } catch (err) {
                console.error("Control message error:", err);
            }
        } else {
            fileHandler.addChunk(e.data);
            updateUI();
        }
    };
}

function updateUI() {
    const received = fileHandler.receivedSize;
    const progress = Math.min((received / fileHandler.totalSize) * 100, 100);
    const stats = fileHandler.getStats(received, fileHandler.totalSize);
    
    const progressEl = document.getElementById("progressBar");
    const percentEl = document.getElementById("progressPercent");
    const speedEl = document.getElementById("speed");
    const receivedEl = document.getElementById("receivedSize");
    const etaEl = document.getElementById("timeLeft");

    if (progressEl) progressEl.style.width = `${progress}%`;
    if (percentEl) percentEl.innerText = `${Math.round(progress)}%`;
    if (speedEl) speedEl.innerText = stats.speed;
    if (receivedEl) receivedEl.innerText = formatSize(received);
    if (etaEl) etaEl.innerText = stats.eta;
}