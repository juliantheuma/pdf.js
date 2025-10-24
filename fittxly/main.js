// Main entry point for fittxly PDF processing utilities
// You can import and use the PDF.js library from here

import { getDocument } from "../build/dist/legacy/build/pdf.mjs";

console.log("Fittxly PDF.js utilities ready!");
console.log("");
console.log("Available scripts:");
console.log("  node fittxly/getinfo.mjs [pdf-file]   - Extract PDF metadata and text");
console.log("  node fittxly/pdf2png.mjs [pdf-file]   - Convert first page to PNG");
console.log("");
console.log("You can also import { getDocument } from '../build/dist/legacy/build/pdf.mjs' to use PDF.js directly!");

// Example: Load and display basic info about a PDF
const pdfPath = process.argv[2];
if (pdfPath) {
  console.log(`Loading: ${pdfPath}`);
  const loadingTask = getDocument(pdfPath);
  loadingTask.promise
    .then(doc => {
      console.log(`✓ PDF loaded successfully`);
      console.log(`  Pages: ${doc.numPages}`);
    })
    .catch(err => {
      console.error(`Error loading PDF: ${err}`);
    });
} else {
  console.log("Usage: node fittxly/main.js <path-to-pdf>");
}

