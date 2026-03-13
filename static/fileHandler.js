function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    if (isNaN(bytes) || bytes < 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const sizeLabels = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    // Check if we are formatting speed or size
    const labels = (arguments.callee.caller && arguments.callee.caller.name === 'getStats') ? sizes : sizeLabels;
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizeLabels[i];
}

class FileHandler {
    constructor() {
        this.receivedChunks = [];
        this.receivedSize = 0;
        this.totalSize = 0;
        this.fileName = "";
        this.fileType = "";
        this.startTime = 0;
    }

    init(name, size, type) {
        this.fileName = name;
        this.totalSize = size;
        this.fileType = type;
        this.receivedChunks = [];
        this.receivedSize = 0;
        this.startTime = Date.now();
    }

    addChunk(chunk) {
        this.receivedChunks.push(chunk);
        this.receivedSize += chunk.byteLength;
    }

    startTimer() {
        this.startTime = Date.now();
    }

    save() {
        const blob = new Blob(this.receivedChunks, { type: this.fileType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = this.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getStats(bytesTransferred, totalSize) {
        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000;
        const speed = elapsed > 0 ? bytesTransferred / elapsed : 0;
        
        const remainingBytes = totalSize - bytesTransferred;
        let eta = "Finalizing...";
        if (remainingBytes > 0 && speed > 0) {
            const remainingSeconds = Math.ceil(remainingBytes / speed);
            if (remainingSeconds < 60) {
                eta = `${remainingSeconds}s`;
            } else {
                const mins = Math.floor(remainingSeconds / 60);
                const secs = remainingSeconds % 60;
                eta = `${mins}m ${secs}s`;
            }
        } else if (remainingBytes <= 0) {
            eta = "Complete";
        }

        return {
            speed: this.formatSpeed(speed),
            eta: eta
        };
    }

    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '0 Bytes/s';
        const k = 1024;
        const sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}