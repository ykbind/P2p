// Use current origin and simplify transport to ensure compatibility
const socket = io({
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    path: "/socket.io"
});

socket.on("connect", () => {
    console.log("Socket connected successfully with ID:", socket.id);
});

socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
});

socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
});

function initSocket(sessionId, onSignal, onJoined) {
    socket.on("signal", (data) => {
        if (onSignal) onSignal(data);
    });

    socket.on("receiver_joined", () => {
        console.log("Receiver joined.");
        if (onJoined) onJoined();
    });

    socket.on("status_updated", (data) => {
        const statusText = document.getElementById("statusText");
        if (statusText) statusText.innerText = `Status: ${data.status}`;
    });

    socket.on("error", (err) => {
        console.error("Socket error:", err);
    });

    setInterval(() => {
        if (sessionId) {
            socket.emit("heartbeat", sessionId);
        }
    }, 5000);

    return socket;
}

socket.on("session_created", (data) => {
    console.log("Session created:", data.sessionId);
    sessionId = data.sessionId; 
    const base = window.location.origin;
    const url = `${base}/receive/${data.sessionId}`;
    
    const shareLink = document.getElementById("shareLink");
    const sessionInfo = document.getElementById("sessionInfo");
    
    if (shareLink && sessionInfo) {
        shareLink.innerText = url;
        sessionInfo.style.display = "block";
        const wrapper = document.querySelector(".file-input-wrapper");
        if (wrapper) wrapper.style.display = "none";
    }
});

function sendSignal(sessionId, signalData) {
    socket.emit("signal", {
        sessionId: sessionId,
        signal: signalData
    });
}

function updateStatus(sessionId, status) {
    socket.emit("update_status", {
        sessionId: sessionId,
        status: status
    });
}