const { parentPort } = require('worker_threads');
const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

parentPort.on('message', (pdfBuffer) => {
  pdfExtract.extractBuffer(pdfBuffer, {}, (err, data) => {
    if (err) {
      parentPort.postMessage({ success: false, error: err.message });
      return;
    }

    try {
      // 1. CPU/Page Exhaustion Protection
      if (data.pages && data.pages.length > 500) {
        parentPort.postMessage({ success: false, error: 'PDF exceeds maximum allowed pages (500).' });
        return;
      }

      // 2. Memory/Decompression Bomb Protection
      let extractedText = '';
      const MAX_CHARS = 1000000; // ~1MB of raw text

      for (const page of data.pages) {
        const pageText = page.content.map(item => item.str).join(' ');
        extractedText += pageText + '\n\n';

        if (extractedText.length > MAX_CHARS) {
          extractedText = extractedText.substring(0, MAX_CHARS);
          break;
        }
      }

      extractedText = extractedText.trim();
      if (!extractedText) {
        parentPort.postMessage({ success: false, error: 'No text extracted from PDF' });
        return;
      }

      const newChunks = extractedText.split('\n\n').filter(chunk => chunk.trim() !== '');
      parentPort.postMessage({ success: true, chunks: newChunks, extractedText });
    } catch (error) {
      parentPort.postMessage({ success: false, error: error.message });
    }
  });
});
