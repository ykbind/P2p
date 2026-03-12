// File Transfer Worker
// Responsible for slicing files and managing the chunk flow to the main thread

let isPaused = false;
let currentChunkIndex = 0;
let file = null;

onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'START_TRANSFER':
            file = data.file;
            currentChunkIndex = data.resumeFrom || 0;
            isPaused = false;
            readNextChunk();
            break;
        
        case 'RESUME':
            isPaused = false;
            readNextChunk();
            break;

        case 'PEER_READY':
            isPaused = false;
            readNextChunk();
            break;

        case 'CANCEL':
            isPaused = true;
            file = null;
            break;
    }
};

async function readNextChunk() {
    if (isPaused || !file) return;

    // Use current dynamic chunk size (could be passed in or calculated here)
    const CHUNK_SIZE = 64 * 1024; // Base 64KB
    const start = currentChunkIndex * CHUNK_SIZE;

    if (start >= file.size) {
        postMessage({ type: 'COMPLETE' });
        return;
    }

    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    
    // We use FileReaderSync inside a worker for simplicity if available, 
    // or the standard FileReader as it is also async here.
    const reader = new FileReader();
    reader.onload = (event) => {
        postMessage({
            type: 'CHUNK_READY',
            data: {
                chunk: event.target.result,
                index: currentChunkIndex,
                sent: end
            }
        });
        currentChunkIndex++;
    };
    reader.readAsArrayBuffer(blob);
}
