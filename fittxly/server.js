import express from 'express';
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

async function convertToText(imagesFolder) {
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
  
    for (const image of files) {
      const imagePath = path.join(imagesFolder, image);
      console.log('🔍 Processing image:', imagePath);
  
      const { data: { text } } = await worker.recognize(imagePath);
      const _isSection = checkForNewSection(text);
      if (_isSection) sections.push({
        text: text,
        documentType: detectDocumentType(text)
      });
    }
  
    await worker.terminate();
    return sections;
  }

  // Function to detect document type based on OCR text
  const detectDocumentType = (text) => {

    console.log("text: ", text)
    const lowerText = text.toLowerCase();
    
    // Primary company detection - check for specific patterns first
    // Check for company number pattern like 'C-9279472' (C- followed by any amount of numbers)
    const companyNumberPattern = /C-\d+/i;
    if (companyNumberPattern.test(text)) {
      console.log("companyNumberPattern.test(text)")
      return 'companies';
    }
    
    // Check for "Comp. Reg. No." or "Company Reg. No." pattern
    const compRegPattern = /comp\.?\s*reg\.?\s*no\.?/i;
    if (compRegPattern.test(text)) {
      console.log("compRegPattern.test(text)")
      return 'companies';
    }
    
    // Secondary company indicators (fallback)
    const companyIndicators = ['CHICKENNNCNECNEJCNENC'
      // 'company', 'ltd', 'limited', 'inc', 'corp', 'corporation', 'plc', 'llc',
      // 'company number', 'registration number', 'reg no', 'company reg'
    ];

    if(companyIndicators.some(indicator => lowerText.includes(indicator))){
      console.log("companyIndicators.some(indicator => lowerText.includes(indicator))")
      return 'companies';
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
    if (maxScore === 0) return 'companies'; // Default to company
    
    if (individualScore > companyScore) return 'individuals';
    return 'companies'; // Default to company if scores are equal or company is higher
  };
  

function checkForNewSection(text) {
    const keywords = [
      'Searches Unit',
      'Group Reference',
      'IDENTITY',
      'Archbishop Street',
      'Search Results',
      'Searches of',
      'Liabilities From',
      'Transfers From',
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

    if( !lowerText.includes('liabilities') && !lowerText.includes('transfers')){ return false; }
    if (lowerText.includes('invoice')){ return false; }

    const isSection = foundCount >= 3;
    return isSection;
  };
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

    const sections = await convertToText(conversionResult.imagesFolder);
    console.log('🔍 Sections:', sections);

    res.json({
      success: true,
      sections: sections
    //   message: 'PDF uploaded and converted successfully',
    //   file: {
    //     originalName: req.file.originalname,
    //     savedAs: req.file.filename,
    //     size: req.file.size,
    //     sizeKB: parseFloat((req.file.size / 1024).toFixed(2)),
    //     path: req.file.path
    //   },
    //   conversion: {
    //     numPages: conversionResult.numPages,
    //     imagesFolder: conversionResult.imagesFolder,
    //     images: conversionResult.images
    //   }
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

