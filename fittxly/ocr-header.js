import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PDFJS_DIST_DIR_CANDIDATES = [
  path.join(__dirname, "..", "node_modules", "pdfjs-dist"),
  path.join(__dirname, "node_modules", "pdfjs-dist"),
];
const PDFJS_DIST_DIR =
  PDFJS_DIST_DIR_CANDIDATES.find(candidate => fs.existsSync(candidate)) ??
  PDFJS_DIST_DIR_CANDIDATES[0];
const PDFJS_LOADING_OPTIONS = {
  cMapUrl: `${path.join(PDFJS_DIST_DIR, "cmaps")}${path.sep}`,
  cMapPacked: true,
  standardFontDataUrl: `${path.join(PDFJS_DIST_DIR, "standard_fonts")}${path.sep}`,
};

// Get PDF path from command line argument or use default
const pdfPath = process.argv[2] || path.join(__dirname, 'Searches Borg Jonathan & Giselle 19-10-2022-1-228.pdf');

// Function to check if text contains section keywords
function checkForNewSection(text) {
  const keywords = [
    'Searches Unit',
    'IDENTITY',
    'Archbishop Street',
    'Valletta',
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

//   if( !lowerText.includes('liabilities') && !lowerText.includes('transfers')){ return false; }
  if (lowerText.includes('invoice')){ return false; }
  if (lowerText.includes('transfers from')){ return true; }
  if (lowerText.includes('liabilities from')){ return true; }
  if (lowerText.includes('searches of')){ return true; }

  const isSection = foundCount >= 3;
  return isSection;
}

async function ocrPdfHeader(pdfPath) {
  const startTime = Date.now();
  
  console.log('🚀 Starting PDF Header OCR');
  console.log(`📄 PDF: ${path.basename(pdfPath)}`);
  console.log('─'.repeat(60));
  console.log('');

  // Check if PDF exists
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const pdfStats = fs.statSync(pdfPath);
  console.log(`📊 PDF Size: ${(pdfStats.size / 1024).toFixed(2)} KB\n`);

  try {
    // Load PDF
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = getDocument({
      data,
      ...PDFJS_LOADING_OPTIONS,
    });

    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;
    console.log(`📄 Total pages: ${numPages}\n`);

    const canvasFactory = pdfDocument.canvasFactory;
    
    // Create pool of 4 workers
    const NUM_WORKERS = 12;
    console.log(`🔧 Creating worker pool (${NUM_WORKERS} workers)...`);
    const workerPool = await Promise.all(
      Array(NUM_WORKERS).fill(null).map(() => createWorker('eng'))
    );
    console.log(`✅ Worker pool ready\n`);
    
    // Header height percentage (25% of page)
    const HEADER_PERCENTAGE = 0.1;
    
    // Track first section detection
    let firstSectionTime = null;
    let firstSectionPage = null;
    
    console.log('─'.repeat(60));
    console.log('Processing pages...\n');

    // Process page function
    async function processPage(pageNum, worker) {
      const pageStartTime = Date.now();
      
      console.log(`📍 Page ${pageNum}/${numPages} (Worker ${workerPool.indexOf(worker) + 1})`);
      console.log(`   Rendering page...`);

      // Render page to canvas
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

      await page.render(renderContext).promise;

      // Extract header portion (top 25%)
      const headerHeight = Math.floor(viewport.height * HEADER_PERCENTAGE);
      
      // Create a new canvas for the header
      const headerCanvasAndContext = canvasFactory.create(
        viewport.width,
        headerHeight
      );
      const headerContext = headerCanvasAndContext.context;
      
      // Extract image data from top portion of original canvas
      const originalContext = canvasAndContext.context;
      const imageData = originalContext.getImageData(0, 0, viewport.width, headerHeight);
      
      // Put the image data into the header canvas
      headerContext.putImageData(imageData, 0, 0);
      
      const headerImage = headerCanvasAndContext.canvas.toBuffer("image/png");
      
      // Cleanup page resources
      page.cleanup();

      console.log(`   Running OCR on top ${(HEADER_PERCENTAGE * 100).toFixed(0)}%...`);

      // OCR header
      const { data: { text } } = await worker.recognize(headerImage);
      
      // Check if this is a section
      const isSection = checkForNewSection(text);
      
      const pageDuration = ((Date.now() - pageStartTime) / 1000).toFixed(2);
      const progress = ((pageNum / numPages) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`   ✅ OCR Complete (${pageDuration}s)`);
      console.log(`   Progress: ${progress}% | Total time: ${elapsed}s`);
      
      // Track first section detection (by page number, not completion order)
      if (isSection) {
        if (firstSectionTime === null || pageNum < firstSectionPage) {
          firstSectionTime = Date.now();
          firstSectionPage = pageNum;
          const timeToFirstSection = ((firstSectionTime - startTime) / 1000).toFixed(2);
          console.log(`   ${isSection ? '⭐ SECTION FOUND' : '⏭️  Not a section'}`);
          console.log(`   🎯 FIRST SECTION DETECTED! (Page ${pageNum}, ${timeToFirstSection}s from start)`);
        } else {
          console.log(`   ${isSection ? '⭐ SECTION FOUND' : '⏭️  Not a section'}`);
        }
      } else {
        console.log(`   ${isSection ? '⭐ SECTION FOUND' : '⏭️  Not a section'}`);
      }
      console.log('');
      console.log('   📝 OCR Text:');
      console.log('   ' + '─'.repeat(56));
      console.log('   ' + text.split('\n').filter(line => line.trim()).join('\n   '));
      console.log('   ' + '─'.repeat(56));
      console.log('');

      return { pageNum, text, duration: pageDuration, isSection };
    }

    // Process pages in batches using round-robin
    const results = [];
    const batchSize = NUM_WORKERS;
    
    for (let i = 0; i < numPages; i += batchSize) {
      const batch = [];
      
      // Create batch of pages to process
      for (let j = 0; j < batchSize && (i + j) < numPages; j++) {
        const pageNum = i + j + 1;
        // Round-robin: assign page to worker based on page number
        const worker = workerPool[(pageNum - 1) % NUM_WORKERS];
        batch.push(processPage(pageNum, worker));
      }
      
      // Process batch in parallel
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      
      // Sort results by page number for consistent output
      results.sort((a, b) => a.pageNum - b.pageNum);
    }

    // Cleanup all workers
    console.log('🧹 Cleaning up workers...');
    await Promise.all(workerPool.map(worker => worker.terminate()));

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Count sections found
    const sectionsFound = results.filter(r => r.isSection).length;
    const sectionPages = results.filter(r => r.isSection).map(r => r.pageNum);
    
    console.log('─'.repeat(60));
    console.log('✅ Processing Complete!');
    console.log(`⏱️  Total time: ${totalDuration}s`);
    console.log(`📄 Pages processed: ${numPages}`);
    console.log(`⚡ Average time per page: ${(totalDuration / numPages).toFixed(2)}s`);
    console.log(`👷 Workers used: ${NUM_WORKERS}`);
    console.log(`⭐ Sections found: ${sectionsFound}`);
    if (sectionsFound > 0) {
      console.log(`📋 Section pages: ${sectionPages.join(', ')}`);
    }
    if (firstSectionTime !== null) {
      const timeToFirstSection = ((firstSectionTime - startTime) / 1000).toFixed(2);
      console.log(`🎯 Time to first section: ${timeToFirstSection}s (Page ${firstSectionPage})`);
    } else {
      console.log(`🎯 Time to first section: N/A (no sections found)`);
    }
    console.log('─'.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
ocrPdfHeader(pdfPath);

