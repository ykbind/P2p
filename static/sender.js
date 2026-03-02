let sessionId = null;
let selectedFile = null;
let rtc = null;
let isTransferring = false;
let currentChunkIndex = 0;
const fileHandler = new FileHandler();

async function onFileSelected() {
    const input = document.getElementById('fileInput');
    selectedFile = input.files[0];
    if (!selectedFile) return;

    console.log("File selected:", selectedFile.name);
    
    // UI Feedback: Show file info immediately
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) {
        fileInfo.innerText = `Selected: ${selectedFile.name} (${formatSize(selectedFile.size)})`;
    }

    // Emit session creation
    try {
        console.log("Emitting create_session...");
        // Use a 2-second timeout to check if socket is actually connected
        if (!socket.connected) {
            console.error("Socket not connected! Attempting to reconnect...");
            socket.connect();
        }

        socket.emit('create_session', {
            metadata: {
                name: selectedFile.name,
                size: selectedFile.size,
                type: selectedFile.type
            }
        });
    } catch (err) {
        console.error("Error emitting create_session:", err);
    }
}

socket.on('session_created', (data) => {
    console.log("Session created successfully:", data.session_id);
    sessionId = data.session_id;
    
    const base = window.location.origin;
    const url = `${base}/r/${sessionId}`;
    
    // Ensure both visibility and content
    const sessionInfo = document.getElementById('sessionInfo');
    const shareLink = document.getElementById('shareLink');
    
    if (sessionInfo && shareLink) {
        shareLink.innerText = url;
        sessionInfo.style.display = 'block';
        console.log("Share link updated in UI");
    } else {
        console.error("UI Elements for session info not found!");
    }
});

socket.on('receiver_joined', async () => {
    console.log("Receiver joined room. Starting WebRTC sequence.");
    document.getElementById('statusText').innerText = 'Receiver joined. Creating WebRTC connection...';
    document.getElementById('transferInfo').style.display = 'block';

    rtc = new WebRTCManager(
        sessionId,
        (candidate) => sendSignal(sessionId, { candidate }),
        (dc) => {}, // not used on sender side for creation
        (data) => handleControlMessage(data)
    );

    const dc = rtc.createDataChannel('fileTransfer');
    dc.onopen = () => {
        console.log('Data channel open');
        // Send metadata first
        dc.send(JSON.stringify({
            type: 'metadata',
            content: {
                name: selectedFile.name,
                size: selectedFile.size,
                type: selectedFile.type
            }
        }));
        startTransfer();
    };

    const offer = await rtc.createOffer();
    sendSignal(sessionId, { offer });
});

socket.on('signal', async (data) => {
    if (data.answer) await rtc.setAnswer(data.answer);
    if (data.candidate) await rtc.addCandidate(data.candidate);
});

function handleControlMessage(data) {
    if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'resume') {
            currentChunkIndex = msg.content;
            startTransfer();
        }
    }
}

async function startTransfer() {
    if (isTransferring) return;
    isTransferring = true;
    updateStatus(sessionId, 'transferring');
    fileHandler.startTimer();
    
    document.getElementById('statusText').innerText = 'Transferring...';
    document.getElementById('totalSize').innerText = formatSize(selectedFile.size);

    const CHUNK_SIZE = 64 * 1024;
    const reader = new FileReader();

    const sendNextChunk = () => {
        if (!isTransferring) return;

        // Backpressure check
        if (rtc.dc.bufferedAmount > 8 * 1024 * 1024) { // 8MB
            setTimeout(sendNextChunk, 50);
            return;
        }

        const start = currentChunkIndex * CHUNK_SIZE;
        if (start >= selectedFile.size) {
            console.log('Transfer complete');
            rtc.dc.send(JSON.stringify({ type: 'done' }));
            isTransferring = false;
            updateStatus(sessionId, 'completed');
            document.getElementById('statusText').innerText = 'Transfer complete!';
            return;
        }

        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const blob = selectedFile.slice(start, end);
        
        reader.onload = (e) => {
            rtc.dc.send(e.target.result);
            currentChunkIndex++;
            updateUI();
            sendNextChunk();
        };
        reader.readAsArrayBuffer(blob);
    };

    sendNextChunk();
}

function updateUI() {
    const sent = currentChunkIndex * 64 * 1024;
    const progress = Math.min((sent / selectedFile.size) * 100, 100);
    const stats = fileHandler.getStats(sent);

    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressPercent').innerText = `${Math.round(progress)}%`;
    document.getElementById('speed').innerText = stats.speed;
    document.getElementById('sentSize').innerText = formatSize(sent);
}
