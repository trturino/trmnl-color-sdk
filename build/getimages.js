#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Jimp = require('jimp');
const { program } = require('commander');
const minimatch = require('minimatch');

program
  .argument('<cssSource>', 'Local CSS file path or URL')
  .option('-b, --base-url <url>', 'Base URL for resolving relative image paths')
  .option('-o, --output <dir>', 'Output root directory', 'output_images')
  .option('-c, --color <name:#RRGGBB>', 'Color mapping; repeatable', (v, a) => a.concat(v), [])
  .option('-f, --filter <glob>', 'Glob pattern to exclude matching paths; repeatable', (v, a) => a.concat(v), [])
  .parse(process.argv);

const opts = program.opts();
const cssSource = program.args[0];

async function fetchCss(source) {
  try {
    let content;
    if (/^https?:\/\//.test(source)) {
      console.log(`Fetching CSS from: ${source}`);
      const res = await axios.get(source, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        responseType: 'text',
        validateStatus: status => status >= 200 && status < 300
      });
      content = res.data;
    } else {
      console.log(`Reading local CSS file: ${source}`);
      content = fs.readFileSync(source, 'utf8');
    }
    
    // Basic validation to ensure we got CSS content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Empty or invalid CSS content');
    }
    
    return content;
  } catch (error) {
    console.error(`Error fetching CSS from ${source}:`, error.message);
    throw error;
  }
}

function findPngUrls(css) {
  // First, clean up the CSS by removing comments and newlines
  const cleanCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove CSS comments
    .replace(/\s+/g, ' ');                // Collapse whitespace

  // Look for URL patterns in the CSS
  const re = /url\(['"]?([^'")]+\.png)['"]?\s*\)/gi;
  const urls = [];
  let match;
  
  while ((match = re.exec(cleanCss)) !== null) {
    // Clean up the URL by removing any query strings or fragments
    const cleanUrl = match[1]
      .split('?')[0]    // Remove query string
      .split('#')[0]     // Remove fragment
      .replace(/^['"]|['"]$/g, ''); // Remove surrounding quotes if any
    
    if (!urls.includes(cleanUrl)) {
      urls.push(cleanUrl);
    }
  }
  
  return urls;
}

function parseColors(colorArgs) {
  const defaults = {
    green:  [0, 128, 0],
    yellow: [255, 255, 0],
    red:    [255, 0, 0],
    blue:   [0, 0, 255],
  };
  if (!colorArgs.length) return defaults;

  const colors = {};
  for (let entry of colorArgs) {
    const [name, hex] = entry.split(':');
    if (!name || !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
      console.error(`Invalid --color entry: ${entry}`);
      process.exit(1);
    }
    const h = hex.replace(/^#/, '');
    colors[name] = [
      parseInt(h.slice(0,2), 16),
      parseInt(h.slice(2,4), 16),
      parseInt(h.slice(4,6), 16),
    ];
  }
  return colors;
}

async function fetchImage(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Jimp.read(res.data);
}

async function processAndSave(img, rgb, outPath) {
  const clone = img.clone();
  clone.scan(0, 0, clone.bitmap.width, clone.bitmap.height, function(x, y, idx) {
    const r = this.bitmap.data[idx + 0];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    const a = this.bitmap.data[idx + 3];

    // 1) White → transparent
    if (a !== 0 && r === 255 && g === 255 && b === 255) {
      this.bitmap.data[idx + 3] = 0;
      return;
    }

    // 2) Black → your color
    if (a !== 0 && r === 0 && g === 0 && b === 0) {
      this.bitmap.data[idx + 0] = rgb[0];
      this.bitmap.data[idx + 1] = rgb[1];
      this.bitmap.data[idx + 2] = rgb[2];
    }
  });

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await clone.writeAsync(outPath);
  console.log(`    ↳ saved → ${outPath}`);
}

(async () => {
  try {
    console.log('Starting image extraction process...');
    
    // Fetch and process CSS
    console.log(`Processing CSS source: ${cssSource}`);
    const css = await fetchCss(cssSource);
    console.log(`Successfully fetched CSS (${css.length} characters)`);
    
    // Extract image URLs
    console.log('Extracting image URLs from CSS...');
    let paths = findPngUrls(css);
    console.log(`Found ${paths.length} image references in CSS`);

    // Apply filters if any
    if (opts.filter.length) {
      console.log(`Applying filters: ${opts.filter.join(', ')}`);
      const beforeCount = paths.length;
      paths = paths.filter(p => !opts.filter.some(pat => minimatch(p, pat)));
      const filteredCount = beforeCount - paths.length;
      console.log(`Filtered out ${filteredCount} images, ${paths.length} remaining`);
    }

    if (!paths.length) {
      console.log('No .png URLs to process.');
      return;
    }

    // Parse and validate colors
    const colors = parseColors(opts.color);
    console.log(`Generating color variants for: ${Object.keys(colors).join(', ')}`);
    
    // Ensure output directory exists
    await fs.promises.mkdir(opts.output, { recursive: true });
    console.log(`Output directory: ${path.resolve(opts.output)}`);

    for (let rel of paths) {
      let url;
      if (/^https?:\/\//.test(rel)) {
        url = rel;
      } else if (opts.baseUrl) {
        url = new URL(rel, opts.baseUrl).toString();
      } else {
        console.warn(`Skipping (no base URL): ${rel}`);
        continue;
      }

      console.log(`\nProcessing image: ${url}`);
      let img;
      try {
        console.log(`  Downloading from: ${url}`);
        img = await fetchImage(url);
        console.log(`  ✓ Downloaded (${img.bitmap.width}×${img.bitmap.height})`);
      } catch (e) {
        console.error(`  ✗ Failed to download: ${e.message}`);
        continue;
      }

      const cleanRel = rel.replace(/^\/+/, '');
      for (let [name, rgb] of Object.entries(colors)) {
        const outFile = path.join(opts.output, name, cleanRel);
        console.log(`  → Saving ${name} variant to: ${outFile}`);
        try {
          await processAndSave(img, rgb, outFile);
          console.log(`  ✓ Saved ${name} variant`);
        } catch (e) {
          console.error(`  ✗ Failed to save ${name} variant: ${e.message}`);
        }
      }
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();