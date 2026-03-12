let rtc = null;
let receivedChunks = [];
let receivedSize = 0;
let fileMetadata = null;
let currentChunkIndex = 0;
const fileHandler = new FileHandler();

// Initialize session
socket.emit('join_session', { session_id: SESSION_ID });

socket.on('signal', async (data) => {
    if (data.offer) {
        rtc = new WebRTCManager(
            SESSION_ID,
            (candidate) => sendSignal(SESSION_ID, { candidate }),
            (dc) => {}, // dc setup in WebRTCManager
            (data) => handleData(data)
        );
        const answer = await rtc.setOffer(data.offer);
        sendSignal(SESSION_ID, { answer });

        // Resume request logic
        if (currentChunkIndex > 0) {
            rtc.dc.send(JSON.stringify({ type: 'resume', content: currentChunkIndex }));
        }
    } else if (data.candidate) {
        if (rtc) await rtc.addCandidate(data.candidate);
    }
});

function handleData(data) {
    if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'metadata') {
            fileMetadata = msg.content;
            document.getElementById('totalSize').innerText = formatSize(fileMetadata.size);
            document.getElementById('statusText').innerText = 'Receiving...';
            fileHandler.startTimer();
        } else if (msg.type === 'done') {
            onTransferComplete();
        }
        return;
    }

    // Binary chunk received
    receivedChunks.push(new Uint8Array(data));
    receivedSize += data.byteLength;
    currentChunkIndex++;
    updateUI();
}

function updateUI() {
    if (!fileMetadata) return;
    const progress = Math.min((receivedSize / fileMetadata.size) * 100, 100);
    const stats = fileHandler.getStats(receivedSize, fileMetadata.size);

    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressPercent').innerText = `${Math.round(progress)}%`;
    document.getElementById('speed').innerText = stats.speed;
    document.getElementById('receivedSize').innerText = formatSize(receivedSize);
    document.getElementById('timeLeft').innerText = stats.eta;
}

function onTransferComplete() {
    document.getElementById('statusText').innerText = 'Transfer complete!';
    document.getElementById('downloadBtn').style.display = 'block';
    updateStatus(SESSION_ID, 'completed');
}

function downloadFile() {
    const blob = new Blob(receivedChunks, { type: fileMetadata.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileMetadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

socket.on('peer_disconnected', () => {
    document.getElementById('statusText').innerText = 'Sender disconnected. Reconnecting...';
});
