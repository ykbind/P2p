import os
import secrets
import logging
from flask import Flask, render_template, request, redirect
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
    allow_upgrades=True,
    transports=['websocket', 'polling'],
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

@app.route("/tos")
def tos():
    return render_template("legal.html", title="Terms of Service", content="DropIt is a peer-to-peer file transfer tool. By using this service, you agree that files are transferred directly between users and are not stored on our servers. You are responsible for the content you share.")

@app.route("/privacy")
def privacy():
    return render_template("legal.html", title="Privacy Policy", content="Your privacy is our priority. DropIt does not store your files. We only facilitate the peer-to-peer connection. Metadata is only used to establish the connection and is discarded immediately after.")

@app.route("/about")
def about():
    return redirect("https://ykblmao.xyz")

@socketio.on("create_session")
def on_create(data=None):
    sid = request.sid
    join_room(sid)
    print(f"[SIGNAL] Sender {sid} created session.")
    emit("session_created", sid)

@socketio.on("join_session")
def on_join(data=None):
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
    emit("signal", data.get("signal"), to=target, include_self=False)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 P2P Server starting on port {port}...")
    socketio.run(app, host="0.0.0.0", port=port, debug=True)