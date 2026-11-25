import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { extractDatesFromImageBuffer } from './claude.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PDF_JOB_SCRIPT = path.join(__dirname, 'pdf-job.js');

// Enable CORS for all origins
app.use(cors());


// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Save files to 'uploads' folder
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

// File filter to only accept PDFs
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2000 * 1024 * 1024 // 50MB limit
  }
});

// Multer config for PNG image uploads (used by /suggest-page)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG or JPEG images are allowed!'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});


// PDF jobs run in a child process (pdf-job.js) so that all memory they use is
// returned to the OS when the job ends. Only one job runs at a time; further
// uploads wait in line, which keeps peak memory bounded.
let jobQueue = Promise.resolve();

function runPdfJob(pdfPath, onProgress, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      return resolve({ success: false, error: 'Client disconnected' });
    }

    const child = fork(PDF_JOB_SCRIPT, [], { stdio: 'inherit' });
    let result = null;

    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });

    child.on('message', (msg) => {
      if (msg.kind === 'progress') onProgress(msg.data);
      else if (msg.kind === 'result') result = msg.result;
    });

    child.on('exit', (code, sig) => {
      signal.removeEventListener('abort', abort);
      resolve(result ?? {
        success: false,
        error: signal.aborted
          ? 'Client disconnected'
          : `PDF job exited unexpectedly (code ${code}, signal ${sig})`,
      });
    });

    child.send({ pdfPath });
  });
}

function enqueuePdfJob(pdfPath, onProgress, signal) {
  const job = jobQueue.then(() => runPdfJob(pdfPath, onProgress, signal));
  jobQueue = job.catch(() => {});
  return job;
}

// Upload endpoint with Server-Sent Events for progress
app.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    console.log('❌ No file uploaded');
    return res.status(400).json({
      success: false,
      error: 'No file uploaded'
    });
  }

  // Console log the file name
  console.log('📄 Uploaded file name:', req.file.originalname);
  console.log('📁 Saved as:', req.file.filename);
  console.log('📊 File size:', (req.file.size / 1024).toFixed(2), 'KB');
  console.log('📍 Saved to:', req.file.path);
  console.log('---');

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Helper function to send SSE messages
  const sendProgress = (data) => {

    // console.log("Sending progress!");
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const filePath = req.file.path;

  const cleanup = () => {
    fs.unlink(filePath, (err) => {
      if (err) console.error('❌ Failed to delete uploaded file:', err.message);
    });
  };

  // Kill the job if the client goes away before it finishes
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abortController.abort();
  });

  try {
    // Send initial progress
    sendProgress({
      type: 'progress',
      stage: 'uploading',
      message: 'File uploaded successfully, starting processing...',
      progress: 0
    });

    // Process PDF in a separate process; forward all progress events to client
    const result = await enqueuePdfJob(filePath, sendProgress, abortController.signal);

    if (!result.success) {
      sendProgress({
        type: 'error',
        error: result.error,
        message: 'PDF processing failed'
      });
      cleanup();
      return res.end();
    }

    console.log('🔍 Total sections found:', result.sections.length);

    // Send final result
    sendProgress({
      type: 'complete',
      success: true,
      sections: result.sections,
      firstSectionPage: result.firstSectionPage,
      timeToFirstSection: result.timeToFirstSection,
      progress: 100
    });

    cleanup();
    res.end();
  } catch (error) {
    console.error('❌ Processing error:', error);
    sendProgress({
      type: 'error',
      error: error.message,
      message: 'Processing failed'
    });
    cleanup();
    res.end();
  }
});

// Suggest endpoint: accepts a single PNG/JPEG page image and returns Claude suggestions
app.post('/suggest-page', imageUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image uploaded' });
  }

  try {
    const mediaType = req.file.mimetype === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const suggestions = await extractDatesFromImageBuffer(req.file.buffer, mediaType);

    if (!suggestions) {
      return res.status(422).json({ success: false, error: 'Claude could not extract data from the image' });
    }

    return res.json({ success: true, suggestions });
  } catch (error) {
    console.error('❌ /suggest-page error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('❌ Multer error:', err.message);
    return res.status(400).json({
      success: false,
      error: 'Upload error',
      message: err.message
    });
  } else if (err) {
    console.error('❌ Error:', err.message);
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  next();
});

// Start the server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   📄 PDF Upload & Convert Server Running!    ║
╚═══════════════════════════════════════════════╝

🌐 Server URL: http://localhost:${PORT}
📁 Upload folder: ${path.join(__dirname, 'uploads')}
🖼️  Feature: Auto-convert PDFs to PNG images

Ready to accept PDF uploads and convert them!
  `);
});


