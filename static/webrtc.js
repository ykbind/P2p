const P2P_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // Public TURN servers for NAT traversal (fallback when STUN fails)
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ],
    iceCandidatePoolSize: 10
};

class PeerConnection {
    constructor(sid, sendSignal, onError) {
        this.sid = sid;
        this.sendSignal = sendSignal;
        this.onError = onError || function() {};
        this.pc = new RTCPeerConnection(P2P_CONFIG);
        this.dc = null;
        this.pendingIce = [];

        this.pc.onicecandidate = (e) => {
            if (e.candidate) this.sendSignal({ candidate: e.candidate });
        };

        // Monitor ICE connection state for diagnostic/error reporting
        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc.iceConnectionState;
            console.log("[ICE]", state);
            if (state === "failed") {
                console.error("[ICE] Connection failed — attempting restart");
                // Try ICE restart before giving up
                this.pc.restartIce();
                this.onError("ice_failed");
            }
            if (state === "disconnected") {
                console.warn("[ICE] Peer disconnected");
                this.onError("ice_disconnected");
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("[RTC]", this.pc.connectionState);
        };
    }

    async addIce(candidate) {
        if (!this.pc.remoteDescription) {
            this.pendingIce.push(candidate);
            return;
        }
        try {
            // Validate candidate before adding — sdpMid OR sdpMLineIndex must be present
            if (candidate && (candidate.sdpMid !== null || candidate.sdpMLineIndex !== null)) {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) {
            console.warn("[ICE] addIceCandidate error:", err);
        }
    }

    async drainIce() {
        while (this.pendingIce.length > 0) {
            await this.addIce(this.pendingIce.shift());
        }
    }

    async createOffer() {
        this.dc = this.pc.createDataChannel("file-transfer", { ordered: true });
        // Set low-water mark so onbufferedamountlow fires at 512 KB
        this.dc.bufferedAmountLowThreshold = 512 * 1024;
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