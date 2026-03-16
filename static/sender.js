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
    const url = `${window.location.origin}/receive/${sid}`;
    document.getElementById("shareLink").innerText = url;
    document.getElementById("sessionInfo").style.display = "block";
    document.getElementById("dropZone").style.display = "none";
});

socket.on("receiver_joined", async () => {
    console.log("Peer joined. Starting P2P handshake.");
    document.getElementById("statusText").innerHTML = '<span class="pulse" style="background:var(--secondary)"></span>Connecting...';

    socket.emit("signal", { 
        sid, 
        signal: { 
            metadata: { 
                name: file.name, 
                size: file.size, 
                type: file.type 
            } 
        } 
    });
    
    p2p = new PeerConnection(sid, (signal) => socket.emit("signal", { sid, signal }));
    const offer = await p2p.createOffer();
    socket.emit("signal", { sid, signal: { offer } });
    
    p2p.dc.onopen = () => {
        console.log("Transfer channel open");
        document.getElementById("transferInfo").style.display = "block";
        document.getElementById("statusText").innerHTML = '<span class="pulse"></span>Streaming file...';
        startTime = Date.now();
        initChart();
        startWorkerTransfer();
    };
});

socket.on("signal", async (signal) => {
    if (signal.answer) await p2p.handleAnswer(signal.answer);
    if (signal.candidate) await p2p.addIce(signal.candidate);
});

function handleFile(files) {
    file = files[0];
    if (!file) return;
    socket.emit("create_session");
}

function initChart() {
    const canvas = document.createElement("canvas");
    canvas.id = "speedGraph";
    canvas.style.marginTop = "20px";
    document.querySelector(".card").appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(20).fill(""),
            datasets: [{
                label: 'MB/s',
                data: Array(20).fill(0),
                borderColor: '#6366f1',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { display: false }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function startWorkerTransfer() {
    // Note: worker.js must exist in static/
    const worker = new Worker("/static/worker.js");
    let adaptiveChunk = 12 * 1024; // initial 12KB
    
    worker.postMessage({ file, chunkSize: 128 * 1024 }); // Use 128KB base chunks

    worker.onmessage = function(e) {
        if (e.data.done) {
            p2p.dc.send(JSON.stringify({ type: "DONE" }));
            document.getElementById("statusText").innerText = "✓ Transfer Complete";
            return;
        }

        const buffer = e.data.buffer;
        
        const sendWhenReady = () => {
            if (p2p.dc.bufferedAmount > 8 * 1024 * 1024) { // 8MB safety threshold
                setTimeout(sendWhenReady, 50);
                return;
            }
            p2p.dc.send(buffer);
            updateUI(e.data.offset + buffer.byteLength);
        };
        sendWhenReady();
    };
}

function updateUI(sent) {
    const progress = Math.min((sent / file.size) * 100, 100);
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;

    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    const speed = sent / elapsed; // bytes/s
    const remaining = (file.size - sent) / speed;

    if (etaText && isFinite(remaining)) {
        const min = Math.floor(remaining / 60);
        const sec = Math.floor(remaining % 60);
        document.getElementById("etaText").innerText = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    }

    if (speedChart && Math.floor(now/1000) > Math.floor((now-100)/1000)) {
        const mbs = (speed / (1024 * 1024)).toFixed(1);
        speedChart.data.datasets[0].data.push(mbs);
        speedChart.data.datasets[0].data.shift();
        speedChart.update('none');
    }
}