import os
import secrets
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
# Allow all origins for Vercel/Render compatibility
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=True, engineio_logger=True, ping_timeout=60, ping_interval=25)

sessions = {}

@app.route("/")
def index():
    return render_template("sender.html")

@app.route("/send")
def send():
    return render_template("sender.html")

@app.route("/receive/<session_id>")
def receive(session_id):
    if session_id not in sessions:
        return "Session not found", 404
    return render_template("receiver.html", session_id=session_id)

@socketio.on("create_session")
def on_create_session(data):
    session_id = secrets.token_urlsafe(8)
    sessions[session_id] = {
        "metadata": data.get("metadata"),
        "sender": request.sid,
        "receiver": None,
        "status": "waiting"
    }
    join_room(session_id)
    print(f"Session created: {session_id} by {request.sid}")
    emit("session_created", {"sessionId": session_id, "metadata": data.get("metadata")})

@socketio.on("join_session")
def on_join_session(data):
    session_id = data.get("sessionId")
    if session_id in sessions:
        sessions[session_id]["receiver"] = request.sid
        sessions[session_id]["status"] = "connecting"
        join_room(session_id)
        print(f"Receiver {request.sid} joined session: {session_id}")
        # Broadcast to room that receiver joined
        emit("receiver_joined", room=session_id, include_self=False)
        emit("session_info", {"metadata": sessions[session_id]["metadata"]})
    else:
        emit("error", {"message": "Session not found"})

@socketio.on("signal")
def on_signal(data):
    session_id = data.get("sessionId")
    signal_data = data.get("signal")
    print(f"Signal received in room {session_id}")
    # Forward the signal to everyone in the room except the sender
    emit("signal", signal_data, room=session_id, include_self=False)

@socketio.on("update_status")
def on_update_status(data):
    session_id = data.get("sessionId")
    status = data.get("status")
    if session_id in sessions:
        sessions[session_id]["status"] = status
        emit("status_updated", {"status": status}, room=session_id)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=True)