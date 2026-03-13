let sessionId = null;
let rtc = null;
const fileHandler = new FileHandler();

socket.on("connect", () => {
    console.log("Connected to SocketIO server as receiver.");
    sessionId = window.location.pathname.split("/").pop();
    console.log("Extracted sessionId:", sessionId);
    if (sessionId) {
        socket.emit("join_session", { sessionId });
    }
});

socket.on("session_info", (data) => {
    console.log("Session metadata received:", data.metadata);
    document.getElementById("statusText").innerText = "Connected to sender. Starting transfer...";
    document.getElementById("transferInfo").style.display = "block";
    document.getElementById("totalSize").innerText = formatSize(data.metadata.size);
    
    rtc = new WebRTCManager(
        sessionId,
        (candidate) => sendSignal(sessionId, { candidate }),
        (dc) => handleDataChannel(dc)
    );
});

socket.on("signal", async (data) => {
    console.log("Signal received from sender:", Object.keys(data));
    if (data.offer) {
        const answer = await rtc.createAnswer(data.offer);
        sendSignal(sessionId, { answer });
    }
    if (data.candidate) await rtc.addCandidate(data.candidate);
});

function handleDataChannel(dc) {
    dc.onopen = () => console.log("Receiver data channel open!");
    dc.onmessage = (e) => {
        if (typeof e.data === "string") {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === "metadata") {
                    console.log("Metadata received via WebRTC:", msg.content);
                    fileHandler.init(msg.content.name, msg.content.size, msg.content.type);
                    fileHandler.startTimer();
                } else if (msg.type === "done") {
                    console.log("Transfer complete from sender signal.");
                    fileHandler.save(sessionId);
                    document.getElementById("statusText").innerText = "Transfer complete!";
                }
            } catch (err) {
                console.error("Error parsing control message:", err);
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
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;
    document.getElementById("speed").innerText = stats.speed;
    document.getElementById("receivedSize").innerText = formatSize(received);
    document.getElementById("timeLeft").innerText = stats.eta;
}