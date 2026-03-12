// Function to handle clipboard copy
async function copyToClipboard() {
    const shareLink = document.getElementById('shareLink').innerText;
    try {
        await navigator.clipboard.writeText(shareLink);
        const btn = document.querySelector('button[onclick="copyToClipboard()"]');
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = oldText, 2000);
    } catch (err) {
        console.error('Failed to copy: ', err);
    }
}

// Function to handle QR code generation and display
function toggleQR() {
    const qrContainer = document.getElementById('qrcode');
    const shareLink = document.getElementById('shareLink').innerText;
    
    qrContainer.classList.toggle('active');
    
    // Clear and generate new QR if turning on
    if (qrContainer.classList.contains('active')) {
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
            text: shareLink,
            width: 256,
            height: 256,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }
}

let sessionId = null;
let selectedFile = null;
let rtc = null;
let isTransferring = false;
let currentChunkIndex = 0;
let fileWorker = null;
const fileHandler = new FileHandler();

// Initialize Drag & Drop
const dropZone = document.getElementById('dropZone');
if (dropZone) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('active'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    onFileSelected(file);
}

async function onFileSelected(file) {
    if (!file) return;
    selectedFile = file;

    console.log("File selected:", selectedFile.name);
    
    // UI Feedback: Show file info immediately
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) {
        fileInfo.innerText = `Selected: ${selectedFile.name} (${formatSize(selectedFile.size)})`;
    }

    // Hide drag/drop zone
    if (dropZone) dropZone.style.display = 'none';

    // Emit session creation
    try {
        console.log("Emitting create_session...");
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

// ... existing code ...

socket.on('signal', async (data) => {
    if (data.answer) await rtc.setAnswer(data.answer);
    if (data.candidate) await rtc.addCandidate(data.candidate);
});

function initWorker() {
    fileWorker = new Worker('/static/fileWorker.js');
    fileWorker.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === 'CHUNK_READY') {
            handleWorkerChunk(data);
        } else if (type === 'COMPLETE') {
            handleTransferComplete();
        }
    };
}

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
    
    if (!fileWorker) initWorker();
    
    document.getElementById('statusText').innerText = 'Transferring...';
    document.getElementById('totalSize').innerText = formatSize(selectedFile.size);

    fileWorker.postMessage({
        type: 'START_TRANSFER',
        data: {
            file: selectedFile,
            resumeFrom: currentChunkIndex
        }
    });
}

function handleWorkerChunk(data) {
    if (!isTransferring) return;

    // Send the chunk via WebRTC
    rtc.dc.send(data.chunk);
    
    // Update index for tracking
    currentChunkIndex = data.index;
    updateUI();

    // Check backpressure
    if (rtc.dc.bufferedAmount > 8 * 1024 * 1024) {
        // Stop the worker until buffer drains
        setTimeout(() => fileWorker.postMessage({ type: 'RESUME' }), 50);
    } else {
        // Request next chunk immediately
        fileWorker.postMessage({ type: 'RESUME' });
    }
}

function handleTransferComplete() {
    console.log('Transfer complete');
    rtc.dc.send(JSON.stringify({ type: 'done' }));
    isTransferring = false;
    updateStatus(sessionId, 'completed');
    document.getElementById('statusText').innerText = 'Transfer complete!';
}

function updateUI() {
    const sent = currentChunkIndex * 64 * 1024;
    const progress = Math.min((sent / selectedFile.size) * 100, 100);
    const stats = fileHandler.getStats(sent, selectedFile.size);

    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressPercent').innerText = `${Math.round(progress)}%`;
    document.getElementById('speed').innerText = stats.speed;
    document.getElementById('sentSize').innerText = formatSize(sent);
    document.getElementById('timeLeft').innerText = stats.eta;
}
