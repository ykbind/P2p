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
    console.log("Transport in use:", socket.io.engine.transport.name);
});

socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
});

socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
});

socket.io.engine.on("upgrade", () => {
    console.log("Transport upgraded to:", socket.io.engine.transport.name);
});

function initSocket(sessionId, onSignal, onJoined) {
    socket.on("signal", (data) => {
        console.log("Signal received:", data.type || "ice-candidate");
        onSignal(data);
    });

    socket.on("receiver_joined", () => {
        console.log("Receiver joined theoretical session");
        if (onJoined) onJoined();
    });

    socket.on("error", (err) => {
        console.error("Socket server-side error:", err);
    });

    setInterval(() => {
        if (sessionId) {
            socket.emit("heartbeat", sessionId);
        }
    }, 5000);

    return socket;
}

socket.on("session_created", (data) => {
    console.log("Session created successfully:", data.session_id);
    const base = window.location.origin;
    const url = `${base}/r/${data.session_id}`;
    
    const sessionInfo = document.getElementById("sessionInfo");
    const shareLink = document.getElementById("shareLink");
    
    if (sessionInfo && shareLink) {
        shareLink.innerText = url;
        sessionInfo.style.display = "block";
        const wrapper = document.querySelector(".file-input-wrapper");
        if (wrapper) wrapper.style.display = "none";
    }
});

function sendSignal(sessionId, signalData) {
    socket.emit("signal", {
        session_id: sessionId,
        ...signalData
    });
}

function updateStatus(sessionId, status) {
    socket.emit("status_update", {
        session_id: sessionId,
        status: status
    });
}
