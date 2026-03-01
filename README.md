# P2P File Transfer Web Application

A production-level, high-performance Peer-to-Peer (P2P) file transfer application built with **Python Flask**, **Flask-SocketIO**, and **WebRTC DataChannels**.

## 🚀 Features

- **Direct P2P Transfer**: Files are transferred directly between devices using WebRTC, bypassing the server for maximum speed and privacy.
- **Unlimited File Size**: Chunks files into 64KB segments using `file.slice()`. Does not load entire files into memory.
- **Backpressure Handling**: Monitors `bufferedAmount` to prevent browser crashes or network congestion.
- **Resumable Transfers**: Automatically resumes from the last successfully received chunk upon reconnection.
- **Secure Sessions**: Generate secure 32-byte tokens for session IDs.
- **In-Memory Storage**: No database required. Sessions are stored in a global dictionary and auto-cleaned.
- **Modern Dark UI**: Clean, responsive dashboard with real-time transfer speed, progress percentage, and connection status.

## 🛠️ Tech Stack

- **Backend**: Python, Flask, Flask-SocketIO, Eventlet
- **Frontend**: Vanilla JS, WebRTC (RTCPeerConnection, RTCDataChannel), CSS3
- **Signaling**: SocketIO for WebRTC handshake and session management.

## 📋 Requirements

- Python 3.8+
- Dependencies listed in `requirements.txt`

## 📦 Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd p2p-transfer
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application**:
   ```bash
   python app.py
   ```

4. **Access the app**:
   - Open `http://localhost:5000` in your browser.
   - Select a file to generate a shareable link.
   - Open the link on another device/browser to start the transfer.

## 🔒 Security & Expiry Rules

- **Session Expiry**: Sessions expire after 10 minutes of inactivity.
- **Active Transfer Protection**: Sessions **never** expire while a transfer is in progress.
- **Disconnection Handling**: If a peer is disconnected for more than 60 seconds, the session is destroyed.
- **Auto-Cleanup**: A background thread runs every 60 seconds to prune stale sessions.

## ⚙️ Configuration

- **Chunk Size**: 64KB (Optimized for WebRTC DataChannels).
- **STUN Server**: Uses Google's public STUN server (`stun:stun.l.google.com:19302`).
- **Buffering**: Pauses sending if the internal buffer exceeds 8MB.

## 📄 License

MIT License
