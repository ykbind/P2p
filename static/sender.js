const socket = io({ 
    transports: ["polling", "websocket"], 
    path: "/socket.io" 
});

let sid = null;
let file = null;
let p2p = null;
let startTime = 0;
let speedChart = null;

socket.on("session_created", (newSid) => {
    sid = newSid;
    document.getElementById("shareLink").innerText = `${window.location.origin}/receive/${sid}`;
    document.getElementById("sessionInfo").style.display = "block";
    document.getElementById("dropZone").style.display = "none";
});

socket.on("receiver_joined", async () => {
    document.getElementById("statusText").innerHTML = '<span class="pulse" style="background:var(--secondary)"></span>Connecting...';
    socket.emit("signal", { sid, signal: { metadata: { name: file.name, size: file.size, type: file.type } } });
    
    p2p = new PeerConnection(sid, (signal) => socket.emit("signal", { sid, signal }));
    const offer = await p2p.createOffer();
    socket.emit("signal", { sid, signal: { offer } });
    
    p2p.dc.onopen = () => {
        document.getElementById("transferInfo").style.display = "block";
        document.getElementById("statusText").innerHTML = '<span class="pulse"></span>Streaming...';
        startTime = Date.now();
        initChart();
        startWorkerTransfer();
    };
});

socket.on("signal", async (s) => { if(s.answer) await p2p.handleAnswer(s.answer); if(s.candidate) await p2p.addIce(s.candidate); });

function handleFile(files) { file = files[0]; if(file) socket.emit("create_session"); }

function initChart() {
    const canvas = document.createElement("canvas");
    canvas.id = "speedGraph";
    canvas.style.marginTop = "20px";
    canvas.height = 100;
    document.querySelector(".card").appendChild(canvas);
    speedChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: Array(30).fill(""), datasets: [{ data: Array(30).fill(0), borderColor: '#6366f1', tension: 0.4, fill: true, backgroundColor: 'rgba(99, 102, 241, 0.05)', pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { display: false }, x: { display: false } }, plugins: { legend: { display: false } } }
    });
}

function startWorkerTransfer() {
    const worker = new Worker("/static/worker.js");
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks for ideal WebRTC MTU alignment
    const BUFFER_LIMIT = 4 * 1024 * 1024; // 4MB low-water mark for high reactivity
    
    worker.postMessage({ file, chunkSize: CHUNK_SIZE });

    let isWaiting = false;
    const queue = [];

    worker.onmessage = function(e) {
        if (e.data.done) {
            p2p.dc.send(JSON.stringify({ type: "DONE" }));
            document.getElementById("statusText").innerText = "✓ Complete";
            return;
        }
        
        // Use requestAnimationFrame to ensure UI updates don't block the network flow
        queue.push(e.data);
        if (!isWaiting) processQueue();
    };

    function processQueue() {
        if (queue.length === 0) {
            isWaiting = false;
            return;
        }

        if (p2p.dc.bufferedAmount > BUFFER_LIMIT) {
            isWaiting = true;
            // Back-pressure: wait for buffer to drain before processing more chunks
            p2p.dc.onbufferedamountlow = () => {
                p2p.dc.onbufferedamountlow = null;
                processQueue();
            };
            return;
        }

        const data = queue.shift();
        p2p.dc.send(data.buffer);
        updateUI(data.offset + data.buffer.byteLength);
        
        // Yield to browser UI thread briefly every 10 chunks to keep page responsive
        if (queue.length % 10 === 0) {
            setTimeout(processQueue, 0);
        } else {
            processQueue();
        }
    }
}

function updateUI(sent) {
    const progress = (sent / file.size) * 100;
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;

    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    const speed = sent / elapsed; 
    const remaining = (file.size - sent) / speed;

    const etaEl = document.getElementById("etaText");
    if (etaEl && isFinite(remaining)) {
        etaEl.innerText = remaining > 60 ? `${Math.round(remaining/60)}m` : `${Math.round(remaining)}s`;
    }

    if (speedChart && now % 500 < 100) {
        const mbs = (speed / (1024 * 1024)).toFixed(1);
        speedChart.data.datasets[0].data.push(mbs);
        speedChart.data.datasets[0].data.shift();
        speedChart.update('none');
    }
}