import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDocument } from "../build/dist/legacy/build/pdf.mjs";
import { createWorker } from 'tesseract.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS for all origins
app.use(cors());

// PDF to PNG conversion function
async function convertPdfToImages(pdfPath, progressCallback) {
  console.log(`🔄 Starting conversion of: ${pdfPath}`);
  
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  
  const loadingTask = getDocument({
    data,
    cMapUrl: "../build/dist/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "../build/dist/standard_fonts/",
    wasmUrl: "../build/dist/wasm/",
  });

  const startTime = Date.now();

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
      
      if (progressCallback) {
        progressCallback({
          stage: 'converting',
          current: pageNum,
          total: numPages,
          message: `Converting page ${pageNum} of ${numPages} to image`
        });
      }
      
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
    fileSize: 2000 * 1024 * 1024 // 50MB limit
  }
});

async function convertToText(imagesFolder, progressCallback) {
    console.log(`🔄 Starting conversion of: ${imagesFolder}`);
  
    const worker = await createWorker('eng');
    const sections = [];
  
    const files = fs.readdirSync(imagesFolder)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10);
        const numB = parseInt(b.match(/\d+/)[0], 10);
        return numA - numB;
      });
  
    const totalFiles = files.length;
    let currentFile = 0;
  
    for (const image of files) {
      currentFile++;
      const imagePath = path.join(imagesFolder, image);
      console.log('🔍 Processing image:', imagePath);

      if (progressCallback) {
        progressCallback({
          stage: 'ocr',
          current: currentFile,
          total: totalFiles,
          message: `Processing OCR on page ${currentFile} of ${totalFiles}`
        });
      }

      const { data: { text } } = await worker.recognize(imagePath);
      const _isSection = checkForNewSection(text);
      if (_isSection) {
        // Extract page number from filename (e.g., "page-1.png" -> 1)
        const pageNumber = parseInt(image.match(/\d+/)[0], 10);
        const section = {
          page: pageNumber,
          text: text,
          documentType: detectDocumentType(text)
        };
        sections.push(section);
        
        // Emit section found event
        if (progressCallback) {
          progressCallback({
            type: 'section_found',
            section: section,
            message: `Found section on page ${pageNumber}`
          });
        }
      }
    }
  
    await worker.terminate();
    return sections;
  }

  // Function to detect document type based on OCR text
  const detectDocumentType = (text) => {

    // console.log("text: ", text)
    const lowerText = text.toLowerCase();
    
    // Primary company detection - check for specific patterns first
    // Check for company number pattern like 'C-9279472' (C- followed by any amount of numbers)
    const companyNumberPattern = /C-\d+/i;
    if (companyNumberPattern.test(text)) {
      console.log("companyNumberPattern.test(text)")
      return 'COMPANY';
    }
    
    // Check for "Comp. Reg. No." or "Company Reg. No." pattern
    const compRegPattern = /comp\.?\s*reg\.?\s*no\.?/i;
    if (compRegPattern.test(text)) {
      console.log("compRegPattern.test(text)")
      return 'COMPANY';
    }
    
    // Secondary company indicators (fallback)
    const companyIndicators = ['CHICKENNNCNECNEJCNENC', 'limited'
      // 'company', 'ltd', 'limited', 'inc', 'corp', 'corporation', 'plc', 'llc',
      // 'company number', 'registration number', 'reg no', 'company reg'
    ];

    if(companyIndicators.some(indicator => lowerText.includes(indicator))){
      console.log("companyIndicators.some(indicator => lowerText.includes(indicator))")
      return 'COMPANY';
    }
    
    // Individual indicators
    const individualIndicators = [
      'name', 'spouse',
      'date of birth', 'birthplace',
      'father', 'mother',
      'id card', 'passport',
    ];
    
    // Count matches for each category
    const companyScore = companyIndicators.reduce((score, indicator) => {
      return score + (lowerText.includes(indicator) ? 1 : 0);
    }, 0);
    
    const individualScore = individualIndicators.reduce((score, indicator) => {
      return score + (lowerText.includes(indicator) ? 1 : 0);
    }, 0);

    console.log("companyScore: ", companyScore)
    console.log("individualScore: ", individualScore)
    
    // Return the category with the highest score, or default to company if no clear match
    const maxScore = Math.max(companyScore, individualScore);
    if (maxScore === 0) return 'COMPANY'; // Default to company
    
    if (individualScore > companyScore) return 'INDIVIDUAL';
    return 'COMPANY'; // Default to company if scores are equal or company is higher
  };
  

function checkForNewSection(text) {

  console.log(text)

  const keywords = [
    'Searches Unit',
    'IDENTITY',
    'Archbishop Street',
    'Achbishop Street',
    'Valletta',
    'bishop',
    'IDENTITY Searches',
    'Avchbishop Street',
    'SEARCHES OF',
    'LIABILITIES FROM',
    'TRANSFERS FROM',
  ];

  const lowerText = text.toLowerCase();
  let foundCount = 0;
  const foundKeywords = [];

  keywords.forEach(keyword => {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundCount++;
      foundKeywords.push(keyword);
    }
  });

  if (lowerText.includes('invoice')){ return false; }
  
  if (lowerText.includes('transfers from')){ return true; }
  if (lowerText.includes('liabilities from')){ return true; }
  if (lowerText.includes('searches of')){ return true; }

  const isSection = foundCount >= 1;
  return isSection;
};

// Optimized PDF processing function using worker pool + header OCR
async function processPdfPages(pdfPath, progressCallback) {
  console.log(`🔄 Starting processing of: ${pdfPath}`);

  const startTime = Date.now();
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  const loadingTask = getDocument({
    data,
    cMapUrl: "../build/dist/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "../build/dist/standard_fonts/",
    wasmUrl: "../build/dist/wasm/",
  });

  try {
    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;
    console.log(`📄 PDF has ${numPages} pages`);

    const canvasFactory = pdfDocument.canvasFactory;
    const sections = [];

    const NUM_WORKERS = 8;
    const HEADER_PERCENTAGE = 0.1;
    let firstSectionTime = null;
    let firstSectionPage = null;

    console.log(`🔧 Creating worker pool (${NUM_WORKERS})...`);
    const workerPool = await Promise.all(
      Array(NUM_WORKERS).fill(null).map(() => createWorker('eng'))
    );
    console.log(`✅ Worker pool ready`);

    async function processPage(pageNum, worker) {
      try {
        const pageStartTime = Date.now();
    
        if (progressCallback) {
          progressCallback({
            type: "progress",
            stage: "converting",
            current: pageNum,
            total: numPages,
            message: `Rendering header of page ${pageNum}/${numPages}`,
          });
        }
    
        const page = await pdfDocument.getPage(pageNum);
    
        // Full page viewport (used later if needed)
        const fullViewport = page.getViewport({ scale: 1.5 });
    
        // -------------------------------
        // 1️⃣ HEADER-ONLY RENDER
        // -------------------------------
    
        let headerHeight = Math.floor(fullViewport.height * HEADER_PERCENTAGE);
        if (headerHeight < 10) headerHeight = 10; // Safety
    
        // Cropped viewport for header-only rendering
        const headerViewport = page.getViewport({
          scale: 1.5,
          rotation: page.rotate,
        });
    
        // Clip to header region
        headerViewport.height = headerHeight;
        headerViewport.viewBox = [0, 0, fullViewport.width, headerHeight];
    
        const headerCanvas = canvasFactory.create(
          headerViewport.width,
          headerViewport.height
        );
    
        // Render ONLY the header area
        await page.render({
          canvasContext: headerCanvas.context,
          viewport: headerViewport,
        }).promise;
    
        // Convert header region to PNG
        const headerPNG = headerCanvas.canvas.toBuffer("image/jpeg", { quality: 0.8});
    
        if (!headerPNG || headerPNG.length < 50) {
          throw new Error(`Header PNG invalid on page ${pageNum}`);
        }
    
        if (progressCallback) {
          progressCallback({
            type: "progress",
            stage: "header_ocr",
            current: pageNum,
            total: numPages,
            message: `OCR header on page ${pageNum}`,
          });
        }
    
        // OCR header
        const { data: { text: headerText } } = await worker.recognize(headerPNG);
        const isSectionHeader = checkForNewSection(headerText);
    
        // ===============================
        //  SKIP FULL OCR IF NO MATCH
        // ===============================
        if (!isSectionHeader) {
          page.cleanup();
    
          if (progressCallback) {
            progressCallback({
              type: "progress",
              stage: "skipped",
              current: pageNum,
              total: numPages,
              message: `Header did not match — skipping full OCR`,
            });
          }
    
          return null;
        }
    
        // -------------------------------
        // 2️⃣ FULL PAGE OCR (ONLY IF MATCH)
        // -------------------------------
    
        if (progressCallback) {
          progressCallback({
            type: "progress",
            stage: "full_ocr",
            current: pageNum,
            total: numPages,
            message: `Header matched — full OCR for page ${pageNum}`,
          });
        }
    
        const fullCanvas = canvasFactory.create(
          fullViewport.width,
          fullViewport.height
        );
    
        await page.render({
          canvasContext: fullCanvas.context,
          viewport: fullViewport,
        }).promise;
    
        // Convert full page to PNG (Tesseract requirement)
        const fullPNG = fullCanvas.canvas.toBuffer("image/jpeg", { quality: 0.8});
    
        if (!fullPNG || fullPNG.length < 100) {
          throw new Error(`Full PNG invalid on page ${pageNum}`);
        }
    
        // OCR full page
        const { data: { text } } = await worker.recognize(fullPNG);
    
        page.cleanup();
    
        // Save section
        const section = {
          page: pageNum,
          text,
          documentType: detectDocumentType(text),
        };
    
        sections.push(section);
    
        // Track first detected section
        if (!firstSectionTime || pageNum < firstSectionPage) {
          firstSectionTime = Date.now();
          firstSectionPage = pageNum;
    
          if (progressCallback) {
            progressCallback({
              type: "first_section",
              page: pageNum,
              message: `First section detected`,
              timeFromStart: ((firstSectionTime - startTime) / 1000).toFixed(2),
            });
          }
        }
    
        if (progressCallback) {
          progressCallback({
            type: "section_found",
            section,
            message: `Found section on page ${pageNum}`,
          });
        }
    
        const duration = ((Date.now() - pageStartTime) / 1000).toFixed(2);
        console.log(`  ✅ Page ${pageNum} processed in ${duration}s`);
    
        return section;
    
      } catch (pageError) {
        console.error(`❌ Page ${pageNum} failed:`, pageError);
    
        if (progressCallback) {
          progressCallback({
            type: "page_error",
            stage: "error",
            page: pageNum,
            message: pageError.message,
          });
        }
    
        return null;
      }
    }
    
    

    // Queue-based processing: workers continuously pick up next available page
    let currentPage = 1;
    const pagePromises = [];

    // Start all workers processing pages from a shared queue
    for (let workerIndex = 0; workerIndex < NUM_WORKERS; workerIndex++) {
      const worker = workerPool[workerIndex];
      
      const workerPromise = (async () => {
        while (currentPage <= numPages) {
          const pageNum = currentPage++;
          await processPage(pageNum, worker);
        }
      })();
      
      pagePromises.push(workerPromise);
    }

    // Wait for all workers to finish
    await Promise.all(pagePromises);

    await Promise.all(workerPool.map((worker) => worker.terminate()));

    console.log(`✅ Processing complete! Found ${sections.length} sections`);

    return {
      success: true,
      numPages,
      sections,
      firstSectionPage,
      timeToFirstSection: firstSectionTime
        ? ((firstSectionTime - startTime) / 1000).toFixed(2)
        : null,
    };
  } catch (error) {
    console.error("❌ Processing error:", error);

    return {
      success: false,
      error: error.message,
    };
  }
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

    console.log("Sending progress!");
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Send initial progress
    sendProgress({ 
      type: 'progress',
      stage: 'uploading', 
      message: 'File uploaded successfully, starting processing...',
      progress: 0
    });

    // Process PDF with combined page-by-page approach
    const result = await processPdfPages(req.file.path, (progressData) => {
      // Forward all progress events to client
      sendProgress(progressData);
    });

    if (!result.success) {
      sendProgress({
        type: 'error',
        error: result.error,
        message: 'PDF processing failed'
      });
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

    res.end();
  } catch (error) {
    console.error('❌ Processing error:', error);
    sendProgress({
      type: 'error',
      error: error.message,
      message: 'Processing failed'
    });
    res.end();
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


