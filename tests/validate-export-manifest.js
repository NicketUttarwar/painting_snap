/**
 * Validates that a saved manifest.json has all required fields for re-load and reproducibility.
 * Usage: node tests/validate-export-manifest.js [path/to/manifest.json]
 * If no path given, validates the expected structure by building a minimal manifest shape.
 */
import fs from 'fs';
import path from 'path';

const requiredRoot = [
  'source_filename',
  'source_width',
  'source_height',
  'sections',
  'layout',
  'composite_filename',
];

const requiredSection = [
  'index',
  'filename',
  'bounds',
  'corners',
  'centroid_x',
  'centroid_y',
  'rotation_degrees',
  'output_width_px',
  'output_height_px',
];

const requiredLayout = ['reading_order', 'section_relations'];

const optionalButRecommended = ['output_rect', 'composite_width', 'composite_height', 'margin_px'];
const recreateFields = ['composite_width_px', 'composite_height_px', 'scale', 'margin_color', 'recreate_composite'];
const sectionRecreateFields = ['bounds_px'];

function validateManifest(manifest) {
  const errors = [];

  for (const key of requiredRoot) {
    if (manifest[key] === undefined) errors.push(`Missing root field: ${key}`);
  }

  if (!Array.isArray(manifest.sections)) {
    errors.push('sections must be an array');
  } else {
    for (let i = 0; i < manifest.sections.length; i++) {
      const s = manifest.sections[i];
      for (const key of requiredSection) {
        if (s[key] === undefined) errors.push(`Section ${i} missing: ${key}`);
      }
      if (s.corners && s.corners.length !== 4) {
        errors.push(`Section ${i} must have exactly 4 corners`);
      }
      if (s.bounds && (s.bounds.x === undefined || s.bounds.y === undefined || s.bounds.width === undefined || s.bounds.height === undefined)) {
        errors.push(`Section ${i} bounds must have x, y, width, height`);
      }
    }
  }

  if (manifest.layout) {
    for (const key of requiredLayout) {
      if (manifest.layout[key] === undefined) errors.push(`layout missing: ${key}`);
    }
  }

  for (const key of optionalButRecommended) {
    if (manifest[key] === undefined) {
      console.warn(`Optional field missing: ${key}`);
    }
  }

  // Reconstruction: need pixel dimensions and per-section bounds_px to recreate composite from section images
  for (const key of recreateFields) {
    if (manifest[key] === undefined) {
      errors.push(`Missing recreate field: ${key} (required to rebuild composite from sections)`);
    }
  }
  if (Array.isArray(manifest.sections)) {
    for (let i = 0; i < manifest.sections.length; i++) {
      const s = manifest.sections[i];
      for (const key of sectionRecreateFields) {
        if (s[key] === undefined) {
          errors.push(`Section ${i} missing: ${key} (required to place section in composite)`);
        } else if (key === 'bounds_px') {
          const bp = s.bounds_px;
          if (bp.x === undefined || bp.y === undefined || bp.width === undefined || bp.height === undefined) {
            errors.push(`Section ${i} bounds_px must have x, y, width, height`);
          }
        }
      }
    }
  }

  return errors;
}

const filePath = process.argv[2];

if (filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const errors = validateManifest(raw);
  if (errors.length) {
    console.error('Validation failed:');
    errors.forEach((e) => console.error('  -', e));
    process.exit(1);
  }
  console.log('Manifest valid. Sections:', raw.sections?.length);
  if (raw.output_rect) console.log('  output_rect:', raw.output_rect);
  if (raw.composite_width_px != null) console.log('  composite (px):', raw.composite_width_px, 'x', raw.composite_height_px);
  if (raw.rectilinear_polygon) console.log('  rectilinear_polygon vertices:', raw.rectilinear_polygon.length);
  process.exit(0);
} else {
  console.log('No manifest path provided. Expected structure:');
  console.log('  Root:', requiredRoot.join(', '));
  console.log('  Section:', requiredSection.join(', '));
  console.log('  Layout:', requiredLayout.join(', '));
  console.log('  Optional:', optionalButRecommended.join(', '));
  console.log('  Recreate (composite from sections):', recreateFields.join(', '), '; section:', sectionRecreateFields.join(', '));
  process.exit(0);
}
