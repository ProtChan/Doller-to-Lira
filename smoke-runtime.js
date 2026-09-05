const fs = require('fs');
const vm = require('vm');

const storage = new Map();
global.localStorage = {
  getItem: (k) => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

global.document = {
  readyState: 'loading',
  addEventListener: (name, fn) => {
    if (name !== 'DOMContentLoaded' || typeof fn !== 'function') {
      throw new Error('Unexpected document event binding');
    }
  },
  getElementById: () => null,
  querySelectorAll: () => [],
};

global.window = { addEventListener: () => {} };
global.confirm = () => true;

global.Chart = undefined;

const code = fs.readFileSync('app.js', 'utf8');
vm.runInThisContext(code, { filename: 'app.js' });

if (typeof bootstrap !== 'function') throw new Error('bootstrap is not defined');
if (typeof switchTab !== 'function') throw new Error('switchTab is not defined');
if (typeof openSettings !== 'function') throw new Error('openSettings is not defined');
console.log('runtime smoke test passed');
