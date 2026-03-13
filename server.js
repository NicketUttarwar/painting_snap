/**
 * Serves the app and accepts POST /api/save-export to write exports to output_defaults/.
 * Run: node server.js
 */

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DEFAULTS = path.join(__dirname, 'output_defaults');
const PORT = 3333;

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '1mb' }));

// API routes must be registered before express.static so they are not shadowed
app.get('/api/health', (req, res) => {
  res.json({ ok: true, saveExport: true, message: 'Save API is available. Use POST /api/save-export to save exports.' });
});

app.post('/api/save-export', upload.any(), (req, res) => {
  const folderName = (req.body && req.body.folderName) || 'corrected';
  const manifestStr = req.body && req.body.manifest;
  const files = req.files || [];

  if (!manifestStr) {
    return res.status(400).json({ error: 'Missing manifest' });
  }

  const subdir = folderName;
  const outDir = path.join(OUTPUT_DEFAULTS, subdir);

  try {
    if (!fs.existsSync(OUTPUT_DEFAULTS)) {
      fs.mkdirSync(OUTPUT_DEFAULTS, { recursive: true });
    }
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestStr, 'utf8');

    for (const file of files) {
      const name = file.originalname || file.fieldname || 'file';
      if (!name) continue;
      fs.writeFileSync(path.join(outDir, name), file.buffer);
    }

    const saved = ['manifest.json', ...files.map((f) => f.originalname || f.fieldname).filter(Boolean)];
    res.json({ ok: true, saved, path: subdir });
  } catch (e) {
    console.error('Save export error:', e);
    res.status(500).json({ error: e.message || 'Failed to save' });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Section Image Correction Editor at http://localhost:${PORT}`);
  console.log(`Exports save to ${OUTPUT_DEFAULTS}/`);
});
