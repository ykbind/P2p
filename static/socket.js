// Ensure we use absolute URL to project root for socket
const socket = io(window.location.origin, {
    transports: ['polling', 'websocket'], // Prefer polling first for Vercel/Proxy stability
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    forceNew: true,
    path: '/socket.io'
});

socket.on('connect', () => {
    console.log("Socket connected successfully with ID:", socket.id);
});

socket.on('disconnect', (reason) => {
    console.log("Socket disconnected:", reason);
});

socket.on('connect_error', (error) => {
    console.error("Socket connection error:", error);
});

function initSocket(sessionId, onSignal, onJoined) {
    socket.on('signal', (data) => {
        onSignal(data);
    });

    socket.on('receiver_joined', () => {
        if (onJoined) onJoined();
    });

    // Heartbeat mechanism
    setInterval(() => {
        if (sessionId) {
            socket.emit('heartbeat', sessionId);
        }
    }, 5000);

    return socket;
}

function sendSignal(sessionId, signalData) {
    socket.emit('signal', {
        session_id: sessionId,
        ...signalData
    });
}

function updateStatus(sessionId, status) {
    socket.emit('status_update', {
        session_id: sessionId,
        status: status
    });
}
