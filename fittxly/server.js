import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDocument } from "../build/dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// PDF to PNG conversion function
async function convertPdfToImages(pdfPath) {
  console.log(`🔄 Starting conversion of: ${pdfPath}`);
  
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  
  const loadingTask = getDocument({
    data,
    cMapUrl: "../build/dist/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "../build/dist/standard_fonts/",
  });

  try {
    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;
    console.log(`📄 PDF has ${numPages} pages`);
    
    const canvasFactory = pdfDocument.canvasFactory;
    const convertedImages = [];
    
    // Create images folder based on PDF filename
    const pdfBasename = path.basename(pdfPath, '.pdf');
    const imagesFolder = path.join(__dirname, 'uploads', `${pdfBasename}_images`);
    
    // Create the folder if it doesn't exist
    if (!fs.existsSync(imagesFolder)) {
      fs.mkdirSync(imagesFolder, { recursive: true });
    }
    
    // Loop through all pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      console.log(`  Processing page ${pageNum}/${numPages}...`);
      
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvasAndContext = canvasFactory.create(
        viewport.width,
        viewport.height
      );
      const renderContext = {
        canvasContext: canvasAndContext.context,
        viewport,
      };

      const renderTask = page.render(renderContext);
      await renderTask.promise;
      
      const image = canvasAndContext.canvas.toBuffer("image/png");
      const outputPath = path.join(imagesFolder, `page-${pageNum}.png`);
      
      await fs.promises.writeFile(outputPath, image);
      convertedImages.push({
        page: pageNum,
        filename: `page-${pageNum}.png`,
        path: outputPath,
        relativePath: `${pdfBasename}_images/page-${pageNum}.png`
      });
      
      page.cleanup();
    }
    
    console.log(`✅ Conversion complete! Created ${numPages} images in: ${imagesFolder}`);
    
    return {
      success: true,
      numPages,
      imagesFolder,
      images: convertedImages
    };
  } catch (error) {
    console.error("❌ Conversion error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

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
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Serve a simple HTML form for testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>PDF Upload</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
        }
        .upload-form {
          border: 2px dashed #ccc;
          padding: 30px;
          border-radius: 10px;
          text-align: center;
        }
        input[type="file"] {
          margin: 20px 0;
        }
        button {
          background: #007bff;
          color: white;
          padding: 10px 30px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        }
        button:hover {
          background: #0056b3;
        }
        .message {
          margin-top: 20px;
          padding: 15px;
          border-radius: 5px;
        }
        .success {
          background: #d4edda;
          color: #155724;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <h1>📄 PDF Upload & Convert Server</h1>
      <div class="upload-form">
        <h2>Upload a PDF File</h2>
        <p style="color: #666; font-size: 14px;">Your PDF will be automatically converted to PNG images</p>
        <form action="/upload" method="POST" enctype="multipart/form-data">
          <input type="file" name="pdf" accept=".pdf" required>
          <br>
          <button type="submit">Upload & Convert PDF</button>
        </form>
        <div id="message"></div>
      </div>
    </body>
    </html>
  `);
});

// Upload endpoint
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

  // Convert PDF to images
  const conversionResult = await convertPdfToImages(req.file.path);

  if (conversionResult.success) {
    res.json({
      success: true,
      message: 'PDF uploaded and converted successfully',
      file: {
        originalName: req.file.originalname,
        savedAs: req.file.filename,
        size: req.file.size,
        sizeKB: parseFloat((req.file.size / 1024).toFixed(2)),
        path: req.file.path
      },
      conversion: {
        numPages: conversionResult.numPages,
        imagesFolder: conversionResult.imagesFolder,
        images: conversionResult.images
      }
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'PDF uploaded but conversion failed',
      error: conversionResult.error,
      file: {
        originalName: req.file.originalname,
        savedAs: req.file.filename,
        size: req.file.size,
        path: req.file.path
      }
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
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

