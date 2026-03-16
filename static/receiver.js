const socket = io({ 
    transports: ["polling", "websocket"], 
    path: "/socket.io" 
});

let sid = window.location.pathname.split("/").pop();
let p2p = null;
let metadata = null;
let received = 0;
let writer = null;

socket.on("connect", () => {
    socket.emit("join_session", sid);
});

socket.on("signal", async (signal) => {
    if (signal.metadata) {
        metadata = signal.metadata;
        document.getElementById("statusText").innerHTML = '<span class="pulse" style="background:var(--secondary)"></span>Link Secured';
        document.getElementById("transferInfo").style.display = "block";
        document.getElementById("fileName").innerText = metadata.name;
        
        // Initialize StreamSaver to write directly to disk
        const fileStream = streamSaver.createWriteStream(metadata.name, {
            size: metadata.size
        });
        writer = fileStream.getWriter();
        return;
    }

    if (!p2p) {
        p2p = new PeerConnection(sid, (s) => socket.emit("signal", { sid, signal: s }));
    }
    
    if (signal.offer) {
        const answer = await p2p.handleOffer(signal.offer);
        socket.emit("signal", { sid, signal: { answer } });
        
        p2p.pc.ondatachannel = (e) => {
            p2p.dc = e.channel;
            p2p.dc.binaryType = "arraybuffer";
            p2p.dc.onopen = () => {
                document.getElementById("statusText").innerHTML = '<span class="pulse"></span>Streaming to Disk...';
            };
            p2p.dc.onmessage = async (msg) => {
                if (typeof msg.data === "string") {
                    try {
                        const payload = JSON.parse(msg.data);
                        if (payload.type === "DONE") {
                            await writer.close();
                            document.getElementById("statusText").innerText = "✓ Complete";
                            return;
                        }
                    } catch (e) {}
                }
                
                // Write directly to disk
                const data = new Uint8Array(msg.data);
                writer.write(data);
                received += data.byteLength;
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