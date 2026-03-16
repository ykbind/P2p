const socket = io({ 
    transports: ["polling", "websocket"], 
    path: "/socket.io" 
});

let sid = null;
let file = null;
let p2p = null;
let startTime = 0;

socket.on("session_created", (newSid) => {
    sid = newSid;
    const url = `${window.location.origin}/receive/${sid}`;
    document.getElementById("shareLink").innerText = url;
    document.getElementById("sessionInfo").style.display = "block";
    document.getElementById("dropZone").style.display = "none";
});

socket.on("receiver_joined", async () => {
    console.log("Peer joined. Starting P2P handshake.");
    document.getElementById("statusText").innerHTML = '<span class="pulse" style="background:var(--secondary)"></span>Authenticating peer...';

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
        startStreaming();
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

async function startStreaming() {
    const CHUNK_SIZE = 64 * 1024; // 64KB
    let offset = 0;
    const reader = new FileReader();

    const readNext = () => {
        if (offset >= file.size) {
            p2p.dc.send(JSON.stringify({ type: "DONE" }));
            document.getElementById("statusText").innerText = "✓ Transfer Complete";
            return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
        if (p2p.dc.bufferedAmount > 10 * 1024 * 1024) {
            setTimeout(() => {
                p2p.dc.send(e.target.result);
                offset += e.target.result.byteLength;
                updateUI(offset);
                readNext();
            }, 100);
        } else {
            p2p.dc.send(e.target.result);
            offset += e.target.result.byteLength;
            updateUI(offset);
            readNext();
        }
    };

    readNext();
}

function updateUI(sent) {
    const progress = Math.min((sent / file.size) * 100, 100);
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;

    // Calculate ETA
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = sent / elapsed; // bytes per second
    const remaining = file.size - sent;
    const eta = remaining / speed;

    if (eta && isFinite(eta)) {
      const minutes = Math.floor(eta / 60);
      const seconds = Math.floor(eta % 60);
      document.getElementById("etaText").innerText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
}