const CHUNK_SIZE = 64 * 1024; // 64KB
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8MB

class WebRTCManager {
    constructor(sessionId, onCandidate, onDataChannel, onData) {
        this.sessionId = sessionId;
        this.onCandidate = onCandidate;
        this.onDataChannel = onDataChannel;
        this.onData = onData; // Note: This is now only used for the DataChannel setup
        
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 10
        };
        
        this.pc = new RTCPeerConnection(this.config);
        this.dc = null;

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.onCandidate(event.candidate);
            }
        };

        this.pc.ondatachannel = (event) => {
            console.log("Remote DataChannel received");
            this.dc = event.channel;
            this.setupDataChannel();
            if (this.onDataChannel) this.onDataChannel(this.dc);
        };
    }

    createDataChannel(label) {
        this.dc = this.pc.createDataChannel(label);
        this.setupDataChannel();
        return this.dc;
    }

    setupDataChannel() {
        this.dc.binaryType = 'arraybuffer';
        this.dc.onmessage = (event) => {
            if (this.onData) this.onData(event.data);
        };
    }

    async createOffer() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return offer;
    }

    async createAnswer(offer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    async setAnswer(answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async addCandidate(candidate) {
        try {
            if (!candidate) return;
            // Ensure we are passing the candidate object correctly
            const iceCandidate = (candidate.candidate !== undefined) ? candidate : { candidate: candidate };
            await this.pc.addIceCandidate(new RTCIceCandidate(iceCandidate));
        } catch (e) {
            console.error('Error adding ice candidate', e);
        }
    }
}