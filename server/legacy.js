// Serves the TV pages (display, chooser and their scripts) in a form older TV
// browsers can run: the 2016 Fire TV Stick (Chrome 59 web view) and Samsung
// Tizen 5.5 (Chrome 69). esbuild rewrites newer JavaScript syntax (like
// {...spread} and ?.) into older equivalents, and a few missing built-ins get
// small stand-ins. Modern browsers run the rewritten code just the same.
// Results are cached until the source file changes. If esbuild isn't
// available the files are sent unchanged.
const fs = require('fs');
const path = require('path');

let esbuild = null;
try {
  esbuild = require('esbuild');
} catch (e) {}

const TARGET = ['chrome58', 'safari11'];

const POLYFILLS = `(function(){var A=Array.prototype;
if(!A.flat){Object.defineProperty(A,'flat',{configurable:true,writable:true,value:function(d){d=d===undefined?1:Math.floor(d);var o=[];(function f(a,n){for(var i=0;i<a.length;i++){if(!(i in a))continue;var v=a[i];if(Array.isArray(v)&&n>0)f(v,n-1);else o.push(v);}})(this,d);return o;}});}
if(!A.flatMap){Object.defineProperty(A,'flatMap',{configurable:true,writable:true,value:function(fn,t){return A.map.call(this,fn,t).flat(1);}});}
if(!Object.fromEntries){Object.fromEntries=function(it){var o={};Array.from(it).forEach(function(p){o[p[0]]=p[1];});return o;};}
if(typeof Promise!=='undefined'&&!Promise.prototype.finally){Promise.prototype.finally=function(f){var P=this.constructor;return this.then(function(v){return P.resolve(f()).then(function(){return v;});},function(e){return P.resolve(f()).then(function(){throw e;});});};}
if(!String.prototype.replaceAll){String.prototype.replaceAll=function(s,r){return s instanceof RegExp?this.replace(s,r):this.split(s).join(typeof r==='function'?r(s):r);};}
if(!Array.prototype.at){Object.defineProperty(A,'at',{configurable:true,writable:true,value:function(i){i=Math.trunc(i)||0;if(i<0)i+=this.length;return this[i];}});}
if(typeof globalThis==='undefined'){window.globalThis=window;}
})();
`;

const cache = new Map(); // file -> { mtimeMs, body }

function lowerJs(code, name) {
  if (!esbuild) return code;
  try {
    return esbuild.transformSync(code, { loader: 'js', target: TARGET, sourcefile: name, charset: 'utf8' }).code;
  } catch (e) {
    console.error(`Legacy build of ${name} failed: ${e.message}`);
    return code;
  }
}

function build(file) {
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.body;
  const src = fs.readFileSync(file, 'utf8');
  let body;
  if (file.endsWith('.js')) {
    body = lowerJs(src, path.basename(file));
  } else {
    // HTML: lower each inline <script> (not ones with src=), and put the
    // stand-ins first so every script can rely on them.
    let first = true;
    body = src.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => {
      const out = (first ? POLYFILLS : '') + lowerJs(code, path.basename(file));
      first = false;
      return `<script>${out}</script>`;
    });
    if (first) body = body.replace(/<script/, `<script>${POLYFILLS}</script><script`);
  }
  cache.set(file, { mtimeMs: st.mtimeMs, body });
  return body;
}

// Express handlers.
// Each start of the app (every update restarts it) gets a new tag on the
// page's scripts and styles, so phones and TVs never keep an old copy.
const BOOT = Date.now().toString(36);
const versioned = (html) => html.replace(/((?:src|href)="\/static\/[^"?]+\.(?:js|css))"/g, `$1?v=${BOOT}"`);

function sendPage(file, opts = {}) {
  return (req, res, next) => {
    try {
      const html = opts.raw ? fs.readFileSync(file, 'utf8') : build(file);
      res.type('html').set('Cache-Control', 'no-cache').send(versioned(html));
    } catch (e) {
      next(e);
    }
  };
}

function scripts(dir, names) {
  return (req, res, next) => {
    const name = req.path.replace(/^\//, '');
    if (!names.includes(name)) return next();
    try {
      res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(build(path.join(dir, name)));
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { sendPage, scripts, available: () => !!esbuild };
