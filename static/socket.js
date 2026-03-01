const socket = io();

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
