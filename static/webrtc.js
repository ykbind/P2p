const P2P_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Reliable public TURN servers for NAT traversal on Render
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
    ],
    iceCandidatePoolSize: 10
};

class PeerConnection {
    constructor(sid, sendSignal) {
        this.sid = sid;
        this.sendSignal = sendSignal;
        this.pc = new RTCPeerConnection(P2P_CONFIG);
        this.dc = null;
        this.pendingIce = [];
        
        this.pc.onicecandidate = (e) => {
            if (e.candidate) this.sendSignal({ candidate: e.candidate });
        };
    }

    async addIce(candidate) {
        if (!this.pc.remoteDescription) {
            this.pendingIce.push(candidate);
            return;
        }
        try {
            // Strong candidate validation to skip invalid/null indices
            if (candidate && (candidate.sdpMid !== null || candidate.sdpMLineIndex !== null)) {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) { console.warn("ICE error", err); }
    }

    async drainIce() {
        while (this.pendingIce.length > 0) {
            await this.addIce(this.pendingIce.shift());
        }
    }

    async createOffer() {
        this.dc = this.pc.createDataChannel("file-transfer", { ordered: true });
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return offer;
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        await this.drainIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this.drainIce();
    }
}