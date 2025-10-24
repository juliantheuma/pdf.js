# Fittxly - PDF Processing Utilities

A Node.js server that uploads PDFs and automatically converts them to PNG images using PDF.js.

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

### Start the Server
```bash
npm start
# or
node server.js
```

The server will start at **http://localhost:3000**

---

## 📋 Features

✅ **PDF Upload** - Upload PDFs via web interface or API  
✅ **Auto-Conversion** - Automatically converts all pages to PNG images  
✅ **Organized Storage** - Creates separate folders for each PDF's images  
✅ **Progress Logging** - Console logs show conversion progress  

---

## 🌐 Usage

### Web Interface
1. Open http://localhost:3000 in your browser
2. Click "Choose File" and select a PDF
3. Click "Upload & Convert PDF"
4. Wait for conversion to complete
5. View the list of converted images

### API (cURL)
```bash
curl -X POST -F "pdf=@/path/to/your/file.pdf" http://localhost:3000/upload
```

---

## 📁 File Structure

```
fittxly/
├── server.js           # Express server with PDF conversion
├── pdf2png.mjs         # Convert first page to PNG
├── pdf2pngMulti.mjs    # Convert all pages to PNG
├── getinfo.mjs         # Extract PDF metadata and text
├── main.js             # Main entry point with examples
├── uploads/            # Uploaded PDFs
│   └── filename_images/  # Converted PNG images
├── package.json
└── README.md
```

---

## 📄 Standalone Scripts

You can also use the PDF processing scripts directly:

### Extract PDF Info
```bash
node getinfo.mjs path/to/file.pdf
```

### Convert First Page to PNG
```bash
node pdf2png.mjs path/to/file.pdf
```

### Convert All Pages to PNG
```bash
node pdf2pngMulti.mjs path/to/file.pdf
```

---

## 🔧 Configuration

Edit `server.js` to customize:
- **Port**: Change `PORT` variable (default: 3000)
- **Upload folder**: Change `destination` in multer config
- **File size limit**: Adjust `limits.fileSize` (default: 50MB)
- **Image scale**: Modify `scale` in `getViewport()` (default: 1.5)

---

## 🖼️ Output

When you upload a PDF named `example.pdf`:
- Original PDF saved to: `uploads/example.pdf`
- Images saved to: `uploads/example_images/`
  - `page-1.png`
  - `page-2.png`
  - `page-3.png`
  - etc.

---

## 🛑 Stopping the Server

```bash
# Find and kill the process
lsof -ti:3000 | xargs kill

# Or if running in foreground, press Ctrl+C
```

---

## 📦 Dependencies

- **express** - Web server framework
- **multer** - File upload handling
- **pdfjs-dist** - PDF rendering (from parent project)

---

## 🐛 Troubleshooting

### "DOMMatrix is not defined"
Make sure you're using Node.js v22+:
```bash
node -v  # Should show v22.21.0 or higher
```

### Font warnings
Font warnings are harmless. Images will still be created with fallback fonts. To fix, update font paths in `server.js` to point to `../build/dist/standard_fonts/`

### Port already in use
Change the port in `server.js` or kill the existing process:
```bash
lsof -ti:3000 | xargs kill
```

---

## 📝 License

Same as PDF.js parent project (Apache-2.0)

