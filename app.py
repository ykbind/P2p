import os
import time
import secrets
import threading
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
# Explicitly allowing common SocketIO options to avoid 400 errors
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    async_mode='eventlet', 
    logger=True, 
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
    allow_upgrades=True,
    cookie=False
)

# In-memory session storage
# sessions = {
#     session_id: {
#         "sender": socket_id,
#         "receiver": socket_id,
#         "created_at": timestamp,
#         "last_activity": timestamp,
#         "status": "waiting" | "transferring" | "completed" | "disconnected",
#         "file_metadata": {},
#         "last_chunk_index": 0
#     }
# }
sessions = {}

def cleanup_sessions():
    """Background thread to clean up expired or disconnected sessions."""
    while True:
        now = time.time()
        expired_sessions = []
        
        for session_id, data in sessions.items():
            # 1. Destroy if completed
            if data['status'] == 'completed':
                expired_sessions.append(session_id)
                continue
            
            # 2. Destroy if disconnected for more than 60 seconds
            if data['status'] == 'disconnected' and (now - data['last_activity'] > 60):
                expired_sessions.append(session_id)
                continue
                
            # 3. Expire after 10 minutes (600s) if NOT transferring
            if data['status'] != 'transferring' and (now - data['last_activity'] > 600):
                expired_sessions.append(session_id)
                
        for sid in expired_sessions:
            print(f"Cleaning up session: {sid}")
            sessions.pop(sid, None)
            
        time.sleep(60)

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_sessions, daemon=True)
cleanup_thread.start()

@app.route('/')
def index():
    return render_template('sender.html')

@app.route('/r/<session_id>')
def receiver(session_id):
    if session_id not in sessions:
        return "Session not found or expired", 404
    return render_template('receiver.html', session_id=session_id)

@socketio.on('create_session')
def handle_create_session(data):
    print(f"Creating session for: {request.sid}")
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {
        "sender": request.sid,
        "receiver": None,
        "created_at": time.time(),
        "last_activity": time.time(),
        "status": "waiting",
        "file_metadata": data.get('metadata', {}),
        "last_chunk_index": 0
    }
    join_room(session_id)
    print(f"Session created: {session_id}")
    emit('session_created', {'session_id': session_id})

@socketio.on('join_session')
def handle_join_session(data):
    session_id = data.get('session_id')
    if session_id in sessions:
        sessions[session_id]['receiver'] = request.sid
        sessions[session_id]['last_activity'] = time.time()
        join_room(session_id)
        # Notify sender that receiver joined
        emit('receiver_joined', room=sessions[session_id]['sender'])
    else:
        emit('error', {'message': 'Session expired or invalid'})

@socketio.on('signal')
def handle_signal(data):
    session_id = data.get('session_id')
    if session_id in sessions:
        # Forward signaling messages (offer, answer, ice-candidates) to the other peer
        recipient = sessions[session_id]['receiver'] if request.sid == sessions[session_id]['sender'] else sessions[session_id]['sender']
        if recipient:
            emit('signal', data, room=recipient)

@socketio.on('heartbeat')
def handle_heartbeat(session_id):
    if session_id in sessions:
        sessions[session_id]['last_activity'] = time.time()

@socketio.on('status_update')
def handle_status_update(data):
    session_id = data.get('session_id')
    status = data.get('status')
    if session_id in sessions:
        sessions[session_id]['status'] = status
        sessions[session_id]['last_activity'] = time.time()
        if status == 'completed':
            # Will be cleaned up by background thread or immediately
            pass

@socketio.on('disconnect')
def handle_disconnect():
    for session_id, data in sessions.items():
        if request.sid == data.get('sender') or request.sid == data.get('receiver'):
            data['status'] = 'disconnected'
            data['last_activity'] = time.time()
            emit('peer_disconnected', room=session_id)
            break

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
