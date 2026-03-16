import os
import secrets
import logging
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room

# Configure standard logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)

# SocketIO Setup with production settings
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode='eventlet', 
    engineio_logger=True,
    logger=True,
    ping_timeout=120, 
    ping_interval=25,
    max_payload=10**8
)

@app.route("/")
def index():
    return render_template("sender.html")

@app.route("/receive/<session_id>")
def receive(session_id):
    return render_template("receiver.html", session_id=session_id)

@socketio.on("create_session")
def on_create(data=None):
    # Receiver/Socket logic
    sid = request.sid
    join_room(sid)
    print(f"[SIGNAL] Sender {sid} created session.")
    emit("session_created", sid)

@socketio.on("join_session")
def on_join(data=None):
    # Data is expected to be the sender's SID string
    target_sid = data
    if not target_sid:
        return
    
    join_room(target_sid)
    print(f"[SIGNAL] Receiver {request.sid} joined sender {target_sid}")
    emit("receiver_joined", {"receiver_id": request.sid}, to=target_sid)

@socketio.on("signal")
def on_signal(data=None):
    if not isinstance(data, dict): return
    target = data.get("sid")
    if not target: return
    
    # Broadcast signal to everyone in the room except the sender
    emit("signal", data.get("signal"), to=target, include_self=False)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 P2P Server starting on port {port}...")
    socketio.run(app, host="0.0.0.0", port=port, debug=True)