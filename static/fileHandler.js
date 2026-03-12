function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

class FileHandler {
    constructor() {
        this.receivedChunks = [];
        this.receivedSize = 0;
        this.startTime = 0;
    }

    static async getFileMetadata(file) {
        return {
            name: file.name,
            size: file.size,
            type: file.type
        };
    }

    startTimer() {
        this.startTime = Date.now();
    }

    getStats(bytesTransferred, totalSize) {
        const now = Date.now();
        const duration = (now - this.startTime) / 1000;
        const speed = duration > 0 ? bytesTransferred / duration : 0;
        
        // Calculate ETA
        const remainingBytes = totalSize - bytesTransferred;
        let eta = "Calculating...";
        if (speed > 0) {
            const remainingSeconds = Math.ceil(remainingBytes / speed);
            if (remainingSeconds < 60) {
                eta = `${remainingSeconds}s`;
            } else {
                const mins = Math.floor(remainingSeconds / 60);
                const secs = remainingSeconds % 60;
                eta = `${mins}m ${secs}s`;
            }
        }

        return {
            speed: formatSize(speed) + '/s',
            duration: Math.round(duration) + 's',
            eta: eta
        };
    }
}
