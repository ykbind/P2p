import os
import secrets
import logging
from flask import Flask, render_template, request, redirect, jsonify
from flask_socketio import SocketIO, emit, join_room

# --- Logging ---
# In production (Render), suppress noisy SocketIO/engineio debug logs
IS_PROD = os.environ.get("RENDER") == "true"
log_level = logging.WARNING if IS_PROD else logging.INFO
logging.basicConfig(level=log_level)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get("SECRET_KEY", secrets.token_hex(16))

# SocketIO setup — optimised for Render.com:
#  - polling first then upgrade (Render's proxy is HTTP/1.1 friendly)
#  - ping_interval=25s / ping_timeout=60s to survive Render's 60s idle cut-off
#  - disable verbose loggers in prod to keep dyno logs clean
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='eventlet',
    engineio_logger=not IS_PROD,
    logger=not IS_PROD,
    allow_upgrades=True,
    transports=['polling', 'websocket'],
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=10 ** 8,   # 100 MB max signalling payload (not file data)
)

# ---------------------------------------------------------------------------
# HTTP Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("sender.html")

@app.route("/receive/<session_id>")
def receive(session_id):
    return render_template("receiver.html", session_id=session_id)

@app.route("/tos")
def tos():
    return render_template(
        "legal.html",
        title="Terms of Service",
        content="DropIt is a peer-to-peer file transfer tool. By using this service, you agree that files are transferred directly between users and are not stored on our servers. You are responsible for the content you share."
    )

@app.route("/privacy")
def privacy():
    return render_template(
        "legal.html",
        title="Privacy Policy",
        content="Your privacy is our priority. DropIt does not store your files. We only facilitate the peer-to-peer connection. Metadata is only used to establish the connection and is discarded immediately after."
    )

@app.route("/about")
def about():
    return redirect("https://ykblmao.xyz")

# Health-check endpoint — used by Render's health checks and uptime monitors
# (e.g. UptimeRobot) to keep the service warm and avoid cold-start spin-downs.
@app.route("/ping")
def ping():
    return jsonify({"status": "ok"}), 200

# ---------------------------------------------------------------------------
# SocketIO Signalling (relay only — no file data passes through here)
# ---------------------------------------------------------------------------

@socketio.on("create_session")
def on_create(data=None):
    sid = request.sid
    join_room(sid)
    logger.info("[SIGNAL] Sender %s created session", sid)
    emit("session_created", sid)

@socketio.on("join_session")
def on_join(data=None):
    target_sid = data
    if not target_sid:
        return
    join_room(target_sid)
    logger.info("[SIGNAL] Receiver %s joined sender %s", request.sid, target_sid)
    emit("receiver_joined", {"receiver_id": request.sid}, to=target_sid)

@socketio.on("signal")
def on_signal(data=None):
    if not isinstance(data, dict):
        return
    target = data.get("sid")
    if not target:
        return
    emit("signal", data.get("signal"), to=target, include_self=False)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = not IS_PROD
    logger.info("🚀 DropIt server starting on port %d (debug=%s)…", port, debug)
    socketio.run(app, host="0.0.0.0", port=port, debug=debug)