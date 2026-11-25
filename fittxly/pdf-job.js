// Runs one PDF job in its own process. The parent (server.js) forks this file
// per upload; when the job ends the process exits, so the OS reclaims all of
// its memory (canvas, Tesseract WASM heaps, V8 heap) instead of it lingering
// in the long-lived server process.
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from 'tesseract.js';
import { extractDatesFromImageBuffer } from './claude.js';

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
    const companyIndicators = ['CHICKENNNCNECNEJCNENC',
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
      'id card', 'passport', 'nee'
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

  // console.log(text)

  const keywords = [
    'Searches Unit',
    'Searches Results',
    'IDENTITY',
    'Front Page',
    // 'Archbishop Street',
    // 'Achbishop Street',
    // 'Valletta',
    // 'bishop',
    'IDENTITY Searches',
    // 'Avchbishop Street',

  ];

  const keywords2 = [
    'SEARCHES OF',
    'LIABILITIES FROM',
    'TRANSFERS FROM',
    'TRANSFERS TO',
    'LIABILITIES TO',
    'FIDI FROM',
    'FIDI TO',
  ]

  const lowerText = text.toLowerCase();
  let foundCount = 0;
  let foundCount2 = 0;
  const foundKeywords = [];
  const foundKeywords2 = [];

  keywords.forEach(keyword => {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundCount++;
      foundKeywords.push(keyword);
    }
  });

  keywords2.forEach(keyword => {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundCount2++;
      foundKeywords2.push(keyword);
    }
  });

  console.log("foundKeywords: ", foundKeywords)
  console.log("foundKeywords2: ", foundKeywords2)

  if (lowerText.includes('invoice')){ return false; }
  // if (lowerText.includes('no remarks')){ return false; }

  const isSection = foundCount >= 1 && foundCount2 >= 1;
  if(isSection) { console.log(text) }
  return isSection;
};

// Optimized PDF processing function using worker pool + header OCR
async function processPdfPages(pdfPath, progressCallback) {
  console.log(`🔄 Starting processing of: ${pdfPath}`);

  const startTime = Date.now();
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  const loadingTask = getDocument({
    data,
    ...PDFJS_LOADING_OPTIONS,
  });

  let pdfDocument = null;
  let workerPool = [];

  try {
    pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;
    console.log(`📄 PDF has ${numPages} pages`);

    const canvasFactory = pdfDocument.canvasFactory;
    const sections = [];

    const NUM_WORKERS = Number(process.env.OCR_WORKERS) || 4;
    const HEADER_PERCENTAGE = 0.5;
    let firstSectionTime = null;
    let firstSectionPage = null;

    console.log(`🔧 Creating worker pool (${NUM_WORKERS})...`);
    workerPool = await Promise.all(
      Array(NUM_WORKERS).fill(null).map(() => createWorker('eng'))
    );
    console.log(`✅ Worker pool ready`);

    async function processPage(pageNum, worker) {
      let page = null;
      let headerCanvas = null;
      let fullCanvas = null;

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

        page = await pdfDocument.getPage(pageNum);

        const fullViewport = page.getViewport({ scale: 1.5 });

        let headerHeight = Math.floor(fullViewport.height * HEADER_PERCENTAGE);
        if (headerHeight < 10) headerHeight = 10;

        const headerViewport = page.getViewport({
          scale: 1.5,
          rotation: page.rotate,
        });

        headerViewport.height = headerHeight;
        headerViewport.viewBox = [0, 0, fullViewport.width, headerHeight];

        headerCanvas = canvasFactory.create(
          headerViewport.width,
          headerViewport.height
        );

        await page.render({
          canvasContext: headerCanvas.context,
          viewport: headerViewport,
        }).promise;

        const headerPNG = headerCanvas.canvas.toBuffer("image/jpeg", { quality: 0.8});
        canvasFactory.destroy(headerCanvas);
        headerCanvas = null;

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

        const { data: { text: headerText } } = await worker.recognize(headerPNG);
        const isSectionHeader = checkForNewSection(headerText);

        if (!isSectionHeader) {
          page.cleanup();
          page = null;

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

        if (progressCallback) {
          progressCallback({
            type: "progress",
            stage: "full_ocr",
            current: pageNum,
            total: numPages,
            message: `Header matched — full OCR for page ${pageNum}`,
          });
        }

        fullCanvas = canvasFactory.create(
          fullViewport.width,
          fullViewport.height
        );

        await page.render({
          canvasContext: fullCanvas.context,
          viewport: fullViewport,
        }).promise;

        const fullPNG = fullCanvas.canvas.toBuffer("image/jpeg", { quality: 0.8});
        canvasFactory.destroy(fullCanvas);
        fullCanvas = null;

        if (!fullPNG || fullPNG.length < 100) {
          throw new Error(`Full PNG invalid on page ${pageNum}`);
        }

        const { data: { text } } = await worker.recognize(fullPNG);

        let suggestions = null;
        try {
          suggestions = await extractDatesFromImageBuffer(fullPNG, "image/jpeg");
        } catch (suggestionError) {
          console.error(`❌ Claude suggestions failed on page ${pageNum}:`, suggestionError);
        }

        page.cleanup();
        page = null;

        const documentType =
          suggestions?.document_type === "COMPANY" || suggestions?.document_type === "INDIVIDUAL"
            ? suggestions.document_type
            : detectDocumentType(text);
        const section = {
          page: pageNum,
          text,
          documentType,
          suggestions: suggestions || null,
        };

        sections.push(section);

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

        if (headerCanvas) { canvasFactory.destroy(headerCanvas); }
        if (fullCanvas) { canvasFactory.destroy(fullCanvas); }
        if (page) { page.cleanup(); }

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

    await Promise.all(pagePromises);

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
  } finally {
    await Promise.all(workerPool.map((w) => w.terminate()));
    if (pdfDocument) { pdfDocument.destroy(); }
  }
}

// IPC protocol: parent sends { pdfPath }; we reply with
// { kind: 'progress', data } messages and one { kind: 'result', result }, then exit.
function send(msg) {
  return new Promise(resolve => process.send(msg, resolve));
}

process.once('message', async ({ pdfPath }) => {
  let result;
  try {
    result = await processPdfPages(pdfPath, data => {
      process.send({ kind: 'progress', data });
    });
  } catch (error) {
    result = { success: false, error: error.message };
  }
  await send({ kind: 'result', result });
  process.exit(0);
});
