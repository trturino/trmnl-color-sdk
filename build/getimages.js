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
  if (/^https?:\/\//.test(source)) {
    const res = await axios.get(source);
    return res.data;
  } else {
    return fs.readFileSync(source, 'utf8');
  }
}

function findPngUrls(css) {
  const re = /url\(\s*['"]?(.*?\.png)['"]?\s*\)/gi;
  const urls = [];
  let m;
  while ((m = re.exec(css)) !== null) urls.push(m[1]);
  return urls;
}

function parseColors(colorArgs) {
  const defaults = {
    green:  [0, 255, 0],
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
    const r = this.bitmap.data[idx+0],
          g = this.bitmap.data[idx+1],
          b = this.bitmap.data[idx+2],
          a = this.bitmap.data[idx+3];
    if (a !== 0 && r===0 && g===0 && b===0) {
      this.bitmap.data[idx+0] = rgb[0];
      this.bitmap.data[idx+1] = rgb[1];
      this.bitmap.data[idx+2] = rgb[2];
    }
  });
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await clone.writeAsync(outPath);
  console.log(`    ↳ saved → ${outPath}`);
}

(async () => {
  try {
    const css = await fetchCss(cssSource);
    let paths = findPngUrls(css);

    // apply filters
    if (opts.filter.length) {
      console.log(`Applying filters: ${opts.filter.join(', ')}`);
      paths = paths.filter(p =>
        !opts.filter.some(pat => minimatch(p, pat))
      );
    }

    if (!paths.length) {
      console.log('No .png URLs to process.');
      return;
    }

    const colors = parseColors(opts.color);
    console.log(`Generating variants for: ${Object.keys(colors).join(', ')}`);

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

      console.log(`Fetching ${url} …`);
      let img;
      try {
        img = await fetchImage(url);
      } catch (e) {
        console.error(`  ✗ failed to load: ${e.message}`);
        continue;
      }

      const cleanRel = rel.replace(/^\/+/, '');
      for (let [name, rgb] of Object.entries(colors)) {
        const outFile = path.join(opts.output, name, cleanRel);
        await processAndSave(img, rgb, outFile);
      }
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();