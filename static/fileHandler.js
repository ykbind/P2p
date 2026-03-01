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

    getStats(bytesTransferred) {
        const now = Date.now();
        const duration = (now - this.startTime) / 1000;
        const speed = duration > 0 ? bytesTransferred / duration : 0;
        return {
            speed: formatSize(speed) + '/s',
            duration: Math.round(duration) + 's'
        };
    }
}
