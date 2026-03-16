const socket = io({ 
    transports: ["polling", "websocket"], 
    path: "/socket.io" 
});

let sid = window.location.pathname.split("/").pop();
let p2p = null;
let metadata = null;
let chunks = [];
let received = 0;

socket.on("connect", () => {
    socket.emit("join_session", sid);
});

socket.on("signal", async (signal) => {
    if (signal.metadata) {
        metadata = signal.metadata;
        document.getElementById("statusText").innerHTML = '<span class="pulse" style="background:var(--secondary)"></span>Secure Link Established';
        document.getElementById("transferInfo").style.display = "block";
        document.getElementById("fileName").innerText = metadata.name;
        return;
    }

    if (!p2p) {
        console.log("Offer received, initializing PeerConnection.");
        p2p = new PeerConnection(sid, (s) => socket.emit("signal", { sid, signal: s }));
    }
    
    if (signal.offer) {
        const answer = await p2p.handleOffer(signal.offer);
        socket.emit("signal", { sid, signal: { answer } });
        
        p2p.pc.ondatachannel = (e) => {
            p2p.dc = e.channel;
            p2p.dc.binaryType = "arraybuffer";
            p2p.dc.onopen = () => {
                console.log("P2P Open");
                document.getElementById("statusText").innerHTML = '<span class="pulse"></span>Downloading...';
            };
            p2p.dc.onmessage = (msg) => {
                if (typeof msg.data === "string") {
                    try {
                        const signalPayload = JSON.parse(msg.data);
                        if (signalPayload.type === "DONE") {
                            finalize();
                            return;
                        }
                    } catch (e) {}
                }
                
                chunks.push(msg.data);
                received += msg.data.byteLength;
                updateUI();
            };
        };
    }
    if (signal.candidate) await p2p.addIce(signal.candidate);
    if (signal.answer) await p2p.handleAnswer(signal.answer);
});

function updateUI() {
    if (!metadata) return;
    const progress = Math.min((received / metadata.size) * 100, 100);
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").innerText = `${Math.round(progress)}%`;
}

function finalize() {
    if (!metadata) return;
    const blob = new Blob(chunks, { type: metadata.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = metadata.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    document.getElementById("statusText").innerText = "✓ Download Complete";
    document.getElementById("progressLabel").innerText = "File saved successfully!";
}