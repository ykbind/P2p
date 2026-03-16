self.onmessage = function(e) {
    const { file, chunkSize } = e.data;
    let offset = 0;
    const reader = new FileReaderSync(); // Using Sync version in Worker

    while (offset < file.size) {
        try {
            const slice = file.slice(offset, offset + chunkSize);
            const buffer = reader.readAsArrayBuffer(slice);
            self.postMessage({ buffer, offset, done: false }, [buffer]);
            offset += chunkSize;
        } catch (err) {
            self.postMessage({ error: err.message });
            break;
        }
    }
    self.postMessage({ done: true });
};