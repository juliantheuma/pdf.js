/* Copyright 2017 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from "fs";
import { getDocument } from "../build/dist/legacy/build/pdf.mjs";

// Some PDFs need external cmaps.
const CMAP_URL = "../node_modules/pdfjs-dist/cmaps/";
const CMAP_PACKED = true;

// Where the standard fonts are located.
const STANDARD_FONT_DATA_URL = "../node_modules/pdfjs-dist/standard_fonts/";

// Loading file from file system into typed array.
const pdfPath = process.argv[2] || "../web/compressed.tracemonkey-pldi-09.pdf";
const data = new Uint8Array(fs.readFileSync(pdfPath));

// Load the PDF file.
const loadingTask = getDocument({
  data,
  cMapUrl: CMAP_URL,
  cMapPacked: CMAP_PACKED,
  standardFontDataUrl: STANDARD_FONT_DATA_URL,
});

try {
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  console.log(`# PDF document loaded. Converting ${numPages} pages...`);
  
  const canvasFactory = pdfDocument.canvasFactory;
  
  // Loop through all pages
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    console.log(`Processing page ${pageNum}/${numPages}...`);
    
    // Get the page
    const page = await pdfDocument.getPage(pageNum);
    
    // Render the page on a Node canvas with 100% scale.
    const viewport = page.getViewport({ scale: 1.0 });
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
    
    // Convert the canvas to an image buffer.
    const image = canvasAndContext.canvas.toBuffer("image/png");
    
    // Save with page number in filename
    const outputPath = `page-${pageNum}.png`;
    await fs.promises.writeFile(outputPath, image);
    console.log(`  ✓ Saved ${outputPath}`);
    
    // Release page resources.
    page.cleanup();
  }
  
  console.log(`\n✓ Finished! Converted ${numPages} pages to PNG images.`);
} catch (reason) {
  console.error("Error:", reason);
}

